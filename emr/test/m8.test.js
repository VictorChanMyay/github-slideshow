'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');

let server, base, db;
before(async () => {
  db = dbm.open(':memory:'); seed(db, { demo: true });
  server = createServer(db); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());
async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const jar = {};
async function as(u) { if (!jar[u]) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: DEMO_PASSWORD }) }); assert.equal(r.status, 200); jar[u] = r.headers.get('set-cookie').split(';')[0]; } return jar[u]; }
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
async function newPatient(name, daysOld = 365 * 30, extra = {}) { const r = await call('POST', '/api/patients', { name_en: name, sex: 'F', dob: iso(-daysOld), force: true, ...extra }, await as('reg1')); assert.equal(r.status, 201); return r.data.id; }
const bed = (label) => db.prepare('SELECT id FROM beds WHERE label=?').get(label).id;
const freeBed = (prefix = 'A') => db.prepare("SELECT b.id FROM beds b WHERE b.label LIKE ? AND b.status='active' AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id=b.id AND a.status='admitted') ORDER BY b.id").get(prefix + '%').id;
const admit = async (pid, o = {}, who = 'nurse1') => call('POST', `/api/patients/${pid}/admissions`, { bed_id: freeBed(), reason: 'Severe malaria, needs IV treatment', condition: 'serious', ...o }, await as(who));
const addObs = async (id, o, who = 'nurse1') => call('POST', `/api/admissions/${id}/obs`, o, await as(who));
const dischargeBody = (o = {}) => ({ discharge_type: 'discharged', discharge_condition: 'Well, afebrile', stay_summary: 'Treated with IV artesunate for 3 days, recovered.', discharge_medicines: 'Primaquine as prescribed', follow_up: 'Review in 1 week', ...o });
const discharge = async (id, o = {}, who = 'doctor1') => call('POST', `/api/admissions/${id}/discharge`, dischargeBody(o), await as(who));
const testId = (code) => db.prepare('SELECT id FROM lab_tests WHERE code=?').get(code).id;
async function setGroup(pid, value) { // record a resulted blood group test for the patient
  const doc = await as('doctor1'), nurse = await as('nurse1'), lab = await as('lab1');
  const enc = (await call('POST', `/api/patients/${pid}/checkin`, {}, doc)).data.id; const o = (await call('POST', `/api/encounters/${enc}/lab-orders`, { test_id: testId('BLOODGRP') }, doc)).data.lab_orders[0].id;
  await call('POST', `/api/lab-orders/${o}/collect`, {}, nurse); assert.equal((await call('POST', `/api/lab-orders/${o}/result`, { value }, lab)).status, 200); db.prepare("UPDATE encounters SET status='cancelled' WHERE id=?").run(enc);
}
let unitSeq = 100;
const ALLNEG = { hiv: 'negative', hbv: 'negative', hcv: 'negative', syphilis: 'negative', malaria: 'negative' };
async function makeUnit(abo, rh, component = 'red_cells', over = {}) { // a screened, available unit
  const lab = await as('lab1'); const r = await call('POST', '/api/blood/units', { unit_no: 'U' + (++unitSeq), abo, rh, component, volume_ml: 300, collected_on: iso(-3), expires_on: iso(30), donor_ref: 'D-' + unitSeq, ...over }, lab); assert.equal(r.status, 201);
  assert.equal((await call('POST', `/api/blood/units/${r.data.id}/screening`, ALLNEG, lab)).data.outcome, 'release'); return r.data.id;
}

