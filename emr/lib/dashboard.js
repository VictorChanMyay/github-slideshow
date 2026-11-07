'use strict';
// Dashboard numbers. Each person only gets the tiles their role may see. Charts show counts only, never names.
const { can } = require('./permissions');
const followup = require('./followup');
const referrals = require('./referrals');
const mch = require('./mch');
const blood = require('./blood');
const I = require('./indicators');
const { addDays, today: todayStr } = require('./maternal');

const n = (db, sql, ...a) => db.prepare(sql).get(...a).c;
function dashboard(db, user) {
  const today = todayStr(); const tiles = []; const add = (key, value, link, level) => tiles.push({ key, value, link, level: level || null });
  if (can(user.role, 'queue.read')) { add('visits_today', n(db, "SELECT COUNT(*) c FROM encounters WHERE visit_date=? AND status!='cancelled'", today), 'queue'); add('in_queue', n(db, "SELECT COUNT(*) c FROM encounters WHERE visit_date=? AND status IN ('waiting','triaged','in_consult')", today), 'queue'); }
  if (can(user.role, 'adm.read')) { const o = n(db, "SELECT COUNT(*) c FROM admissions WHERE status='admitted'"); add('admitted_now', o, 'inpatients'); add('beds_free', n(db, "SELECT COUNT(*) c FROM beds WHERE status='active'") - o, 'inpatients'); }
  if (can(user.role, 'lab.read')) add('labs_waiting', n(db, "SELECT COUNT(*) c FROM lab_orders WHERE status IN ('ordered','collected')"), 'lab');
  if (can(user.role, 'rx.read')) add('rx_waiting', n(db, "SELECT COUNT(*) c FROM prescriptions WHERE status IN ('prescribed','partial')"), 'pharmacy');
  if (can(user.role, 'stock.read')) { const v = I.run(db, 'stock_below_reorder_now', today, today, { mask: false }).value; add('low_stock', v, 'stock', v ? 'warn' : null); }
  if (can(user.role, 'blood.read')) { const v = blood.summary(db).groups.filter((g) => g.low).length; add('blood_low_groups', v, 'blood', v ? 'warn' : null); }
  if (can(user.role, 'ref.read')) { const v = referrals.worklist(db, 'active').filter((r) => r.overdue).length; add('referrals_overdue', v, 'referrals', v ? 'warn' : null); }
  if (can(user.role, 'followup.read')) { const v = followup.list(db, user).length; add('followups', v, 'followup', v ? 'warn' : null); }
  if (can(user.role, 'mch.read')) { const v = mch.register(db, 'antenatal').filter((r) => r.alert_level === 2).length; add('anc_danger', v, 'mch', v ? 'crit' : null); }
  if (can(user.role, 'encounter.read')) { const v = n(db, "SELECT COUNT(*) c FROM encounters WHERE status IN ('waiting','triaged','in_consult') AND visit_date<?", today); add('unsigned_visits', v, 'queue', v ? 'warn' : null); }
  const d30 = addDays(today, -29);
  const perDay = db.prepare("SELECT visit_date date, COUNT(*) count FROM encounters WHERE status='signed' AND visit_date BETWEEN ? AND ? GROUP BY visit_date").all(d30, today); const map = Object.fromEntries(perDay.map((r) => [r.date, r.count]));
  const visits_per_day = Array.from({ length: 30 }, (_, i) => { const d = addDays(d30, i); return { date: d, count: map[d] || 0 }; });
  const top_diagnoses = db.prepare("SELECT d.code, i.name, COUNT(*) count FROM diagnoses d JOIN encounters e ON e.id=d.encounter_id JOIN icd10 i ON i.code=d.code WHERE e.status='signed' AND d.kind='primary' AND e.visit_date BETWEEN ? AND ? AND d.code!='B24' GROUP BY d.code ORDER BY count DESC, d.code LIMIT 8").all(d30, today);
  const m12 = []; for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1)); const ym = d.toISOString().slice(0, 7); m12.push({ month: ym, count: n(db, "SELECT COUNT(*) c FROM encounters WHERE status='signed' AND substr(visit_date,1,7)=?", ym) }); }
  return { tiles, charts: { visits_per_day, top_diagnoses, visits_per_month: m12 } };
}
module.exports = { dashboard };
