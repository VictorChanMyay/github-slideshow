'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');
const B = require('../lib/backup');

let db, server, base;
before(async () => { db = dbm.open(':memory:'); seed(db, { demo: true }); server = createServer(db, { loginMax: 4 }); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; });
after(() => server.close());
const H = { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' };
const login = async (u, p = DEMO_PASSWORD) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ username: u, password: p }) }); return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], res: r }; };
const call = (method, p, cookie, body) => fetch(base + p, { method, headers: { ...H, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'emr-m10-'));

/* ---------------- sessions ---------------- */
test('a session that has been idle for over an hour is signed out; activity keeps it alive', async () => {
  const { cookie } = await login('nurse1');
  assert.equal((await call('GET', '/api/me', cookie)).status, 200);
  const tok = (c) => c.split('=')[1];
  const sha = require('node:crypto').createHash('sha256').update(tok(cookie)).digest('hex');
  db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(Date.now() - 59 * 60000, sha);
  assert.equal((await call('GET', '/api/me', cookie)).status, 200, '59 minutes idle is still fine');
  assert.ok(db.prepare('SELECT last_seen FROM sessions WHERE token_hash=?').get(sha).last_seen > Date.now() - 5000, 'activity refreshes the clock');
  db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(Date.now() - 61 * 60000, sha);
  assert.equal((await call('GET', '/api/me', cookie)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE token_hash=?').get(sha).c, 0, 'the dead session is removed');
});

test('changing your password signs out your other sessions but not this one', async () => {
  const u = db.prepare("SELECT id FROM users WHERE username='lab1'").get().id;
  const a = await login('lab1'), b = await login('lab1');
  const r = await call('POST', '/api/me/password', a.cookie, { current: DEMO_PASSWORD, new: 'Another-pass-2468' });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/me', a.cookie)).status, 200);
  assert.equal((await call('GET', '/api/me', b.cookie)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id=?').get(u).c, 1);
  await call('POST', '/api/me/password', a.cookie, { current: 'Another-pass-2468', new: DEMO_PASSWORD }); // put it back for other tests
});

test('repeated failed sign-ins from one computer are throttled, and a success is not blocked before the limit', async () => {
  const s2 = createServer(db, { loginMax: 3 }); await new Promise((r) => s2.listen(0, '127.0.0.1', r)); const b2 = 'http://127.0.0.1:' + s2.address().port;
  const bad = (u) => fetch(b2 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ username: u, password: 'nope-nope-1234' }) });
  try {
    assert.equal((await bad('nobody1')).status, 401); assert.equal((await bad('nobody2')).status, 401); assert.equal((await bad('nobody3')).status, 401);
    const blocked = await fetch(b2 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ username: 'doctor1', password: DEMO_PASSWORD }) });
    assert.equal(blocked.status, 429, 'even the right password is refused while throttled');
    assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='login_throttled'").get().c >= 1);
  } finally { s2.close(); }
});

test('security headers are present on pages and API answers', async () => {
  for (const p of ['/', '/api/me']) {
    const r = await fetch(base + p); const h = (n) => r.headers.get(n);
    assert.equal(h('x-content-type-options'), 'nosniff'); assert.equal(h('x-frame-options'), 'DENY');
    assert.match(h('content-security-policy'), /default-src 'self'/); assert.match(h('permissions-policy'), /camera=\(\)/);
  }
  assert.equal((await fetch(base + '/api/me')).headers.get('strict-transport-security'), null, 'no HSTS over plain http');
  const s3 = createServer(db, { secureCookies: true }); await new Promise((r) => s3.listen(0, '127.0.0.1', r));
  try { assert.match((await fetch('http://127.0.0.1:' + s3.address().port + '/')).headers.get('strict-transport-security'), /max-age/); } finally { s3.close(); }
});

test('the database file and the audit log never expose password hashes through the API', async () => {
  const { cookie } = await login('admin');
  const users = await (await call('GET', '/api/users', cookie)).json();
  assert.ok(users.users.length >= 9);
  assert.ok(!JSON.stringify(users).match(/pass_hash|pass_salt/));
  const audit = JSON.stringify(await (await call('GET', '/api/audit', cookie)).json());
  assert.ok(!audit.includes(DEMO_PASSWORD));
});

