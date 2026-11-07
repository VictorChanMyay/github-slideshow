'use strict';
const { tx } = require('./db');
const { HttpError, encounterRow } = require('./encounters');
const R = require('./inpatient_rules');
const clinical = require('./clinical');
const appointments = require('./appointments');
const { validDate, today: todayStr } = require('./maternal');

const text = (v, max = 2000) => (v == null ? '' : String(v).trim().slice(0, max));
const CONDITIONS = ['stable', 'serious', 'critical'], NOTE_KINDS = ['round', 'nursing', 'event', 'correction'], DISCHARGE_TYPES = ['discharged', 'referred', 'transferred', 'absconded', 'died'];
const patientRow = (db, id) => { const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
const admRow = (db, id) => { const a = db.prepare('SELECT * FROM admissions WHERE id=?').get(id); if (!a) throw new HttpError(404, 'Admission not found'); return a; };
const activeAdm = (db, id) => { const a = admRow(db, id); if (a.status !== 'admitted') throw new HttpError(409, 'This patient has been discharged'); return a; };
const bedInfo = (db, bedId) => db.prepare('SELECT b.id,b.label,b.status,w.id ward_id,w.name ward,w.kind,w.active ward_active FROM beds b JOIN wards w ON w.id=b.ward_id WHERE b.id=?').get(bedId);
const nowMs = () => Date.now();
const lastObs = (db, id) => (db.prepare('SELECT MAX(recorded_at) m FROM inpatient_obs WHERE admission_id=?').get(id) || {}).m || null;

/* ---- wards and beds ---- */
function addWard(db, input) {
  const name = text(input.name, 80); if (!name) throw new HttpError(400, 'Name is required', { field: 'name' });
  if (db.prepare('SELECT 1 FROM wards WHERE name=? COLLATE NOCASE').get(name)) throw new HttpError(409, 'This ward already exists');
  return Number(db.prepare('INSERT INTO wards(name,kind) VALUES(?,?)').run(name, ['general', 'maternity', 'paediatric', 'isolation', 'other'].includes(input.kind) ? input.kind : 'general').lastInsertRowid);
}
function addBed(db, wardId, input) {
  if (!db.prepare('SELECT 1 FROM wards WHERE id=?').get(wardId)) throw new HttpError(404, 'Ward not found');
  const label = text(input.label, 20); if (!label) throw new HttpError(400, 'Bed label is required', { field: 'label' });
  if (db.prepare('SELECT 1 FROM beds WHERE ward_id=? AND label=? COLLATE NOCASE').get(wardId, label)) throw new HttpError(409, 'This bed already exists in the ward');
  return Number(db.prepare('INSERT INTO beds(ward_id,label) VALUES(?,?)').run(wardId, label).lastInsertRowid);
}
function setBedStatus(db, bedId, status) {
  if (!['active', 'out_of_service'].includes(status)) throw new HttpError(400, 'Not a valid status');
  if (!db.prepare('SELECT 1 FROM beds WHERE id=?').get(bedId)) throw new HttpError(404, 'Bed not found');
  if (status === 'out_of_service' && db.prepare("SELECT 1 FROM admissions WHERE bed_id=? AND status='admitted'").get(bedId)) throw new HttpError(409, 'A patient is in this bed. Move the patient first.');
  db.prepare('UPDATE beds SET status=? WHERE id=?').run(status, bedId);
}
function board(db) {
  const today = todayStr(); const now = nowMs(); let occupied = 0, usable = 0;
  const wards = db.prepare('SELECT * FROM wards WHERE active=1 ORDER BY id').all().map((w) => ({ id: w.id, name: w.name, kind: w.kind, beds: db.prepare('SELECT id,label,status FROM beds WHERE ward_id=? ORDER BY id').all(w.id).map((b) => {
    const a = db.prepare("SELECT * FROM admissions WHERE bed_id=? AND status='admitted'").get(b.id);
    if (b.status === 'active') usable += 1;
    if (!a) return { ...b, admission: null };
    occupied += 1; const p = db.prepare('SELECT id,mrn,name_en,restricted FROM patients WHERE id=?').get(a.patient_id); const lo = lastObs(db, a.id);
    return { ...b, admission: { id: a.id, adm_no: a.adm_no, patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, restricted: !!p.restricted }, admitted_at: a.admitted_at, los_days: R.lengthOfStay(a.admitted_at, null, today),
      condition: a.condition, isolation: !!a.isolation, obs_overdue: R.obsOverdue(a.admitted_at, lo, a.obs_every_hours, now), last_obs_at: lo } };
  }) }));
  return { wards, occupied, usable, free: usable - occupied };
}

