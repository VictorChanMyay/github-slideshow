'use strict';
const { tx } = require('./db');
const { can } = require('./permissions');
const clinical = require('./clinical');

const GRANT_MINUTES = 60;
const TYPES = ['outpatient', 'antenatal', 'follow_up', 'emergency'];
const text = (v, max = 4000) => (v == null ? '' : String(v).trim().slice(0, max));

class HttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }

const todayStr = () => new Date().toISOString().slice(0, 10);
const patientRow = (db, id) => db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=? AND voided=0').get(id);

/* ---- restricted-record access grants ---- */
function createGrant(db, user, patientId, reason) {
  db.prepare('INSERT INTO access_grants(user_id,patient_id,reason,expires_at) VALUES(?,?,?,?)').run(user.id, patientId, reason, Date.now() + GRANT_MINUTES * 60000);
}
function hasGrant(db, user, patientId) {
  return !!db.prepare('SELECT 1 FROM access_grants WHERE user_id=? AND patient_id=? AND expires_at>?').get(user.id, patientId, Date.now());
}
// Throws unless the user may see clinical data of this patient right now.
function gate(db, user, patient) {
  if (!patient.restricted) return;
  if (!can(user.role, 'patient.restricted')) throw new HttpError(403, 'Restricted record');
  if (!hasGrant(db, user, patient.id)) throw new HttpError(428, 'Reason required for restricted record', { restricted: true });
}
const needPatient = (db, id) => { const p = patientRow(db, id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
function encounterRow(db, id) {
  const e = db.prepare('SELECT * FROM encounters WHERE id=?').get(id);
  if (!e) throw new HttpError(404, 'Visit not found');
  return e;
}
const editable = (e) => { if (e.status === 'signed') throw new HttpError(409, 'Visit is signed and locked. Add an addendum instead.'); if (e.status === 'cancelled') throw new HttpError(409, 'Visit was cancelled'); };

/* ---- check-in and queue ---- */
function checkin(db, user, patientId, input) {
  const p = needPatient(db, patientId); gate(db, user, p);
  const type = TYPES.includes(input.type) ? input.type : 'outpatient';
  const priority = input.priority === 'urgent' ? 'urgent' : 'normal';
  const date = todayStr();
  return tx(db, () => {
    const open = db.prepare("SELECT id FROM encounters WHERE patient_id=? AND visit_date=? AND status NOT IN ('signed','cancelled')").get(patientId, date);
    if (open) throw new HttpError(409, 'Patient is already checked in today', { encounter_id: open.id });
    const q = db.prepare('SELECT COALESCE(MAX(queue_no),0)+1 n FROM encounters WHERE visit_date=?').get(date).n;
    const r = db.prepare('INSERT INTO encounters(patient_id,visit_date,queue_no,type,priority,chief_complaint,checkin_by) VALUES(?,?,?,?,?,?,?)')
      .run(patientId, date, q, type, priority, text(input.chief_complaint, 300), user.id);
    db.prepare("UPDATE appointments SET status='attended', encounter_id=? WHERE patient_id=? AND appt_date=? AND status='scheduled'").run(Number(r.lastInsertRowid), patientId, date); // arriving on the day counts as attending
    return { id: Number(r.lastInsertRowid), queue_no: q };
  });
}

function queue(db, date) {
  const rows = db.prepare(`SELECT e.id,e.queue_no,e.type,e.priority,e.status,e.chief_complaint,e.created_at,
      p.id pid,p.mrn,p.name_en,p.sex,p.dob,p.restricted, v.temp,v.sys,v.dia,v.pulse,v.rr,v.spo2,v.weight,v.height,v.muac
    FROM encounters e JOIN patients p ON p.id=e.patient_id LEFT JOIN vitals v ON v.encounter_id=e.id
    WHERE e.visit_date=? AND e.status!='cancelled'`).all(date || todayStr());
  const out = rows.map((r) => {
    const flags = r.temp == null && r.sys == null && r.pulse == null && r.rr == null && r.spo2 == null ? [] :
      clinical.flagVitals(r, clinical.ageInMonths(r.dob));
    const level = flags.some((f) => f.level === 'critical') ? 'critical' : flags.length ? 'warn' : null;
    return { id: r.id, queue_no: r.queue_no, type: r.type, priority: r.priority, status: r.status, chief_complaint: r.restricted ? null : r.chief_complaint,
      patient: { id: r.pid, mrn: r.mrn, name_en: r.restricted ? null : r.name_en, sex: r.sex, dob: r.dob, restricted: !!r.restricted }, alert: level };
  });
  const done = (s) => (s === 'signed' ? 1 : 0);
  return out.sort((a, b) => done(a.status) - done(b.status) || (b.priority === 'urgent') - (a.priority === 'urgent') || a.queue_no - b.queue_no);
}

/* ---- encounter detail ---- */
function getEncounter(db, id) {
  const e = encounterRow(db, id);
  const p = patientRow(db, e.patient_id);
  const v = db.prepare('SELECT * FROM vitals WHERE encounter_id=?').get(id) || null;
  const age = clinical.ageInMonths(p.dob);
  const vit = v ? Object.fromEntries(clinical.FIELDS.map((f) => [f, v[f]])) : null;
  const names = Object.fromEntries(db.prepare('SELECT id,username,full_name FROM users').all().map((u) => [u.id, u.full_name]));
  return {
    encounter: { ...e, checkin_name: names[e.checkin_by] || null, triage_name: names[e.triage_by] || null, consult_name: names[e.consult_by] || null, signed_name: names[e.signed_by] || null },
    patient: { id: p.id, mrn: p.mrn, name_en: p.name_en, sex: p.sex, dob: p.dob, age_months: age, restricted: !!p.restricted },
    vitals: vit ? { ...vit, bmi: clinical.bmi(vit), recorded_at: v.recorded_at, flags: clinical.flagVitals(vit, age) } : null,
    notes: db.prepare('SELECT subjective,objective,assessment,plan,updated_at FROM notes WHERE encounter_id=?').get(id) || { subjective: '', objective: '', assessment: '', plan: '' },
    diagnoses: db.prepare('SELECT d.id,d.code,i.name,d.kind,d.certainty FROM diagnoses d JOIN icd10 i ON i.code=d.code WHERE d.encounter_id=? ORDER BY d.kind DESC,d.id').all(id),
    addenda: db.prepare('SELECT a.id,a.text,a.at,u.full_name by_name FROM addenda a LEFT JOIN users u ON u.id=a.by_user WHERE a.encounter_id=? ORDER BY a.id').all(id),
    allergies: db.prepare("SELECT id,allergen,reaction,severity FROM allergies WHERE patient_id=? AND active=1 ORDER BY id").all(p.id),
  };
}

function saveVitals(db, user, id, input) {
  const e = encounterRow(db, id); editable(e);
  const { values, errors } = clinical.parseVitals(input || {});
  if (Object.keys(errors).length) throw new HttpError(400, 'Invalid vital signs', { errors });
  if (clinical.FIELDS.every((f) => values[f] == null)) throw new HttpError(400, 'Enter at least one measurement');
  tx(db, () => {
    db.prepare(`INSERT INTO vitals(encounter_id,temp,sys,dia,pulse,rr,spo2,weight,height,muac,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(encounter_id) DO UPDATE SET temp=excluded.temp,sys=excluded.sys,dia=excluded.dia,pulse=excluded.pulse,rr=excluded.rr,spo2=excluded.spo2,
        weight=excluded.weight,height=excluded.height,muac=excluded.muac,recorded_by=excluded.recorded_by,recorded_at=datetime('now')`)
      .run(id, values.temp, values.sys, values.dia, values.pulse, values.rr, values.spo2, values.weight, values.height, values.muac, user.id);
    db.prepare("UPDATE encounters SET triage_by=?, status=CASE WHEN status='waiting' THEN 'triaged' ELSE status END WHERE id=?").run(user.id, id);
  });
  return e;
}

function saveNotes(db, user, id, input) {
  const e = encounterRow(db, id); editable(e);
  tx(db, () => {
    db.prepare(`INSERT INTO notes(encounter_id,subjective,objective,assessment,plan,updated_by) VALUES(?,?,?,?,?,?)
      ON CONFLICT(encounter_id) DO UPDATE SET subjective=excluded.subjective,objective=excluded.objective,assessment=excluded.assessment,plan=excluded.plan,updated_by=excluded.updated_by,updated_at=datetime('now')`)
      .run(id, text(input.subjective), text(input.objective), text(input.assessment), text(input.plan), user.id);
    if (input.chief_complaint !== undefined) db.prepare('UPDATE encounters SET chief_complaint=? WHERE id=?').run(text(input.chief_complaint, 300), id);
    db.prepare("UPDATE encounters SET consult_by=?, status=CASE WHEN status IN ('waiting','triaged') THEN 'in_consult' ELSE status END WHERE id=?").run(user.id, id);
  });
  return e;
}

function addDiagnosis(db, user, id, input) {
  const e = encounterRow(db, id); editable(e);
  const code = text(input.code, 8).toUpperCase();
  if (!db.prepare('SELECT 1 FROM icd10 WHERE code=?').get(code)) throw new HttpError(400, 'Unknown diagnosis code');
  const kind = input.kind === 'primary' ? 'primary' : 'secondary';
  const certainty = input.certainty === 'suspected' ? 'suspected' : 'confirmed';
  tx(db, () => {
    if (kind === 'primary') db.prepare("UPDATE diagnoses SET kind='secondary' WHERE encounter_id=? AND kind='primary'").run(id);
    db.prepare(`INSERT INTO diagnoses(encounter_id,code,kind,certainty,added_by) VALUES(?,?,?,?,?)
      ON CONFLICT(encounter_id,code) DO UPDATE SET kind=excluded.kind,certainty=excluded.certainty`).run(id, code, kind, certainty, user.id);
    db.prepare("UPDATE encounters SET consult_by=?, status=CASE WHEN status IN ('waiting','triaged') THEN 'in_consult' ELSE status END WHERE id=?").run(user.id, id);
  });
  return { e, code };
}
function removeDiagnosis(db, id, did) {
  const e = encounterRow(db, id); editable(e);
  const r = db.prepare('DELETE FROM diagnoses WHERE id=? AND encounter_id=?').run(did, id);
  if (!r.changes) throw new HttpError(404, 'Diagnosis not found');
  return e;
}

function sign(db, user, id) {
  const e = encounterRow(db, id); editable(e);
  if (!db.prepare("SELECT 1 FROM diagnoses WHERE encounter_id=? AND kind='primary'").get(id)) throw new HttpError(400, 'A primary diagnosis is required before signing');
  db.prepare("UPDATE encounters SET status='signed', signed_by=?, signed_at=datetime('now') WHERE id=?").run(user.id, id);
  return e;
}
function addAddendum(db, user, id, input) {
  const e = encounterRow(db, id);
  if (e.status !== 'signed') throw new HttpError(409, 'Addenda can only be added to signed visits');
  const t = text(input.text); if (!t) throw new HttpError(400, 'Addendum text is required');
  db.prepare('INSERT INTO addenda(encounter_id,text,by_user) VALUES(?,?,?)').run(id, t, user.id);
  return e;
}
function cancel(db, user, id, input) {
  const e = encounterRow(db, id); editable(e);
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  db.prepare("UPDATE encounters SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, id);
  return e;
}

/* ---- allergies and problems (patient level) ---- */
function addAllergy(db, user, patientId, input) {
  const allergen = text(input.allergen, 100); if (!allergen) throw new HttpError(400, 'Allergen is required');
  const severity = ['mild', 'moderate', 'severe'].includes(input.severity) ? input.severity : 'unknown';
  const dup = db.prepare('SELECT 1 FROM allergies WHERE patient_id=? AND active=1 AND allergen=? COLLATE NOCASE').get(patientId, allergen);
  if (dup) throw new HttpError(409, 'This allergy is already recorded');
  const r = db.prepare('INSERT INTO allergies(patient_id,allergen,reaction,severity,recorded_by) VALUES(?,?,?,?,?)').run(patientId, allergen, text(input.reaction, 200), severity, user.id);
  return Number(r.lastInsertRowid);
}
function deactivateAllergy(db, patientId, aid, input) {
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  const r = db.prepare('UPDATE allergies SET active=0, deactivated_reason=? WHERE id=? AND patient_id=? AND active=1').run(reason, aid, patientId);
  if (!r.changes) throw new HttpError(404, 'Allergy not found');
}
function addProblem(db, user, patientId, input) {
  const label = text(input.text, 200); if (!label) throw new HttpError(400, 'Problem description is required');
  let code = input.icd_code ? text(input.icd_code, 8).toUpperCase() : null;
  if (code && !db.prepare('SELECT 1 FROM icd10 WHERE code=?').get(code)) throw new HttpError(400, 'Unknown diagnosis code');
  const r = db.prepare('INSERT INTO problems(patient_id,text,icd_code,onset,recorded_by) VALUES(?,?,?,?,?)').run(patientId, label, code, text(input.onset, 10) || null, user.id);
  return Number(r.lastInsertRowid);
}
function resolveProblem(db, patientId, pid) {
  const r = db.prepare("UPDATE problems SET status='resolved', resolved_at=datetime('now') WHERE id=? AND patient_id=? AND status='active'").run(pid, patientId);
  if (!r.changes) throw new HttpError(404, 'Problem not found');
}

/* ---- patient clinical summary ---- */
function patientClinical(db, patientId) {
  return {
    allergies: db.prepare('SELECT id,allergen,reaction,severity FROM allergies WHERE patient_id=? AND active=1 ORDER BY id').all(patientId),
    problems: db.prepare('SELECT id,text,icd_code,status,onset FROM problems WHERE patient_id=? ORDER BY status,id').all(patientId),
    encounters: db.prepare(`SELECT e.id,e.visit_date,e.type,e.status,e.chief_complaint,
        (SELECT group_concat(d.code || ' ' || i.name, '; ') FROM diagnoses d JOIN icd10 i ON i.code=d.code WHERE d.encounter_id=e.id) dx
      FROM encounters e WHERE e.patient_id=? AND e.status!='cancelled' ORDER BY e.id DESC LIMIT 50`).all(patientId),
  };
}

function searchIcd(db, q) {
  q = text(q, 60);
  const l = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return db.prepare("SELECT code,name FROM icd10 WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY code LIMIT 25").all(l, l);
}

module.exports = { HttpError, createGrant, hasGrant, gate, needPatient, encounterRow, checkin, queue, getEncounter, saveVitals, saveNotes, addDiagnosis, removeDiagnosis,
  sign, addAddendum, cancel, addAllergy, deactivateAllergy, addProblem, resolveProblem, patientClinical, searchIcd };
