'use strict';
// All database access goes through here, so the SQLite driver can be swapped later.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = [
  // 1: foundation
  `
  CREATE TABLE users(
    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
    role TEXT NOT NULL, pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'en', must_change INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions(
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE audit_log(
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER, username TEXT, action TEXT NOT NULL, patient_id INTEGER,
    detail TEXT, ip TEXT
  );
  CREATE INDEX audit_patient ON audit_log(patient_id);
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE patients(
    id INTEGER PRIMARY KEY, mrn TEXT UNIQUE NOT NULL, name_en TEXT NOT NULL,
    sex TEXT NOT NULL CHECK(sex IN ('F','M','O')), dob TEXT NOT NULL,
    dob_estimated INTEGER NOT NULL DEFAULT 0, phone TEXT, village TEXT,
    ethnicity TEXT, language TEXT, nationality TEXT, restricted INTEGER NOT NULL DEFAULT 0,
    voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT,
    created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX patients_name ON patients(name_en COLLATE NOCASE);
  CREATE TABLE patient_names(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
    script TEXT NOT NULL, name TEXT NOT NULL
  );
  CREATE INDEX patient_names_pid ON patient_names(patient_id);
  CREATE TABLE patient_ids(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id),
    id_type TEXT NOT NULL, number TEXT NOT NULL
  );
  CREATE INDEX patient_ids_pid ON patient_ids(patient_id);
  CREATE INDEX patient_ids_num ON patient_ids(number);
  `,
];

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version(v) VALUES(0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.prepare('UPDATE schema_version SET v=?').run(v);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

// Run fn inside a transaction (rolls back on throw).
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, tx };
