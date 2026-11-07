'use strict';
const { tx } = require('./db');
const { HttpError } = require('./encounters');
const { can } = require('./permissions');
const R = require('./inpatient_rules');
const { validDate, diffDays, addDays, today: todayStr } = require('./maternal');

const text = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const COMPONENTS = ['whole_blood', 'red_cells', 'plasma', 'platelets'], RESULT = ['negative', 'positive', 'pending'], REACTIONS = ['none', 'mild', 'severe'];
const DEFAULT_MIN_UNITS = 2; // draft: red cells of each group should not drop below this
const unitRow = (db, id) => { const u = db.prepare('SELECT * FROM blood_units WHERE id=?').get(id); if (!u) throw new HttpError(404, 'Blood unit not found'); return u; };
const issueRow = (db, id) => { const i = db.prepare('SELECT * FROM blood_issues WHERE id=?').get(id); if (!i) throw new HttpError(404, 'Blood issue not found'); return i; };

// Donor screening results are visible to blood bank staff only; everyone else sees a generic reason
function unitView(u, user, today = todayStr()) {
  const bank = can(user.role, 'blood.write'); const v = { id: u.id, unit_no: u.unit_no, abo: u.abo, rh: u.rh, component: u.component, volume_ml: u.volume_ml, collected_on: u.collected_on, expires_on: u.expires_on, status: R.unitState(u, today), stored_status: u.status };
  if (bank) { v.donor_ref = u.donor_ref; v.tests = Object.fromEntries(R.TESTS.map((k) => [k, u[k]])); v.discard_reason = u.discard_reason; }
  else if (u.status === 'discarded') v.discard_reason = u.discard_code === 'screening_reactive' ? 'screening' : u.discard_reason;
  return v;
}
function addUnit(db, user, input) {
  const no = text(input.unit_no, 40); if (!no) throw new HttpError(400, 'Unit number is required', { field: 'unit_no' });
  if (db.prepare('SELECT 1 FROM blood_units WHERE unit_no=?').get(no)) throw new HttpError(409, 'This unit number is already registered');
  if (!R.ABO.includes(input.abo)) throw new HttpError(400, 'Choose the ABO group', { field: 'abo' }); if (!['pos', 'neg'].includes(input.rh)) throw new HttpError(400, 'Choose the Rh type', { field: 'rh' });
  if (!COMPONENTS.includes(input.component)) throw new HttpError(400, 'Choose the component', { field: 'component' });
  const vol = Number(input.volume_ml); if (!Number.isInteger(vol) || vol < 50 || vol > 600) throw new HttpError(400, 'Volume must be a whole number from 50 to 600 ml', { field: 'volume_ml' });
  const col = text(input.collected_on, 10), exp = text(input.expires_on, 10); if (!validDate(col) || diffDays(col, todayStr()) > 0) throw new HttpError(400, 'Collection date must be valid and not in the future', { field: 'collected_on' });
  if (!validDate(exp) || diffDays(exp, col) <= 0 || diffDays(exp, col) > 400) throw new HttpError(400, 'The expiry date must be after the collection date', { field: 'expires_on' });
  if (diffDays(exp, todayStr()) < 0) throw new HttpError(400, 'This unit has already expired and cannot be registered', { field: 'expires_on' });
  const id = Number(db.prepare('INSERT INTO blood_units(unit_no,abo,rh,component,volume_ml,collected_on,expires_on,donor_ref,registered_by) VALUES(?,?,?,?,?,?,?,?,?)').run(no, input.abo, input.rh, input.component, vol, col, exp, text(input.donor_ref, 60) || null, user.id).lastInsertRowid);
  return { id };
}
function recordScreening(db, id, input) {
  const u = unitRow(db, id); if (u.status !== 'quarantine') throw new HttpError(409, 'Screening can only be recorded for units in quarantine');
  const next = {}; for (const k of R.TESTS) { if (input[k] === undefined) continue; if (!RESULT.includes(input[k])) throw new HttpError(400, 'Not a valid result', { field: k }); next[k] = input[k]; }
  if (!Object.keys(next).length) throw new HttpError(400, 'Enter at least one result');
  const merged = { ...u, ...next }; const outcome = R.screeningOutcome(merged);
  tx(db, () => {
    db.prepare('UPDATE blood_units SET hiv=?, hbv=?, hcv=?, syphilis=?, malaria=? WHERE id=?').run(merged.hiv, merged.hbv, merged.hcv, merged.syphilis, merged.malaria, id);
    if (outcome === 'release') db.prepare("UPDATE blood_units SET status='available' WHERE id=?").run(id);
    if (outcome === 'discard') db.prepare("UPDATE blood_units SET status='discarded', discard_code='screening_reactive', discard_reason='Reactive screening result' WHERE id=?").run(id);
  });
  return outcome;
}
function discard(db, id, reason) {
  const u = unitRow(db, id); if (u.status !== 'quarantine' && u.status !== 'available') throw new HttpError(409, 'Only units in the bank can be discarded');
  const why = text(reason, 200); if (why.length < 3) throw new HttpError(400, 'A reason is required', { field: 'reason' });
  db.prepare("UPDATE blood_units SET status='discarded', discard_code='other', discard_reason=? WHERE id=?").run(why, id); return u;
}
function listUnits(db, user, status) {
  const today = todayStr(); const rows = db.prepare('SELECT * FROM blood_units ORDER BY expires_on, id').all().map((u) => unitView(u, user, today));
  if (status === 'all') return rows.slice(-300); const want = status === 'history' ? ['issued', 'transfused', 'discarded', 'expired'] : ['available', 'quarantine'];
  return rows.filter((u) => want.includes(u.status));
}
function summary(db) {
  const today = todayStr(); const soon = addDays(today, 7); const rows = db.prepare("SELECT * FROM blood_units WHERE status IN ('available','quarantine')").all();
  const cell = (abo, rh, component) => rows.filter((u) => u.abo === abo && u.rh === rh && u.component === component && u.status === 'available' && !R.unitExpired(u, today)).length;
  const groups = []; for (const abo of R.ABO) for (const rh of ['pos', 'neg']) { const rc = cell(abo, rh, 'red_cells') + cell(abo, rh, 'whole_blood'); groups.push({ group: abo + (rh === 'pos' ? '+' : '-'), red_cells: cell(abo, rh, 'red_cells'), whole_blood: cell(abo, rh, 'whole_blood'), plasma: cell(abo, rh, 'plasma'), platelets: cell(abo, rh, 'platelets'), low: rc < DEFAULT_MIN_UNITS }); }
  return { groups, min_units: DEFAULT_MIN_UNITS, expiring_soon: rows.filter((u) => u.status === 'available' && u.expires_on >= today && u.expires_on <= soon).length, expired_to_discard: rows.filter((u) => R.unitExpired(u, today)).length, in_quarantine: rows.filter((u) => u.status === 'quarantine' && !R.unitExpired(u, today)).length };
}
const recipientGroup = (db, patientId) => { const r = db.prepare("SELECT o.result_value v FROM lab_orders o JOIN lab_tests t ON t.id=o.test_id WHERE o.patient_id=? AND t.code='BLOODGRP' AND o.status='resulted' ORDER BY o.resulted_at DESC, o.id DESC LIMIT 1").get(patientId); return r ? R.parseGroup(r.v) : null; };

