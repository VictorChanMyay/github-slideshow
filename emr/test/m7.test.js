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
const testId = (code) => db.prepare('SELECT id FROM lab_tests WHERE code=?').get(code).id;
const drugId = (name) => db.prepare('SELECT id FROM drugs WHERE name=?').get(name).id;
// A realistic visit: complaint, vitals, malaria (normal) and HIV (reactive) tests, a prescription, a diagnosis, and a plan
async function fullVisit(pid, { sign = false } = {}) {
  const doc = await as('doctor1'), nurse = await as('nurse1'), lab = await as('lab1');
  const enc = (await call('POST', `/api/patients/${pid}/checkin`, { chief_complaint: 'Fever' }, await as('reg1'))).data.id;
  await call('PUT', `/api/encounters/${enc}/vitals`, { temp: 38.9, sys: 118, dia: 76, pulse: 96, weight: 55 }, nurse);
  await call('PUT', `/api/encounters/${enc}/notes`, { subjective: 'Fever for 3 days', assessment: 'Likely malaria', plan: 'Antimalarial, review in 3 days' }, doc);
  await call('POST', `/api/encounters/${enc}/diagnoses`, { code: 'B54', kind: 'primary' }, doc);
  const orders = [];
  for (const code of ['MAL_RDT', 'HIV_RDT']) { const r = await call('POST', `/api/encounters/${enc}/lab-orders`, { test_id: testId(code) }, doc); orders.push(r.data.lab_orders.at(-1).id); }
  for (const [id, v] of [[orders[0], 'Positive P. falciparum'], [orders[1], 'Reactive']]) { await call('POST', `/api/lab-orders/${id}/collect`, {}, nurse); await call('POST', `/api/lab-orders/${id}/result`, { value: v }, lab); }
  await call('POST', `/api/encounters/${enc}/prescriptions`, { drug_id: drugId('Artemether-lumefantrine'), dose: '4 tablets', frequency: 'twice a day', duration_days: 3, quantity: 24 }, doc);
  if (sign) assert.equal((await call('POST', `/api/encounters/${enc}/sign`, {}, doc)).status, 200);
  return enc;
}
const refBody = (o = {}) => ({ destination_id: db.prepare("SELECT id FROM referral_destinations WHERE name='Mae Sot Hospital'").get().id, reason: 'Needs admission for severe anaemia', urgency: 'urgent', clinical_summary: 'Pale, Hb 6.5, weak. Needs transfusion assessment.', consent_to_share: true, needs: 'Escort needed', ...o });
const mkRef = async (pid, o, who = 'doctor1') => call('POST', `/api/patients/${pid}/referrals`, refBody(o), await as(who));