/* ---------------- wards, beds and admissions ---------------- */
test('bed board, permissions and ward administration', async () => {
  for (const [u, code] of [['reg1', 403], ['lab1', 403], ['pharm1', 403], ['nurse1', 200], ['his1', 200], ['admin', 200]]) assert.equal((await call('GET', '/api/wards', undefined, await as(u))).status, code, u);
  const b = (await call('GET', '/api/wards', undefined, await as('nurse1'))).data; assert.deepEqual(b.wards.map((w) => w.name), ['Adult ward', 'Maternity', 'Children', 'Isolation']); assert.equal(b.usable, 16); assert.equal(b.free, 16);
  const admin = await as('admin'); assert.equal((await call('POST', '/api/wards', { name: 'Surgical' }, await as('doctor1'))).status, 403);
  const w = await call('POST', '/api/wards', { name: 'Surgical', kind: 'general' }, admin); assert.equal(w.status, 201); assert.equal((await call('POST', '/api/wards', { name: 'surgical' }, admin)).status, 409);
  const bd = await call('POST', `/api/wards/${w.data.id}/beds`, { label: 'S1' }, admin); assert.equal(bd.status, 201); assert.equal((await call('POST', `/api/wards/${w.data.id}/beds`, { label: 's1' }, admin)).status, 409); assert.equal((await call('POST', '/api/wards/999/beds', { label: 'X' }, admin)).status, 404);
  assert.equal((await call('PUT', `/api/beds/${bd.data.id}`, { status: 'out_of_service' }, admin)).status, 200); assert.equal((await call('PUT', `/api/beds/${bd.data.id}`, { status: 'broken' }, admin)).status, 400);
  const p = await newPatient('Out Of Service'); assert.equal((await admit(p, { bed_id: bd.data.id })).status, 400); // a bed that is out of service cannot be used
});
let a1, p1;
test('admission: validation and the rules that keep a bed and a patient unique', async () => {
  const adult = db.prepare("SELECT id FROM wards WHERE name='Adult ward'").get().id; for (let i = 7; i <= 30; i++) db.prepare('INSERT INTO beds(ward_id,label) VALUES(?,?)').run(adult, 'A' + i); // the tests admit many patients: give the adult ward more beds
  p1 = await newPatient('Adm Patient One'); const bad = [[{ reason: 'x' }, 'reason'], [{ bed_id: 9999 }, 'unknown bed'], [{ admit_dx_code: 'ZZZ9' }, 'bad code'], [{ obs_every_hours: 0 }, 'interval 0'], [{ obs_every_hours: 30 }, 'interval 30'], [{ encounter_id: 99999 }, 'unknown visit']];
  for (const [o, why] of bad) assert.ok([400, 404].includes((await admit(p1, o)).status), why);
  assert.equal((await admit(p1, {}, 'reg1')).status, 403); assert.equal((await admit(p1, {}, 'pharm1')).status, 403);
  const ok = await admit(p1, { bed_id: bed('A1'), admit_dx_code: 'B54', obs_every_hours: 2 }); assert.equal(ok.status, 201); a1 = ok.data.id; assert.match(ok.data.adm_no, new RegExp(`^ADM-${new Date().getUTCFullYear()}-0001$`));
  const p2 = await newPatient('Adm Patient Two'); assert.equal((await admit(p2, { bed_id: bed('A1') })).status, 409); // bed occupied
  const again = await admit(p1, { bed_id: bed('A2') }); assert.equal(again.status, 409); assert.equal(again.data.admission_id, a1); // already admitted
  const board = (await call('GET', '/api/wards', undefined, await as('nurse1'))).data; const row = board.wards[0].beds.find((x) => x.label === 'A1'); assert.equal(row.admission.patient.name_en, 'Adm Patient One'); assert.equal(board.occupied, 1);
  assert.throws(() => db.prepare("INSERT INTO admissions(adm_no,patient_id,ward_id,bed_id,reason) VALUES('X1',?,?,?,'x')").run(p2, 1, bed('A1')), /UNIQUE/); // the database itself refuses two patients in one bed
  assert.throws(() => db.prepare("INSERT INTO admissions(adm_no,patient_id,ward_id,bed_id,reason) VALUES('X2',?,?,?,'x')").run(p1, 1, bed('A3')), /UNIQUE/); // ... and two active admissions for one patient
  assert.equal((await call('PUT', `/api/beds/${bed('A1')}`, { status: 'out_of_service' }, await as('admin'))).status, 409); // cannot take an occupied bed out of service
});
test('isolation: an isolation patient needs an isolation bed unless a reason is given', async () => {
  const p = await newPatient('Isolation Patient'); const gen = await admit(p, { bed_id: bed('A4'), isolation: true, reason: 'Suspected infectious TB' });
  assert.equal(gen.status, 409); assert.equal(gen.data.isolation_ward_needed, true); assert.equal((await admit(p, { bed_id: bed('A4'), isolation: true, isolation_override: 'no', reason: 'Suspected infectious TB' })).status, 409);
  const iso1 = await admit(p, { bed_id: bed('I1'), isolation: true, reason: 'Suspected infectious TB' }); assert.equal(iso1.status, 201);
  const q = await newPatient('Isolation Override'); assert.equal((await admit(q, { bed_id: bed('A4'), isolation: true, isolation_override: 'Isolation ward full, single room used', reason: 'Suspected infectious TB' })).status, 201);
  const mv = (o) => call('POST', `/api/admissions/${iso1.data.id}/transfer`, { bed_id: bed('A5'), reason: 'More space needed', ...o }, null); void mv;
  const nurse = await as('nurse1'); assert.equal((await call('POST', `/api/admissions/${iso1.data.id}/transfer`, { bed_id: bed('A5'), reason: 'More space needed' }, nurse)).status, 409); // cannot leave isolation silently
  assert.equal((await call('POST', `/api/admissions/${iso1.data.id}/transfer`, { bed_id: bed('A5'), reason: 'More space needed', isolation_override: 'Cleared by the doctor, TB excluded' }, nurse)).status, 200);
});
test('moving a patient to another bed', async () => {
  const nurse = await as('nurse1'); const mv = (b, o = {}) => call('POST', `/api/admissions/${a1}/transfer`, { bed_id: b, reason: 'Closer to the nurses station', ...o }, nurse);
  assert.equal((await mv(bed('A1'))).status, 400); // same bed
  const p = await newPatient('Moves Into A2'); await admit(p, { bed_id: bed('A2') }); assert.equal((await mv(bed('A2'))).status, 409); // occupied
  assert.equal((await mv(bed('A6'), { reason: '' })).status, 400); assert.equal((await mv(bed('A6'))).status, 200);
  const d = (await call('GET', `/api/admissions/${a1}`, undefined, await as('doctor1'))).data; assert.equal(d.admission.bed, 'A6'); assert.deepEqual(d.moves.map((m) => m.to_bed), ['A1', 'A6']);
  const q = await newPatient('Takes Free A1'); assert.equal((await admit(q, { bed_id: bed('A1') })).status, 201); // the old bed is free again
});
test('ward notes and observations: validation, abnormal values flagged, overdue observations shown on the board', async () => {
  assert.equal((await addObs(a1, {})).status, 400); assert.equal((await addObs(a1, { temp: 99 })).status, 400); assert.equal((await addObs(a1, { fluid_in_ml: 20000 })).status, 400); assert.equal((await addObs(a1, { recorded_at: '2020-01-01 10:00' })).status, 400);
  assert.equal((await addObs(a1, { temp: 37 }, 'pharm1')).status, 403); assert.equal((await addObs(a1, { temp: 37 }, 'reg1')).status, 403);
  const o = await addObs(a1, { temp: 39.7, sys: 150, dia: 95, pulse: 112, spo2: 91, fluid_in_ml: 500, urine_ml: 200 }); assert.equal(o.status, 201);
  assert.deepEqual(o.data.flags.map((f) => f.code).sort(), ['bp_high', 'high_fever', 'spo2_low', 'tachycardia'].sort());
  const kid = await newPatient('Ward Child', 400); const ak = (await admit(kid, { bed_id: bed('C1') })).data.id; assert.deepEqual((await addObs(ak, { rr: 55 })).data.flags.map((f) => f.code), ['rr_fast_child']); // a child's breathing rate uses child limits
  const note = (b, who = 'nurse1') => as(who).then((c) => call('POST', `/api/admissions/${a1}/notes`, b, c)); assert.equal((await note({ kind: 'round', text: '' })).status, 400); assert.equal((await note({ kind: 'gossip', text: 'abc def' })).status, 400);
  assert.equal((await note({ kind: 'round', text: 'Improving, afebrile since morning' }, 'doctor1')).status, 201); assert.equal((await note({ kind: 'nursing', text: 'Tolerating oral fluids' })).status, 201); assert.equal((await note({ kind: 'event', text: 'x y' }, 'pharm1')).status, 403);
  const d = (await call('GET', `/api/admissions/${a1}`, undefined, await as('doctor1'))).data; assert.deepEqual(d.notes.map((n) => [n.kind, n.by_name]), [['round', 'Demo Doctor'], ['nursing', 'Demo Nurse']]); assert.equal(d.obs[0].flags.length, 4);
  db.prepare("UPDATE admissions SET admitted_at=datetime('now','-3 days') WHERE id=?").run(ak); db.prepare("UPDATE inpatient_obs SET recorded_at=datetime('now','-3 days') WHERE admission_id=?").run(ak);
  const cell = () => call('GET', '/api/wards', undefined, null).then(() => as('nurse1')).then((c) => call('GET', '/api/wards', undefined, c)).then((r) => r.data.wards.flatMap((w) => w.beds).find((x) => x.admission && x.admission.id === ak).admission);
  assert.equal((await cell()).obs_overdue, true); await addObs(ak, { rr: 30, temp: 36.8 }); assert.equal((await cell()).obs_overdue, false); // charting a new set clears the warning
});
test('restricted patients: ward staff can chart and move beds by MRN but cannot open the record', async () => {
  const rs = await newPatient('Ward Restricted', 365 * 30, { restricted: true }); const doc = await as('doctor1'), nurse = await as('nurse1');
  assert.equal((await admit(rs, {}, 'doctor1')).status, 428); assert.equal((await admit(rs, {}, 'nurse1')).status, 403);
  await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Admission for care')}`, undefined, doc);
  const a = await admit(rs, { bed_id: freeBed('M') }, 'doctor1'); assert.equal(a.status, 201);
  const row = (await call('GET', '/api/wards', undefined, nurse)).data.wards.flatMap((w) => w.beds).find((x) => x.admission && x.admission.id === a.data.id).admission; assert.equal(row.patient.name_en, null); assert.equal(row.patient.restricted, true); // the board shows the MRN only
  assert.equal((await call('GET', `/api/admissions/${a.data.id}`, undefined, nurse)).status, 403); assert.equal((await call('GET', `/api/admissions/${a.data.id}`, undefined, doc)).status, 200);
  assert.equal((await addObs(a.data.id, { temp: 37.2, pulse: 80 })).status, 201); // charting works without opening the record
  assert.equal((await call('POST', `/api/admissions/${a.data.id}/notes`, { kind: 'nursing', text: 'Comfortable, slept well' }, nurse)).status, 201);
  assert.equal((await call('POST', `/api/admissions/${a.data.id}/transfer`, { bed_id: freeBed('M'), reason: 'Quieter room' }, nurse)).status, 200);
});

