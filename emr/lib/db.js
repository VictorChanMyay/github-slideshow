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
  // 2: outpatient core
  `
  CREATE TABLE icd10(code TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE access_grants(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), patient_id INTEGER NOT NULL REFERENCES patients(id),
    reason TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX grants_lookup ON access_grants(user_id, patient_id);
  CREATE TABLE encounters(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), visit_date TEXT NOT NULL, queue_no INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'outpatient' CHECK(type IN ('outpatient','antenatal','follow_up','emergency')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgent')),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','triaged','in_consult','signed','cancelled')),
    chief_complaint TEXT, cancel_reason TEXT,
    checkin_by INTEGER REFERENCES users(id), triage_by INTEGER REFERENCES users(id), consult_by INTEGER REFERENCES users(id),
    signed_by INTEGER REFERENCES users(id), signed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX enc_patient ON encounters(patient_id);
  CREATE INDEX enc_date ON encounters(visit_date);
  CREATE TABLE vitals(
    encounter_id INTEGER PRIMARY KEY REFERENCES encounters(id), temp REAL, sys REAL, dia REAL, pulse REAL, rr REAL, spo2 REAL,
    weight REAL, height REAL, muac REAL, recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE notes(
    encounter_id INTEGER PRIMARY KEY REFERENCES encounters(id), subjective TEXT, objective TEXT, assessment TEXT, plan TEXT,
    updated_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE diagnoses(
    id INTEGER PRIMARY KEY, encounter_id INTEGER NOT NULL REFERENCES encounters(id), code TEXT NOT NULL REFERENCES icd10(code),
    kind TEXT NOT NULL DEFAULT 'secondary' CHECK(kind IN ('primary','secondary')),
    certainty TEXT NOT NULL DEFAULT 'confirmed' CHECK(certainty IN ('confirmed','suspected')),
    added_by INTEGER REFERENCES users(id), added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(encounter_id, code)
  );
  CREATE TABLE addenda(
    id INTEGER PRIMARY KEY, encounter_id INTEGER NOT NULL REFERENCES encounters(id), text TEXT NOT NULL,
    by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE allergies(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), allergen TEXT NOT NULL, reaction TEXT,
    severity TEXT NOT NULL DEFAULT 'unknown' CHECK(severity IN ('mild','moderate','severe','unknown')),
    active INTEGER NOT NULL DEFAULT 1, deactivated_reason TEXT, recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX allergies_pid ON allergies(patient_id);
  CREATE TABLE problems(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), text TEXT NOT NULL, icd_code TEXT REFERENCES icd10(code),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')), onset TEXT,
    recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
  );
  CREATE INDEX problems_pid ON problems(patient_id);
  `,
];

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate(db);
  seedReference(db);
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

function seedReference(db) {
  const n = db.prepare('SELECT COUNT(*) c FROM icd10').get().c;
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO icd10(code,name) VALUES(?,?)');
  tx(db, () => { for (const [c, name] of require('./icd10')) ins.run(c, name); });
}

// Run fn inside a transaction (rolls back on throw).
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, tx };