/* ---------------- referrals ---------------- */
test('permissions: who can write, give feedback on, and read referrals', async () => {
  const p = await newPatient('Ref Perm');
  assert.equal((await mkRef(p, {}, 'nurse1')).status, 403); assert.equal((await mkRef(p, {}, 'pharm1')).status, 403); assert.equal((await mkRef(p, {}, 'reg1')).status, 403);
  const r = await mkRef(p, {}, 'doctor1'); assert.equal(r.status, 201); assert.match(r.data.ref_no, new RegExp(`^REF-${new Date().getUTCFullYear()}-0001$`));
  for (const [u, code] of [['reg1', 403], ['lab1', 403], ['pharm1', 403], ['his1', 200], ['nurse1', 200]]) assert.equal((await call('GET', '/api/referrals', undefined, await as(u))).status, code, u);
  assert.equal((await call('POST', `/api/referrals/${r.data.id}/cancel`, { reason: 'Mistake made' }, await as('nurse1'))).status, 403); // nurses record feedback but do not cancel
  assert.equal((await call('POST', `/api/referrals/${r.data.id}/attended`, {}, await as('his1'))).status, 403);
});
test('the letter text comes from the visit but never contains sensitive results', async () => {
  const p = await newPatient('Letter Patient'); await call('POST', `/api/patients/${p}/allergies`, { allergen: 'Penicillin', reaction: 'Rash' }, await as('nurse1'));
  const enc = await fullVisit(p); const d = await call('GET', `/api/encounters/${enc}/referral-draft`, undefined, await as('doctor1')); assert.equal(d.status, 200);
  const t = d.data.summary;
  for (const part of ['B54', 'main', 'temp 38.9', 'BP 118/76', 'Fever for 3 days', 'Likely malaria', 'Artemether-lumefantrine', 'Malaria rapid test', 'Positive P. falciparum', 'Penicillin']) assert.ok(t.includes(part), part);
  assert.ok(!/HIV|Reactive/i.test(t)); // the HIV test and its result are left out
  assert.equal((await call('GET', `/api/encounters/${enc}/referral-draft`, undefined, await as('nurse1'))).status, 403);
});
test('referral validation, consent and the emergency exception', async () => {
  const p = await newPatient('Ref Valid'); const doc = await as('doctor1');
  for (const [bad, why] of [[{ reason: 'x' }, 'reason'], [{ clinical_summary: 'short' }, 'summary'], [{ urgency: 'whenever' }, 'urgency'], [{ urgency: undefined }, 'no urgency'], [{ destination_id: 9999 }, 'destination'], [{ destination_id: undefined }, 'no destination'], [{ consent_to_share: false }, 'no consent'], [{ consent_to_share: false, urgency: 'urgent', consent_note: 'she was asleep' }, 'urgent is not an emergency'], [{ consent_to_share: false, urgency: 'emergency' }, 'emergency without a reason'], [{ consent_to_share: false, urgency: 'emergency', consent_note: 'no' }, 'reason too short']]) {
    assert.equal((await call('POST', `/api/patients/${p}/referrals`, refBody(bad), doc)).status, 400, why);
  }
  const free = await call('POST', `/api/patients/${p}/referrals`, refBody({ destination_id: undefined, destination_name: 'Private clinic in town' }), doc); assert.equal(free.status, 201);
  const em = await mkRef(p, { consent_to_share: false, urgency: 'emergency', consent_note: 'Patient unconscious, no relative present' }); assert.equal(em.status, 201);
  const row = db.prepare('SELECT consent_to_share,consent_note FROM referrals WHERE id=?').get(em.data.id); assert.equal(row.consent_to_share, 0); assert.match(row.consent_note, /unconscious/);
  const other = await newPatient('Other Pat'); const otherEnc = await fullVisit(other);
  assert.equal((await mkRef(p, { encounter_id: otherEnc })).status, 400); // a visit that belongs to someone else
});
test('referral lifecycle: attended, referral back, cancel; every step is checked', async () => {
  const p = await newPatient('Ref Life'); const enc = await fullVisit(p); const doc = await as('doctor1'), nurse = await as('nurse1');
  const id = (await mkRef(p, { encounter_id: enc })).data.id; const act = (a, b, who = nurse) => call('POST', `/api/referrals/${id}/${a}`, b, who);
  assert.equal((await act('attended', { attended_on: iso(2) })).status, 400); assert.equal((await act('attended', { attended_on: iso(-5) })).status, 400); // future / before the referral
  assert.equal((await act('attended', { attended_on: 'bad' })).status, 400);
  const att = await act('attended', {}); assert.equal(att.status, 200); assert.equal(att.data.referral.status, 'attended'); assert.equal(att.data.referral.attended_on, iso(0));
  assert.equal((await act('attended', {})).status, 409); assert.equal((await act('cancel', { reason: 'too late' }, doc)).status, 409);
  assert.equal((await act('back', { outcome: '' })).status, 400);
  const back = await act('back', { outcome: 'Admitted, severe malaria, transfused', treatment: 'IV artesunate', followup: 'Review at clinic in 1 week' }); assert.equal(back.status, 200);
  assert.equal(back.data.referral.status, 'completed'); assert.equal(back.data.referral.back_by_name, 'Demo Nurse'); assert.equal(back.data.referral.back_outcome, 'Admitted, severe malaria, transfused');
  assert.equal((await act('back', { outcome: 'again again' })).status, 409);
  const d = back.data; assert.deepEqual(d.medicines.map((m) => m.drug.split(' ')[0]), ['Artemether-lumefantrine']); assert.equal(d.patient.name_en, 'Ref Life');
  const direct = await mkRef(p, {}); const done = await call('POST', `/api/referrals/${direct.data.id}/back`, { outcome: 'Seen and treated', attended_on: iso(0) }, nurse); assert.equal(done.status, 200); // reply may arrive without a separate "attended" step
  const c = await mkRef(p, {}); assert.equal((await call('POST', `/api/referrals/${c.data.id}/cancel`, { reason: '' }, doc)).status, 400);
  assert.equal((await call('POST', `/api/referrals/${c.data.id}/cancel`, { reason: 'Family declined transfer' }, doc)).data.referral.status, 'cancelled');
});
test('worklist: overdue and urgent referrals come first', async () => {
  const a = await newPatient('Wl A'), b = await newPatient('Wl B'), c = await newPatient('Wl C');
  const ra = (await mkRef(a, { urgency: 'routine' })).data.id, rb = (await mkRef(b, { urgency: 'emergency' })).data.id, rc = (await mkRef(c, { urgency: 'routine' })).data.id;
  db.prepare("UPDATE referrals SET created_at=datetime('now','-20 days') WHERE id=?").run(rc); // a routine referral with no news for 20 days
  const rows = (await call('GET', '/api/referrals', undefined, await as('nurse1'))).data.referrals; const idx = (id) => rows.findIndex((r) => r.id === id);
  assert.equal(rows[idx(rc)].overdue, true); assert.equal(rows[idx(ra)].overdue, false); assert.ok(idx(rc) < idx(rb) && idx(rb) < idx(ra));
  assert.ok(rows.every((r) => r.clinical_summary === undefined)); // the list never carries the clinical text
});
test('restricted patients: referrals need the right role and an access reason; lists hide the name', async () => {
  const rs = await newPatient('Ref Restricted', 365 * 30, { restricted: true }); const doc = await as('doctor1');
  assert.equal((await mkRef(rs, {}, 'doctor1')).status, 428); assert.equal((await call('GET', `/api/patients/${rs}/referrals`, undefined, await as('nurse1'))).status, 403);
  await call('GET', `/api/patients/${rs}?reason=${encodeURIComponent('Referral for care')}`, undefined, doc);
  const r = await mkRef(rs, {}, 'doctor1'); assert.equal(r.status, 201);
  const row = (await call('GET', '/api/referrals', undefined, await as('nurse1'))).data.referrals.find((x) => x.id === r.data.id); assert.equal(row.patient.name_en, null); assert.equal(row.patient.restricted, true);
  assert.equal((await call('GET', `/api/referrals/${r.data.id}`, undefined, await as('nurse1'))).status, 403); assert.equal((await call('GET', `/api/referrals/${r.data.id}`, undefined, doc)).status, 200);
});
test('referral destinations: admin only, no duplicates', async () => {
  const admin = await as('admin'); assert.equal((await call('POST', '/api/referrals/destinations', { name: 'Mae Ramat Clinic', type: 'clinic' }, await as('doctor1'))).status, 403);
  assert.equal((await call('POST', '/api/referrals/destinations', { name: 'Mae Ramat Clinic', type: 'clinic' }, admin)).status, 201); assert.equal((await call('POST', '/api/referrals/destinations', { name: 'mae ramat clinic' }, admin)).status, 409);
  assert.equal((await call('POST', '/api/referrals/destinations', { name: '' }, admin)).status, 400);
  assert.ok((await call('GET', '/api/referrals/destinations', undefined, await as('doctor1'))).data.destinations.some((d) => d.name === 'Mae Ramat Clinic'));
});