/* ---------------- discharge ---------------- */
test('discharge: roles, validation, death, bed freed, follow-up appointment', async () => {
  const p = await newPatient('Discharge Patient'); const a = (await admit(p, { bed_id: bed('M3'), admit_dx_code: 'B54' })).data.id; const aBed = bed('M3');
  assert.equal((await discharge(a, {}, 'nurse1')).status, 403); assert.equal((await discharge(a, {}, 'reg1')).status, 403);
  for (const [bad, why] of [[{ discharge_type: 'left' }, 'type'], [{ discharge_condition: 'ok' }, 'condition'], [{ stay_summary: 'short' }, 'summary'], [{ discharge_dx_code: 'ZZZ9' }, 'code'], [{ discharge_type: 'died' }, 'death needs a cause']]) assert.equal((await discharge(a, bad)).status, 400, why);
  assert.equal((await call('GET', `/api/admissions/${a}/summary`, undefined, await as('doctor1'))).status, 409); // not discharged yet
  await call('POST', `/api/admissions/${a}/notes`, { kind: 'round', text: 'Ready for discharge today' }, await as('doctor1'));
  const r = await discharge(a, { discharge_dx_code: 'B54', follow_up_date: iso(7) }); assert.equal(r.status, 200); assert.equal(r.data.admission.status, 'discharged'); assert.equal(r.data.admission.discharged_by_name, 'Demo Doctor');
  assert.ok(db.prepare("SELECT 1 FROM appointments WHERE patient_id=? AND appt_date=? AND status='scheduled'").get(p, iso(7))); // follow-up booked
  assert.equal((await discharge(a)).status, 409); assert.equal((await call('POST', `/api/admissions/${a}/notes`, { kind: 'round', text: 'late note here' }, await as('nurse1'))).status, 409); assert.equal((await addObs(a, { temp: 37 })).status, 409);
  const q = await newPatient('Next In Bed'); assert.equal((await admit(q, { bed_id: aBed })).status, 201); assert.equal((await admit(p, { bed_id: freeBed('A') })).status, 201); // bed freed; the same patient can be admitted again later
  const d = await newPatient('Dies On Ward'); const ad = (await admit(d, { bed_id: freeBed('A') })).data.id; const dead = await discharge(ad, { discharge_type: 'died', discharge_condition: 'Died', cause_of_death: 'Cerebral malaria', follow_up_date: iso(7) }); assert.equal(dead.status, 200); assert.equal(dead.data.admission.cause_of_death, 'Cerebral malaria');
  assert.ok(!db.prepare("SELECT 1 FROM appointments WHERE patient_id=? AND status='scheduled'").get(d)); // no follow-up appointment after a death
});
test('discharge summary: contents, never with sensitive results; a discharged patient can be summarised once', async () => {
  const p = await newPatient('Summary Inpatient'); const doc = await as('doctor1'), nurse = await as('nurse1'), lab = await as('lab1');
  const enc = (await call('POST', `/api/patients/${p}/checkin`, {}, await as('reg1'))).data.id; await call('POST', `/api/patients/${p}/allergies`, { allergen: 'Penicillin' }, nurse);
  for (const [code, v] of [['MAL_RDT', 'Positive P. falciparum'], ['HIV_RDT', 'Reactive']]) { const o = (await call('POST', `/api/encounters/${enc}/lab-orders`, { test_id: testId(code) }, doc)).data.lab_orders.at(-1).id; await call('POST', `/api/lab-orders/${o}/collect`, {}, nurse); await call('POST', `/api/lab-orders/${o}/result`, { value: v }, lab); }
  const a = (await admit(p, { bed_id: freeBed('A'), encounter_id: enc, admit_dx_code: 'B54' })).data.id;
  await call('POST', `/api/patients/${p}/procedures`, { type_code: 'WOUND_CARE', indication: 'Pressure sore dressing', consent_obtained: true }, nurse);
  await discharge(a, { discharge_dx_code: 'B54', follow_up_date: iso(10) });
  const s = await call('GET', `/api/admissions/${a}/summary`, undefined, nurse); assert.equal(s.status, 200); const d = s.data;
  assert.equal(d.admission.los_days, 0); assert.equal(d.discharge_dx.code, 'B54'); assert.deepEqual(d.results.map((x) => x.name), ['Malaria rapid test']); assert.deepEqual(d.procedures.map((x) => x.name), ['Wound cleaning and dressing']); assert.deepEqual(d.allergies.map((x) => x.allergen), ['Penicillin']); assert.equal(d.next_appointment.appt_date, iso(10));
  assert.ok(!/HIV|Reactive/i.test(JSON.stringify(d)));
  assert.equal((await call('GET', `/api/admissions/${a}/summary`, undefined, await as('reg1'))).status, 403);
});

