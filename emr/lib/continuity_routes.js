'use strict';
const enc = require('./encounters');
const referrals = require('./referrals');
const appointments = require('./appointments');
const followup = require('./followup');
const summaries = require('./summaries');
const audit = require('./audit');
const { can } = require('./permissions');

function handle(ctx) {
  const { db, user, req, res, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  const open = (pid) => { const p = enc.needPatient(db, pid); enc.gate(db, user, p); return p; }; // clinical records: restricted-record rules apply
  const exists = (pid) => enc.needPatient(db, pid); // appointments are task-level: no clinical content, so restricted patients can still be booked (listed by MRN only)

  /* referral destinations and the worklist */
  if (method === 'GET' && path === '/api/referrals/destinations') { if (!can(user.role, 'ref.read') && !can(user.role, 'ref.write')) { fail(res, 403, 'Not allowed'); return true; } return run(() => send(res, 200, { destinations: referrals.destinations(db, can(user.role, 'ref.admin')) })); }
  if (method === 'POST' && path === '/api/referrals/destinations') { if (!need('ref.admin')) return true; return run(() => { const id = referrals.addDestination(db, body); log('referral_destination_added', null, String(body.name).slice(0, 100)); send(res, 201, { id }); }); }
  if (method === 'GET' && path === '/api/referrals') { if (!need('ref.read')) return true; return run(() => send(res, 200, { referrals: referrals.worklist(db, url.searchParams.get('tab')) })); }
  if ((m = path.match(/^\/api\/encounters\/(\d+)\/referral-draft$/)) && method === 'GET') {
    if (!need('ref.write')) return true;
    return run(() => { const e = enc.encounterRow(db, Number(m[1])); open(e.patient_id); send(res, 200, { summary: referrals.composeSummary(db, e.id) }); });
  }
  if ((m = path.match(/^\/api\/encounters\/(\d+)\/summary$/)) && method === 'GET') {
    if (!need('encounter.read')) return true;
    return run(() => { const e = enc.encounterRow(db, Number(m[1])); open(e.patient_id); const s = summaries.visitSummary(db, e.id); log('visit_summary_viewed', e.patient_id, String(e.id)); send(res, 200, s); });
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/(referrals|appointments)$/))) {
    const pid = Number(m[1]), what = m[2];
    if (what === 'referrals' && method === 'GET') { if (!need('ref.read')) return true; return run(() => { open(pid); send(res, 200, { referrals: referrals.forPatient(db, pid) }); }); }
    if (what === 'referrals' && method === 'POST') { if (!need('ref.write')) return true; return run(() => { open(pid); const r = referrals.create(db, user, pid, body); log('referral_created', pid, r.ref_no); send(res, 201, r); }); }
    if (what === 'appointments' && method === 'GET') { if (!need('appt.read')) return true; return run(() => { exists(pid); send(res, 200, { appointments: appointments.forPatient(db, pid) }); }); }
    if (what === 'appointments' && method === 'POST') { if (!need('appt.write')) return true; return run(() => { exists(pid); const r = appointments.create(db, user, pid, body); log('appointment_created', pid, `${body.appt_date} ${body.purpose}`); send(res, 201, r); }); }
  }
  if ((m = path.match(/^\/api\/referrals\/(\d+)(?:\/(attended|back|cancel))?$/))) {
    const id = Number(m[1]), sub = m[2];
    const rec = () => { const r = referrals.refRow(db, id); open(r.patient_id); return r; };
    if (!sub && method === 'GET') { if (!need('ref.read')) return true; return run(() => { const r = rec(); log('referral_viewed', r.patient_id, r.ref_no); send(res, 200, referrals.detail(db, id)); }); }
    if (sub && method === 'POST') {
      if (!need(sub === 'cancel' ? 'ref.write' : 'ref.feedback')) return true;
      return run(() => {
        const r = rec();
        if (sub === 'attended') { referrals.markAttended(db, id, body); log('referral_attended', r.patient_id, r.ref_no); }
        else if (sub === 'back') { referrals.recordBack(db, user, id, body); log('referral_back_recorded', r.patient_id, r.ref_no); }
        else { referrals.cancel(db, id, body); log('referral_cancelled', r.patient_id, r.ref_no); }
        send(res, 200, referrals.detail(db, id));
      });
    }
  }

  /* appointments */
  if (method === 'GET' && path === '/api/appointments') {
    if (!need('appt.read')) return true;
    return run(() => { const from = url.searchParams.get('from') || url.searchParams.get('date'), to = url.searchParams.get('to') || from; send(res, 200, appointments.listRange(db, from, to)); });
  }
  if (method === 'GET' && path === '/api/appointments/calllist') { if (!need('appt.read')) return true; return run(() => send(res, 200, { rows: appointments.callList(db) })); }
  if ((m = path.match(/^\/api\/appointments\/(\d+)\/(cancel|reschedule|reminder)$/)) && method === 'POST') {
    if (!need('appt.write')) return true;
    return run(() => {
      const a = appointments.apptRow(db, Number(m[1])); exists(a.patient_id);
      if (m[2] === 'cancel') { appointments.cancel(db, a.id, body); log('appointment_cancelled', a.patient_id, String(a.id)); send(res, 200, { ok: true }); }
      else if (m[2] === 'reschedule') { const r = appointments.reschedule(db, user, a.id, body); log('appointment_rescheduled', a.patient_id, `${a.id} -> ${r.id}`); send(res, 200, r); }
      else { appointments.addReminder(db, user, a.id, body); log('reminder_logged', a.patient_id, `${a.id}: ${body.method}/${body.result}`); send(res, 201, { ok: true }); }
    });
  }
  if (method === 'GET' && path === '/api/followup') { if (!need('followup.read')) return true; return run(() => { log('followup_viewed', null, user.role); send(res, 200, { items: followup.list(db, user) }); }); }
  if (method === 'GET' && path === '/api/continuity/meta') { return run(() => send(res, 200, { purposes: appointments.PURPOSES, methods: appointments.METHODS, results: appointments.RESULTS, urgencies: referrals.URGENCY })); }
  return false;
}
module.exports = { handle };