/* ---- patient-level: issue, transfuse, return ---- */
function forPatient(db, user, patientId) {
  const g = recipientGroup(db, patientId); const today = todayStr();
  const avail = db.prepare("SELECT * FROM blood_units WHERE status='available' ORDER BY expires_on, id").all().filter((u) => !R.unitExpired(u, today));
  const candidates = (g ? avail.filter((u) => R.bloodCompatible(g, u).ok) : avail.filter(R.isUniversalEmergencyRedCell)).map((u) => ({ id: u.id, unit_no: u.unit_no, abo: u.abo, rh: u.rh, component: u.component, volume_ml: u.volume_ml, expires_on: u.expires_on }));
  const issues = db.prepare('SELECT i.*, u.unit_no,u.abo,u.rh,u.component,u.volume_ml FROM blood_issues i JOIN blood_units u ON u.id=i.unit_id WHERE i.patient_id=? ORDER BY i.id DESC').all(patientId).map((i) => ({ ...i, transfusion: db.prepare('SELECT * FROM transfusions WHERE issue_id=?').get(i.id) || null }));
  void user; return { recipient_group: R.groupText(g), emergency_only: !g, candidates, issues };
}
function issue(db, user, patientId, input) {
  const u = unitRow(db, Number(input.unit_id)); const today = todayStr();
  if (u.status !== 'available' || R.unitExpired(u, today)) throw new HttpError(409, 'This unit is not available (expired, in quarantine or already used)', { unit_not_available: true });
  const indication = text(input.indication, 300); if (indication.length < 3) throw new HttpError(400, 'The reason for the transfusion is required', { field: 'indication' });
  const g = recipientGroup(db, patientId); const redCell = u.component === 'red_cells' || u.component === 'whole_blood'; let crossmatch, reason = null;
  if (!g) { // the blood group is not on record: only O negative red cells, in an emergency, with a written reason
    reason = text(input.emergency_reason, 300);
    if (!input.emergency_override || reason.length < 5) throw new HttpError(409, 'The patient\'s blood group is not recorded. Order a blood group test, or use the emergency exception with a written reason.', { group_unknown: true });
    if (!R.isUniversalEmergencyRedCell(u)) throw new HttpError(409, 'Without a recorded blood group only O negative red cells can be issued', { group_unknown: true, o_negative_only: true });
    crossmatch = 'emergency_uncrossmatched';
  } else {
    const c = R.bloodCompatible(g, u); if (!c.ok) throw new HttpError(409, 'This unit is not compatible with the patient\'s blood group', { incompatible: true, reasons: c.reasons });
    if (redCell) { if (input.crossmatch !== 'compatible') throw new HttpError(400, 'Confirm that the crossmatch was done and compatible', { field: 'crossmatch' }); crossmatch = 'compatible'; } else crossmatch = 'not_required';
  }
  const adm = db.prepare("SELECT id FROM admissions WHERE patient_id=? AND status='admitted'").get(patientId);
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO blood_issues(unit_id,patient_id,admission_id,issued_by,indication,recipient_group,crossmatch,emergency_reason) VALUES(?,?,?,?,?,?,?,?)').run(u.id, patientId, adm ? adm.id : null, user.id, indication, R.groupText(g), crossmatch, reason).lastInsertRowid);
    db.prepare("UPDATE blood_units SET status='issued' WHERE id=?").run(u.id); return { id, crossmatch };
  });
}
function recordTransfusion(db, user, issueId, input) {
  const i = issueRow(db, issueId); if (i.status !== 'issued') throw new HttpError(409, 'This unit has already been transfused or returned');
  const num = (v, label, min, max, req) => { if (v === undefined || v === null || v === '') { if (req) throw new HttpError(400, `${label} is required`, { field: label }); return null; } const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be from ${min} to ${max}`, { field: label }); return n; };
  const pre = { temp: num(input.pre_temp, 'pre_temp', 30, 45, true), pulse: num(input.pre_pulse, 'pre_pulse', 20, 300, true), sys: num(input.pre_sys, 'pre_sys', 40, 300), dia: num(input.pre_dia, 'pre_dia', 20, 200) };
  const post = { temp: num(input.post_temp, 'post_temp', 30, 45), pulse: num(input.post_pulse, 'post_pulse', 20, 300), sys: num(input.post_sys, 'post_sys', 40, 300), dia: num(input.post_dia, 'post_dia', 20, 200) };
  const reaction = REACTIONS.includes(input.reaction) ? input.reaction : null; if (!reaction) throw new HttpError(400, 'Record whether there was a reaction', { field: 'reaction' });
  const note = text(input.reaction_note, 500); if (reaction !== 'none' && note.length < 3) throw new HttpError(400, 'Describe the reaction', { field: 'reaction_note' });
  const volume = num(input.volume_given_ml, 'volume_given_ml', 0, 1000, true);
  const started = text(input.started_at, 16).replace('T', ' ') || new Date().toISOString().slice(0, 16).replace('T', ' '), ended = text(input.ended_at, 16).replace('T', ' ') || null;
  for (const [v, label] of [[started, 'started_at'], [ended, 'ended_at']]) if (v && (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(v) || !validDate(v.slice(0, 10)))) throw new HttpError(400, 'Time must be YYYY-MM-DD HH:MM', { field: label });
  if (ended && ended < started) throw new HttpError(400, 'The end cannot be before the start', { field: 'ended_at' });
  tx(db, () => {
    db.prepare('INSERT INTO transfusions(issue_id,started_at,ended_at,volume_given_ml,pre_temp,pre_pulse,pre_sys,pre_dia,post_temp,post_pulse,post_sys,post_dia,reaction,reaction_note,by_user) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(issueId, started, ended, volume, pre.temp, pre.pulse, pre.sys, pre.dia, post.temp, post.pulse, post.sys, post.dia, reaction, note || null, user.id);
    db.prepare("UPDATE blood_issues SET status='transfused' WHERE id=?").run(issueId); db.prepare("UPDATE blood_units SET status='transfused' WHERE id=?").run(i.unit_id);
  });
  return { reaction };
}
function returnUnit(db, issueId, reason) {
  const i = issueRow(db, issueId); if (i.status !== 'issued') throw new HttpError(409, 'This unit has already been transfused or returned');
  const why = text(reason, 200); if (why.length < 3) throw new HttpError(400, 'A reason is required', { field: 'reason' });
  tx(db, () => { db.prepare("UPDATE blood_issues SET status='returned', return_reason=? WHERE id=?").run(why, issueId); db.prepare("UPDATE blood_units SET status='discarded', discard_code='returned', discard_reason='Returned after issue (cold chain not guaranteed)' WHERE id=?").run(i.unit_id); });
  return i;
}
module.exports = { addUnit, recordScreening, discard, listUnits, summary, recipientGroup, forPatient, issue, recordTransfusion, returnUnit, issueRow, unitRow, COMPONENTS, REACTIONS };
