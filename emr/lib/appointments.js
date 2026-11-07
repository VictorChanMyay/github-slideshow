'use strict';
const { tx } = require('./db');
const { HttpError, encounterRow } = require('./encounters');
const R = require('./continuity_rules');
const { validDate, diffDays, addDays, today: todayStr } = require('./maternal');

const text = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
// Generic on purpose: an appointment list is seen by reception, so it never names a diagnosis or the HIV programme
const PURPOSES = ['general', 'antenatal', 'postnatal', 'child_health', 'family_planning', 'lab', 'medicine_refill', 'programme', 'other'];
const METHODS = ['call', 'sms', 'visit'], RESULTS = ['reached', 'no_answer', 'wrong_number', 'declined'];
const patientRow = (db, id) => { const p = db.prepare('SELECT id,mrn,name_en,phone,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
const apptRow = (db, id) => { const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(id); if (!a) throw new HttpError(404, 'Appointment not found'); return a; };

function checkWhen(input) {
  const date = text(input.appt_date, 10); if (!validDate(date)) throw new HttpError(400, 'Choose a valid date', { field: 'appt_date' });
  if (diffDays(date, todayStr()) < 0) throw new HttpError(400, 'The date cannot be in the past', { field: 'appt_date' });
  if (diffDays(date, todayStr()) > 365) throw new HttpError(400, 'The date is more than a year away', { field: 'appt_date' });
  const time = input.appt_time ? text(input.appt_time, 5) : null; if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Time must be HH:MM', { field: 'appt_time' });
  return { date, time };
}
function create(db, user, patientId, input) {
  patientRow(db, patientId); const { date, time } = checkWhen(input);
  const purpose = PURPOSES.includes(input.purpose) ? input.purpose : null; if (!purpose) throw new HttpError(400, 'Choose the purpose of the appointment', { field: 'purpose' });
  if (db.prepare("SELECT 1 FROM appointments WHERE patient_id=? AND appt_date=? AND purpose=? AND status='scheduled'").get(patientId, date, purpose)) throw new HttpError(409, 'This patient already has an appointment for this purpose on that day');
  let enc = null; if (input.encounter_id) { const e = encounterRow(db, Number(input.encounter_id)); if (e.patient_id !== patientId) throw new HttpError(400, 'That visit belongs to a different patient'); enc = e.id; }
  const id = Number(db.prepare('INSERT INTO appointments(patient_id,encounter_id,appt_date,appt_time,purpose,note,reminder_ok,created_by) VALUES(?,?,?,?,?,?,?,?)').run(patientId, enc, date, time, purpose, text(input.note, 200) || null, input.reminder_ok ? 1 : 0, user.id).lastInsertRowid);
  return { id };
}
function cancel(db, id, input) {
  const a = apptRow(db, id); if (a.status !== 'scheduled') throw new HttpError(409, 'Only a scheduled appointment can be cancelled');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required', { field: 'reason' });
  db.prepare("UPDATE appointments SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, id); return a;
}
function reschedule(db, user, id, input) {
  const a = apptRow(db, id); if (a.status !== 'scheduled') throw new HttpError(409, 'Only a scheduled appointment can be moved');
  const { date, time } = checkWhen(input);
  return tx(db, () => {
    const nid = Number(db.prepare('INSERT INTO appointments(patient_id,encounter_id,appt_date,appt_time,purpose,note,reminder_ok,created_by) VALUES(?,?,?,?,?,?,?,?)').run(a.patient_id, a.encounter_id, date, time, a.purpose, a.note, a.reminder_ok, user.id).lastInsertRowid);
    db.prepare("UPDATE appointments SET status='rescheduled', rescheduled_to=? WHERE id=?").run(nid, id);
    return { id: nid, patient_id: a.patient_id };
  });
}
function addReminder(db, user, id, input) {
  const a = apptRow(db, id); if (!a.reminder_ok) throw new HttpError(409, 'The patient has not agreed to reminders');
  if (!METHODS.includes(input.method) || !RESULTS.includes(input.result)) throw new HttpError(400, 'Choose how the patient was contacted and the result');
  db.prepare('INSERT INTO appointment_reminders(appointment_id,method,result,by_user) VALUES(?,?,?,?)').run(id, input.method, input.result, user.id); return a;
}
const remindersOf = (db, id) => db.prepare('SELECT r.id,r.method,r.result,r.at,u.full_name by_name FROM appointment_reminders r LEFT JOIN users u ON u.id=r.by_user WHERE appointment_id=? ORDER BY r.id').all(id);
function row(db, a, today) {
  const p = db.prepare('SELECT id,mrn,name_en,phone,restricted FROM patients WHERE id=?').get(a.patient_id);
  return { id: a.id, appt_date: a.appt_date, appt_time: a.appt_time, purpose: a.purpose, note: a.note, reminder_ok: !!a.reminder_ok, status: R.apptState(a, today), stored_status: a.status, cancel_reason: a.cancel_reason, reminders: remindersOf(db, a.id),
    patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, restricted: !!p.restricted }, phone: a.reminder_ok && !p.restricted ? p.phone || null : null };
}
// Appointments between two dates (inclusive), plus how many are booked each day
function listRange(db, from, to) {
  const today = todayStr(); if (!validDate(from) || !validDate(to) || diffDays(to, from) < 0 || diffDays(to, from) > 62) throw new HttpError(400, 'Choose a date range of up to 62 days');
  const rows = db.prepare("SELECT * FROM appointments WHERE appt_date>=? AND appt_date<=? AND status!='rescheduled' ORDER BY appt_date, COALESCE(appt_time,'99:99'), id").all(from, to).map((a) => row(db, a, today));
  const counts = {}; for (const r of rows) if (r.status !== 'cancelled') counts[r.appt_date] = (counts[r.appt_date] || 0) + 1;
  return { rows, counts };
}
function forPatient(db, patientId) { const today = todayStr(); return db.prepare("SELECT * FROM appointments WHERE patient_id=? AND status!='rescheduled' ORDER BY appt_date DESC, id DESC LIMIT 30").all(patientId).map((a) => row(db, a, today)); }
function callList(db) {
  const today = todayStr();
  const appts = db.prepare("SELECT * FROM appointments WHERE status='scheduled' AND reminder_ok=1 AND appt_date>=? AND appt_date<=?").all(addDays(today, -R.MISSED_WINDOW), addDays(today, R.REMIND_WITHIN));
  const rem = db.prepare(`SELECT appointment_id,result FROM appointment_reminders WHERE appointment_id IN (${appts.map(() => '?').join(',') || 'NULL'})`).all(...appts.map((a) => a.id));
  return R.callList(appts, rem, today).map((a) => ({ ...row(db, a, today), reason: a.reason, days: a.days }));
}
module.exports = { create, cancel, reschedule, addReminder, listRange, forPatient, callList, apptRow, PURPOSES, METHODS, RESULTS };