/* ---------------- user administration ---------------- */
test('only administrators manage users', async () => {
  const { cookie } = await login('doctor1');
  const id = db.prepare("SELECT id FROM users WHERE username='reg1'").get().id;
  assert.equal((await call('PUT', '/api/users/' + id, cookie, { active: false })).status, 403);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(id).active, 1);
});

test('deactivating a user signs them out at once and blocks sign-in; reactivating restores it', async () => {
  const admin = (await login('admin')).cookie; const victim = await login('reg1');
  const id = db.prepare("SELECT id FROM users WHERE username='reg1'").get().id;
  assert.equal((await call('GET', '/api/me', victim.cookie)).status, 200);
  assert.equal((await call('PUT', '/api/users/' + id, admin, { active: false })).status, 200);
  assert.equal((await call('GET', '/api/me', victim.cookie)).status, 401);
  assert.equal((await login('reg1')).status, 401);
  assert.equal((await call('PUT', '/api/users/' + id, admin, { active: true })).status, 200);
  assert.equal((await call('GET', '/api/me', victim.cookie)).status, 401, 'reactivating does not bring the old session back');
  assert.equal((await login('reg1')).status, 200);
  const acts = db.prepare("SELECT action, detail FROM audit_log WHERE action IN ('user_deactivated','user_reactivated') AND detail='reg1'").all().map((r) => r.action);
  assert.deepEqual(acts.sort(), ['user_deactivated', 'user_reactivated']);
});

test('an administrator cannot deactivate themselves or change their own role; one admin may deactivate another', async () => {
  const admin = (await login('admin')).cookie; const me = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  assert.equal((await call('POST', '/api/users', admin, { username: 'admin2', full_name: 'Second Admin', role: 'admin', password: 'Temp-pass-13579' })).status, 201);
  const second = db.prepare("SELECT id FROM users WHERE username='admin2'").get().id;
  const first = await login('admin2', 'Temp-pass-13579'); assert.equal((await call('POST', '/api/me/password', first.cookie, { current: 'Temp-pass-13579', new: 'Second-admin-2468' })).status, 200);
  const a2 = (await login('admin2', 'Second-admin-2468')).cookie;
  assert.equal((await call('PUT', '/api/users/' + me, admin, { active: false, role: 'nurse' })).status, 400, 'with two admins, self-deactivation is still refused for its own sake');
  assert.equal((await call('PUT', '/api/users/' + me, admin, { role: 'nurse' })).status, 400);
  assert.equal(db.prepare('SELECT active, role FROM users WHERE id=?').get(me).active, 1);
  assert.equal((await call('PUT', '/api/users/' + second, a2, { role: 'nurse' })).status, 400, 'cannot change own role');
  assert.equal((await call('PUT', '/api/users/' + me, a2, { active: false })).status, 200, 'another admin may deactivate admin');
  assert.equal((await call('GET', '/api/me', admin)).status, 401, 'and admin is signed out at once');
  assert.equal((await call('PUT', '/api/users/' + second, a2, { active: false })).status, 400, 'the one remaining admin cannot deactivate themselves');
  assert.equal((await call('PUT', '/api/users/' + me, a2, { active: true })).status, 200);
});

