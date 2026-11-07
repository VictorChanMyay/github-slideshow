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
  // 4: maternal and child health
  `
  ALTER TABLE patients ADD COLUMN mother_id INTEGER REFERENCES patients(id);
  CREATE INDEX patients_mother ON patients(mother_id);
  CREATE TABLE anc_episodes(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), lmp TEXT NOT NULL, lmp_certain INTEGER NOT NULL DEFAULT 1,
    edd TEXT NOT NULL, edd_source TEXT NOT NULL CHECK(edd_source IN ('lmp','ultrasound')), gravida INTEGER NOT NULL, para INTEGER NOT NULL, living_children INTEGER NOT NULL DEFAULT 0,
    risk_factors TEXT NOT NULL DEFAULT '[]', notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','delivered','miscarriage','transferred','closed')), closed_reason TEXT, closed_at TEXT,
    booked_by INTEGER REFERENCES users(id), booked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX one_active_episode ON anc_episodes(patient_id) WHERE status='active';
  CREATE INDEX episodes_patient ON anc_episodes(patient_id);
  CREATE TABLE anc_visits(
    id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES anc_episodes(id), encounter_id INTEGER NOT NULL REFERENCES encounters(id),
    visit_date TEXT NOT NULL, ga_days INTEGER NOT NULL, weight REAL, sys REAL, dia REAL, temp REAL, fundal_height REAL, fhr INTEGER,
    presentation TEXT, fetal_movement TEXT, urine_protein TEXT, hb REAL, danger_signs TEXT NOT NULL DEFAULT '[]',
    iron_folate INTEGER NOT NULL DEFAULT 0, td_vaccine INTEGER NOT NULL DEFAULT 0, counselling TEXT, next_visit_date TEXT, notes TEXT,
    recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(episode_id, encounter_id)
  );
  CREATE TABLE deliveries(
    id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL UNIQUE REFERENCES anc_episodes(id), patient_id INTEGER NOT NULL REFERENCES patients(id),
    delivered_on TEXT NOT NULL, delivered_time TEXT, ga_days INTEGER NOT NULL, mode TEXT NOT NULL, place TEXT NOT NULL, labour_hours REAL, blood_loss_ml INTEGER,
    third_stage TEXT, oxytocin INTEGER NOT NULL DEFAULT 0, perineal_tear TEXT, complications TEXT NOT NULL DEFAULT '[]',
    maternal_outcome TEXT NOT NULL, referred_to TEXT, notes TEXT, recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE newborns(
    id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL REFERENCES deliveries(id), birth_order INTEGER NOT NULL, outcome TEXT NOT NULL,
    patient_id INTEGER REFERENCES patients(id), sex TEXT, birth_weight_g INTEGER, apgar1 INTEGER, apgar5 INTEGER, resuscitation INTEGER NOT NULL DEFAULT 0,
    breastfed_within_hour INTEGER NOT NULL DEFAULT 0, skin_to_skin INTEGER NOT NULL DEFAULT 0, vitamin_k INTEGER NOT NULL DEFAULT 0,
    bcg_given INTEGER NOT NULL DEFAULT 0, opv0_given INTEGER NOT NULL DEFAULT 0, hepb0_given INTEGER NOT NULL DEFAULT 0, referred INTEGER NOT NULL DEFAULT 0, notes TEXT
  );
  CREATE TABLE partograph_entries(
    id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES anc_episodes(id), recorded_at TEXT NOT NULL, cervix_cm INTEGER, descent INTEGER, contractions INTEGER,
    fhr INTEGER, pulse INTEGER, sys REAL, dia REAL, temp REAL, liquor TEXT, moulding INTEGER, notes TEXT, by_user INTEGER REFERENCES users(id)
  );
  CREATE INDEX partograph_ep ON partograph_entries(episode_id);
  CREATE TABLE postnatal_visits(
    id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES anc_episodes(id), encounter_id INTEGER REFERENCES encounters(id), visit_date TEXT NOT NULL, days_postpartum INTEGER NOT NULL,
    newborn_id INTEGER REFERENCES newborns(id), sys REAL, dia REAL, temp REAL, pulse INTEGER, bleeding TEXT, uterus TEXT, perineum TEXT, mood TEXT, mother_danger TEXT NOT NULL DEFAULT '[]',
    baby_weight_g INTEGER, baby_temp REAL, baby_rr INTEGER, feeding TEXT, cord TEXT, jaundice INTEGER NOT NULL DEFAULT 0, baby_danger TEXT NOT NULL DEFAULT '[]',
    counselled_fp INTEGER NOT NULL DEFAULT 0, notes TEXT, recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE family_planning(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), encounter_id INTEGER REFERENCES encounters(id), visit_date TEXT NOT NULL,
    method TEXT NOT NULL, action TEXT NOT NULL, pregnancy_excluded INTEGER NOT NULL DEFAULT 0, sys REAL, dia REAL, side_effects TEXT, next_due TEXT,
    warnings_acked TEXT NOT NULL DEFAULT '[]', notes TEXT, recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX fp_patient ON family_planning(patient_id);
  `,
  // 5: child health (immunization schedule, doses given, growth measurements)
  `
  CREATE TABLE vaccines(code TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE vaccine_doses(
    id INTEGER PRIMARY KEY, vaccine_code TEXT NOT NULL REFERENCES vaccines(code), dose_no INTEGER NOT NULL, due_days INTEGER NOT NULL, min_age_days INTEGER NOT NULL,
    min_interval_days INTEGER, max_age_days INTEGER, late_days INTEGER NOT NULL DEFAULT 28, UNIQUE(vaccine_code, dose_no)
  );
  CREATE TABLE immunizations(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), vaccine_code TEXT NOT NULL, dose_no INTEGER NOT NULL, given_on TEXT NOT NULL,
    batch_no TEXT, site TEXT, source TEXT NOT NULL CHECK(source IN ('given_here','card','birth_record')), valid INTEGER NOT NULL DEFAULT 1, invalid_reason TEXT,
    recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now')), voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT,
    FOREIGN KEY(vaccine_code, dose_no) REFERENCES vaccine_doses(vaccine_code, dose_no)
  );
  CREATE UNIQUE INDEX one_valid_dose ON immunizations(patient_id, vaccine_code, dose_no) WHERE voided=0 AND valid=1;
  CREATE INDEX imm_patient ON immunizations(patient_id);
  CREATE TABLE growth_measurements(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), encounter_id INTEGER REFERENCES encounters(id), measured_on TEXT NOT NULL, age_days INTEGER NOT NULL,
    weight_kg REAL, length_cm REAL, head_cm REAL, muac_cm REAL, lying INTEGER, edema INTEGER NOT NULL DEFAULT 0, notes TEXT,
    recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now')), voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT
  );
  CREATE INDEX growth_patient ON growth_measurements(patient_id);
  `,
  // 6: programmes (TB, HIV, malaria, malnutrition, chronic disease)
  `
  CREATE TABLE program_enrolments(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), program TEXT NOT NULL CHECK(program IN ('tb','hiv','malaria','nutrition','chronic')),
    condition TEXT NOT NULL DEFAULT '', registration_no TEXT NOT NULL UNIQUE, enrolled_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
    outcome TEXT, outcome_on TEXT, outcome_note TEXT, details TEXT NOT NULL DEFAULT '{}', next_due TEXT, contact_consent INTEGER NOT NULL DEFAULT 0,
    enrolled_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX one_active_enrolment ON program_enrolments(patient_id, program, condition) WHERE status='active';
  CREATE INDEX enrol_patient ON program_enrolments(patient_id);
  CREATE INDEX enrol_status ON program_enrolments(program, status);
  CREATE TABLE program_visits(
    id INTEGER PRIMARY KEY, enrolment_id INTEGER NOT NULL REFERENCES program_enrolments(id), visit_date TEXT NOT NULL, encounter_id INTEGER REFERENCES encounters(id),
    data TEXT NOT NULL DEFAULT '{}', growth_id INTEGER REFERENCES growth_measurements(id), next_due TEXT, recorded_by INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX pvisit_enrol ON program_visits(enrolment_id);
  `,
  // 7: referrals, appointments and reminders
  `
  CREATE TABLE referral_destinations(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL DEFAULT 'hospital', contact TEXT, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE referrals(
    id INTEGER PRIMARY KEY, ref_no TEXT NOT NULL UNIQUE, patient_id INTEGER NOT NULL REFERENCES patients(id), encounter_id INTEGER REFERENCES encounters(id),
    destination_id INTEGER REFERENCES referral_destinations(id), destination_name TEXT NOT NULL, service TEXT, reason TEXT NOT NULL,
    urgency TEXT NOT NULL CHECK(urgency IN ('routine','urgent','emergency')), clinical_summary TEXT NOT NULL, needs TEXT,
    consent_to_share INTEGER NOT NULL DEFAULT 0, consent_note TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','attended','completed','cancelled')), cancel_reason TEXT,
    created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
    attended_on TEXT, back_outcome TEXT, back_treatment TEXT, back_followup TEXT, back_by INTEGER REFERENCES users(id), back_at TEXT
  );
  CREATE INDEX referrals_patient ON referrals(patient_id);
  CREATE INDEX referrals_status ON referrals(status);
  CREATE TABLE appointments(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), encounter_id INTEGER REFERENCES encounters(id), appt_date TEXT NOT NULL, appt_time TEXT,
    purpose TEXT NOT NULL, note TEXT, reminder_ok INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','attended','cancelled','rescheduled')),
    cancel_reason TEXT, rescheduled_to INTEGER, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX appt_date ON appointments(appt_date);
  CREATE INDEX appt_patient ON appointments(patient_id);
  CREATE TABLE appointment_reminders(
    id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id), method TEXT NOT NULL CHECK(method IN ('call','sms','visit')),
    result TEXT NOT NULL CHECK(result IN ('reached','no_answer','wrong_number','declined')), by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX reminders_appt ON appointment_reminders(appointment_id);
  `,
  // 8: inpatient care, procedures and the blood bank
  `
  CREATE TABLE wards(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'general' CHECK(kind IN ('general','maternity','paediatric','isolation','other')), active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE beds(id INTEGER PRIMARY KEY, ward_id INTEGER NOT NULL REFERENCES wards(id), label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','out_of_service')), UNIQUE(ward_id, label));
  CREATE TABLE admissions(
    id INTEGER PRIMARY KEY, adm_no TEXT NOT NULL UNIQUE, patient_id INTEGER NOT NULL REFERENCES patients(id), encounter_id INTEGER REFERENCES encounters(id),
    ward_id INTEGER NOT NULL REFERENCES wards(id), bed_id INTEGER NOT NULL REFERENCES beds(id), admitted_at TEXT NOT NULL DEFAULT (datetime('now')), admitted_by INTEGER REFERENCES users(id),
    reason TEXT NOT NULL, admit_dx_code TEXT REFERENCES icd10(code), admit_dx_text TEXT, condition TEXT NOT NULL DEFAULT 'stable' CHECK(condition IN ('stable','serious','critical')),
    isolation INTEGER NOT NULL DEFAULT 0, isolation_override TEXT, obs_every_hours INTEGER NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'admitted' CHECK(status IN ('admitted','discharged')), discharged_at TEXT, discharged_by INTEGER REFERENCES users(id),
    discharge_type TEXT CHECK(discharge_type IN ('discharged','referred','transferred','absconded','died')), discharge_condition TEXT, discharge_dx_code TEXT REFERENCES icd10(code), discharge_dx_text TEXT,
    stay_summary TEXT, discharge_medicines TEXT, follow_up TEXT, cause_of_death TEXT
  );
  CREATE UNIQUE INDEX one_patient_per_bed ON admissions(bed_id) WHERE status='admitted';
  CREATE UNIQUE INDEX one_active_admission ON admissions(patient_id) WHERE status='admitted';
  CREATE INDEX adm_patient ON admissions(patient_id);
  CREATE TABLE bed_moves(id INTEGER PRIMARY KEY, admission_id INTEGER NOT NULL REFERENCES admissions(id), from_bed_id INTEGER REFERENCES beds(id), to_bed_id INTEGER NOT NULL REFERENCES beds(id), reason TEXT, by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE ward_notes(id INTEGER PRIMARY KEY, admission_id INTEGER NOT NULL REFERENCES admissions(id), kind TEXT NOT NULL CHECK(kind IN ('round','nursing','event','correction')), text TEXT NOT NULL, by_user INTEGER REFERENCES users(id), at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX notes_adm ON ward_notes(admission_id);
  CREATE TABLE inpatient_obs(id INTEGER PRIMARY KEY, admission_id INTEGER NOT NULL REFERENCES admissions(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now')), temp REAL, sys REAL, dia REAL, pulse REAL, rr REAL, spo2 REAL, fluid_in_ml INTEGER, urine_ml INTEGER, notes TEXT, by_user INTEGER REFERENCES users(id));
  CREATE INDEX obs_adm ON inpatient_obs(admission_id);
  CREATE TABLE procedure_types(code TEXT PRIMARY KEY, name TEXT NOT NULL, surgical INTEGER NOT NULL DEFAULT 0, needs_consent INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE procedures(
    id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), encounter_id INTEGER REFERENCES encounters(id), admission_id INTEGER REFERENCES admissions(id), type_code TEXT NOT NULL REFERENCES procedure_types(code),
    performed_on TEXT NOT NULL, performed_time TEXT, performed_by INTEGER REFERENCES users(id), assistant TEXT, indication TEXT NOT NULL, anaesthesia TEXT NOT NULL DEFAULT 'none' CHECK(anaesthesia IN ('none','local','spinal','general','sedation')),
    consent_obtained INTEGER NOT NULL DEFAULT 0, consent_note TEXT, checklist_signin INTEGER NOT NULL DEFAULT 0, checklist_timeout INTEGER NOT NULL DEFAULT 0, checklist_signout INTEGER NOT NULL DEFAULT 0,
    findings TEXT, complications TEXT, outcome TEXT NOT NULL DEFAULT 'uncomplicated' CHECK(outcome IN ('uncomplicated','complication','referred')), voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX proc_patient ON procedures(patient_id);
  CREATE INDEX proc_date ON procedures(performed_on);
  CREATE TABLE blood_units(
    id INTEGER PRIMARY KEY, unit_no TEXT NOT NULL UNIQUE, abo TEXT NOT NULL CHECK(abo IN ('A','B','AB','O')), rh TEXT NOT NULL CHECK(rh IN ('pos','neg')),
    component TEXT NOT NULL CHECK(component IN ('whole_blood','red_cells','plasma','platelets')), volume_ml INTEGER NOT NULL, collected_on TEXT NOT NULL, expires_on TEXT NOT NULL, donor_ref TEXT,
    hiv TEXT NOT NULL DEFAULT 'pending' CHECK(hiv IN ('negative','positive','pending')), hbv TEXT NOT NULL DEFAULT 'pending' CHECK(hbv IN ('negative','positive','pending')),
    hcv TEXT NOT NULL DEFAULT 'pending' CHECK(hcv IN ('negative','positive','pending')), syphilis TEXT NOT NULL DEFAULT 'pending' CHECK(syphilis IN ('negative','positive','pending')),
    malaria TEXT NOT NULL DEFAULT 'pending' CHECK(malaria IN ('negative','positive','pending')),
    status TEXT NOT NULL DEFAULT 'quarantine' CHECK(status IN ('quarantine','available','issued','transfused','discarded')), discard_reason TEXT, discard_code TEXT,
    registered_by INTEGER REFERENCES users(id), registered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE blood_issues(
    id INTEGER PRIMARY KEY, unit_id INTEGER NOT NULL REFERENCES blood_units(id), patient_id INTEGER NOT NULL REFERENCES patients(id), admission_id INTEGER REFERENCES admissions(id), issued_by INTEGER REFERENCES users(id),
    issued_at TEXT NOT NULL DEFAULT (datetime('now')), indication TEXT NOT NULL, recipient_group TEXT, crossmatch TEXT NOT NULL CHECK(crossmatch IN ('compatible','not_required','emergency_uncrossmatched')), emergency_reason TEXT,
    status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','transfused','returned')), return_reason TEXT
  );
  CREATE INDEX issues_patient ON blood_issues(patient_id);
  CREATE TABLE transfusions(
    id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL UNIQUE REFERENCES blood_issues(id), started_at TEXT NOT NULL, ended_at TEXT, volume_given_ml INTEGER, pre_temp REAL, pre_pulse REAL, pre_sys REAL, pre_dia REAL,
    post_temp REAL, post_pulse REAL, post_sys REAL, post_dia REAL, reaction TEXT NOT NULL CHECK(reaction IN ('none','mild','severe')), reaction_note TEXT, by_user INTEGER REFERENCES users(id), recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  if (db.prepare('SELECT COUNT(*) c FROM referral_destinations').get().c === 0) db.prepare("INSERT INTO referral_destinations(name,type) VALUES('Mae Sot Hospital','hospital')").run(); // name only: the clinic adds contacts and other services
  const { WARDS, PROCEDURES } = require('./inpatient_seed');
  if (db.prepare('SELECT COUNT(*) c FROM wards').get().c === 0) {
    const w = db.prepare('INSERT INTO wards(name,kind) VALUES(?,?)'), b = db.prepare('INSERT INTO beds(ward_id,label) VALUES(?,?)');
    tx(db, () => { for (const [name, kind, beds] of WARDS) { const id = Number(w.run(name, kind).lastInsertRowid); for (const l of beds) b.run(id, l); } });
  }
  if (db.prepare('SELECT COUNT(*) c FROM procedure_types').get().c === 0) { const ins = db.prepare('INSERT INTO procedure_types(code,name,surgical,needs_consent) VALUES(?,?,?,?)'); tx(db, () => { for (const x of PROCEDURES) ins.run(...x); }); }
  const { VACCINES, DOSES } = require('./immunization_seed');
  if (db.prepare('SELECT COUNT(*) c FROM vaccines').get().c === 0) {
    const v = db.prepare('INSERT INTO vaccines(code,name) VALUES(?,?)'), d = db.prepare('INSERT INTO vaccine_doses(vaccine_code,dose_no,due_days,min_age_days,min_interval_days,max_age_days,late_days) VALUES(?,?,?,?,?,?,?)');
    tx(db, () => { for (const x of VACCINES) v.run(...x); for (const x of DOSES) d.run(...x); });
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