/* ---- admit, move, notes, observations ---- */
function checkIsolation(isolation, wardKind, reason) {
  if (isolation && wardKind !== 'isolation' && text(reason, 300).length < 5) throw new HttpError(409, 'This patient needs isolation. Use an isolation bed, or write why that is not possible.', { isolation_ward_needed: true });
}
function admit(db, user, patientId, input) {
  const p = patientRow(db, patientId);
  const bed = bedInfo(db, Number(input.bed_id)); if (!bed || bed.status !== 'active' || !bed.ward_active) throw new HttpError(400, 'Choose a bed that is in service', { field: 'bed_id' });
  if (db.prepare("SELECT 1 FROM admissions WHERE bed_id=? AND status='admitted'").get(bed.id)) throw new HttpError(409, 'This bed is occupied');
  const already = db.prepare("SELECT id FROM admissions WHERE patient_id=? AND status='admitted'").get(patientId); if (already) throw new HttpError(409, 'This patient is already admitted', { admission_id: already.id });
  const reason = text(input.reason, 300); if (reason.length < 3) throw new HttpError(400, 'A reason for admission is required', { field: 'reason' });
  const condition = CONDITIONS.includes(input.condition) ? input.condition : 'stable'; const isolation = !!input.isolation;
  checkIsolation(isolation, bed.kind, input.isolation_override);
  const every = input.obs_every_hours == null || input.obs_every_hours === '' ? 4 : Number(input.obs_every_hours); if (!Number.isInteger(every) || every < 1 || every > 24) throw new HttpError(400, 'Observation interval must be 1 to 24 hours', { field: 'obs_every_hours' });
  let dx = input.admit_dx_code ? text(input.admit_dx_code, 8).toUpperCase() : null; if (dx && !db.prepare('SELECT 1 FROM icd10 WHERE code=?').get(dx)) throw new HttpError(400, 'Unknown diagnosis code', { field: 'admit_dx_code' });
  let enc = null; if (input.encounter_id) { const e = encounterRow(db, Number(input.encounter_id)); if (e.patient_id !== patientId) throw new HttpError(400, 'That visit belongs to a different patient'); enc = e.id; }
  try {
    return tx(db, () => {
      const year = todayStr().slice(0, 4); const seq = db.prepare('SELECT COUNT(*) c FROM admissions WHERE adm_no LIKE ?').get(`ADM-${year}-%`).c + 1; const no = `ADM-${year}-${String(seq).padStart(4, '0')}`;
      const id = Number(db.prepare('INSERT INTO admissions(adm_no,patient_id,encounter_id,ward_id,bed_id,admitted_by,reason,admit_dx_code,admit_dx_text,condition,isolation,isolation_override,obs_every_hours) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(no, patientId, enc, bed.ward_id, bed.id, user.id, reason, dx, text(input.admit_dx_text, 200) || null, condition, isolation ? 1 : 0, isolation && bed.kind !== 'isolation' ? text(input.isolation_override, 300) : null, every).lastInsertRowid);
      db.prepare('INSERT INTO bed_moves(admission_id,from_bed_id,to_bed_id,reason,by_user) VALUES(?,?,?,?,?)').run(id, null, bed.id, 'Admission', user.id);
      void p; return { id, adm_no: no };
    });
  } catch (e) { if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'The bed or the patient was just taken by another admission'); throw e; }
}
function transfer(db, user, admId, input) {
  const a = activeAdm(db, admId); const bed = bedInfo(db, Number(input.bed_id));
  if (!bed || bed.status !== 'active' || !bed.ward_active) throw new HttpError(400, 'Choose a bed that is in service', { field: 'bed_id' });
  if (bed.id === a.bed_id) throw new HttpError(400, 'The patient is already in this bed', { field: 'bed_id' });
  if (db.prepare("SELECT 1 FROM admissions WHERE bed_id=? AND status='admitted'").get(bed.id)) throw new HttpError(409, 'This bed is occupied');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required', { field: 'reason' });
  if (a.isolation) checkIsolation(true, bed.kind, input.isolation_override);
  tx(db, () => { db.prepare('UPDATE admissions SET ward_id=?, bed_id=? WHERE id=?').run(bed.ward_id, bed.id, admId); db.prepare('INSERT INTO bed_moves(admission_id,from_bed_id,to_bed_id,reason,by_user) VALUES(?,?,?,?,?)').run(admId, a.bed_id, bed.id, reason, user.id); });
  return a;
}
function addNote(db, user, admId, input) {
  const a = activeAdm(db, admId); const kind = NOTE_KINDS.includes(input.kind) ? input.kind : null; if (!kind) throw new HttpError(400, 'Choose the type of note', { field: 'kind' });
  const body = text(input.text, 2000); if (body.length < 2) throw new HttpError(400, 'Write the note', { field: 'text' });
  db.prepare('INSERT INTO ward_notes(admission_id,kind,text,by_user) VALUES(?,?,?,?)').run(admId, kind, body, user.id); return a;
}
function addObs(db, user, admId, input) {
  const a = activeAdm(db, admId); const p = patientRow(db, a.patient_id);
  const { values, errors } = clinical.parseVitals({ temp: input.temp, sys: input.sys, dia: input.dia, pulse: input.pulse, rr: input.rr, spo2: input.spo2 }); if (Object.keys(errors).length) throw new HttpError(400, 'Invalid observations', { errors });
  const iv = (v, label) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10000) throw new HttpError(400, `${label} must be a whole number from 0 to 10000`); return n; };
  const fluid = iv(input.fluid_in_ml, 'Fluid in'), urine = iv(input.urine_ml, 'Urine');
  if (['temp', 'sys', 'dia', 'pulse', 'rr', 'spo2'].every((k) => values[k] == null) && fluid == null && urine == null) throw new HttpError(400, 'Enter at least one measurement');
  let at = null; if (input.recorded_at) { at = text(input.recorded_at, 16).replace('T', ' '); if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(at) || !validDate(at.slice(0, 10))) throw new HttpError(400, 'Time must be YYYY-MM-DD HH:MM', { field: 'recorded_at' }); at += ':00'; if (at < a.admitted_at) throw new HttpError(400, 'Time is before the admission', { field: 'recorded_at' }); }
  const id = Number(db.prepare('INSERT INTO inpatient_obs(admission_id,recorded_at,temp,sys,dia,pulse,rr,spo2,fluid_in_ml,urine_ml,notes,by_user) VALUES(?,COALESCE(?,datetime(\'now\')),?,?,?,?,?,?,?,?,?,?)')
    .run(admId, at, values.temp, values.sys, values.dia, values.pulse, values.rr, values.spo2, fluid, urine, text(input.notes, 300) || null, user.id).lastInsertRowid);
  return { id, flags: clinical.flagVitals({ ...values, weight: null, height: null, muac: null }, clinical.ageInMonths(p.dob)) };
}

