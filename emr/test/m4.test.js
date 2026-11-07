'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');
const M = require('../lib/maternal');

let server, base, db, mw;
before(async () => {
  db = dbm.open(':memory:'); seed(db, { demo: true });
  server = createServer(db); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  mw = await as('midwife1');
});
after(() => server.close());
async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const jar = {};
async function as(u) { if (!jar[u]) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: DEMO_PASSWORD }) }); assert.equal(r.status, 200); jar[u] = r.headers.get('set-cookie').split(';')[0]; } return jar[u]; }
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const lmpAt = (w, d = 0) => iso(-(w * 7 + d));
const dobYearsAgo = (y, extraDays = 40) => iso(-(y * 365 + Math.floor(y / 4) + extraDays));
async function newPatient(name, dob, extra = {}) { const r = await call('POST', '/api/patients', { name_en: name, sex: 'F', dob, force: true, ...extra }, await as('reg1')); assert.equal(r.status, 201); return r.data.id; }
// A fresh open clinic visit for the patient (previous open visits are closed first so each ANC contact has its own visit).
async function visitFor(pid) {
  db.prepare("UPDATE encounters SET status='cancelled' WHERE patient_id=? AND status NOT IN ('signed','cancelled')").run(pid);
  const r = await call('POST', `/api/patients/${pid}/checkin`, { type: 'antenatal' }, await as('reg1')); assert.equal(r.status, 201); return r.data.id;
}
const book = (pid, over = {}) => call('POST', `/api/patients/${pid}/anc-episodes`, { lmp: lmpAt(28), lmp_certain: true, gravida: 2, para: 1, living_children: 1, ...over }, jar.midwife1);
const goodBabies = [{ outcome: 'live', sex: 'F', birth_weight_g: 3100, apgar1: 8, apgar5: 9, breastfed_within_hour: true }];
const delivery = (over = {}) => ({ delivered_on: iso(0), mode: 'svd', place: 'clinic', maternal_outcome: 'well', newborns: goodBabies, ...over });

test('booking: roles, LMP and obstetric history validation', async () => {
  const p = await newPatient('Anc Woman One', dobYearsAgo(28));
  assert.equal((await call('POST', `/api/patients/${p}/anc-episodes`, { lmp: lmpAt(10), gravida: 1, para: 0 }, await as('nurse1'))).status, 403);
  assert.equal((await call('GET', `/api/patients/${p}/mch`, undefined, await as('pharm1'))).status, 403);
  assert.equal((await call('GET', `/api/patients/${p}/mch`, undefined, await as('nurse1'))).status, 200);
  for (const [bad, why] of [[{ lmp: iso(5) }, 'future LMP'], [{ lmp: lmpAt(50) }, 'LMP over 43 weeks ago'], [{ lmp: '2026-02-30' }, 'invalid date'], [{ gravida: 1, para: 1 }, 'para >= gravida'],
    [{ gravida: 0 }, 'gravida 0'], [{ risk_factors: ['nonsense'] }, 'unknown risk'], [{ lmp: lmpAt(10), us_date: iso(-3), us_weeks: 99 }, 'scan weeks']]) {
    assert.equal((await book(p, bad)).status, 400, why);
  }
});
test('booking: EDD from LMP, automatic risks, one active record per patient', async () => {
  const p = await newPatient('Anc Woman Two', dobYearsAgo(37));
  const r = await book(p, { lmp: lmpAt(17, 1), gravida: 6, para: 5 });
  assert.equal(r.status, 201); assert.equal(r.data.edd, M.eddFromLmp(lmpAt(17, 1))); assert.equal(r.data.edd_source, 'lmp');
  assert.deepEqual(r.data.risks.sort(), ['age_35_plus', 'grand_multipara']);
  const dup = await book(p); assert.equal(dup.status, 409); assert.equal(dup.data.episode_id, r.data.id);
  const ep = (await call('GET', `/api/anc-episodes/${r.data.id}`, undefined, mw)).data.episode;
  assert.equal(ep.ga_text, '17w 1d'); assert.ok(ep.alerts.some((a) => a.code === 'high_risk'));
});
test('booking: ultrasound can override a doubtful LMP', async () => {
  const p = await newPatient('Anc Woman Three', dobYearsAgo(25));
  const lmp = lmpAt(14); // LMP says 14 weeks; scan 2 weeks ago said 8w0d => 10 weeks today
  const r = await book(p, { lmp, lmp_certain: true, gravida: 1, para: 0, us_date: iso(-14), us_weeks: 8, us_days: 0 });
  assert.equal(r.status, 201); assert.equal(r.data.edd_source, 'ultrasound'); assert.equal(r.data.discrepancy_days, 28);
  const p2 = await newPatient('Anc Woman Four', dobYearsAgo(25));
  const r2 = await book(p2, { lmp: lmpAt(14), lmp_certain: true, gravida: 1, para: 0, us_date: iso(-14), us_weeks: 12, us_days: 3 });
  assert.equal(r2.data.edd_source, 'lmp'); // scan agrees within 7 days
  const p3 = await newPatient('Anc Woman Five', dobYearsAgo(25));
  assert.equal((await book(p3, { lmp: lmpAt(14), us_date: iso(-30), us_weeks: 5 + 0, us_days: 0 }).then((x) => x.status)), 201);
  assert.equal((await book(await newPatient('Anc Woman Six', dobYearsAgo(25)), { us_date: iso(2), us_weeks: 8 })).status, 400); // scan date in the future
});
test('booking: child patient age check', async () => {
  const kid = await newPatient('Too Young', iso(-9 * 365));
  assert.equal((await book(kid, { lmp: lmpAt(10), gravida: 1, para: 0 })).status, 400);
});

