'use strict';
const { HttpError, encounterRow } = require('./encounters');
const pharm = require('./pharmacy');
const { today: todayStr } = require('./maternal');

// Take-home summary of a signed visit. Sensitive lab results (HIV, hepatitis B, syphilis) are never printed here.
function visitSummary(db, id) {
  const e = encounterRow(db, id); if (e.status !== 'signed') throw new HttpError(409, 'Sign the visit before printing the summary');
  const p = db.prepare('SELECT id,mrn,name_en,sex,dob FROM patients WHERE id=?').get(e.patient_id);
  const signer = e.signed_by ? db.prepare('SELECT full_name FROM users WHERE id=?').get(e.signed_by) : null;
  return {
    patient: p, visit: { id: e.id, date: e.visit_date, type: e.type, chief_complaint: e.chief_complaint, signed_by: signer ? signer.full_name : null, signed_at: e.signed_at },
    diagnoses: db.prepare('SELECT d.code,i.name,d.kind,d.certainty FROM diagnoses d JOIN icd10 i ON i.code=d.code WHERE d.encounter_id=? ORDER BY d.kind DESC,d.id').all(id),
    medicines: pharm.forEncounter(db, id).filter((x) => x.status !== 'cancelled'),
    results: db.prepare("SELECT t.name,t.unit,o.result_value,o.result_flag FROM lab_orders o JOIN lab_tests t ON t.id=o.test_id WHERE o.encounter_id=? AND o.status='resulted' AND t.sensitive=0 ORDER BY o.id").all(id),
    plan: (db.prepare('SELECT plan FROM notes WHERE encounter_id=?').get(id) || {}).plan || '',
    allergies: db.prepare('SELECT allergen,reaction FROM allergies WHERE patient_id=? AND active=1').all(p.id),
    next_appointment: db.prepare("SELECT appt_date,appt_time,purpose FROM appointments WHERE patient_id=? AND status='scheduled' AND appt_date>=? ORDER BY appt_date LIMIT 1").get(p.id, todayStr()) || null,
  };
}
module.exports = { visitSummary };