/* ---- discharge ---- */
function discharge(db, user, admId, input) {
  const a = activeAdm(db, admId);
  const type = DISCHARGE_TYPES.includes(input.discharge_type) ? input.discharge_type : null; if (!type) throw new HttpError(400, 'Choose how the stay ended', { field: 'discharge_type' });
  const cond = text(input.discharge_condition, 200); if (cond.length < 3) throw new HttpError(400, 'Write the condition at discharge', { field: 'discharge_condition' });
  const summary = text(input.stay_summary, 4000); if (summary.length < 10) throw new HttpError(400, 'Write a summary of the stay', { field: 'stay_summary' });
  const cause = text(input.cause_of_death, 300); if (type === 'died' && cause.length < 3) throw new HttpError(400, 'Record the cause of death', { field: 'cause_of_death' });
  let dx = input.discharge_dx_code ? text(input.discharge_dx_code, 8).toUpperCase() : null; if (dx && !db.prepare('SELECT 1 FROM icd10 WHERE code=?').get(dx)) throw new HttpError(400, 'Unknown diagnosis code', { field: 'discharge_dx_code' });
  if (db.prepare("SELECT 1 FROM blood_issues WHERE admission_id=? AND status='issued'").get(admId)) throw new HttpError(409, 'A blood unit issued to this patient has not been transfused or returned. Record it first.', { blood_pending: true });
  const fu = input.follow_up_date ? text(input.follow_up_date, 10) : null;
  tx(db, () => {
    db.prepare("UPDATE admissions SET status='discharged', discharged_at=datetime('now'), discharged_by=?, discharge_type=?, discharge_condition=?, discharge_dx_code=?, discharge_dx_text=?, stay_summary=?, discharge_medicines=?, follow_up=?, cause_of_death=? WHERE id=?")
      .run(user.id, type, cond, dx, text(input.discharge_dx_text, 200) || null, summary, text(input.discharge_medicines, 2000) || null, text(input.follow_up, 1000) || null, type === 'died' ? cause : null, admId);
    if (fu && type !== 'died') appointments.create(db, user, a.patient_id, { appt_date: fu, purpose: 'general', note: 'After discharge', reminder_ok: false });
  });
  return a;
}

