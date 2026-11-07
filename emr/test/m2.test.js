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
  const res = await fetch(base + url, { method, headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const cookies = {};
async function as(u) { if (!cookies[u]) { const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: DEMO_PASSWORD }) }); assert.equal(res.status, 200); cookies[u] = res.headers.get('set-cookie').split(';')[0]; } return cookies[u]; }
const P1 = 1, P2 = 2, P3 = 3; // seeded: adult woman, child (estimated age), restricted patient
let e1, e2;

test('check-in: permissions, queue numbers, duplicate guard, urgent first', async () => {
  assert.equal((await call('POST', `/api/patients/${P1}/checkin`, {}, await as('pharm1'))).status, 403);
  const a = await call('POST', `/api/patients/${P1}/checkin`, { chief_complaint: 'Fever 3 days' }, await as('reg1'));
  assert.equal(a.status, 201); assert.equal(a.data.queue_no, 1); e1 = a.data.id;
  const dup = await call('POST', `/api/patients/${P1}/checkin`, {}, await as('reg1'));
  assert.equal(dup.status, 409); assert.equal(dup.data.encounter_id, e1);
  const b = await call('POST', `/api/patients/${P2}/checkin`, { priority: 'urgent', chief_complaint: 'Fast breathing' }, await as('reg1'));
  assert.equal(b.data.queue_no, 2); e2 = b.data.id;
  const q = (await call('GET', '/api/queue', undefined, await as('nurse1'))).data.queue;
  assert.deepEqual(q.map((x) => x.id), [e2, e1]); // urgent child first
  assert.equal((await call('GET', '/api/queue', undefined, await as('lab1'))).status, 403);
});

test('restricted patient: check-in needs the right role and an access reason; queue hides the name', async () => {
  assert.equal((await call('POST', `/api/patients/${P3}/checkin`, {}, await as('reg1'))).status, 403);
  assert.equal((await call('POST', `/api/patients/${P3}/checkin`, {}, await as('doctor1'))).status, 428);
  assert.equal((await call('GET', `/api/patients/${P3}?reason=${encodeURIComponent('Antenatal visit today')}`, undefined, await as('doctor1'))).status, 200);
  const c = await call('POST', `/api/patients/${P3}/checkin`, {}, await as('doctor1'));
  assert.equal(c.status, 201);
  const q = (await call('GET', '/api/queue', undefined, await as('nurse1'))).data.queue.find((x) => x.id === c.data.id);
  assert.equal(q.patient.name_en, null); assert.equal(q.patient.restricted, true);
  assert.equal((await call('GET', `/api/encounters/${c.data.id}`, undefined, await as('his1'))).status, 428); // right role, no grant
  assert.equal((await call('GET', `/api/encounters/${c.data.id}`, undefined, await as('nurse1'))).status, 403); // wrong role
  assert.equal((await call('GET', `/api/encounters/${c.data.id}`, undefined, await as('doctor1'))).status, 200);
});

test('triage: validation, flags, status change, roles', async () => {
  const nurse = await as('nurse1');
  const bad = await call('PUT', `/api/encounters/${e1}/vitals`, { temp: 99, pulse: 'x' }, nurse);
  assert.equal(bad.status, 400); assert.equal(bad.data.errors.temp, 'out_of_range'); assert.equal(bad.data.errors.pulse, 'not_a_number');
  assert.equal((await call('PUT', `/api/encounters/${e1}/vitals`, {}, nurse)).status, 400);
  assert.equal((await call('PUT', `/api/encounters/${e1}/vitals`, { temp: 38.6 }, await as('reg1'))).status, 403);
  const ok = await call('PUT', `/api/encounters/${e1}/vitals`, { temp: 38.6, sys: 150, dia: 95, pulse: 104, rr: 18, spo2: 97, weight: 56, height: 160 }, nurse);
  assert.equal(ok.status, 200); assert.equal(ok.data.encounter.status, 'triaged');
  assert.deepEqual(ok.data.vitals.flags.map((f) => f.code).sort(), ['bp_high', 'fever', 'tachycardia']);
  assert.equal(ok.data.vitals.bmi, 21.9);
  const kid = await call('PUT', `/api/encounters/${e2}/vitals`, { rr: 52, muac: 11.2, temp: 37 }, nurse);
  assert.deepEqual(kid.data.vitals.flags.map((f) => f.code), ['rr_fast_child']); // 7-year-old: fast breathing yes, MUAC screening not applicable
  const q = (await call('GET', '/api/queue', undefined, nurse)).data.queue;
  assert.equal(q.find((x) => x.id === e2).alert, 'warn');
});