/* ---------------- visit summary ---------------- */
test('take-home visit summary: only after signing, never with sensitive results, includes the next appointment', async () => {
  const p = await newPatient('Summary Patient'); const enc = await fullVisit(p); const nurse = await as('nurse1');
  assert.equal((await call('GET', `/api/encounters/${enc}/summary`, undefined, nurse)).status, 409); // not signed yet
  await call('POST', `/api/encounters/${enc}/sign`, {}, await as('doctor1'));
  await call('POST', `/api/patients/${p}/appointments`, { appt_date: iso(3), purpose: 'general', appt_time: '09:30' }, await as('reg1'));
  const r = await call('GET', `/api/encounters/${enc}/summary`, undefined, nurse); assert.equal(r.status, 200); const s = r.data;
  assert.deepEqual(s.diagnoses.map((d) => d.code), ['B54']); assert.equal(s.medicines.length, 1); assert.deepEqual(s.results.map((x) => x.name), ['Malaria rapid test']); assert.match(s.plan, /review in 3 days/);
  assert.equal(s.visit.signed_by, 'Demo Doctor'); assert.deepEqual([s.next_appointment.appt_date, s.next_appointment.appt_time], [iso(3), '09:30']);
  assert.ok(!/HIV|Reactive/i.test(JSON.stringify(s)));
  assert.equal((await call('GET', `/api/encounters/${enc}/summary`, undefined, await as('reg1'))).status, 403); assert.equal((await call('GET', `/api/encounters/${enc}/summary`, undefined, await as('lab1'))).status, 403);
});

