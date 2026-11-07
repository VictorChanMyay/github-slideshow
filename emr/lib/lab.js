'use strict';
const { tx } = require('./db');
const { can } = require('./permissions');
const { HttpError } = require('./encounters');
const clinical = require('./clinical');

const text = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const parse = (j) => { try { return j ? JSON.parse(j) : []; } catch { return []; } };

function listTests(db) {
  return db.prepare('SELECT * FROM lab_tests WHERE active=1 ORDER BY name').all()
    .map((t) => ({ id: t.id, code: t.code, name: t.name, kind: t.kind, unit: t.unit, options: parse(t.options), sensitive: !!t.sensitive, adult_only: !!t.adult_only, ref_low: t.ref_low, ref_high: t.ref_high }));
}

// DRAFT interpretation. Child reference ranges differ and are not included: adult-only tests are 'not_assessed' under 12 years.
function interpret(test, value, sex, ageMonths) {
  if (test.kind === 'qualitative') {
    const options = parse(test.options);
    if (!options.includes(value)) throw new HttpError(400, 'Result must be one of the listed options');
    if (/^invalid$/i.test(value)) return 'invalid';
    return parse(test.abnormal).includes(value) ? 'abnormal' : 'normal';
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, 'Result must be a number');
  if (test.adult_only && ageMonths < 144) return 'not_assessed';
  let lo = test.ref_low, hi = test.ref_high;
  if (sex === 'M' && test.ref_low_m != null) { lo = test.ref_low_m; hi = test.ref_high_m; }
  if (sex === 'F' && test.ref_low_f != null) { lo = test.ref_low_f; hi = test.ref_high_f; }
  if ((test.crit_low != null && n < test.crit_low) || (test.crit_high != null && n > test.crit_high)) return 'critical';
  if ((lo != null && n < lo) || (hi != null && n > hi)) return 'abnormal';
  return 'normal';
}

function orderRow(db, id) {
  const o = db.prepare('SELECT o.*, t.code, t.name test_name, t.kind, t.unit, t.sensitive FROM lab_orders o JOIN lab_tests t ON t.id=o.test_id WHERE o.id=?').get(id);
  if (!o) throw new HttpError(404, 'Lab order not found');
  return o;
}
const view = (o, user) => {
  const hide = o.sensitive && o.status === 'resulted' && !can(user.role, 'lab.sensitive');
  return { id: o.id, encounter_id: o.encounter_id, patient_id: o.patient_id, test: o.test_name, code: o.code, kind: o.kind, unit: o.unit, sensitive: !!o.sensitive, priority: o.priority, status: o.status,
    ordered_at: o.ordered_at, collected_at: o.collected_at, resulted_at: o.resulted_at, amended: !!o.amended,
    result_value: hide ? null : o.result_value, result_flag: hide ? null : o.result_flag, result_comment: hide ? null : o.result_comment, hidden: !!hide, cancel_reason: o.cancel_reason };
};

function order(db, user, encounter, input) {
  const test = db.prepare('SELECT * FROM lab_tests WHERE id=? AND active=1').get(Number(input.test_id));
  if (!test) throw new HttpError(400, 'Unknown test');
  const dup = db.prepare("SELECT id FROM lab_orders WHERE encounter_id=? AND test_id=? AND status!='cancelled'").get(encounter.id, test.id);
  if (dup && !input.confirm_duplicate) throw new HttpError(409, 'This test is already ordered for this visit', { duplicate: true });
  const r = db.prepare('INSERT INTO lab_orders(encounter_id,patient_id,test_id,priority,ordered_by) VALUES(?,?,?,?,?)')
    .run(encounter.id, encounter.patient_id, test.id, input.priority === 'urgent' ? 'urgent' : 'routine', user.id);
  return Number(r.lastInsertRowid);
}
function cancelOrder(db, id, input) {
  const o = orderRow(db, id);
  if (o.status !== 'ordered') throw new HttpError(409, 'Only tests that have not been collected can be cancelled');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  db.prepare("UPDATE lab_orders SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, id);
  return o;
}
function collect(db, user, id) {
  const o = orderRow(db, id);
  if (o.status !== 'ordered') throw new HttpError(409, 'Specimen already collected or order closed');
  db.prepare("UPDATE lab_orders SET status='collected', collected_by=?, collected_at=datetime('now') WHERE id=?").run(user.id, id);
  return o;
}
function enterResult(db, user, id, input) {
  const o = orderRow(db, id);
  if (o.status === 'cancelled' || o.status === 'ordered') throw new HttpError(409, 'Collect the specimen before entering a result');
  const p = db.prepare('SELECT sex,dob FROM patients WHERE id=?').get(o.patient_id);
  const test = db.prepare('SELECT * FROM lab_tests WHERE id=?').get(o.test_id);
  const value = text(input.value, 60); if (!value) throw new HttpError(400, 'A result value is required');
  const flag = interpret(test, value, p.sex, clinical.ageInMonths(p.dob));
  const comment = text(input.comment, 300);
  tx(db, () => {
    if (o.status === 'resulted') {
      const reason = text(input.amend_reason, 200);
      if (reason.length < 3) throw new HttpError(400, 'A reason is required to amend a result', { amend: true });
      db.prepare('INSERT INTO lab_result_history(order_id,old_value,new_value,reason,by_user) VALUES(?,?,?,?,?)').run(id, o.result_value, value, reason, user.id);
      db.prepare("UPDATE lab_orders SET result_value=?, result_flag=?, result_comment=?, resulted_by=?, resulted_at=datetime('now'), amended=1 WHERE id=?").run(value, flag, comment, user.id, id);
    } else {
      db.prepare("UPDATE lab_orders SET status='resulted', result_value=?, result_flag=?, result_comment=?, resulted_by=?, resulted_at=datetime('now') WHERE id=?").run(value, flag, comment, user.id, id);
    }
  });
  return { order: o, flag };
}

// Worklist for lab staff. Restricted patients appear by MRN only (task-level access: they can be processed, not browsed).
function worklist(db, user, status) {
  const st = status === 'resulted' ? ['resulted'] : status === 'collected' ? ['collected'] : ['ordered'];
  const rows = db.prepare(`SELECT o.id FROM lab_orders o WHERE o.status IN (${st.map(() => '?').join(',')}) ORDER BY o.priority='urgent' DESC, o.id ${st[0] === 'resulted' ? 'DESC' : 'ASC'} LIMIT 200`).all(...st);
  return rows.map(({ id }) => {
    const o = orderRow(db, id); const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=?').get(o.patient_id);
    return { ...view(o, user), patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, sex: p.sex, dob: p.dob, restricted: !!p.restricted } };
  });
}
const forEncounter = (db, user, encounterId) => db.prepare('SELECT id FROM lab_orders WHERE encounter_id=? ORDER BY id').all(encounterId).map(({ id }) => view(orderRow(db, id), user));

module.exports = { listTests, interpret, order, cancelOrder, collect, enterResult, worklist, forEncounter, orderRow };
