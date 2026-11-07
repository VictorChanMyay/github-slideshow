'use strict';
const { tx } = require('./db');
const { HttpError, encounterRow } = require('./encounters');
const { can } = require('./permissions');
const { PROGRAMS, PROGRAM_KEYS } = require('./programs_spec');
const R = require('./programs_rules');
const child = require('./child');
const { addDays, diffDays, validDate, today: todayStr } = require('./maternal');

const text = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const parseJ = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
const blank = (v) => v === undefined || v === null || v === '';

// Check one set of fields against its specification. Returns only known keys with proper types; blank values are left out.
function parseFields(specs, input, { enforceRequired = false } = {}) {
  const out = {};
  for (const f of specs) {
    let v = input[f.key];
    if (blank(v)) { if (f.default !== undefined && enforceRequired) out[f.key] = f.default; if (f.required && enforceRequired) throw new HttpError(400, 'This field is required', { field: f.key }); continue; }
    const bad = (msg) => { throw new HttpError(400, msg, { field: f.key }); };
    if (f.type === 'enum') { if (!f.values.includes(v)) bad('Not a valid option'); }
    else if (f.type === 'int' || f.type === 'num') { v = Number(v); if (!Number.isFinite(v) || (f.type === 'int' && !Number.isInteger(v)) || v < f.min || v > f.max) bad(`Must be a ${f.type === 'int' ? 'whole ' : ''}number from ${f.min} to ${f.max}`); }
    else if (f.type === 'date') { v = text(v, 10); if (!validDate(v)) bad('Must be a valid date'); }
    else if (f.type === 'bool') { v = v === true || v === 'true' || v === 1; if (!v) continue; }
    else if (f.type === 'text') v = text(v, f.max);
    else if (f.type === 'list') { if (!Array.isArray(v) || v.some((x) => !f.values.includes(x))) bad('Not a valid option'); v = [...new Set(v)]; if (!v.length) continue; }
    out[f.key] = v;
  }
  return out;
}
const patientRow = (db, id) => { const p = db.prepare('SELECT id,mrn,name_en,sex,dob,phone,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
const notFuture = (d, label) => { if (d && diffDays(d, todayStr()) > 0) throw new HttpError(400, `${label} cannot be in the future`); };

function enrolmentRow(db, id) { const e = db.prepare('SELECT * FROM program_enrolments WHERE id=?').get(id); if (!e) throw new HttpError(404, 'Programme record not found'); return e; }
function visitsOf(db, id) { return db.prepare('SELECT * FROM program_visits WHERE enrolment_id=? ORDER BY visit_date, id').all(id).map((v) => ({ ...v, data: parseJ(v.data, {}) })); }
// A role without hiv.read must not learn that an HIV record exists: callers use this to answer "not found"
const hiddenFrom = (user, e) => e.program === 'hiv' && !can(user.role, 'hiv.read');
function maskDetails(user, e, details) { if (e.program === 'tb' && details.hiv_status && !can(user.role, 'hiv.read')) { const { hiv_status, ...rest } = details; void hiv_status; return { ...rest, hiv_status_hidden: true }; } return details; }

function enrol(db, user, patientId, input) {
  const p = patientRow(db, patientId);
  const program = input.program; const def = PROGRAMS[program]; if (!def) throw new HttpError(400, 'Unknown programme');
  const d = parseFields(def.enrol, input, { enforceRequired: true });
  const enrolledOn = blank(input.enrolled_on) ? todayStr() : text(input.enrolled_on, 10);
  if (!validDate(enrolledOn)) throw new HttpError(400, 'Enrolment date must be a valid date', { field: 'enrolled_on' }); notFuture(enrolledOn, 'Enrolment date');
  if (diffDays(enrolledOn, p.dob) < 0) throw new HttpError(400, 'Enrolment date is before the date of birth');
  notFuture(d.treatment_start, 'Treatment start'); notFuture(d.diagnosed_on, 'Diagnosis date'); notFuture(d.art_start_on, 'ART start');
  if (program === 'tb' && d.hiv_status && d.hiv_status !== 'unknown' && !can(user.role, 'hiv.write')) throw new HttpError(403, 'Only staff allowed to handle HIV information can record an HIV status');
  if (program === 'hiv' && d.diagnosed_on && d.art_start_on && diffDays(d.art_start_on, d.diagnosed_on) < 0) throw new HttpError(400, 'ART cannot start before the diagnosis date');
  if (program === 'nutrition' && diffDays(todayStr(), p.dob) >= 5 * 365) throw new HttpError(400, 'The malnutrition programme is for children under 5 years');
  const condition = program === 'chronic' ? d.condition : '';
  const year = enrolledOn.slice(0, 4);
  return tx(db, () => {
    const dup = db.prepare("SELECT id FROM program_enrolments WHERE patient_id=? AND program=? AND condition=? AND status='active'").get(patientId, program, condition);
    if (dup) throw new HttpError(409, 'This patient is already enrolled in this programme', { enrolment_id: dup.id });
    const seq = db.prepare('SELECT COUNT(*) c FROM program_enrolments WHERE program=? AND registration_no LIKE ?').get(program, `${def.prefix}-${year}-%`).c + 1;
    const reg = `${def.prefix}-${year}-${String(seq).padStart(4, '0')}`;
    const id = Number(db.prepare('INSERT INTO program_enrolments(patient_id,program,condition,registration_no,enrolled_on,details,next_due,contact_consent,enrolled_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(patientId, program, condition, reg, enrolledOn, JSON.stringify(d), R.initialNextDue(program, d, enrolledOn), input.contact_consent ? 1 : 0, user.id).lastInsertRowid);
    return { id, registration_no: reg };
  });
}

function addVisit(db, user, enrolId, input) {
  const e = enrolmentRow(db, enrolId); if (e.status !== 'active') throw new HttpError(409, 'This programme record is closed');
  const def = PROGRAMS[e.program]; const p = patientRow(db, e.patient_id);
  const date = blank(input.visit_date) ? todayStr() : text(input.visit_date, 10);
  if (!validDate(date)) throw new HttpError(400, 'Visit date must be a valid date', { field: 'visit_date' }); notFuture(date, 'Visit date');
  if (diffDays(date, e.enrolled_on) < 0) throw new HttpError(400, 'Visit date is before enrolment');
  const data = parseFields(def.visit, input);
  if (!Object.keys(data).length) throw new HttpError(400, 'Enter at least one finding');
  if (data.sys != null && data.dia != null && data.dia >= data.sys) throw new HttpError(400, 'Diastolic must be lower than systolic', { field: 'dia' });
  if ((data.sys == null) !== (data.dia == null)) throw new HttpError(400, 'Enter both systolic and diastolic', { field: 'dia' });
  if (data.glucose_mgdl != null && !data.glucose_type) throw new HttpError(400, 'Say whether the glucose was fasting or random', { field: 'glucose_type' });
  if (e.program === 'tb' && data.smear_result && data.smear_result !== 'not_done' && !data.smear_for) throw new HttpError(400, 'Say which smear this is (month 2, month 5, end of treatment or other)', { field: 'smear_for' });
  if (e.program === 'malaria' && data.parasite_result && data.parasite_result !== 'not_done' && !data.follow_up_day) throw new HttpError(400, 'Say which follow-up day this is', { field: 'follow_up_day' });
  let encId = null;
  if (input.encounter_id) { const en = encounterRow(db, Number(input.encounter_id)); if (en.patient_id !== e.patient_id) throw new HttpError(400, 'That visit belongs to a different patient'); if (en.status === 'signed' || en.status === 'cancelled') throw new HttpError(409, 'That visit is already closed'); encId = en.id; }
  const next = blank(input.next_due) ? null : text(input.next_due, 10);
  if (next && (!validDate(next) || diffDays(next, date) < 0)) throw new HttpError(400, 'Next due date must not be before the visit', { field: 'next_due' });
  return tx(db, () => {
    let growthId = null;
    if (e.program === 'nutrition' && (data.weight_kg != null || data.length_cm != null || data.muac_cm != null || data.edema)) { // the follow-up visit also becomes a growth record, so charts stay current
      const g = child.addMeasurement(db, user, e.patient_id, { measured_on: date, weight_kg: data.weight_kg, length_cm: data.length_cm, muac_cm: data.muac_cm, edema: !!data.edema, encounter_id: encId });
      growthId = g.id; if (g.z.whz != null) data.whz = g.z.whz;
    }
    const id = Number(db.prepare('INSERT INTO program_visits(enrolment_id,visit_date,encounter_id,data,growth_id,next_due,recorded_by) VALUES(?,?,?,?,?,?,?)').run(enrolId, date, encId, JSON.stringify(data), growthId, next, user.id).lastInsertRowid);
    const visits = visitsOf(db, enrolId); const enr = { ...e, details: parseJ(e.details, {}) };
    const dueOn = next || R.defaultNextDue(e.program, enr, visits, todayStr(), date);
    db.prepare('UPDATE program_enrolments SET next_due=? WHERE id=?').run(dueOn, enrolId);
    const ev = R.evaluate(e.program, { ...enr, next_due: dueOn }, visits, todayStr());
    return { id, next_due: dueOn, flags: ev.flags, growth_id: growthId, patient_id: p.id };
  });
}

const REASON_NOT_NEEDED = ['cured', 'treatment_completed', 'recovered'];
function close(db, user, enrolId, input) {
  const e = enrolmentRow(db, enrolId); if (e.status !== 'active') throw new HttpError(409, 'This programme record is already closed');
  const outcome = input.outcome; if (!PROGRAMS[e.program].outcomes.includes(outcome)) throw new HttpError(400, 'Not a valid outcome', { field: 'outcome' });
  const note = text(input.note, 300); if (!REASON_NOT_NEEDED.includes(outcome) && note.length < 3) throw new HttpError(400, 'A note is required for this outcome', { field: 'note' });
  const err = R.outcomeCheck(e.program, outcome, { ...e, details: parseJ(e.details, {}) }, visitsOf(db, enrolId)); if (err) throw new HttpError(400, 'The records do not support this outcome', { reason_code: err });
  db.prepare("UPDATE program_enrolments SET status='closed', outcome=?, outcome_on=?, outcome_note=? WHERE id=?").run(outcome, todayStr(), note, enrolId);
  return e;
}

/* ---- views ---- */
function summarise(db, user, e, today = todayStr()) {
  const details = parseJ(e.details, {}); const visits = visitsOf(db, e.id); const ev = R.evaluate(e.program, { ...e, details }, visits, today);
  return { id: e.id, program: e.program, condition: e.condition, registration_no: e.registration_no, enrolled_on: e.enrolled_on, status: e.status, outcome: e.outcome, outcome_on: e.outcome_on, outcome_note: e.outcome_note,
    contact_consent: !!e.contact_consent, details: maskDetails(user, e, details), next_due: e.next_due, due: ev.due, flags: e.status === 'active' ? ev.flags : [], schedule: ev.schedule, visit_count: visits.length, last_visit: visits.length ? visits[visits.length - 1].visit_date : null, _visits: visits };
}
function overview(db, user, patientId) {
  return db.prepare('SELECT * FROM program_enrolments WHERE patient_id=? ORDER BY status, id DESC').all(patientId).filter((e) => !hiddenFrom(user, e)).map((e) => { const { _visits, ...s } = summarise(db, user, e); void _visits; return s; });
}
function detail(db, user, id) {
  const e = enrolmentRow(db, id); if (hiddenFrom(user, e)) throw new HttpError(404, 'Programme record not found');
  const s = summarise(db, user, e); const visits = s._visits.map((v) => ({ id: v.id, visit_date: v.visit_date, data: v.data, next_due: v.next_due, growth_id: v.growth_id })); delete s._visits;
  return { enrolment: s, visits, patient_id: e.patient_id };
}
const worst = (flags) => (flags.some((f) => f.level === 'critical') ? 2 : flags.some((f) => f.level === 'warn') ? 1 : 0);
function register(db, user, { program, tab }) {
  const which = PROGRAM_KEYS.includes(program) ? [program] : PROGRAM_KEYS;
  if (which.length === 1 && which[0] === 'hiv' && !can(user.role, 'hiv.read')) throw new HttpError(403, 'Not allowed');
  const today = todayStr(); const rows = [];
  for (const e of db.prepare(`SELECT * FROM program_enrolments WHERE status='active' AND program IN (${which.map(() => '?').join(',')})`).all(...which)) {
    if (hiddenFrom(user, e)) continue;
    const s = summarise(db, user, e, today); const p = db.prepare('SELECT id,mrn,name_en,phone,restricted FROM patients WHERE id=?').get(e.patient_id);
    rows.push({ id: e.id, program: e.program, condition: e.condition, registration_no: e.registration_no, enrolled_on: e.enrolled_on, due: s.due, flags: s.flags, level: worst(s.flags), last_visit: s.last_visit,
      patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, restricted: !!p.restricted }, phone: e.contact_consent && !p.restricted ? p.phone || null : null, contact_consent: !!e.contact_consent });
  }
  const out = tab === 'recall' ? rows.filter((r) => r.due.state === 'overdue' || r.due.state === 'due_soon').sort((a, b) => b.due.overdue_days - a.due.overdue_days || (a.due.next_due < b.due.next_due ? -1 : 1))
    : rows.sort((a, b) => (b.level - a.level) || (b.due.overdue_days - a.due.overdue_days));
  const result = { rows: out };
  if (which.length === 1 && which[0] === 'nutrition' && tab !== 'recall') { // children flagged in the growth register but not yet in the programme
    const enrolled = new Set(rows.map((r) => r.patient.id)); result.candidates = child.nutritionRegister(db).filter((r) => !enrolled.has(r.patient.id) && r.flags.some((f) => ['sam', 'sam_muac', 'sam_edema', 'mam', 'mam_muac'].includes(f.code)));
  }
  return result;
}
function meta(user) {
  const out = {};
  for (const k of PROGRAM_KEYS) if (k !== 'hiv' || can(user.role, 'hiv.read')) out[k] = { enrol: PROGRAMS[k].enrol.filter((f) => !(f.sensitive && !can(user.role, 'hiv.write'))), visit: PROGRAMS[k].visit, outcomes: PROGRAMS[k].outcomes };
  return { programs: out };
}
module.exports = { enrol, addVisit, close, overview, detail, register, meta, parseFields, enrolmentRow, hiddenFrom, patientRow };