let ep1, pid1, enc1;
test('antenatal visit: visit required, validation, alerts, one per clinic visit', async () => {
  pid1 = await newPatient('Anc Visit Woman', dobYearsAgo(30));
  ep1 = (await book(pid1, { lmp: lmpAt(26), gravida: 3, para: 2, living_children: 2 })).data.id;
  assert.equal((await call('POST', `/api/anc-episodes/${ep1}/visits`, { sys: 120, dia: 80 }, mw)).status, 400); // no visit
  const other = await newPatient('Someone Else', dobYearsAgo(30)); const otherEnc = await visitFor(other);
  assert.equal((await call('POST', `/api/anc-episodes/${ep1}/visits`, { encounter_id: otherEnc, sys: 120, dia: 80 }, mw)).status, 400); // other patient's visit
  enc1 = await visitFor(pid1);
  for (const bad of [{ sys: 80, dia: 90 }, { sys: 120, dia: 80, fhr: 300 }, { sys: 120, dia: 80, presentation: 'upside' }, { danger_signs: ['nonsense'] }, { }, { sys: 120, dia: 80, urine_protein: 'lots' }, { sys: 120, dia: 80, next_visit_date: iso(-1) }, { weight: 5 }]) {
    assert.equal((await call('POST', `/api/anc-episodes/${ep1}/visits`, { encounter_id: enc1, ...bad }, mw)).status, 400, JSON.stringify(bad));
  }
  const ok = await call('POST', `/api/anc-episodes/${ep1}/visits`, { encounter_id: enc1, sys: 148, dia: 96, urine_protein: '2+', weight: 66, fundal_height: 26, fhr: 140, presentation: 'cephalic', fetal_movement: 'present', hb: 10.4, iron_folate: true, counselling: 'Birth plan' }, mw);
  assert.equal(ok.status, 201); assert.deepEqual(ok.data.alerts.map((a) => a.code).sort(), ['anaemia', 'bp_high', 'preeclampsia_suspected']);
  assert.equal(ok.data.ga_text, '26w 0d');
  assert.equal((await call('POST', `/api/anc-episodes/${ep1}/visits`, { encounter_id: enc1, sys: 120, dia: 80 }, mw)).status, 409); // same visit twice
});
test('antenatal visit: closed clinic visits are refused; the episode shows next contact and alerts', async () => {
  const done = await visitFor(pid1); db.prepare("UPDATE encounters SET status='signed' WHERE id=?").run(done);
  assert.equal((await call('POST', `/api/anc-episodes/${ep1}/visits`, { encounter_id: done, sys: 120, dia: 80 }, mw)).status, 409);
  const e = (await call('GET', `/api/anc-episodes/${ep1}`, undefined, mw)).data;
  assert.equal(e.visits.length, 1); assert.equal(e.episode.next_contact.week, 30); assert.equal(e.episode.next_contact.overdue, false);
  assert.ok(e.episode.latest_visit_alerts.some((a) => a.code === 'preeclampsia_suspected'));
});
test('antenatal register: critical alerts first; restricted names hidden', async () => {
  const doc = await as('doctor1');
  await call('GET', `/api/patients/3?reason=${encodeURIComponent('Antenatal booking')}`, undefined, doc);
  const ep3 = (await call('POST', '/api/patients/3/anc-episodes', { lmp: lmpAt(33), lmp_certain: true, gravida: 3, para: 2 }, doc)); assert.equal(ep3.status, 201);
  const reg = (await call('GET', '/api/mch/register?tab=antenatal', undefined, await as('nurse1'))).data.rows;
  assert.equal(reg[0].alert_level, 2); assert.equal(reg[0].patient.id, pid1);
  const restricted = reg.find((r) => r.patient.restricted); assert.equal(restricted.patient.name_en, null);
  assert.equal((await call('GET', '/api/mch/register', undefined, await as('lab1'))).status, 403);
});
test('overdue contact is detected', async () => {
  const p = await newPatient('Overdue Woman', dobYearsAgo(27)); const id = (await book(p, { lmp: lmpAt(23), gravida: 2, para: 1 })).data.id;
  const e = (await call('GET', `/api/anc-episodes/${id}`, undefined, mw)).data.episode;
  assert.deepEqual([e.next_contact.week, e.next_contact.overdue, e.next_contact.first], [12, true, true]); // 23 weeks and no visit yet
});