test('role change and password reset: forced change, sessions ended, lock cleared, nothing secret logged', async () => {
  const admin = (await login('admin')).cookie; const t = await login('pharm1'); const id = db.prepare("SELECT id FROM users WHERE username='pharm1'").get().id;
  db.prepare('UPDATE users SET failed_count=3, locked_until=? WHERE id=?').run(Date.now() + 600000, id);
  assert.equal((await call('PUT', '/api/users/' + id, admin, { password: 'short' })).status, 400, 'weak temporary password refused');
  assert.equal((await call('PUT', '/api/users/' + id, admin, { password: 'Reset-pass-86420' })).status, 200);
  const u = db.prepare('SELECT must_change, failed_count, locked_until FROM users WHERE id=?').get(id);
  assert.deepEqual({ ...u }, { must_change: 1, failed_count: 0, locked_until: 0 });
  assert.equal((await call('GET', '/api/me', t.cookie)).status, 401, 'old sessions end');
  const again = await login('pharm1', 'Reset-pass-86420'); assert.equal(again.status, 200);
  assert.equal((await call('GET', '/api/patients', again.cookie)).status, 403, 'must change the password before doing anything else');
  assert.equal((await call('PUT', '/api/users/' + id, admin, { role: 'nope' })).status, 400);
  assert.equal((await call('PUT', '/api/users/' + id, admin, { role: 'lab' })).status, 200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id).role, 'lab');
  const log = db.prepare("SELECT detail FROM audit_log WHERE action LIKE 'user_%'").all().map((r) => r.detail).join('|');
  assert.ok(!log.includes('Reset-pass-86420') && !log.includes('Temp-pass-13579'));
  assert.equal((await call('PUT', '/api/users/99999', admin, { active: false })).status, 404);
  db.prepare("UPDATE users SET role='pharmacist', must_change=0 WHERE username='pharm1'").run();
});

test('an administrator can unlock an account', async () => {
  const admin = (await login('admin')).cookie; const id = db.prepare("SELECT id FROM users WHERE username='midwife1'").get().id;
  db.prepare('UPDATE users SET failed_count=0, locked_until=? WHERE id=?').run(Date.now() + 600000, id);
  assert.equal((await login('midwife1')).status, 429);
  assert.equal((await call('PUT', '/api/users/' + id, admin, { unlock: true })).status, 200);
  assert.equal((await login('midwife1')).status, 200);
});

/* ---------------- backup, verify, restore ---------------- */
function makeDb(file) { const d = dbm.open(file); seed(d, { demo: true }); d.prepare("INSERT INTO patients(mrn,name_en,sex,dob) VALUES('BK1','Backup Person','F','2000-01-01')").run(); return d; }

test('a backup taken from a live database passes its own check and can be restored to a working database', () => {
  const dir = tmp(); const src = path.join(dir, 'emr.db'); const d = makeDb(src);
  const r = B.backup(d, path.join(dir, 'bk'));
  assert.ok(r.check.ok); assert.equal(r.check.counts.patients, d.prepare('SELECT COUNT(*) c FROM patients').get().c);
  assert.equal(r.check.schema_version, dbm.SCHEMA_VERSION);
  d.prepare("INSERT INTO patients(mrn,name_en,sex,dob) VALUES('AFTER','Added After Backup','M','1999-01-01')").run(); // the live database moves on
  d.close();
  const target = path.join(dir, 'restored', 'emr.db');
  const out = B.restore(r.file, target);
  assert.equal(out.previous_kept_as, null);
  const back = dbm.open(target);
  assert.ok(back.prepare("SELECT 1 FROM patients WHERE mrn='BK1'").get());
  assert.equal(back.prepare("SELECT 1 FROM patients WHERE mrn='AFTER'").get(), undefined, 'restored state is the state at backup time');
  assert.ok(back.prepare('SELECT 1 FROM users WHERE username=?').get('doctor1'));
  back.close();
});

test('restoring over an existing database keeps the old one next to it and keeps its journal with it', () => {
  const dir = tmp(); const src = path.join(dir, 'emr.db'); const d = makeDb(src);
  const r = B.backup(d, path.join(dir, 'bk'));
  d.prepare("INSERT INTO patients(mrn,name_en,sex,dob) VALUES('LATER','Later Person','M','1999-01-01')").run();
  assert.ok(fs.existsSync(src + '-wal'), 'the live database has a journal file with the latest change in it');
  const out = B.restore(r.file, src, { now: new Date(2030, 0, 2, 3, 4, 5) });
  assert.match(out.previous_kept_as, /emr\.db\.before-restore-20300102-030405$/);
  assert.ok(fs.existsSync(out.previous_kept_as), 'nothing is deleted');
  const kept = dbm.open(out.previous_kept_as); assert.ok(kept.prepare("SELECT 1 FROM patients WHERE mrn='LATER'").get(), 'the old database keeps its latest data too (its journal moves with it)'); kept.close();
  const back = dbm.open(src); assert.equal(back.prepare("SELECT 1 FROM patients WHERE mrn='LATER'").get(), undefined); back.close();
  d.close();
});