/* ---------------- appointments ---------------- */
test('appointments: validation, roles, generic purposes (HIV can never be a purpose), duplicates', async () => {
  const p = await newPatient('Appt Patient', 365 * 30, { phone: '081-000-1111' }); const reg = await as('reg1'); const post = (b, who = 'reg1') => as(who).then((c) => call('POST', `/api/patients/${p}/appointments`, b, c));
  for (const [bad, why] of [[{ appt_date: iso(-1) }, 'past'], [{ appt_date: iso(400) }, 'too far'], [{ appt_date: 'soon' }, 'bad date'], [{ appt_time: '25:00' }, 'bad time'], [{ purpose: 'hiv' }, 'HIV purpose'], [{ purpose: 'tb' }, 'TB purpose'], [{ purpose: undefined }, 'no purpose']]) {
    assert.equal((await post({ appt_date: iso(5), purpose: 'general', ...bad })).status, 400, why);
  }
  assert.equal((await post({ appt_date: iso(5), purpose: 'general' }, 'pharm1')).status, 403); assert.equal((await post({ appt_date: iso(5), purpose: 'general' }, 'his1')).status, 403);
  assert.equal((await post({ appt_date: iso(5), purpose: 'general', reminder_ok: true })).status, 201); assert.equal((await post({ appt_date: iso(5), purpose: 'general' })).status, 409);
  assert.equal((await post({ appt_date: iso(5), purpose: 'lab' })).status, 201); // a different purpose on the same day is fine
  const meta = (await call('GET', '/api/continuity/meta', undefined, reg)).data; assert.ok(!meta.purposes.includes('hiv') && !meta.purposes.includes('tb'));
});
test('appointment lists: counts per day, hidden names and phones for restricted patients, phone only with consent', async () => {
  const ok = await newPatient('Appt Phone', 365 * 30, { phone: '081-222-3333' }), no = await newPatient('Appt No Consent', 365 * 30, { phone: '081-444-5555' }), rs = await newPatient('Appt Restricted', 365 * 30, { phone: '081-666-7777', restricted: true });
  const reg = await as('reg1'); const day = iso(9);
  for (const [pid, rem] of [[ok, true], [no, false], [rs, true]]) assert.equal((await call('POST', `/api/patients/${pid}/appointments`, { appt_date: day, purpose: 'programme', reminder_ok: rem }, reg)).status, 201); // reception can book a restricted patient (no clinical access needed)
  const r = (await call('GET', `/api/appointments?date=${day}`, undefined, reg)).data; assert.equal(r.counts[day], 3);
  const by = (pid) => r.rows.find((x) => x.patient.id === pid);
  assert.equal(by(ok).phone, '081-222-3333'); assert.equal(by(no).phone, null); assert.equal(by(rs).phone, null); assert.equal(by(rs).patient.name_en, null); assert.equal(by(ok).patient.name_en, 'Appt Phone');
  assert.equal((await call('GET', `/api/appointments?from=${iso(0)}&to=${iso(100)}`, undefined, reg)).status, 400); assert.equal((await call('GET', '/api/appointments?date=nope', undefined, reg)).status, 400);
  assert.equal((await call('GET', `/api/appointments?date=${day}`, undefined, await as('lab1'))).status, 403);
});
test('cancel, reschedule and the "missed" state', async () => {
  const p = await newPatient('Appt Move'); const reg = await as('reg1');
  const a = (await call('POST', `/api/patients/${p}/appointments`, { appt_date: iso(4), purpose: 'general' }, reg)).data.id;
  assert.equal((await call('POST', `/api/appointments/${a}/reschedule`, { appt_date: iso(-1) }, reg)).status, 400);
  const mv = await call('POST', `/api/appointments/${a}/reschedule`, { appt_date: iso(6), appt_time: '10:00' }, reg); assert.equal(mv.status, 200);
  assert.equal(db.prepare('SELECT status,rescheduled_to FROM appointments WHERE id=?').get(a).status, 'rescheduled');
  const list = (await call('GET', `/api/appointments?from=${iso(0)}&to=${iso(10)}`, undefined, reg)).data.rows.filter((x) => x.patient.id === p); assert.deepEqual(list.map((x) => x.appt_date), [iso(6)]); // the old slot is gone from the list
  assert.equal((await call('POST', `/api/appointments/${a}/cancel`, { reason: 'moved already' }, reg)).status, 409);
  assert.equal((await call('POST', `/api/appointments/${mv.data.id}/cancel`, { reason: '' }, reg)).status, 400);
  assert.equal((await call('POST', `/api/appointments/${mv.data.id}/cancel`, { reason: 'Patient travelled' }, reg)).status, 200);
  db.prepare("INSERT INTO appointments(patient_id,appt_date,purpose) VALUES(?,?,?)").run(p, iso(-3), 'general'); // a past, still-scheduled appointment
  const past = (await call('GET', `/api/appointments?from=${iso(-5)}&to=${iso(-1)}`, undefined, reg)).data.rows.find((x) => x.patient.id === p); assert.equal(past.status, 'missed'); assert.equal(past.stored_status, 'scheduled');
});
test('arriving on the day marks the appointment as attended', async () => {
  const p = await newPatient('Appt Arrives'); const reg = await as('reg1');
  const a = (await call('POST', `/api/patients/${p}/appointments`, { appt_date: iso(0), purpose: 'general' }, reg)).data.id; const later = (await call('POST', `/api/patients/${p}/appointments`, { appt_date: iso(7), purpose: 'general' }, reg)).data.id;
  const enc = (await call('POST', `/api/patients/${p}/checkin`, {}, reg)).data.id;
  const row = db.prepare('SELECT status,encounter_id FROM appointments WHERE id=?').get(a); assert.equal(row.status, 'attended'); assert.equal(row.encounter_id, enc);
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(later).status, 'scheduled'); // a later appointment is untouched
});
test('reminder call list: needs consent, logs results, reached people drop off, missed ones stay', async () => {
  const yes = await newPatient('Call Yes', 365 * 30, { phone: '081-777-8888' }), no = await newPatient('Call No'), miss = await newPatient('Call Missed', 365 * 30, { phone: '081-999-0000' }); const reg = await as('reg1');
  const a = (await call('POST', `/api/patients/${yes}/appointments`, { appt_date: iso(1), purpose: 'general', reminder_ok: true }, reg)).data.id;
  const b = (await call('POST', `/api/patients/${no}/appointments`, { appt_date: iso(1), purpose: 'general' }, reg)).data.id;
  db.prepare("INSERT INTO appointments(patient_id,appt_date,purpose,reminder_ok) VALUES(?,?,?,1)").run(miss, iso(-4), 'general');
  const ids = async () => (await call('GET', '/api/appointments/calllist', undefined, reg)).data.rows;
  let rows = await ids(); assert.ok(rows.some((r) => r.id === a && r.reason === 'upcoming')); assert.ok(!rows.some((r) => r.id === b)); assert.equal(rows[0].reason, 'missed'); assert.equal(rows.find((r) => r.id === a).phone, '081-777-8888');
  assert.equal((await call('POST', `/api/appointments/${b}/reminder`, { method: 'call', result: 'reached' }, reg)).status, 409); // no consent to reminders
  assert.equal((await call('POST', `/api/appointments/${a}/reminder`, { method: 'pigeon', result: 'reached' }, reg)).status, 400);
  assert.equal((await call('POST', `/api/appointments/${a}/reminder`, { method: 'call', result: 'no_answer' }, reg)).status, 201); assert.ok((await ids()).some((r) => r.id === a)); // still to be reached
  assert.equal((await call('POST', `/api/appointments/${a}/reminder`, { method: 'call', result: 'reached' }, reg)).status, 201); assert.ok(!(await ids()).some((r) => r.id === a));
  assert.equal((await call('POST', `/api/appointments/${a}/reminder`, { method: 'call', result: 'reached' }, await as('his1'))).status, 403);
});

