'use strict';
const { HttpError } = require('./encounters');
const { addDays, diffDays, validDate, today: todayStr } = require('./maternal');

const GRACE_DAYS = 4; // WHO allows a 4-day grace period before a dose counts as too early
const text = (v, max = 100) => (v == null ? '' : String(v).trim().slice(0, max));
const SOURCES = ['given_here', 'card', 'birth_record'];

function schedule(db) {
  return db.prepare('SELECT d.*, v.name vaccine FROM vaccine_doses d JOIN vaccines v ON v.code=d.vaccine_code ORDER BY d.vaccine_code, d.dose_no').all();
}

// Pure: status of every scheduled dose for a child. records = valid, non-voided doses [{vaccine_code, dose_no, given_on, id}]
// done | blocked (earlier dose missing) | too_late (past the maximum age) | overdue | due | upcoming
function statuses(dob, today, records, doses) {
  const age = diffDays(today, dob);
  const rec = (v, n) => records.find((r) => r.vaccine_code === v && r.dose_no === n);
  return doses.map((d) => {
    const base = { vaccine_code: d.vaccine_code, vaccine: d.vaccine, dose_no: d.dose_no, due_days: d.due_days };
    const r = rec(d.vaccine_code, d.dose_no);
    if (r) return { ...base, status: 'done', given_on: r.given_on, record_id: r.id };
    const prevExists = d.dose_no >= 2 && doses.some((x) => x.vaccine_code === d.vaccine_code && x.dose_no === d.dose_no - 1);
    const prev = prevExists ? rec(d.vaccine_code, d.dose_no - 1) : null;
    if (prevExists && !prev) return { ...base, status: 'blocked', due_on: null };
    let earliest = addDays(dob, d.min_age_days);
    if (prev && d.min_interval_days != null) { const e2 = addDays(prev.given_on, d.min_interval_days); if (e2 > earliest) earliest = e2; }
    const dueOn = addDays(dob, d.due_days) > earliest ? addDays(dob, d.due_days) : earliest;
    let status;
    if (d.max_age_days != null && age > d.max_age_days) status = 'too_late';
    else if (diffDays(today, dueOn) > d.late_days) status = 'overdue';
    else if (diffDays(today, dueOn) >= 0) status = 'due';
    else status = 'upcoming';
    return { ...base, status, due_on: dueOn, earliest_on: earliest, days_overdue: Math.max(0, diffDays(today, dueOn)) };
  });
}
// Pure: why a dose given on `givenOn` would not count (too early, or too soon after the previous dose)
function invalidReasons(dob, givenOn, dose, prevGivenOn) {
  const r = [];
  if (diffDays(givenOn, dob) < dose.min_age_days - GRACE_DAYS) r.push('too_young');
  if (prevGivenOn && dose.min_interval_days != null && diffDays(givenOn, prevGivenOn) < dose.min_interval_days - GRACE_DAYS) r.push('too_soon');
  return r;
}
const summarise = (rows) => ({ done: rows.filter((r) => r.status === 'done').length, due: rows.filter((r) => r.status === 'due').length, overdue: rows.filter((r) => r.status === 'overdue').length, too_late: rows.filter((r) => r.status === 'too_late').length,
  up_to_date: !rows.some((r) => ['due', 'overdue', 'too_late'].includes(r.status)) });