test('partograph: observations, flags, regression warning, validation', async () => {
  const p = await newPatient('Labour Woman', dobYearsAgo(26)); const id = (await book(p, { lmp: lmpAt(39), gravida: 2, para: 1 })).data.id;
  assert.equal((await call('POST', `/api/anc-episodes/${id}/partograph`, {}, mw)).status, 400);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/partograph`, { cervix_cm: 11 }, mw)).status, 400);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/partograph`, { cervix_cm: 5, recorded_at: 'yesterday' }, mw)).status, 400);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/partograph`, { cervix_cm: 5 }, await as('nurse1'))).status, 403);
  const a = await call('POST', `/api/anc-episodes/${id}/partograph`, { recorded_at: `${iso(0)} 08:00`, cervix_cm: 5, descent: 3, contractions: 4, fhr: 140, liquor: 'clear' }, mw);
  assert.equal(a.status, 201); assert.deepEqual(a.data.flags, []);
  const b = await call('POST', `/api/anc-episodes/${id}/partograph`, { recorded_at: `${iso(0)} 10:00`, cervix_cm: 4, contractions: 2, fhr: 105, liquor: 'meconium' }, mw);
  assert.deepEqual(b.data.flags.map((f) => f.code).sort(), ['contractions_weak', 'dilatation_decreased', 'fhr_abnormal', 'liquor_meconium']);
  const e = (await call('GET', `/api/anc-episodes/${id}`, undefined, mw)).data; assert.equal(e.partograph.length, 2); assert.equal(e.partograph[0].cervix_cm, 5);
  const noDeliveryPostnatal = await call('POST', `/api/anc-episodes/${id}/postnatal`, { sys: 120, dia: 80 }, mw); assert.equal(noDeliveryPostnatal.status, 409);
});

test('delivery: validation and atomicity', async () => {
  const p = await newPatient('Delivery Woman', dobYearsAgo(29)); const id = (await book(p, { lmp: lmpAt(39, 3), gravida: 3, para: 2 })).data.id;
  const bad = [[{ delivered_on: iso(2) }, 'future'], [{ mode: 'magic' }, 'mode'], [{ newborns: [] }, 'no babies'], [{ maternal_outcome: 'referred' }, 'referral destination'],
    [{ newborns: [{ outcome: 'live', sex: 'F', birth_weight_g: 3000 }] }, 'apgar missing'], [{ newborns: [{ outcome: 'live', birth_weight_g: 3000, apgar1: 8, apgar5: 9 }] }, 'sex missing'],
    [{ newborns: [{ outcome: 'live', sex: 'F', birth_weight_g: 100, apgar1: 8, apgar5: 9 }] }, 'weight'], [{ blood_loss_ml: -5 }, 'blood loss'], [{ delivered_time: '25:00' }, 'time']];
  for (const [o, why] of bad) assert.equal((await call('POST', `/api/anc-episodes/${id}/delivery`, delivery(o), mw)).status, 400, why);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/delivery`, delivery({ delivered_on: iso(-(39 * 7 + 3 - 19 * 7)) }), mw)).status, 400); // 19 weeks of gestation: that is a miscarriage, not a delivery
  const patientsBefore = db.prepare('SELECT COUNT(*) c FROM patients').get().c;
  const half = await call('POST', `/api/anc-episodes/${id}/delivery`, delivery({ newborns: [goodBabies[0], { outcome: 'live', sex: 'M', birth_weight_g: 100, apgar1: 8, apgar5: 9 }] }), mw);
  assert.equal(half.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM patients').get().c, patientsBefore); // nothing half-created
  assert.equal(db.prepare('SELECT COUNT(*) c FROM deliveries WHERE episode_id=?').get(id).c, 0);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/delivery`, delivery(), await as('nurse1'))).status, 403);
});
test('delivery: a database failure part-way rolls everything back', async () => {
  const p = await newPatient('Rollback Mother', dobYearsAgo(29)); const id = (await book(p, { lmp: lmpAt(38), gravida: 2, para: 1 })).data.id;
  const counts = () => ['patients', 'deliveries', 'newborns'].map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
  const before = counts();
  db.exec("CREATE TRIGGER fail_second_baby BEFORE INSERT ON newborns WHEN NEW.birth_order=2 BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
  try {
    const twins = [goodBabies[0], { outcome: 'live', sex: 'M', birth_weight_g: 2800, apgar1: 8, apgar5: 9 }];
    const r = await call('POST', `/api/anc-episodes/${id}/delivery`, delivery({ newborns: twins }), mw);
    assert.equal(r.status, 500);
  } finally { db.exec('DROP TRIGGER fail_second_baby'); }
  assert.deepEqual(counts(), before); // no delivery, no baby records, no first baby left behind
  assert.equal(db.prepare('SELECT status FROM anc_episodes WHERE id=?').get(id).status, 'active');
  assert.equal((await call('POST', `/api/anc-episodes/${id}/delivery`, delivery(), mw)).status, 201); // and it can be recorded properly afterwards
});
let mother, epD, babyId;
test('delivery: creates the baby record linked to the mother, closes the pregnancy record', async () => {
  mother = await newPatient('Mother Of Baby', dobYearsAgo(27)); epD = (await book(mother, { lmp: lmpAt(39, 5), gravida: 2, para: 1 })).data.id;
  const r = await call('POST', `/api/anc-episodes/${epD}/delivery`, delivery({ blood_loss_ml: 650, delivered_time: '04:30', oxytocin: true, third_stage: 'active', perineal_tear: '1' }), mw);
  assert.equal(r.status, 201); assert.equal(r.data.pph, 'pph'); assert.ok(r.data.complications.includes('pph')); assert.equal(r.data.live_births, 1);
  babyId = r.data.newborns[0].patient_id; assert.ok(babyId);
  const baby = db.prepare('SELECT * FROM patients WHERE id=?').get(babyId);
  assert.equal(baby.mother_id, mother); assert.equal(baby.name_en, 'Baby of Mother Of Baby'); assert.equal(baby.dob, iso(0)); assert.equal(baby.sex, 'F'); assert.equal(baby.restricted, 0);
  const detail = (await call('GET', `/api/patients/${mother}`, undefined, await as('doctor1'))).data.patient;
  assert.deepEqual(detail.children.map((c) => c.id), [babyId]);
  assert.equal((await call('GET', `/api/patients/${babyId}`, undefined, await as('doctor1'))).data.patient.mother.id, mother);
  assert.equal(db.prepare('SELECT status FROM anc_episodes WHERE id=?').get(epD).status, 'delivered');
  assert.equal((await call('POST', `/api/anc-episodes/${epD}/delivery`, delivery(), mw)).status, 409); // only once
  const enc = await visitFor(mother); assert.equal((await call('POST', `/api/anc-episodes/${epD}/visits`, { encounter_id: enc, sys: 120, dia: 80 }, mw)).status, 409); // no more ANC visits
  assert.equal((await call('POST', `/api/anc-episodes/${epD}/partograph`, { cervix_cm: 5 }, mw)).status, 409);
  const e = (await call('GET', `/api/anc-episodes/${epD}`, undefined, mw)).data;
  assert.equal(e.delivery.pph, 'pph'); assert.equal(e.delivery.newborns[0].baby_mrn.startsWith('MTC-'), true);
  assert.deepEqual(e.episode.alerts, []); assert.deepEqual(e.episode.latest_visit_alerts, []); // no stale antenatal alerts after delivery
  const ov = (await call('GET', `/api/patients/${mother}/mch`, undefined, mw)).data.episodes[0]; assert.equal(ov.status, 'delivered'); assert.equal(ov.mode, 'svd');
});
test('delivery: twins, stillbirth, preterm and low-weight alerts', async () => {
  const p = await newPatient('Twin Mother', dobYearsAgo(31)); const id = (await book(p, { lmp: lmpAt(34), gravida: 3, para: 2, risk_factors: ['multiple_pregnancy'] })).data.id;
  const r = await call('POST', `/api/anc-episodes/${id}/delivery`, delivery({ maternal_outcome: 'referred', referred_to: 'Mae Sot Hospital', newborns: [
    { outcome: 'live', sex: 'M', birth_weight_g: 2100, apgar1: 6, apgar5: 8 }, { outcome: 'stillbirth_fresh', sex: 'F', birth_weight_g: 1900 }] }), mw);
  assert.equal(r.status, 201); assert.equal(r.data.live_births, 1);
  assert.deepEqual(r.data.newborns[0].alerts.map((a) => a.code).sort(), ['lbw', 'preterm']);
  assert.equal(r.data.newborns[1].patient_id, null); // no patient record for a stillbirth
  assert.equal(db.prepare('SELECT name_en FROM patients WHERE id=?').get(r.data.newborns[0].patient_id).name_en, 'Baby A of Twin Mother');
});
test('restricted mother: the baby is restricted and named by MRN, not by the mother', async () => {
  const doc = await as('doctor1');
  const ep = db.prepare("SELECT id FROM anc_episodes WHERE patient_id=3 AND status='active'").get().id;
  assert.equal((await call('GET', `/api/anc-episodes/${ep}`, undefined, await as('nurse1'))).status, 403);
  assert.equal((await call('GET', `/api/anc-episodes/${ep}`, undefined, await as('his1'))).status, 428); // right role, no access reason
  const r = await call('POST', `/api/anc-episodes/${ep}/delivery`, delivery({ delivered_on: iso(0) , newborns: [{ outcome: 'live', sex: 'M', birth_weight_g: 2900, apgar1: 8, apgar5: 9 }] }), doc);
  assert.equal(r.status, 201);
  const baby = db.prepare('SELECT * FROM patients WHERE id=?').get(r.data.newborns[0].patient_id);
  assert.equal(baby.restricted, 1); assert.ok(!baby.name_en.includes('Demo Patient Three')); assert.match(baby.name_en, /^Baby of MTC-\d+$/);
});

test('postnatal: visit after delivery, alerts, contact windows in the register', async () => {
  const enc = await visitFor(mother);
  assert.equal((await call('POST', `/api/anc-episodes/${epD}/postnatal`, { encounter_id: enc, sys: 118, dia: 76, temp: 37.0, bleeding: 'normal', baby_temp: 36.8, baby_rr: 42, feeding: 'exclusive', newborn_id: 999999 }, mw)).status, 400);
  const nb = db.prepare('SELECT id FROM newborns WHERE delivery_id=(SELECT id FROM deliveries WHERE episode_id=?)').get(epD).id;
  assert.equal((await call('POST', `/api/anc-episodes/${epD}/postnatal`, { sys: 100, dia: 120 }, mw)).status, 400);
  assert.equal((await call('POST', `/api/anc-episodes/${epD}/postnatal`, { }, mw)).status, 400);
  const ok = await call('POST', `/api/anc-episodes/${epD}/postnatal`, { encounter_id: enc, newborn_id: nb, sys: 118, dia: 76, temp: 38.4, bleeding: 'heavy', baby_temp: 38, baby_rr: 66, feeding: 'exclusive', mother_danger: ['fever'], counselled_fp: true }, mw);
  assert.equal(ok.status, 201); assert.equal(ok.data.days_postpartum, 0);
  assert.deepEqual(ok.data.alerts.map((a) => a.code).sort(), ['baby_fast_breathing', 'baby_fever', 'bleeding_heavy', 'fever', 'mother.fever']);
  const row = (await call('GET', '/api/mch/register?tab=postnatal', undefined, mw)).data.rows.find((r) => r.episode_id === epD);
  assert.equal(row.windows[0].state, 'done'); assert.equal(row.windows[1].state, 'upcoming');
  db.prepare("UPDATE deliveries SET delivered_on=? WHERE episode_id=?").run(iso(-10), epD); // pretend the delivery was 10 days ago
  const later = (await call('GET', '/api/mch/register?tab=postnatal', undefined, mw)).data.rows.find((r) => r.episode_id === epD);
  // the earlier visit (today) now counts as day 10 after the moved delivery date, so the day 7-14 window is covered
  assert.deepEqual(later.windows.map((w) => w.state), ['missed', 'missed', 'done', 'upcoming']); assert.equal(later.attention, true);
});

test('close a pregnancy record (miscarriage) and re-book later', async () => {
  const p = await newPatient('Loss Woman', dobYearsAgo(33)); const id = (await book(p, { lmp: lmpAt(9), gravida: 2, para: 1 })).data.id;
  assert.equal((await call('POST', `/api/anc-episodes/${id}/close`, { outcome: 'miscarriage', reason: '' }, mw)).status, 400);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/close`, { outcome: 'banana', reason: 'x y z' }, mw)).status, 400);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/close`, { outcome: 'miscarriage', reason: 'Spontaneous loss at 9 weeks' }, mw)).status, 200);
  assert.equal((await call('POST', `/api/anc-episodes/${id}/close`, { outcome: 'closed', reason: 'again' }, mw)).status, 409);
  const enc = await visitFor(p); assert.equal((await call('POST', `/api/anc-episodes/${id}/visits`, { encounter_id: enc, sys: 120, dia: 80 }, mw)).status, 409);
  assert.equal((await book(p, { lmp: lmpAt(4), gravida: 3, para: 1 })).status, 201);
});

test('family planning: pregnancy check, active pregnancy block, COC safety warnings, injectable reminder', async () => {
  const nurse = await as('nurse1'); const p = await newPatient('Fp Woman', dobYearsAgo(30));
  const fp = (b) => call('POST', `/api/patients/${p}/family-planning`, b, nurse);
  assert.equal((await fp({ method: 'implant', action: 'start' })).status, 400); // pregnancy not excluded
  assert.equal((await fp({ method: 'banana', action: 'start', pregnancy_excluded: true })).status, 400);
  assert.equal((await call('POST', `/api/patients/${p}/family-planning`, { method: 'condom', action: 'start' }, await as('pharm1'))).status, 403);
  const condom = await fp({ method: 'condom', action: 'start' }); assert.equal(condom.status, 201); assert.equal(condom.data.next_due, null);
  const inj = await fp({ method: 'injectable', action: 'start', pregnancy_excluded: true }); assert.equal(inj.status, 201); assert.equal(inj.data.next_due, iso(84));
  const htn = await fp({ method: 'coc', action: 'start', pregnancy_excluded: true, sys: 150, dia: 95 });
  assert.equal(htn.status, 409); assert.deepEqual(htn.data.warnings, ['coc_hypertension']);
  assert.equal((await fp({ method: 'coc', action: 'start', pregnancy_excluded: true, sys: 150, dia: 95, acknowledged_warnings: ['coc_hypertension'] })).status, 201);
  assert.equal(JSON.parse(db.prepare("SELECT warnings_acked w FROM family_planning WHERE patient_id=? AND method='coc'").get(p).w)[0], 'coc_hypertension');
  await call('POST', `/api/patients/${p}/problems`, { text: 'Hypertension', icd_code: 'I10' }, await as('doctor1'));
  assert.equal((await fp({ method: 'coc', action: 'continue' })).status, 409); // known hypertension, no BP typed
  const pq = await newPatient('Pregnant Fp', dobYearsAgo(30)); await book(pq, { lmp: lmpAt(8), gravida: 2, para: 1 });
  assert.equal((await call('POST', `/api/patients/${pq}/family-planning`, { method: 'implant', action: 'start', pregnancy_excluded: true }, nurse)).status, 409);
  assert.equal((await call('POST', `/api/patients/${pq}/family-planning`, { method: 'condom', action: 'counselling' }, nurse)).status, 201); // counselling is fine
});
test('family planning: postpartum COC warning; overdue register; stopping removes the reminder', async () => {
  const nurse = await as('nurse1');
  const mid = (await call('POST', `/api/patients/${mother}/family-planning`, { method: 'coc', action: 'start', pregnancy_excluded: true }, nurse));
  db.prepare("UPDATE deliveries SET delivered_on=? WHERE patient_id=?").run(iso(-10), mother);
  const w = await call('POST', `/api/patients/${mother}/family-planning`, { method: 'coc', action: 'start', pregnancy_excluded: true }, nurse);
  assert.equal(w.status, 409); assert.deepEqual(w.data.warnings, ['coc_postpartum']); void mid;
  const p = await newPatient('Overdue Inj', dobYearsAgo(26));
  db.prepare("INSERT INTO family_planning(patient_id,visit_date,method,action,pregnancy_excluded,next_due) VALUES(?,?,?,?,?,?)").run(p, iso(-100), 'injectable', 'start', 1, iso(-16));
  let rows = (await call('GET', '/api/mch/register?tab=fp', undefined, nurse)).data.rows;
  const row = rows.find((r) => r.patient.id === p); assert.equal(row.overdue, true); assert.equal(row.days_overdue, 16); assert.equal(rows[0].overdue, true);
  await call('POST', `/api/patients/${p}/family-planning`, { method: 'injectable', action: 'stop', notes: 'wants to conceive' }, nurse);
  rows = (await call('GET', '/api/mch/register?tab=fp', undefined, nurse)).data.rows; assert.ok(!rows.some((r) => r.patient.id === p));
});
test('meta lists and audit trail', async () => {
  const meta = (await call('GET', '/api/mch/meta', undefined, mw)).data; assert.ok(meta.danger_signs.includes('bleeding') && meta.fp_methods.includes('implant'));
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['anc_booked', 'anc_visit_recorded', 'delivery_recorded', 'newborn_registered', 'partograph_entry', 'postnatal_visit_recorded', 'episode_closed', 'fp_visit_recorded', 'mch_viewed']) assert.ok(actions.has(a), a);
  const details = db.prepare("SELECT detail FROM audit_log WHERE action LIKE 'anc_%' OR action LIKE 'delivery%' OR action LIKE 'newborn%'").all().map((r) => r.detail).join(' ');
  assert.ok(!/Mother Of Baby|Twin Mother|Demo Patient/.test(details)); // no patient names in the audit log
});