test('consultation: roles, notes, diagnoses, one primary only', async () => {
  const doc = await as('doctor1');
  assert.equal((await call('PUT', `/api/encounters/${e1}/notes`, { subjective: 'x' }, await as('nurse1'))).status, 403);
  const n = await call('PUT', `/api/encounters/${e1}/notes`, { subjective: 'Fever, headache', objective: 'Febrile', assessment: 'Suspected malaria', plan: 'RDT', chief_complaint: 'Fever' }, doc);
  assert.equal(n.status, 200); assert.equal(n.data.encounter.status, 'in_consult'); assert.equal(n.data.notes.assessment, 'Suspected malaria');
  assert.equal((await call('POST', `/api/encounters/${e1}/diagnoses`, { code: 'ZZZ9' }, doc)).status, 400);
  await call('POST', `/api/encounters/${e1}/diagnoses`, { code: 'b54', kind: 'primary', certainty: 'suspected' }, doc);
  const r = await call('POST', `/api/encounters/${e1}/diagnoses`, { code: 'R50', kind: 'primary' }, doc);
  const prim = r.data.diagnoses.filter((d) => d.kind === 'primary'); assert.equal(prim.length, 1); assert.equal(prim[0].code, 'R50');
  assert.equal(r.data.diagnoses.find((d) => d.code === 'B54').kind, 'secondary');
  const rm = await call('DELETE', `/api/encounters/${e1}/diagnoses/${r.data.diagnoses.find((d) => d.code === 'B54').id}`, undefined, doc);
  assert.equal(rm.data.diagnoses.length, 1);
});

test('signing needs a primary diagnosis, then locks the visit; addenda allowed', async () => {
  const doc = await as('doctor1');
  assert.equal((await call('POST', `/api/encounters/${e2}/sign`, {}, doc)).status, 400); // no diagnosis yet
  assert.equal((await call('POST', `/api/encounters/${e1}/addendum`, { text: 'early' }, doc)).status, 409); // not signed yet
  assert.equal((await call('POST', `/api/encounters/${e1}/sign`, {}, await as('nurse1'))).status, 403);
  const s = await call('POST', `/api/encounters/${e1}/sign`, {}, doc);
  assert.equal(s.status, 200); assert.equal(s.data.encounter.status, 'signed'); assert.ok(s.data.encounter.signed_by);
  for (const [m, u, b] of [['PUT', 'vitals', { temp: 37 }], ['PUT', 'notes', { subjective: 'changed' }], ['POST', 'diagnoses', { code: 'J06' }]]) {
    assert.equal((await call(m, `/api/encounters/${e1}/${u}`, b, doc)).status, 409, u);
  }
  assert.equal((await call('POST', `/api/encounters/${e1}/cancel`, { reason: 'oops' }, doc)).status, 409);
  const a = await call('POST', `/api/encounters/${e1}/addendum`, { text: 'RDT negative, changed plan' }, doc);
  assert.equal(a.status, 200); assert.equal(a.data.addenda.length, 1);
  assert.equal((await call('POST', `/api/encounters/${e1}/addendum`, { text: '  ' }, doc)).status, 400);
});