/* ---------------- procedures ---------------- */
test('procedures: consent, the surgical checklist, roles, complications, voiding', async () => {
  const p = await newPatient('Proc Patient'); const post = (b, who = 'doctor1') => as(who).then((c) => call('POST', `/api/patients/${p}/procedures`, { type_code: 'SUTURE', indication: 'Laceration of the forearm', consent_obtained: true, ...b }, c));
  assert.ok((await call('GET', '/api/procedure-types', undefined, await as('nurse1'))).data.types.length >= 10);
  for (const [bad, why] of [[{ type_code: 'FLY' }, 'unknown type'], [{ indication: 'x' }, 'indication'], [{ performed_on: iso(2) }, 'future'], [{ performed_on: iso(-365 * 40) }, 'before birth'], [{ performed_time: '25:99' }, 'time'], [{ consent_obtained: false }, 'no consent'], [{ outcome: 'complication' }, 'complication needs text'], [{ anaesthesia: 'magic', consent_obtained: false }, 'no consent again']]) {
    assert.equal((await post(bad)).status, 400, why);
  }
  assert.equal((await post({ consent_obtained: false, consent_note: 'Unconscious, no relative present' })).status, 201); // emergency exception with a reason
  assert.equal((await post({ type_code: 'IV_ACCESS', consent_obtained: false })).status, 201); // some procedures need no consent
  const surg = { type_code: 'CAESAREAN', indication: 'Obstructed labour', anaesthesia: 'spinal' };
  assert.equal((await post(surg, 'nurse1')).status, 403); assert.equal((await post(surg, 'reg1')).status, 403);
  const incomplete = await post({ ...surg, checklist_signin: true, checklist_timeout: true }); assert.equal(incomplete.status, 400); assert.deepEqual(incomplete.data.problems, ['checklist_incomplete']);
  const ok = await post({ ...surg, checklist_signin: true, checklist_timeout: true, checklist_signout: true, assistant: 'Demo Midwife', findings: 'Healthy baby delivered' }, 'midwife1'); assert.equal(ok.status, 201);
  const list = (await call('GET', `/api/patients/${p}/procedures`, undefined, await as('nurse1'))).data.procedures; assert.equal(list.length, 3); const c = list.find((x) => x.type_code === 'CAESAREAN'); assert.equal(c.surgical, true); assert.deepEqual(c.checklist, [true, true, true]); assert.equal(c.performed_by_name, 'Demo Midwife');
  assert.equal((await call('POST', `/api/procedures/${ok.data.id}/void`, { reason: '' }, await as('doctor1'))).status, 400); assert.equal((await call('POST', `/api/procedures/${ok.data.id}/void`, { reason: 'Recorded on the wrong patient' }, await as('doctor1'))).status, 200);
  assert.equal((await call('GET', `/api/patients/${p}/procedures`, undefined, await as('nurse1'))).data.procedures.length, 2); assert.equal((await call('POST', `/api/procedures/${ok.data.id}/void`, { reason: 'again again' }, await as('doctor1'))).status, 404);
});
test('procedures during a stay are linked to the admission; the register hides restricted names', async () => {
  const p = await newPatient('Proc Admitted'); const a = (await admit(p)).data.id; const r = await call('POST', `/api/patients/${p}/procedures`, { type_code: 'WOUND_CARE', indication: 'Dressing change', consent_obtained: true }, await as('nurse1')); assert.equal(r.data.admission_id, a);
  assert.deepEqual((await call('GET', `/api/admissions/${a}`, undefined, await as('doctor1'))).data.procedures.map((x) => x.name), ['Wound cleaning and dressing']);
  const rs = await newPatient('Proc Restricted', 365 * 30, { restricted: true }); await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Procedure for care')}`, undefined, await as('doctor1'));
  assert.equal((await call('POST', `/api/patients/${rs}/procedures`, { type_code: 'SUTURE', indication: 'Laceration', consent_obtained: true }, await as('nurse1'))).status, 403);
  assert.equal((await call('POST', `/api/patients/${rs}/procedures`, { type_code: 'SUTURE', indication: 'Laceration', consent_obtained: true }, await as('doctor1'))).status, 201);
  const reg = (await call('GET', `/api/procedures?from=${iso(-1)}&to=${iso(0)}`, undefined, await as('his1'))).data.procedures; const hidden = reg.find((x) => x.patient.restricted); assert.equal(hidden.patient.name_en, null);
  assert.equal((await call('GET', `/api/procedures?from=${iso(-900)}&to=${iso(0)}`, undefined, await as('his1'))).status, 400); assert.equal((await call('GET', '/api/procedures', undefined, await as('lab1'))).status, 403);
});

