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
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function as(username) { const r = await call('POST', '/api/login', { username, password: DEMO_PASSWORD }); assert.equal(r.status, 200); return r.cookie; }

test('login: wrong password rejected, no session', async () => {
  const r = await call('POST', '/api/login', { username: 'doctor1', password: 'nope' });
  assert.equal(r.status, 401);
  assert.equal((await call('GET', '/api/patients')).status, 401);
});

test('API requires custom header on writes (CSRF guard)', async () => {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('account locks after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/api/login', { username: 'lab1', password: 'bad' + i });
  const r = await call('POST', '/api/login', { username: 'lab1', password: DEMO_PASSWORD });
  assert.equal(r.status, 429);
});

test('patients: register, search by alternate-script name and ID number', async () => {
  const c = await as('reg1');
  const r = await call('POST', '/api/patients', { name_en: 'Test Person', sex: 'F', dob: '2001-02-03', names: [{ script: 'my', name: 'စမ်းသပ်' }], ids: [{ id_type: 'passport', number: 'P123456' }] }, c);
  assert.equal(r.status, 201); assert.match(r.data.mrn, /^MTC-\d{6}$/);
  const byName = (await call('GET', '/api/patients?q=' + encodeURIComponent('စမ်း'), undefined, c)).data.patients;
  assert.ok(byName.some((p) => p.mrn === r.data.mrn));
  const byId = (await call('GET', '/api/patients?q=P123456', undefined, c)).data.patients;
  assert.equal(byId.length, 1); assert.equal(byId[0].mrn, r.data.mrn);
  const full = await call('GET', '/api/patients/' + r.data.id, undefined, c);
  assert.equal(full.status, 200); assert.equal(full.data.patient.ids[0].number, 'P123456');
});

test('patients: duplicate warning, then force', async () => {
  const c = await as('reg1');
  const body = { name_en: 'Dup Person', sex: 'M', dob: '1990-01-01' };
  assert.equal((await call('POST', '/api/patients', body, c)).status, 201);
  const d = await call('POST', '/api/patients', body, c);
  assert.equal(d.status, 409); assert.equal(d.data.duplicates.length, 1);
  assert.equal((await call('POST', '/api/patients', { ...body, force: true }, c)).status, 201);
});

test('patients: validation', async () => {
  const c = await as('reg1');
  for (const bad of [{ name_en: '', sex: 'F', dob: '2000-01-01' }, { name_en: 'X', sex: 'Z', dob: '2000-01-01' }, { name_en: 'X', sex: 'F', dob: '2999-01-01' },
    { name_en: 'X', sex: 'F', dob: '2000-02-31' }, { name_en: 'X', sex: 'F', dob: '2000-01-01', ids: [{ id_type: 'nope', number: '1' }] }]) {
    assert.equal((await call('POST', '/api/patients', bad, c)).status, 400, JSON.stringify(bad));
  }
});

test('search treats % and _ literally and is safe against SQL injection text', async () => {
  const c = await as('reg1');
  const r = await call('GET', "/api/patients?q=" + encodeURIComponent("%' OR 1=1 --"), undefined, c);
  assert.equal(r.status, 200); assert.equal(r.data.patients.length, 0);
});

test('restricted record: reason required, role checked, access logged', async () => {
  const id = db.prepare('SELECT id FROM patients WHERE restricted=1').get().id;
  const doc = await as('doctor1');
  assert.equal((await call('GET', '/api/patients/' + id, undefined, doc)).status, 428);
  assert.equal((await call('GET', `/api/patients/${id}?reason=abc`, undefined, doc)).status, 428);
  assert.equal((await call('GET', `/api/patients/${id}?reason=${encodeURIComponent('Antenatal follow-up')}`, undefined, doc)).status, 200);
  const nurse = await as('nurse1');
  assert.equal((await call('GET', `/api/patients/${id}?reason=${encodeURIComponent('just curious')}`, undefined, nurse)).status, 403);
  const log = db.prepare("SELECT action,detail FROM audit_log WHERE patient_id=? AND action IN ('restricted_access','restricted_denied') ORDER BY id").all(id);
  assert.deepEqual(log.map((x) => x.action), ['restricted_access', 'restricted_denied']);
  assert.equal(log[0].detail, 'Antenatal follow-up');
});

test('restricted patients hide alternate names in lists', async () => {
  const c = await as('doctor1');
  const rows = (await call('GET', '/api/patients', undefined, c)).data.patients.filter((p) => p.restricted);
  assert.ok(rows.length >= 1); for (const p of rows) assert.deepEqual(p.names, []);
});

test('permissions: audit and users are limited', async () => {
  assert.equal((await call('GET', '/api/audit', undefined, await as('nurse1'))).status, 403);
  assert.equal((await call('GET', '/api/users', undefined, await as('his1'))).status, 403);
  assert.equal((await call('GET', '/api/audit', undefined, await as('his1'))).status, 200);
  assert.equal((await call('GET', '/api/users', undefined, await as('admin'))).status, 200);
  assert.equal((await call('POST', '/api/patients', { name_en: 'X', sex: 'F', dob: '2000-01-01' }, await as('pharm1'))).status, 403);
});

test('admin creates user who must change password before working', async () => {
  const admin = await as('admin');
  assert.equal((await call('POST', '/api/users', { username: 'newnurse', full_name: 'New Nurse', role: 'nurse', password: 'short' }, admin)).status, 400);
  assert.equal((await call('POST', '/api/users', { username: 'newnurse', full_name: 'New Nurse', role: 'nurse', password: 'Temp-pass-2026' }, admin)).status, 201);
  const l = await call('POST', '/api/login', { username: 'newnurse', password: 'Temp-pass-2026' });
  assert.equal((await call('GET', '/api/patients', undefined, l.cookie)).status, 403);
  assert.equal((await call('POST', '/api/me/password', { current: 'Temp-pass-2026', new: 'Better-pass-2026' }, l.cookie)).status, 200);
  assert.equal((await call('GET', '/api/patients', undefined, l.cookie)).status, 200);
});

test('logout invalidates the session', async () => {
  const c = await as('doctor1');
  await call('POST', '/api/logout', {}, c);
  assert.equal((await call('GET', '/api/me', undefined, c)).status, 401);
});

test('audit log records logins, failures and patient creation', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['login', 'login_failed', 'patient_created', 'patient_viewed']) assert.ok(actions.has(a), a);
});

test('static: path traversal blocked, index served', async () => {
  assert.ok([403, 404].includes((await fetch(base + '/..%2f..%2fserver.js')).status));
  const r = await fetch(base + '/..%2fserver.js'); assert.notEqual(r.status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
});