/* ---- views ---- */
const names = (db) => Object.fromEntries(db.prepare('SELECT id,full_name FROM users').all().map((u) => [u.id, u.full_name]));
function detail(db, admId) {
  const a = admRow(db, admId); const p = patientRow(db, a.patient_id); const nm = names(db); const today = todayStr(); const ageM = clinical.ageInMonths(p.dob); const bed = bedInfo(db, a.bed_id);
  const obs = db.prepare('SELECT * FROM inpatient_obs WHERE admission_id=? ORDER BY recorded_at DESC, id DESC').all(admId).map((o) => ({ ...o, by_name: nm[o.by_user] || null, flags: clinical.flagVitals({ temp: o.temp, sys: o.sys, dia: o.dia, pulse: o.pulse, rr: o.rr, spo2: o.spo2, weight: null, height: null, muac: null }, ageM) }));
  const lo = lastObs(db, admId);
  return { admission: { ...a, isolation: !!a.isolation, ward: bed.ward, bed: bed.label, admitted_by_name: nm[a.admitted_by] || null, discharged_by_name: nm[a.discharged_by] || null, los_days: R.lengthOfStay(a.admitted_at, a.discharged_at, today), obs_overdue: a.status === 'admitted' && R.obsOverdue(a.admitted_at, lo, a.obs_every_hours, nowMs()) },
    patient: { id: p.id, mrn: p.mrn, name_en: p.name_en, sex: p.sex, dob: p.dob, restricted: !!p.restricted },
    notes: db.prepare('SELECT id,kind,text,by_user,at FROM ward_notes WHERE admission_id=? ORDER BY id').all(admId).map((n) => ({ ...n, by_name: nm[n.by_user] || null })), obs,
    moves: db.prepare('SELECT m.at,m.reason,fb.label from_bed,tb.label to_bed,fw.name from_ward,tw.name to_ward FROM bed_moves m LEFT JOIN beds fb ON fb.id=m.from_bed_id LEFT JOIN wards fw ON fw.id=fb.ward_id JOIN beds tb ON tb.id=m.to_bed_id JOIN wards tw ON tw.id=tb.ward_id WHERE m.admission_id=? ORDER BY m.id').all(admId),
    procedures: db.prepare("SELECT pr.id,pr.performed_on,t.name,pr.outcome FROM procedures pr JOIN procedure_types t ON t.code=pr.type_code WHERE pr.admission_id=? AND pr.voided=0 ORDER BY pr.performed_on, pr.id").all(admId),
    blood: db.prepare("SELECT i.id,i.status,i.issued_at,u.component,u.abo,u.rh,t.reaction FROM blood_issues i JOIN blood_units u ON u.id=i.unit_id LEFT JOIN transfusions t ON t.issue_id=i.id WHERE i.admission_id=? ORDER BY i.id").all(admId) };
}
// Printed summary: sensitive results (HIV, hepatitis B, syphilis) are never included
function summary(db, admId) {
  const d = detail(db, admId); const a = d.admission; if (a.status !== 'discharged') throw new HttpError(409, 'The discharge summary is available after discharge');
  const dx = (code) => (code ? db.prepare('SELECT code,name FROM icd10 WHERE code=?').get(code) : null);
  return { patient: d.patient, admission: { adm_no: a.adm_no, admitted_at: a.admitted_at, discharged_at: a.discharged_at, los_days: a.los_days, ward: a.ward, reason: a.reason, condition_on_admission: a.condition, discharge_type: a.discharge_type, discharge_condition: a.discharge_condition,
      stay_summary: a.stay_summary, discharge_medicines: a.discharge_medicines, follow_up: a.follow_up, cause_of_death: a.cause_of_death, discharged_by_name: a.discharged_by_name },
    admit_dx: dx(a.admit_dx_code) || (a.admit_dx_text ? { code: '', name: a.admit_dx_text } : null), discharge_dx: dx(a.discharge_dx_code) || (a.discharge_dx_text ? { code: '', name: a.discharge_dx_text } : null),
    allergies: db.prepare('SELECT allergen,reaction FROM allergies WHERE patient_id=? AND active=1').all(d.patient.id), procedures: d.procedures,
    results: a.encounter_id ? db.prepare("SELECT t.name,t.unit,o.result_value FROM lab_orders o JOIN lab_tests t ON t.id=o.test_id WHERE o.encounter_id=? AND o.status='resulted' AND t.sensitive=0").all(a.encounter_id) : [],
    transfusions: d.blood.filter((b) => b.status === 'transfused').map((b) => ({ component: b.component, date: String(b.issued_at).slice(0, 10), reaction: b.reaction })),
    next_appointment: db.prepare("SELECT appt_date,appt_time,purpose FROM appointments WHERE patient_id=? AND status='scheduled' AND appt_date>=? ORDER BY appt_date LIMIT 1").get(d.patient.id, todayStr()) || null };
}
const forPatient = (db, patientId) => db.prepare("SELECT a.id,a.adm_no,a.admitted_at,a.discharged_at,a.status,a.discharge_type,a.condition,w.name ward,b.label bed FROM admissions a JOIN beds b ON b.id=a.bed_id JOIN wards w ON w.id=a.ward_id WHERE a.patient_id=? ORDER BY a.id DESC").all(patientId);
module.exports = { addWard, addBed, setBedStatus, board, admit, transfer, addNote, addObs, discharge, detail, summary, forPatient, admRow, CONDITIONS, NOTE_KINDS, DISCHARGE_TYPES };