/* ---------------- the combined follow-up list ---------------- */
test('follow-up list: each role sees only what it may; reception sees appointments, never clinical overdue', async () => {
  const reg = await as('reg1'), doc = await as('doctor1'), mw = await as('midwife1'), nurse = await as('nurse1');
  const mk = async (name, days = 365 * 28, extra = {}) => newPatient(name, days, extra);
  const anc = await mk('Fu Anc'); await call('POST', `/api/patients/${anc}/anc-episodes`, { lmp: iso(-23 * 7), lmp_certain: true, gravida: 2, para: 1 }, mw); // 23 weeks, no visit yet: overdue
  const kid = await mk('Fu Child', 200); // 200 days old, no vaccines recorded
  const ncd = await mk('Fu Chronic', 365 * 50); const ncdE = (await call('POST', `/api/patients/${ncd}/programs`, { program: 'chronic', condition: 'hypertension' }, doc)).data.id; db.prepare('UPDATE program_enrolments SET next_due=? WHERE id=?').run(iso(-40), ncdE);
  const hiv = await mk('Fu Hiv', 365 * 40); const hivE = (await call('POST', `/api/patients/${hiv}/programs`, { program: 'hiv', diagnosed_on: iso(-100), art_start_on: iso(-90) }, nurse)).data.id; db.prepare('UPDATE program_enrolments SET next_due=? WHERE id=?').run(iso(-30), hivE);
  const refp = await mk('Fu Referral'); const rf = (await mkRef(refp, { urgency: 'urgent' })).data.id; db.prepare("UPDATE referrals SET created_at=datetime('now','-10 days') WHERE id=?").run(rf);
  const appt = await mk('Fu Appointment', 365 * 28, { phone: '081-123-4567' }); db.prepare("INSERT INTO appointments(patient_id,appt_date,purpose,reminder_ok) VALUES(?,?,?,1)").run(appt, iso(-2), 'general');
  const items = async (u) => (await call('GET', '/api/followup', undefined, await as(u))).data.items; const kinds = (xs) => new Set(xs.map((x) => x.kind));
  const regItems = await items('reg1'); assert.deepEqual([...kinds(regItems)], ['appointment']); assert.ok(!JSON.stringify(regItems).includes('Fu Hiv')); // reception: appointments only
  const d = await items('doctor1'); for (const k of ['appointment', 'referral', 'anc', 'immunization', 'programme']) assert.ok(kinds(d).has(k), k);
  const names = (xs, kind) => xs.filter((x) => x.kind === kind).map((x) => x.patient.name_en);
  assert.ok(names(d, 'anc').includes('Fu Anc')); assert.ok(names(d, 'immunization').includes('Fu Child')); assert.ok(names(d, 'programme').includes('Fu Hiv')); assert.ok(names(d, 'programme').includes('Fu Chronic'));
  const h = await items('his1'); assert.ok(!names(h, 'programme').includes('Fu Hiv')); assert.ok(names(h, 'programme').includes('Fu Chronic')); // no HIV for a role without hiv.read
  assert.ok(!JSON.stringify(await items('admin')).includes('Fu Hiv'));
  assert.equal((await call('GET', '/api/followup', undefined, await as('lab1'))).status, 403); assert.equal((await call('GET', '/api/followup', undefined, await as('pharm1'))).status, 403);
  assert.equal(regItems.find((x) => x.patient.name_en === 'Fu Appointment').phone, '081-123-4567');
  for (let i = 1; i < d.length; i++) assert.ok(d[i - 1].urgency > d[i].urgency || (d[i - 1].urgency === d[i].urgency && d[i - 1].days_overdue >= d[i].days_overdue), 'sorted'); // most urgent first
  assert.ok(d.find((x) => x.kind === 'referral').urgency === 2);
});
test('follow-up list: restricted patients appear by MRN only, and without a phone', async () => {
  const rs = await newPatient('Fu Restricted', 365 * 30, { phone: '081-555-0000', restricted: true }); db.prepare("INSERT INTO appointments(patient_id,appt_date,purpose,reminder_ok) VALUES(?,?,?,1)").run(rs, iso(-2), 'general');
  const it = (await call('GET', '/api/followup', undefined, await as('reg1'))).data.items.find((x) => x.patient.restricted && x.patient.mrn === db.prepare('SELECT mrn FROM patients WHERE id=?').get(rs).mrn);
  assert.ok(it); assert.equal(it.patient.name_en, null); assert.equal(it.phone, null);
});
test('audit trail covers referrals, appointments, summaries and the follow-up list', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['referral_created', 'referral_attended', 'referral_back_recorded', 'referral_cancelled', 'referral_viewed', 'referral_destination_added', 'appointment_created', 'appointment_cancelled', 'appointment_rescheduled', 'reminder_logged', 'visit_summary_viewed', 'followup_viewed']) assert.ok(actions.has(a), a);
  const details = db.prepare("SELECT detail FROM audit_log WHERE action LIKE 'referral%' OR action LIKE 'appointment%'").all().map((r) => r.detail).join(' ');
  assert.ok(!/anaemia|malaria|Reactive|HIV/i.test(details)); // clinical content never goes into the audit log
});