/* ---------------- blood bank ---------------- */
test('blood units: registration rules and who can do it', async () => {
  const lab = await as('lab1'); const unit = (o = {}) => ({ unit_no: 'REG' + (++unitSeq), abo: 'A', rh: 'pos', component: 'red_cells', volume_ml: 300, collected_on: iso(-2), expires_on: iso(30), ...o });
  assert.equal((await call('POST', '/api/blood/units', unit(), await as('doctor1'))).status, 403); assert.equal((await call('POST', '/api/blood/units', unit(), await as('nurse1'))).status, 403);
  for (const [bad, why] of [[{ unit_no: '' }, 'no number'], [{ abo: 'C' }, 'abo'], [{ rh: 'maybe' }, 'rh'], [{ component: 'milk' }, 'component'], [{ volume_ml: 10 }, 'volume low'], [{ volume_ml: 5000 }, 'volume high'], [{ collected_on: iso(2) }, 'future collection'], [{ expires_on: iso(-1) }, 'expired'], [{ expires_on: iso(-5), collected_on: iso(-2) }, 'expiry before collection']]) assert.equal((await call('POST', '/api/blood/units', unit(bad), lab)).status, 400, why);
  const u = unit(); assert.equal((await call('POST', '/api/blood/units', u, lab)).status, 201); assert.equal((await call('POST', '/api/blood/units', u, lab)).status, 409);
});
test('screening: all negative releases, any positive discards, and donor results stay with blood bank staff', async () => {
  const lab = await as('lab1'), doc = await as('doctor1'); const mk = async () => (await call('POST', '/api/blood/units', { unit_no: 'SCR' + (++unitSeq), abo: 'B', rh: 'pos', component: 'red_cells', volume_ml: 300, collected_on: iso(-1), expires_on: iso(30), donor_ref: 'DONOR-77' }, lab)).data.id;
  const a = await mk(); const part = await call('POST', `/api/blood/units/${a}/screening`, { hiv: 'negative', hbv: 'negative' }, lab); assert.equal(part.data.outcome, 'hold'); assert.equal(db.prepare('SELECT status FROM blood_units WHERE id=?').get(a).status, 'quarantine');
  assert.equal((await call('POST', `/api/blood/units/${a}/screening`, { hiv: 'maybe' }, lab)).status, 400); assert.equal((await call('POST', `/api/blood/units/${a}/screening`, {}, lab)).status, 400);
  assert.equal((await call('POST', `/api/blood/units/${a}/screening`, { hcv: 'negative', syphilis: 'negative', malaria: 'negative' }, lab)).data.outcome, 'release'); assert.equal(db.prepare('SELECT status FROM blood_units WHERE id=?').get(a).status, 'available');
  assert.equal((await call('POST', `/api/blood/units/${a}/screening`, { hiv: 'positive' }, lab)).status, 409); // only units in quarantine can be screened
  const b = await mk(); assert.equal((await call('POST', `/api/blood/units/${b}/screening`, { hbv: 'positive' }, lab)).data.outcome, 'discard'); assert.equal(db.prepare('SELECT status FROM blood_units WHERE id=?').get(b).status, 'discarded');
  const forLab = (await call('GET', '/api/blood/units?status=history', undefined, lab)).data.units.find((x) => x.id === b); assert.equal(forLab.tests.hbv, 'positive'); assert.equal(forLab.donor_ref, 'DONOR-77');
  const forDoc = (await call('GET', '/api/blood/units?status=history', undefined, doc)).data.units.find((x) => x.id === b); assert.equal(forDoc.tests, undefined); assert.equal(forDoc.donor_ref, undefined); assert.equal(forDoc.discard_reason, 'screening'); assert.ok(!JSON.stringify(forDoc).includes('hbv'));
  assert.equal((await call('GET', '/api/blood/units', undefined, await as('reg1'))).status, 403);
  const c = await mk(); assert.equal((await call('POST', `/api/blood/units/${c}/discard`, { reason: '' }, lab)).status, 400); assert.equal((await call('POST', `/api/blood/units/${c}/discard`, { reason: 'Bag leaking' }, doc)).status, 403); assert.equal((await call('POST', `/api/blood/units/${c}/discard`, { reason: 'Bag leaking' }, lab)).status, 200); assert.equal((await call('POST', `/api/blood/units/${c}/discard`, { reason: 'Bag leaking' }, lab)).status, 409);
});
test('stock summary: counts only usable units, low-stock flags, expiry', async () => {
  const lab = await as('lab1'); await makeUnit('AB', 'neg'); await makeUnit('AB', 'neg'); const old = await makeUnit('AB', 'pos'); db.prepare('UPDATE blood_units SET expires_on=? WHERE id=?').run(iso(-1), old); // expired but never issued
  await makeUnit('AB', 'pos', 'red_cells', { expires_on: iso(3) });
  const s = (await call('GET', '/api/blood/summary', undefined, await as('nurse1'))).data; const g = (x) => s.groups.find((r) => r.group === x);
  assert.equal(g('AB-').red_cells, 2); assert.equal(g('AB-').low, false); assert.equal(g('AB+').red_cells, 1); assert.equal(g('AB+').low, true); assert.ok(s.expiring_soon >= 1); assert.ok(s.expired_to_discard >= 1); assert.equal(g('A-').low, true);
  assert.equal((await call('GET', '/api/blood/units?status=history', undefined, lab)).data.units.find((x) => x.id === old).status, 'expired');
});
test('issuing blood: unknown group, emergency O negative, compatibility, crossmatch, expiry', async () => {
  const p = await newPatient('Blood Recipient'); const issue = async (o, who = 'doctor1') => call('POST', `/api/patients/${p}/blood-issues`, { indication: 'Severe anaemia, Hb 5', ...o }, await as(who));
  const oNeg = await makeUnit('O', 'neg'), aPos = await makeUnit('A', 'pos'), bPos = await makeUnit('B', 'pos'), aNegPlasma = await makeUnit('A', 'neg', 'plasma'); void aNegPlasma;
  const unk = await issue({ unit_id: oNeg }); assert.equal(unk.status, 409); assert.equal(unk.data.group_unknown, true); // no recorded group
  assert.equal((await issue({ unit_id: oNeg, emergency_override: true, emergency_reason: 'no' })).status, 409); assert.equal((await issue({ unit_id: aPos, emergency_override: true, emergency_reason: 'Life-threatening bleeding' })).data.o_negative_only, true);
  assert.equal((await issue({ unit_id: oNeg }, 'nurse1')).status, 403); assert.equal((await issue({ unit_id: oNeg }, 'reg1')).status, 403);
  const em = await issue({ unit_id: oNeg, emergency_override: true, emergency_reason: 'Life-threatening bleeding, group unknown' }); assert.equal(em.status, 201); assert.equal(em.data.crossmatch, 'emergency_uncrossmatched');
  assert.equal(db.prepare('SELECT status FROM blood_units WHERE id=?').get(oNeg).status, 'issued'); assert.equal((await issue({ unit_id: oNeg, emergency_override: true, emergency_reason: 'Again life-threatening' })).status, 409); // the unit is gone
  await setGroup(p, 'A-'); const info = (await call('GET', `/api/patients/${p}/blood`, undefined, await as('doctor1'))).data; assert.equal(info.recipient_group, 'A-'); assert.equal(info.emergency_only, false);
  const ids = info.candidates.map((u) => u.id); assert.ok(!ids.includes(aPos) && !ids.includes(bPos)); // Rh positive and wrong-group units are never offered
  const inc = await issue({ unit_id: aPos, crossmatch: 'compatible' }); assert.equal(inc.status, 409); assert.deepEqual(inc.data.reasons, ['rh_positive_to_negative']); assert.equal((await issue({ unit_id: bPos, crossmatch: 'compatible' })).data.reasons.includes('abo_incompatible'), true);
  const okRbc = await makeUnit('A', 'neg'); assert.equal((await issue({ unit_id: okRbc })).status, 400); // crossmatch not confirmed
  assert.equal((await issue({ unit_id: okRbc, crossmatch: 'compatible' }, 'lab1')).status, 201);
  const pl = await makeUnit('AB', 'pos', 'plasma'); const plOk = await issue({ unit_id: pl }); assert.equal(plOk.status, 201); assert.equal(plOk.data.crossmatch, 'not_required'); // plasma follows the reverse rule and needs no red cell crossmatch
  const exp = await makeUnit('A', 'neg'); db.prepare('UPDATE blood_units SET expires_on=? WHERE id=?').run(iso(-1), exp); assert.equal((await issue({ unit_id: exp, crossmatch: 'compatible' })).data.unit_not_available, true);
  const q = (await call('POST', '/api/blood/units', { unit_no: 'QUAR' + (++unitSeq), abo: 'A', rh: 'neg', component: 'red_cells', volume_ml: 300, collected_on: iso(-1), expires_on: iso(30) }, await as('lab1'))).data.id; assert.equal((await issue({ unit_id: q, crossmatch: 'compatible' })).data.unit_not_available, true); // unscreened units are never issued
  assert.equal((await issue({ unit_id: okRbc, crossmatch: 'compatible', indication: 'x' })).status, 409);
});
test('transfusion record: baseline observations, reaction handling, return, and discharge blocked while a unit is out', async () => {
  const p = await newPatient('Transfused Patient'); await setGroup(p, 'O+'); const a = (await admit(p)).data.id; const doc = await as('doctor1'), nurse = await as('nurse1');
  const unit = await makeUnit('O', 'pos'); const i = (await call('POST', `/api/patients/${p}/blood-issues`, { unit_id: unit, indication: 'Severe anaemia', crossmatch: 'compatible' }, doc)).data.id;
  assert.equal(db.prepare('SELECT admission_id FROM blood_issues WHERE id=?').get(i).admission_id, a); // linked to the stay
  assert.equal((await discharge(a)).status, 409); // blocked while the unit is neither transfused nor returned
  const tr = (o, who = 'nurse1') => as(who).then((c) => call('POST', `/api/blood-issues/${i}/transfusion`, o, c)); const good = { pre_temp: 36.8, pre_pulse: 88, pre_sys: 110, pre_dia: 70, volume_given_ml: 300, reaction: 'none' };
  for (const [bad, why] of [[{ pre_temp: undefined }, 'no baseline temperature'], [{ pre_pulse: undefined }, 'no baseline pulse'], [{ reaction: undefined }, 'reaction not recorded'], [{ reaction: 'mild' }, 'reaction needs a description'], [{ volume_given_ml: 5000 }, 'volume'], [{ volume_given_ml: undefined }, 'no volume'], [{ started_at: '2026-01-01 10:00', ended_at: '2026-01-01 09:00' }, 'ends before it starts'], [{ pre_temp: 60 }, 'temperature range']]) assert.equal((await tr({ ...good, ...bad })).status, 400, why);
  assert.equal((await tr(good, 'lab1')).status, 403); assert.equal((await tr(good, 'reg1')).status, 403);
  assert.equal((await tr({ ...good, reaction: 'severe', reaction_note: 'Fever, rigors and chest tightness. Transfusion stopped.', post_temp: 39.4 })).status, 201);
  assert.equal(db.prepare('SELECT status FROM blood_units WHERE id=?').get(unit).status, 'transfused'); assert.equal(db.prepare('SELECT status FROM blood_issues WHERE id=?').get(i).status, 'transfused');
  assert.equal((await tr(good)).status, 409); assert.equal((await call('POST', `/api/blood-issues/${i}/return`, { reason: 'Not needed' }, doc)).status, 409);
  assert.equal((await discharge(a)).status, 200); // nothing pending any more
  const info = (await call('GET', `/api/patients/${p}/blood`, undefined, doc)).data.issues[0]; assert.equal(info.transfusion.reaction, 'severe'); assert.equal(info.transfusion.post_temp, 39.4);
  const u2 = await makeUnit('O', 'pos'); const i2 = (await call('POST', `/api/patients/${p}/blood-issues`, { unit_id: u2, indication: 'Further anaemia', crossmatch: 'compatible' }, doc)).data.id;
  assert.equal((await call('POST', `/api/blood-issues/${i2}/return`, { reason: '' }, doc)).status, 400); assert.equal((await call('POST', `/api/blood-issues/${i2}/return`, { reason: 'Patient improved, not needed' }, doc)).status, 200);
  const back = db.prepare('SELECT status,discard_code FROM blood_units WHERE id=?').get(u2); assert.deepEqual([back.status, back.discard_code], ['discarded', 'returned']); // a returned unit is discarded: the cold chain is unknown
  assert.equal((await call('GET', '/api/blood/pending', undefined, doc)).status, 200);
});
test('restricted patients: blood and records need access; the pending list hides names', async () => {
  const rs = await newPatient('Blood Restricted', 365 * 30, { restricted: true }); const doc = await as('doctor1'); await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Blood group and transfusion')}`, undefined, doc); await setGroup(rs, 'B+'); db.prepare('UPDATE access_grants SET expires_at=0').run(); // the access grant has run out
  const u = await makeUnit('B', 'pos'); assert.equal((await call('POST', `/api/patients/${rs}/blood-issues`, { unit_id: u, indication: 'Anaemia', crossmatch: 'compatible' }, doc)).status, 428); assert.equal((await call('GET', `/api/patients/${rs}/blood`, undefined, await as('nurse1'))).status, 403);
  await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Transfusion for anaemia')}`, undefined, doc); assert.equal((await call('POST', `/api/patients/${rs}/blood-issues`, { unit_id: u, indication: 'Anaemia', crossmatch: 'compatible' }, doc)).status, 201);
  const row = (await call('GET', '/api/blood/pending', undefined, await as('nurse1'))).data.issues.find((x) => x.unit_no === db.prepare('SELECT unit_no FROM blood_units WHERE id=?').get(u).unit_no); assert.equal(row.patient.name_en, null); assert.equal(row.patient.restricted, true);
});
test('audit trail covers admissions, procedures and blood, and never holds donor results or clinical text', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['ward_added', 'bed_added', 'bed_status_changed', 'admitted', 'bed_moved', 'ward_note', 'obs_recorded', 'discharged', 'admission_viewed', 'discharge_summary_viewed', 'procedure_recorded', 'procedure_voided', 'blood_unit_added', 'blood_screening_recorded', 'blood_unit_discarded', 'blood_issued', 'blood_issued_emergency', 'transfusion_reaction', 'blood_returned', 'blood_viewed']) assert.ok(actions.has(a), a);
  const details = db.prepare("SELECT detail FROM audit_log WHERE action LIKE 'blood%' OR action LIKE 'transfusion%' OR action LIKE 'ward%' OR action='discharged'").all().map((r) => r.detail).join(' ');
  assert.ok(!/positive|negative|DONOR-77|Cerebral malaria|Improving/i.test(details));
});
