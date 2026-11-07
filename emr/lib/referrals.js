'use strict';
const { tx } = require('./db');
const { HttpError, encounterRow } = require('./encounters');
const R = require('./continuity_rules');
const { validDate, diffDays, today: todayStr } = require('./maternal');
const pharm = require('./pharmacy');

const text = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const URGENCY = ['routine', 'urgent', 'emergency'];
const patientRow = (db, id) => { const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
const refRow = (db, id) => { const r = db.prepare('SELECT * FROM referrals WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Referral not found'); return r; };

/* ---- destinations ---- */
const destinations = (db, all) => db.prepare(`SELECT id,name,type,contact,active FROM referral_destinations ${all ? '' : 'WHERE active=1'} ORDER BY name`).all();
function addDestination(db, input) {
  const name = text(input.name, 100); if (!name) throw new HttpError(400, 'Name is required', { field: 'name' });
  if (db.prepare('SELECT 1 FROM referral_destinations WHERE name=? COLLATE NOCASE').get(name)) throw new HttpError(409, 'This destination is already in the list');
  const type = ['hospital', 'clinic', 'ngo', 'other'].includes(input.type) ? input.type : 'other';
  return Number(db.prepare('INSERT INTO referral_destinations(name,type,contact) VALUES(?,?,?)').run(name, type, text(input.contact, 200) || null).lastInsertRowid);
}

/* ---- letter text composed from a visit. Sensitive lab results and all HIV programme data are never included. ---- */
function composeSummary(db, encounterId) {
  const e = encounterRow(db, encounterId); const p = patientRow(db, e.patient_id); const lines = [];
  const dx = db.prepare('SELECT d.code,i.name,d.kind,d.certainty FROM diagnoses d JOIN icd10 i ON i.code=d.code WHERE d.encounter_id=? ORDER BY d.kind DESC,d.id').all(encounterId);
  if (dx.length) lines.push('Diagnosis: ' + dx.map((d) => `${d.code} ${d.name}${d.kind === 'primary' ? ' (main)' : ''}${d.certainty === 'suspected' ? ' (suspected)' : ''}`).join('; '));
  const v = db.prepare('SELECT * FROM vitals WHERE encounter_id=?').get(encounterId);
  if (v) { const bits = [v.temp != null && `temp ${v.temp} °C`, v.sys != null && `BP ${v.sys}/${v.dia}`, v.pulse != null && `pulse ${v.pulse}`, v.rr != null && `resp ${v.rr}`, v.spo2 != null && `SpO2 ${v.spo2}%`, v.weight != null && `weight ${v.weight} kg`].filter(Boolean); if (bits.length) lines.push('Vital signs: ' + bits.join(', ')); }
  const n = db.prepare('SELECT subjective,objective,assessment,plan FROM notes WHERE encounter_id=?').get(encounterId);
  if (n) for (const [k, label] of [['subjective', 'History'], ['objective', 'Examination'], ['assessment', 'Assessment'], ['plan', 'Management so far']]) if (n[k]) lines.push(`${label}: ${n[k]}`);
  const rx = db.prepare("SELECT p.id,p.dose,p.frequency,p.duration_days,p.status,d.name,d.strength FROM prescriptions p JOIN drugs d ON d.id=p.drug_id WHERE p.encounter_id=? AND p.status!='cancelled'").all(encounterId);
  if (rx.length) lines.push('Medicines this visit: ' + rx.map((x) => `${x.name} ${x.strength} ${x.dose}, ${x.frequency}, ${x.duration_days} days${x.status === 'dispensed' ? ' (given)' : ''}`).join('; '));
  const labs = db.prepare("SELECT t.name,t.unit,o.result_value,o.result_flag FROM lab_orders o JOIN lab_tests t ON t.id=o.test_id WHERE o.encounter_id=? AND o.status='resulted' AND t.sensitive=0").all(encounterId);
  if (labs.length) lines.push('Results: ' + labs.map((l) => `${l.name} ${l.result_value}${l.unit ? ' ' + l.unit : ''}${l.result_flag && l.result_flag !== 'normal' ? ` (${l.result_flag})` : ''}`).join('; '));
  const al = db.prepare('SELECT allergen,reaction FROM allergies WHERE patient_id=? AND active=1').all(p.id);
  lines.push('Allergies: ' + (al.length ? al.map((a) => a.allergen + (a.reaction ? ` (${a.reaction})` : '')).join(', ') : 'none known'));
  return lines.join('\n');
}

/* ---- referral lifecycle ---- */
function create(db, user, patientId, input) {
  const p = patientRow(db, patientId);
  let enc = null;
  if (input.encounter_id) { enc = encounterRow(db, Number(input.encounter_id)); if (enc.patient_id !== patientId) throw new HttpError(400, 'That visit belongs to a different patient'); if (enc.status === 'cancelled') throw new HttpError(409, 'That visit was cancelled'); }
  let destId = null, destName = text(input.destination_name, 100);
  if (input.destination_id) { const d = db.prepare('SELECT * FROM referral_destinations WHERE id=? AND active=1').get(Number(input.destination_id)); if (!d) throw new HttpError(400, 'Unknown destination', { field: 'destination_id' }); destId = d.id; destName = d.name; }
  if (!destName) throw new HttpError(400, 'Say where the patient is being referred', { field: 'destination_name' });
  const reason = text(input.reason, 300); if (reason.length < 3) throw new HttpError(400, 'A reason for the referral is required', { field: 'reason' });
  const summary = text(input.clinical_summary, 4000); if (summary.length < 10) throw new HttpError(400, 'Add a clinical summary for the receiving service', { field: 'clinical_summary' });
  const urgency = URGENCY.includes(input.urgency) ? input.urgency : null; if (!urgency) throw new HttpError(400, 'Choose how urgent the referral is', { field: 'urgency' });
  const consent = !!input.consent_to_share, note = text(input.consent_note, 300);
  if (!consent && !(urgency === 'emergency' && note.length >= 5)) throw new HttpError(400, 'Record the patient\'s consent to share information. Without it, only an emergency referral is allowed, with a written reason.', { field: 'consent_to_share' });
  return tx(db, () => {
    const year = todayStr().slice(0, 4); const seq = db.prepare('SELECT COUNT(*) c FROM referrals WHERE ref_no LIKE ?').get(`REF-${year}-%`).c + 1; const refNo = `REF-${year}-${String(seq).padStart(4, '0')}`;
    const id = Number(db.prepare(`INSERT INTO referrals(ref_no,patient_id,encounter_id,destination_id,destination_name,service,reason,urgency,clinical_summary,needs,consent_to_share,consent_note,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(refNo, patientId, enc ? enc.id : null, destId, destName, text(input.service, 100) || null, reason, urgency, summary, text(input.needs, 300) || null, consent ? 1 : 0, consent ? null : note, user.id).lastInsertRowid);
    void p; return { id, ref_no: refNo };
  });
}
function markAttended(db, id, input) {
  const r = refRow(db, id); if (r.status !== 'open') throw new HttpError(409, 'Only an open referral can be marked as attended');
  const on = input.attended_on ? text(input.attended_on, 10) : todayStr();
  if (!validDate(on) || diffDays(on, todayStr()) > 0) throw new HttpError(400, 'Date must be valid and not in the future', { field: 'attended_on' });
  if (diffDays(on, String(r.created_at).slice(0, 10)) < 0) throw new HttpError(400, 'The patient cannot have attended before the referral was written', { field: 'attended_on' });
  db.prepare("UPDATE referrals SET status='attended', attended_on=? WHERE id=?").run(on, id); return r;
}
function recordBack(db, user, id, input) {
  const r = refRow(db, id); if (r.status !== 'open' && r.status !== 'attended') throw new HttpError(409, 'This referral is already closed');
  const outcome = text(input.outcome, 1000); if (outcome.length < 3) throw new HttpError(400, 'Record the outcome or diagnosis from the receiving service', { field: 'outcome' });
  let on = r.attended_on;
  if (input.attended_on || !on) { on = input.attended_on ? text(input.attended_on, 10) : todayStr(); if (!validDate(on) || diffDays(on, todayStr()) > 0) throw new HttpError(400, 'Date must be valid and not in the future', { field: 'attended_on' }); if (diffDays(on, String(r.created_at).slice(0, 10)) < 0) throw new HttpError(400, 'The patient cannot have attended before the referral was written', { field: 'attended_on' }); }
  db.prepare("UPDATE referrals SET status='completed', attended_on=?, back_outcome=?, back_treatment=?, back_followup=?, back_by=?, back_at=datetime('now') WHERE id=?").run(on, outcome, text(input.treatment, 1000) || null, text(input.followup, 1000) || null, user.id, id);
  return r;
}
function cancel(db, id, input) {
  const r = refRow(db, id); if (r.status !== 'open') throw new HttpError(409, 'Only an open referral can be cancelled');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required', { field: 'reason' });
  db.prepare("UPDATE referrals SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, id); return r;
}

/* ---- views ---- */
function view(db, r, today = todayStr()) {
  const names = Object.fromEntries(db.prepare('SELECT id,full_name FROM users').all().map((u) => [u.id, u.full_name]));
  return { ...r, consent_to_share: !!r.consent_to_share, created_by_name: names[r.created_by] || null, back_by_name: names[r.back_by] || null, age_days: diffDays(today, String(r.created_at).slice(0, 10)), overdue: R.referralOverdue(r, today) };
}
function detail(db, id) {
  const r = refRow(db, id); const p = patientRow(db, r.patient_id);
  const out = { referral: view(db, r), patient: { id: p.id, mrn: p.mrn, name_en: p.name_en, sex: p.sex, dob: p.dob, restricted: !!p.restricted } };
  out.allergies = db.prepare('SELECT allergen,reaction,severity FROM allergies WHERE patient_id=? AND active=1').all(p.id);
  out.medicines = r.encounter_id ? pharm.forEncounter(db, r.encounter_id).filter((x) => x.status !== 'cancelled') : [];
  return out;
}
function worklist(db, tab) {
  const rows = db.prepare(tab === 'closed' ? "SELECT * FROM referrals WHERE status IN ('completed','cancelled') ORDER BY id DESC LIMIT 100" : "SELECT * FROM referrals WHERE status IN ('open','attended')").all().map((r) => {
    const p = db.prepare('SELECT id,mrn,name_en,restricted FROM patients WHERE id=?').get(r.patient_id);
    return { ...view(db, r), clinical_summary: undefined, patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, restricted: !!p.restricted } };
  });
  const rank = { emergency: 2, urgent: 1, routine: 0 };
  return tab === 'closed' ? rows : rows.sort((a, b) => (b.overdue - a.overdue) || (rank[b.urgency] - rank[a.urgency]) || (b.age_days - a.age_days));
}
const forPatient = (db, patientId) => db.prepare('SELECT * FROM referrals WHERE patient_id=? ORDER BY id DESC').all(patientId).map((r) => ({ ...view(db, r), clinical_summary: undefined }));
module.exports = { destinations, addDestination, composeSummary, create, markAttended, recordBack, cancel, detail, worklist, forPatient, refRow, URGENCY };
