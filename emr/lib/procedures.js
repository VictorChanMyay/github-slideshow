'use strict';
const { HttpError, encounterRow } = require('./encounters');
const R = require('./inpatient_rules');
const { validDate, diffDays, today: todayStr } = require('./maternal');

const text = (v, max = 1000) => (v == null ? '' : String(v).trim().slice(0, max));
const ANAESTHESIA = ['none', 'local', 'spinal', 'general', 'sedation'], OUTCOMES = ['uncomplicated', 'complication', 'referred'];
const types = (db, all) => db.prepare(`SELECT code,name,surgical,needs_consent,active FROM procedure_types ${all ? '' : 'WHERE active=1'} ORDER BY name`).all().map((t) => ({ ...t, surgical: !!t.surgical, needs_consent: !!t.needs_consent }));
const typeRow = (db, code) => { const t = db.prepare('SELECT * FROM procedure_types WHERE code=? AND active=1').get(text(code, 30)); if (!t) throw new HttpError(400, 'Unknown procedure', { field: 'type_code' }); return t; };
const patientRow = (db, id) => { const p = db.prepare('SELECT id,dob,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };

function log(db, user, patientId, input) {
  const p = patientRow(db, patientId); const type = typeRow(db, input.type_code);
  const on = input.performed_on ? text(input.performed_on, 10) : todayStr();
  if (!validDate(on) || diffDays(on, todayStr()) > 0) throw new HttpError(400, 'Date must be valid and not in the future', { field: 'performed_on' }); if (diffDays(on, p.dob) < 0) throw new HttpError(400, 'Date is before the date of birth', { field: 'performed_on' });
  const time = input.performed_time ? text(input.performed_time, 5) : null; if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Time must be HH:MM', { field: 'performed_time' });
  const indication = text(input.indication, 300); if (indication.length < 3) throw new HttpError(400, 'The reason for the procedure is required', { field: 'indication' });
  const anaesthesia = ANAESTHESIA.includes(input.anaesthesia) ? input.anaesthesia : 'none'; const outcome = OUTCOMES.includes(input.outcome) ? input.outcome : 'uncomplicated';
  const complications = text(input.complications, 500); if (outcome === 'complication' && complications.length < 3) throw new HttpError(400, 'Describe the complication', { field: 'complications' });
  const problems = R.procedureProblems({ surgical: type.surgical, needs_consent: type.needs_consent }, { consent_obtained: !!input.consent_obtained, consent_note: input.consent_note, checklist_signin: !!input.checklist_signin, checklist_timeout: !!input.checklist_timeout, checklist_signout: !!input.checklist_signout });
  if (problems.length) throw new HttpError(400, 'The procedure record is incomplete', { problems });
  let enc = null; if (input.encounter_id) { const e = encounterRow(db, Number(input.encounter_id)); if (e.patient_id !== patientId) throw new HttpError(400, 'That visit belongs to a different patient'); enc = e.id; }
  const adm = db.prepare("SELECT id FROM admissions WHERE patient_id=? AND status='admitted'").get(patientId); // a procedure during a stay is linked to it
  const id = Number(db.prepare(`INSERT INTO procedures(patient_id,encounter_id,admission_id,type_code,performed_on,performed_time,performed_by,assistant,indication,anaesthesia,consent_obtained,consent_note,checklist_signin,checklist_timeout,checklist_signout,findings,complications,outcome)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(patientId, enc, adm ? adm.id : null, type.code, on, time, user.id, text(input.assistant, 100) || null, indication, anaesthesia, input.consent_obtained ? 1 : 0, text(input.consent_note, 300) || null, input.checklist_signin ? 1 : 0, input.checklist_timeout ? 1 : 0, input.checklist_signout ? 1 : 0, text(input.findings) || null, complications || null, outcome).lastInsertRowid);
  return { id, admission_id: adm ? adm.id : null };
}
function voidProcedure(db, id, reason) {
  const r = db.prepare('SELECT * FROM procedures WHERE id=? AND voided=0').get(id); if (!r) throw new HttpError(404, 'Procedure not found');
  const why = text(reason, 200); if (why.length < 3) throw new HttpError(400, 'A reason is required', { field: 'reason' });
  db.prepare('UPDATE procedures SET voided=1, void_reason=? WHERE id=?').run(why, id); return r;
}
const view = (db, r) => { const nm = db.prepare('SELECT full_name FROM users WHERE id=?').get(r.performed_by); const t = db.prepare('SELECT name,surgical FROM procedure_types WHERE code=?').get(r.type_code);
  return { id: r.id, patient_id: r.patient_id, admission_id: r.admission_id, type_code: r.type_code, name: t.name, surgical: !!t.surgical, performed_on: r.performed_on, performed_time: r.performed_time, performed_by_name: nm ? nm.full_name : null, assistant: r.assistant, indication: r.indication,
    anaesthesia: r.anaesthesia, consent_obtained: !!r.consent_obtained, consent_note: r.consent_note, checklist: [!!r.checklist_signin, !!r.checklist_timeout, !!r.checklist_signout], findings: r.findings, complications: r.complications, outcome: r.outcome }; };
const forPatient = (db, patientId) => db.prepare('SELECT * FROM procedures WHERE patient_id=? AND voided=0 ORDER BY performed_on DESC, id DESC').all(patientId).map((r) => view(db, r));
function register(db, from, to) {
  if (!validDate(from) || !validDate(to) || diffDays(to, from) < 0 || diffDays(to, from) > 366) throw new HttpError(400, 'Choose a date range of up to a year');
  return db.prepare('SELECT * FROM procedures WHERE voided=0 AND performed_on>=? AND performed_on<=? ORDER BY performed_on DESC, id DESC LIMIT 300').all(from, to).map((r) => { const p = db.prepare('SELECT id,mrn,name_en,restricted FROM patients WHERE id=?').get(r.patient_id); const v = view(db, r);
    return { id: v.id, name: v.name, surgical: v.surgical, performed_on: v.performed_on, outcome: v.outcome, performed_by_name: v.performed_by_name, patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, restricted: !!p.restricted } }; });
}
module.exports = { types, typeRow, log, voidProcedure, forPatient, register, ANAESTHESIA, OUTCOMES };
