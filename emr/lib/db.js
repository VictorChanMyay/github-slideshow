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
  // 3: lab, formulary, prescribing, dispensing, stock
  `
  CREATE TABLE lab_tests(
    id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('numeric','qualitative')),
    unit TEXT, ref_low REAL, ref_high REAL, crit_low REAL, crit_high REAL, options TEXT, abnormal TEXT,
    sensitive INTEGER NOT NULL DEFAULT 0, adult_only INTEGER NOT NULL DEFAULT 0,
    ref_low_m REAL, ref_high_m REAL, ref_low_f REAL, ref_high_f REAL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE lab_orders(
    id INTEGER PRIMARY KEY, encounter_id INTEGER NOT NULL REFERENCES encounters(id), patient_id INTEGER NOT NULL REFERENCES patients(id),
    test_id INTEGER NOT NULL REFERENCES lab_tests(id), priority TEXT NOT NULL DEFAULT 'routine' CHECK(priority IN ('routine','urgent')),
    status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','collected','resulted','cancelled')),
    ordered_by INTEGER REFERENCES users(id), ordered_at TEXT NOT NULL DEFAULT (datetime('now')),
    collected_by INTEGER REFERENCES users(id), collected_at TEXT,
    result_value TEXT, result_flag TEXT, result_comment TEXT, resulted_by INTEGER REFERENCES users(id), resulted_at TEXT,
    amended INTEGER NOT NULL DEFAULT 0, cancel_reason TEXT
  );
  CREATE INDEX lab_orders_enc ON lab_orders(encounter_id);
  CREATE INDEX lab_orders_status ON lab_orders(status);
  CREATE TABLE lab_result_history(
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES lab_orders(id), old_value TEXT, new_value TEXT, reason TEXT NOT NULL,
    by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE drugs(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, strength TEXT NOT NULL, form TEXT NOT NULL, class TEXT, tags TEXT,
    reorder_level INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, UNIQUE(name, strength, form)
  );
  CREATE TABLE prescriptions(
    id INTEGER PRIMARY KEY, encounter_id INTEGER NOT NULL REFERENCES encounters(id), patient_id INTEGER NOT NULL REFERENCES patients(id),
    drug_id INTEGER NOT NULL REFERENCES drugs(id), dose TEXT NOT NULL, frequency TEXT NOT NULL, duration_days INTEGER NOT NULL, quantity INTEGER NOT NULL,
    instructions TEXT, status TEXT NOT NULL DEFAULT 'prescribed' CHECK(status IN ('prescribed','partial','dispensed','cancelled')),
    allergy_override_reason TEXT, duplicate_confirmed INTEGER NOT NULL DEFAULT 0, cancel_reason TEXT,
    prescribed_by INTEGER REFERENCES users(id), prescribed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX rx_enc ON prescriptions(encounter_id);
  CREATE INDEX rx_status ON prescriptions(status);
  CREATE TABLE stock_batches(
    id INTEGER PRIMARY KEY, drug_id INTEGER NOT NULL REFERENCES drugs(id), batch_no TEXT NOT NULL, expiry TEXT NOT NULL,
    qty_received INTEGER NOT NULL, qty_on_hand INTEGER NOT NULL CHECK(qty_on_hand >= 0), source TEXT,
    received_by INTEGER REFERENCES users(id), received_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(drug_id, batch_no, expiry)
  );
  CREATE TABLE stock_movements(
    id INTEGER PRIMARY KEY, drug_id INTEGER NOT NULL REFERENCES drugs(id), batch_id INTEGER REFERENCES stock_batches(id),
    type TEXT NOT NULL CHECK(type IN ('receive','dispense','adjust','writeoff')), qty INTEGER NOT NULL, reference TEXT, reason TEXT,
    by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE dispensing(
    id INTEGER PRIMARY KEY, prescription_id INTEGER NOT NULL REFERENCES prescriptions(id), batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
    qty INTEGER NOT NULL CHECK(qty > 0), by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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
  if (db.prepare('SELECT COUNT(*) c FROM icd10').get().c === 0) {
    const ins = db.prepare('INSERT INTO icd10(code,name) VALUES(?,?)');
    tx(db, () => { for (const [c, name] of require('./icd10')) ins.run(c, name); });
  }
  const { DRUGS, LABS } = require('./formulary_seed');
  if (db.prepare('SELECT COUNT(*) c FROM drugs').get().c === 0) {
    const ins = db.prepare('INSERT INTO drugs(name,strength,form,class,tags,reorder_level) VALUES(?,?,?,?,?,?)');
    tx(db, () => { for (const d of DRUGS) ins.run(...d); });
  }
  if (db.prepare('SELECT COUNT(*) c FROM lab_tests').get().c === 0) {
    const ins = db.prepare(`INSERT INTO lab_tests(code,name,kind,unit,ref_low,ref_high,crit_low,crit_high,options,abnormal,sensitive,adult_only,ref_low_m,ref_high_m,ref_low_f,ref_high_f)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    tx(db, () => { for (const l of LABS) { const row = l.slice(); while (row.length < 16) row.push(null); ins.run(...row); } });
  }
}

// Run fn inside a transaction (rolls back on throw).
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, tx };