test('a damaged or altered backup is refused, never restored', () => {
  const dir = tmp(); const d = makeDb(path.join(dir, 'emr.db')); const r = B.backup(d, path.join(dir, 'bk')); d.close();
  const target = path.join(dir, 'live.db'); fs.writeFileSync(target, 'precious');
  const bytes = fs.readFileSync(r.file); bytes[bytes.length - 3000] ^= 0xff; fs.writeFileSync(r.file, bytes);
  assert.equal(B.verify(r.file).checksum, 'MISMATCH');
  assert.throws(() => B.restore(r.file, target), /not usable/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'precious', 'the live file is untouched');
  fs.rmSync(r.file + '.sha256'); // without the checksum file, SQLite's own check still has to pass or fail
  const junk = path.join(dir, 'junk.db'); fs.writeFileSync(junk, Buffer.alloc(4096, 7));
  assert.throws(() => B.restore(junk, target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'precious');
});

test('encrypted backups need the right passphrase and contain no readable patient data', () => {
  const dir = tmp(); const d = makeDb(path.join(dir, 'emr.db'));
  const r = B.backup(d, path.join(dir, 'bk'), { passphrase: 'correct horse battery' }); d.close();
  assert.match(r.file, /\.db\.enc$/);
  const raw = fs.readFileSync(r.file);
  assert.ok(!raw.includes('Backup Person') && !raw.includes('SQLite format'), 'ciphertext only');
  assert.equal(fs.readdirSync(path.join(dir, 'bk')).filter((f) => f.endsWith('.db')).length, 0, 'no plain copy left behind');
  assert.throws(() => B.verify(r.file), /passphrase is needed/);
  assert.throws(() => B.verify(r.file, { passphrase: 'wrong' }), /Wrong passphrase/);
  assert.ok(B.verify(r.file, { passphrase: 'correct horse battery' }).ok);
  const target = path.join(dir, 'x', 'emr.db'); B.restore(r.file, target, { passphrase: 'correct horse battery' });
  const back = dbm.open(target); assert.ok(back.prepare("SELECT 1 FROM patients WHERE name_en='Backup Person'").get()); back.close();
  const tampered = Buffer.from(raw); tampered[60] ^= 1; fs.writeFileSync(r.file + '.t.enc', tampered);
  assert.throws(() => B.verify(r.file + '.t.enc', { passphrase: 'correct horse battery' }), /Wrong passphrase|damaged/);
});

test('only the newest N backups are kept, and only files made by this tool are ever deleted', () => {
  const dir = tmp(); const d = makeDb(path.join(dir, 'emr.db')); const bk = path.join(dir, 'bk'); fs.mkdirSync(bk);
  fs.writeFileSync(path.join(bk, 'my-notes.txt'), 'keep me'); fs.writeFileSync(path.join(bk, 'emr-old.db'), 'not ours');
  for (let i = 0; i < 5; i++) B.backup(d, bk, { keep: 3, now: new Date(2031, 0, 1 + i, 12, 0, 0) });
  const names = fs.readdirSync(bk).filter((f) => B.NAME.test(f) && !f.endsWith('.sha256')).sort();
  assert.deepEqual(names, ['emr-20310103-120000.db', 'emr-20310104-120000.db', 'emr-20310105-120000.db']);
  assert.ok(fs.existsSync(path.join(bk, 'my-notes.txt')) && fs.existsSync(path.join(bk, 'emr-old.db')));
  assert.equal(fs.readdirSync(bk).filter((f) => f.endsWith('.sha256')).length, 3, 'old checksum files go with their backups');
  d.close();
});

test('two backups in the same second do not overwrite each other', () => {
  const dir = tmp(); const d = makeDb(path.join(dir, 'emr.db')); const t = new Date(2032, 5, 6, 7, 8, 9);
  const a = B.backup(d, path.join(dir, 'bk'), { now: t }), b = B.backup(d, path.join(dir, 'bk'), { now: t });
  assert.notEqual(a.file, b.file); assert.ok(fs.existsSync(a.file) && fs.existsSync(b.file)); d.close();
});

/* ---------------- migrations and performance guards ---------------- */
test('opening a database twice is harmless and reaches the current schema version', () => {
  const dir = tmp(); const f = path.join(dir, 'emr.db'); const a = dbm.open(f); a.close(); const b = dbm.open(f);
  assert.equal(b.prepare('SELECT v FROM schema_version').get().v, dbm.SCHEMA_VERSION); b.close();
});

test('an older database (before the idle-timeout and index migrations) upgrades without losing data', () => {
  const { DatabaseSync } = require('node:sqlite'); const dir = tmp(); const f = path.join(dir, 'old.db');
  const d = dbm.open(f); d.exec('DROP INDEX enc_status_date; ALTER TABLE sessions DROP COLUMN last_seen; UPDATE schema_version SET v=8'); // what a version-8 file looks like
  d.prepare("INSERT INTO patients(mrn,name_en,sex,dob) VALUES('OLD1','Old Person','F','1990-01-01')").run(); d.close();
  const up = dbm.open(f);
  assert.equal(up.prepare('SELECT v FROM schema_version').get().v, dbm.SCHEMA_VERSION);
  assert.ok(up.prepare("SELECT 1 FROM patients WHERE mrn='OLD1'").get());
  assert.ok(up.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name='last_seen'").get());
  up.close(); void DatabaseSync;
});

test('a database from a newer program version is refused by both the server start-up and restore', () => {
  const dir = tmp(); const f = path.join(dir, 'emr.db'); const d = dbm.open(f); d.exec('UPDATE schema_version SET v=99'); d.close();
  assert.throws(() => dbm.open(f), /newer version/);
  const bk = path.join(dir, 'new.db'); fs.copyFileSync(f, bk);
  assert.throws(() => B.restore(bk, path.join(dir, 'target.db')), /newer version/);
  assert.ok(!fs.existsSync(path.join(dir, 'target.db')));
});

test('the signed-visit queries use the covering index (guards the speed-up)', () => {
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM encounters WHERE status='signed' AND visit_date BETWEEN ? AND ?").all('2025-01-01', '2025-12-31').map((r) => r.detail).join(' ');
  assert.match(plan, /COVERING INDEX enc_status_date/);
});

test('large-data smoke test: 3000 patients and 10000 visits, every report still answers quickly', () => {
  const d = dbm.open(':memory:'); const R = require('../lib/reports'); const dash = require('../lib/dashboard');
  d.exec('BEGIN'); const code = d.prepare('SELECT code FROM icd10 LIMIT 1').get().code;
  for (let i = 0; i < 3000; i++) { const p = Number(d.prepare("INSERT INTO patients(mrn,name_en,sex,dob) VALUES(?,?,?,?)").run('S' + i, 'P' + i, i % 2 ? 'F' : 'M', `19${60 + (i % 40)}-01-01`).lastInsertRowid);
    for (let j = 0; j < 3 + (i % 2); j++) { const e = Number(d.prepare("INSERT INTO encounters(patient_id,visit_date,queue_no,status) VALUES(?,?,?,?)").run(p, '2025-0' + (1 + (i + j) % 9) + '-10', 1, 'signed').lastInsertRowid); d.prepare("INSERT INTO diagnoses(encounter_id,code,kind) VALUES(?,?,'primary')").run(e, code); } }
  d.exec('COMMIT');
  const t0 = Date.now();
  for (const k of Object.keys(R.REPORTS)) R.run(d, k, '2025-01-01', '2025-12-31', { mask: true });
  dash.dashboard(d, { id: 1, role: 'admin' });
  assert.ok(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + ' ms');
  const m = R.run(d, 'morbidity', '2025-01-01', '2025-12-31', { mask: true }).sections[0].rows[0]; assert.equal(m.total, d.prepare('SELECT COUNT(*) c FROM diagnoses').get().c);
  assert.equal(m.female + m.male, m.total, 'age/sex breakdown still adds up after the speed-up');
  const ages = ['u1', 'a1_4', 'a5_14', 'a15_24', 'a25_49', 'a50p'].reduce((s, k) => s + m[k], 0); assert.equal(ages, m.total);
});
