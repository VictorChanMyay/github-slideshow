'use strict';
// Backup, verify and restore. A backup is a consistent snapshot made with VACUUM INTO, so it is safe to take
// while the server is running. Optionally encrypted with a passphrase (AES-256-GCM, key from scrypt).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MAGIC = Buffer.from('EMRB1');
const NAME = /^emr-\d{8}-\d{6}(-\d+)?\.db(\.enc)?$/;

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function encryptBuffer(buf, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}
function decryptBuffer(buf, passphrase) {
  if (buf.length < MAGIC.length + 44 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted EMR backup');
  const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(buf.length - 16), body = buf.subarray(33, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(body), d.final()]); }
  catch { throw new Error('Wrong passphrase, or the backup file is damaged'); }
}

// Check a plain database file: SQLite integrity, foreign keys, schema version and a few row counts.
function checkDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    const fk = db.prepare('PRAGMA foreign_key_check').all().length;
    const version = db.prepare('SELECT v FROM schema_version').get();
    const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const counts = { users: n('users'), patients: n('patients'), encounters: n('encounters'), audit_log: n('audit_log') };
    const ok = integrity.length === 1 && integrity[0] === 'ok' && fk === 0 && !!version;
    return { ok, integrity: integrity.join('; '), foreign_key_problems: fk, schema_version: version ? version.v : null, counts };
  } finally { db.close(); }
}

// Take a backup of a running (open) database into dir. Returns { file, bytes, check }.
function backup(db, dir, { passphrase, keep = 30, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let base = `emr-${stamp(now)}`, n = 0;
  while (fs.existsSync(path.join(dir, base + '.db')) || fs.existsSync(path.join(dir, base + '.db.enc'))) base = `emr-${stamp(now)}-${++n}`;
  const plain = path.join(dir, base + '.db');
  db.exec(`VACUUM INTO '${plain.replace(/'/g, "''")}'`);
  const check = checkDb(plain);
  if (!check.ok) { fs.rmSync(plain, { force: true }); throw new Error('Backup failed its own check: ' + check.integrity); }
  let final = plain;
  if (passphrase) {
    final = plain + '.enc';
    fs.writeFileSync(final, encryptBuffer(fs.readFileSync(plain), passphrase), { mode: 0o600 });
    fs.rmSync(plain);
  } else fs.chmodSync(plain, 0o600);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(final)).digest('hex');
  fs.writeFileSync(final + '.sha256', sha + '  ' + path.basename(final) + '\n');
  prune(dir, keep);
  return { file: final, bytes: fs.statSync(final).size, sha256: sha, check };
}

function prune(dir, keep) {
  const files = fs.readdirSync(dir).filter((f) => NAME.test(f)).sort(); // names sort by time
  for (const f of files.slice(0, Math.max(0, files.length - keep))) { fs.rmSync(path.join(dir, f), { force: true }); fs.rmSync(path.join(dir, f + '.sha256'), { force: true }); }
}

// Verify a backup file (plain or encrypted) without touching anything.
function verify(file, { passphrase } = {}) {
  const raw = fs.readFileSync(file);
  const side = file + '.sha256';
  let checksum = 'none';
  if (fs.existsSync(side)) checksum = fs.readFileSync(side, 'utf8').split(/\s+/)[0] === crypto.createHash('sha256').update(raw).digest('hex') ? 'match' : 'MISMATCH';
  if (checksum === 'MISMATCH') return { ok: false, checksum, integrity: 'file changed since the backup was made' };
  let tmpDir, plain = file;
  try {
    if (raw.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (!passphrase) throw new Error('This backup is encrypted: a passphrase is needed');
      tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'emr-verify-'));
      plain = path.join(tmpDir, 'x.db'); fs.writeFileSync(plain, decryptBuffer(raw, passphrase), { mode: 0o600 });
    }
    return { ...checkDb(plain), checksum };
  } finally { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

// Restore a backup over the database file `target`. The current database is kept next to it, never deleted.
// The server must be stopped first. Returns { restored_from, previous_kept_as, check }.
function restore(file, target, { passphrase, now = new Date() } = {}) {
  const v = verify(file, { passphrase });
  if (!v.ok) throw new Error('Backup is not usable: ' + (v.integrity || 'check failed'));
  if (v.schema_version > require('./db').SCHEMA_VERSION) throw new Error(`Backup is from a newer version of the program (schema ${v.schema_version}); update the program first`);
  const raw = fs.readFileSync(file);
  const data = raw.subarray(0, MAGIC.length).equals(MAGIC) ? decryptBuffer(raw, passphrase) : raw;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let kept = null;
  if (fs.existsSync(target)) {
    kept = `${target}.before-restore-${stamp(now)}`;
    fs.renameSync(target, kept);
  }
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(target + ext)) fs.renameSync(target + ext, (kept || target + '.old') + ext); // old journal must not be replayed onto the restored file
  fs.writeFileSync(target, data, { mode: 0o600 });
  const check = checkDb(target);
  if (!check.ok) throw new Error('Restored file failed its check: ' + check.integrity);
  return { restored_from: file, previous_kept_as: kept, check };
}

module.exports = { backup, verify, restore, checkDb, encryptBuffer, decryptBuffer, prune, NAME };