const patient = (db, id) => { const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
const validRecords = (db, pid) => db.prepare('SELECT id,vaccine_code,dose_no,given_on FROM immunizations WHERE patient_id=? AND voided=0 AND valid=1').all(pid);
function overview(db, p, today = todayStr()) {
  const rows = statuses(p.dob, today, validRecords(db, p.id), schedule(db));
  const records = db.prepare('SELECT i.id,i.vaccine_code,v.name vaccine,i.dose_no,i.given_on,i.batch_no,i.site,i.source,i.valid,i.invalid_reason FROM immunizations i JOIN vaccines v ON v.code=i.vaccine_code WHERE i.patient_id=? AND i.voided=0 ORDER BY i.given_on, i.id').all(p.id);
  return { schedule: rows, summary: summarise(rows), records };
}

function record(db, user, patientId, input) {
  const p = patient(db, patientId);
  const dose = db.prepare('SELECT d.*, v.name vaccine FROM vaccine_doses d JOIN vaccines v ON v.code=d.vaccine_code WHERE d.vaccine_code=? AND d.dose_no=?').get(text(input.vaccine_code, 20), Number(input.dose_no));
  if (!dose) throw new HttpError(400, 'Unknown vaccine or dose');
  const givenOn = text(input.given_on, 10);
  if (!validDate(givenOn) || diffDays(givenOn, todayStr()) > 0) throw new HttpError(400, 'Date given must be a valid date, not in the future', { field: 'given_on' });
  if (diffDays(givenOn, p.dob) < 0) throw new HttpError(400, 'Date given is before the date of birth', { field: 'given_on' });
  const source = SOURCES.includes(input.source) && input.source !== 'birth_record' ? input.source : 'given_here';
  const valids = validRecords(db, patientId);
  if (valids.some((r) => r.vaccine_code === dose.vaccine_code && r.dose_no === dose.dose_no)) throw new HttpError(409, 'This dose is already recorded');
  const prevExists = dose.dose_no >= 2 && !!db.prepare('SELECT 1 FROM vaccine_doses WHERE vaccine_code=? AND dose_no=?').get(dose.vaccine_code, dose.dose_no - 1);
  const prev = prevExists ? valids.find((r) => r.vaccine_code === dose.vaccine_code && r.dose_no === dose.dose_no - 1) : null;
  if (prevExists && !prev && source === 'given_here') throw new HttpError(409, 'The previous dose is not recorded. Record it first (from the vaccination card if it was given elsewhere).', { missing_dose: dose.dose_no - 1 });
  const reasons = source === 'card' && !prev ? invalidReasons(p.dob, givenOn, dose, null) : invalidReasons(p.dob, givenOn, dose, prev && prev.given_on);
  if (reasons.length && !input.confirm_invalid) throw new HttpError(409, 'This dose would not count', { invalid_reasons: reasons });
  const r = db.prepare('INSERT INTO immunizations(patient_id,vaccine_code,dose_no,given_on,batch_no,site,source,valid,invalid_reason,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(patientId, dose.vaccine_code, dose.dose_no, givenOn, text(input.batch_no, 40) || null, text(input.site, 40) || null, source, reasons.length ? 0 : 1, reasons.length ? reasons.join(',') : null, user.id);
  return { id: Number(r.lastInsertRowid), valid: !reasons.length, reasons, vaccine: dose.vaccine };
}
function voidDose(db, id, reason) {
  const row = db.prepare('SELECT * FROM immunizations WHERE id=? AND voided=0').get(id); if (!row) throw new HttpError(404, 'Record not found');
  const why = text(reason, 200); if (why.length < 3) throw new HttpError(400, 'A reason is required');
  db.prepare('UPDATE immunizations SET voided=1, void_reason=? WHERE id=?').run(why, id);
  return row;
}
// Birth doses noted at delivery become real records (no transaction here: the caller wraps it)
function recordBirthDoses(db, user, patientId, givenOn, flags) {
  const add = (code, n) => db.prepare("INSERT INTO immunizations(patient_id,vaccine_code,dose_no,given_on,source,valid,recorded_by) VALUES(?,?,?,?,'birth_record',1,?)").run(patientId, code, n, givenOn, user.id);
  if (flags.bcg_given) add('BCG', 1); if (flags.hepb0_given) add('HEPB_B', 1); if (flags.opv0_given) add('OPV', 0);
}
function updateDose(db, id, input) {
  const d = db.prepare('SELECT * FROM vaccine_doses WHERE id=?').get(id); if (!d) throw new HttpError(404, 'Dose not found');
  const int = (v, label, min, max, nullable) => { if (v === undefined) return undefined; if ((v === null || v === '') && nullable) return null; const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`); return n; };
  const next = { due_days: int(input.due_days, 'Due age', 0, 3650) ?? d.due_days, min_age_days: int(input.min_age_days, 'Minimum age', 0, 3650) ?? d.min_age_days,
    min_interval_days: input.min_interval_days === undefined ? d.min_interval_days : int(input.min_interval_days, 'Minimum interval', 0, 365, true),
    max_age_days: input.max_age_days === undefined ? d.max_age_days : int(input.max_age_days, 'Maximum age', 0, 7300, true), late_days: int(input.late_days, 'Late after', 0, 365) ?? d.late_days };
  if (next.min_age_days > next.due_days) throw new HttpError(400, 'Minimum age cannot be later than the due age');
  if (next.max_age_days != null && next.max_age_days < next.due_days) throw new HttpError(400, 'Maximum age cannot be earlier than the due age');
  db.prepare('UPDATE vaccine_doses SET due_days=?, min_age_days=?, min_interval_days=?, max_age_days=?, late_days=? WHERE id=?').run(next.due_days, next.min_age_days, next.min_interval_days, next.max_age_days, next.late_days, id);
  return d;
}

// Worklist: children under 5 with doses due, overdue or past the maximum age
function register(db, today = todayStr()) {
  const cutoff = addDays(today, -1826); const doses = schedule(db);
  const kids = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE voided=0 AND dob>? AND dob<=?').all(cutoff, today);
  const byPatient = {}; for (const r of db.prepare('SELECT patient_id,id,vaccine_code,dose_no,given_on FROM immunizations WHERE voided=0 AND valid=1').all()) (byPatient[r.patient_id] ||= []).push(r);
  return kids.map((k) => { const rows = statuses(k.dob, today, byPatient[k.id] || [], doses); const s = summarise(rows);
    return { patient: { id: k.id, mrn: k.mrn, name_en: k.restricted ? null : k.name_en, dob: k.dob, restricted: !!k.restricted }, age_days: diffDays(today, k.dob), ...s, items: rows.filter((r) => ['due', 'overdue', 'too_late'].includes(r.status)) }; })
    .filter((r) => !r.up_to_date).sort((a, b) => (b.overdue - a.overdue) || (b.too_late - a.too_late) || (b.due - a.due) || (a.age_days - b.age_days));
}
module.exports = { schedule, statuses, invalidReasons, summarise, overview, record, voidDose, recordBirthDoses, updateDose, register, GRACE_DAYS };