test('cancel needs a reason and removes from queue', async () => {
  const reg = await as('reg1');
  assert.equal((await call('POST', `/api/encounters/${e2}/cancel`, { reason: '' }, reg)).status, 400);
  assert.equal((await call('POST', `/api/encounters/${e2}/cancel`, { reason: 'Left without being seen' }, reg)).status, 200);
  const q = (await call('GET', '/api/queue', undefined, reg)).data.queue; assert.ok(!q.some((x) => x.id === e2));
  assert.equal((await call('POST', `/api/patients/${P2}/checkin`, {}, reg)).status, 201); // can check in again after cancel
});

test('allergies and problems', async () => {
  const nurse = await as('nurse1'), doc = await as('doctor1');
  assert.equal((await call('POST', `/api/patients/${P1}/allergies`, { allergen: 'Penicillin', reaction: 'Rash', severity: 'moderate' }, nurse)).status, 201);
  assert.equal((await call('POST', `/api/patients/${P1}/allergies`, { allergen: 'penicillin' }, nurse)).status, 409);
  assert.equal((await call('POST', `/api/patients/${P1}/allergies`, { allergen: '' }, nurse)).status, 400);
  assert.equal((await call('POST', `/api/patients/${P1}/allergies`, { allergen: 'X' }, await as('reg1'))).status, 403);
  const pr = await call('POST', `/api/patients/${P1}/problems`, { text: 'Hypertension', icd_code: 'I10' }, doc);
  assert.equal(pr.status, 201);
  assert.equal((await call('POST', `/api/patients/${P1}/problems`, { text: 'x', icd_code: 'NOPE' }, doc)).status, 400);
  assert.equal((await call('POST', `/api/patients/${P1}/problems`, { text: 'x' }, nurse)).status, 403);
  const d = (await call('GET', `/api/patients/${P1}`, undefined, doc)).data;
  assert.equal(d.allergies.length, 1); assert.equal(d.problems.length, 1); assert.ok(d.encounters.length >= 1);
  assert.match(d.encounters.find((e) => e.status === 'signed').dx, /R50/);
  assert.equal((await call('GET', `/api/patients/${P1}`, undefined, await as('reg1'))).data.allergies, undefined); // no clinical data for clerks
  const s = await call('GET', `/api/patients/${P1}/summary`, undefined, doc); assert.equal(s.status, 200); assert.ok(s.data.patient.name_en);
  assert.equal((await call('POST', `/api/patients/${P1}/allergies/${d.allergies[0].id}/deactivate`, { reason: '' }, nurse)).status, 400);
  assert.equal((await call('POST', `/api/patients/${P1}/allergies/${d.allergies[0].id}/deactivate`, { reason: 'Entered in error' }, nurse)).status, 200);
  assert.equal((await call('POST', `/api/patients/${P1}/problems/${d.problems[0].id}/resolve`, {}, doc)).status, 200);
  assert.equal((await call('POST', `/api/patients/${P1}/problems/${d.problems[0].id}/resolve`, {}, doc)).status, 404);
});

test('encounter shows active allergies; ICD-10 search', async () => {
  await call('POST', `/api/patients/${P1}/allergies`, { allergen: 'Sulfa' }, await as('nurse1'));
  const e = await call('GET', `/api/encounters/${e1}`, undefined, await as('doctor1'));
  assert.deepEqual(e.data.allergies.map((a) => a.allergen), ['Sulfa']);
  const i = await call('GET', '/api/icd10?q=malaria', undefined, await as('doctor1'));
  assert.ok(i.data.codes.some((c) => c.code === 'B54'));
  assert.equal((await call('GET', '/api/icd10?q=malaria', undefined, await as('lab1'))).status, 403);
});

test('audit trail covers the clinical actions', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['checkin', 'vitals_saved', 'notes_saved', 'diagnosis_added', 'diagnosis_removed', 'encounter_signed', 'addendum_added', 'encounter_cancelled', 'allergy_added', 'allergy_removed', 'problem_added', 'problem_resolved', 'encounter_viewed', 'summary_viewed']) assert.ok(actions.has(a), a);
});
