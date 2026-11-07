'use strict';
// One list of everyone who needs contact, merged from every module. Each source is included only if the user's role may see it,
// so a registration clerk sees appointments but never learns that someone is overdue for TB, antenatal or HIV care.
const { can } = require('./permissions');
const mch = require('./mch');
const imm = require('./immunization');
const programs = require('./programs');
const referrals = require('./referrals');
const appointments = require('./appointments');
const R = require('./continuity_rules');
const { diffDays, addDays, today: todayStr } = require('./maternal');

function list(db, user) {
  const today = todayStr(); const items = [];
  const add = (kind, patient, o) => { const dd = o.due_on ? Math.max(0, diffDays(today, o.due_on)) : 0; items.push({ kind, patient, due_on: o.due_on || null, days_overdue: dd, urgency: o.urgency != null ? o.urgency : R.urgencyOf(dd), detail: o.detail || {}, phone: o.phone || null }); };
  if (can(user.role, 'appt.read')) {
    for (const a of appointments.listRange(db, addDays(today, -R.MISSED_WINDOW), addDays(today, 1)).rows) {
      if (a.status === 'missed') add('appointment', a.patient, { due_on: a.appt_date, urgency: 1, phone: a.phone, detail: { state: 'missed', purpose: a.purpose, appt_id: a.id } });
      else if (a.status === 'scheduled') add('appointment', a.patient, { due_on: a.appt_date, urgency: 0, phone: a.phone, detail: { state: a.appt_date === today ? 'today' : 'tomorrow', purpose: a.purpose, appt_id: a.id, time: a.appt_time } });
    }
  }
  if (can(user.role, 'ref.read')) for (const r of referrals.worklist(db, 'active')) if (r.overdue) add('referral', r.patient, { due_on: String(r.created_at).slice(0, 10), urgency: r.urgency === 'routine' ? 1 : 2, detail: { ref_no: r.ref_no, urgency: r.urgency, status: r.status, referral_id: r.id } });
  if (can(user.role, 'mch.read')) {
    for (const r of mch.register(db, 'antenatal')) if (r.overdue) add('anc', r.patient, { urgency: r.alert_level === 2 ? 2 : 1, detail: { ga: r.ga_text, week: r.next_contact && r.next_contact.week, episode_id: r.id } });
    for (const r of mch.register(db, 'postnatal')) if (r.attention) add('postnatal', r.patient, { urgency: r.windows.some((w) => w.state === 'missed') ? 2 : 1, detail: { days: r.days, episode_id: r.episode_id } });
    for (const r of mch.register(db, 'fp')) if (r.overdue) add('fp', r.patient, { due_on: r.next_due, detail: { method: r.method } });
  }
  if (can(user.role, 'child.read')) for (const r of imm.register(db)) if (r.overdue + r.too_late > 0) add('immunization', r.patient, { urgency: r.overdue >= 3 ? 2 : 1, detail: { overdue: r.overdue, due: r.due } });
  if (can(user.role, 'prog.read')) for (const r of programs.register(db, user, { program: 'all', tab: 'recall' }).rows) if (r.due.state === 'overdue') add('programme', r.patient, { due_on: r.due.next_due, urgency: Math.max(R.urgencyOf(r.due.overdue_days), r.level === 2 ? 2 : 0), phone: r.phone, detail: { program: r.program, condition: r.condition, enrolment_id: r.id } });
  return items.sort((a, b) => (b.urgency - a.urgency) || (b.days_overdue - a.days_overdue)).slice(0, 300);
}
module.exports = { list };
