'use strict';
const { HttpError, encounterRow } = require('./encounters');
const growth = require('./growth');
const imm = require('./immunization');
const { validDate, today: todayStr, addDays, diffDays } = require('./maternal');

const text = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
function num(v, label, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be a number from ${min} to ${max}`, { field: label }); return n;
}
const MAX_CHILD_DAYS = 19 * 365;
const patientRow = (db, id) => { const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };

/* ---- growth measurements ---- */
function addMeasurement(db, user, patientId, input) {
  const p = patientRow(db, patientId);
  const on = input.measured_on ? text(input.measured_on, 10) : todayStr();
  if (!validDate(on) || diffDays(on, todayStr()) > 0) throw new HttpError(400, 'Measurement date must be a valid date, not in the future', { field: 'measured_on' });
  const age = diffDays(on, p.dob);
  if (age < 0) throw new HttpError(400, 'Measurement date is before the date of birth', { field: 'measured_on' });
  if (age > MAX_CHILD_DAYS) throw new HttpError(400, 'Growth records are for children and adolescents under 19 years');
  const m = { weight_kg: num(input.weight_kg, 'Weight (kg)', 0.3, 200), length_cm: num(input.length_cm, 'Length / height (cm)', 20, 200), head_cm: num(input.head_cm, 'Head circumference (cm)', 15, 70), muac_cm: num(input.muac_cm, 'MUAC (cm)', 5, 40) };
  const edema = !!input.edema;
  if (Object.values(m).every((x) => x == null) && !edema) throw new HttpError(400, 'Enter at least one measurement');
  const lying = input.lying === true || input.lying === 'true' ? 1 : input.lying === false || input.lying === 'false' ? 0 : null;
  let encId = null;
  if (input.encounter_id) { const e = encounterRow(db, Number(input.encounter_id)); if (e.patient_id !== patientId) throw new HttpError(400, 'That visit belongs to a different patient'); if (e.status === 'signed' || e.status === 'cancelled') throw new HttpError(409, 'That visit is already closed'); encId = e.id; }
  const res = growth.compute({ sex: p.sex, dob: p.dob, measured_on: on, ...m, lying: lying == null ? null : !!lying, edema });
  const id = Number(db.prepare('INSERT INTO growth_measurements(patient_id,encounter_id,measured_on,age_days,weight_kg,length_cm,head_cm,muac_cm,lying,edema,notes,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(patientId, encId, on, age, m.weight_kg, m.length_cm, m.head_cm, m.muac_cm, lying, edema ? 1 : 0, text(input.notes), user.id).lastInsertRowid);
  return { id, ...res };
}
function voidMeasurement(db, id, reason) {
  const r = db.prepare('SELECT * FROM growth_measurements WHERE id=? AND voided=0').get(id); if (!r) throw new HttpError(404, 'Measurement not found');
  const why = text(reason, 200); if (why.length < 3) throw new HttpError(400, 'A reason is required');
  db.prepare('UPDATE growth_measurements SET voided=1, void_reason=? WHERE id=?').run(why, id); return r;
}
const withResults = (p, r) => ({ ...r, edema: !!r.edema, result: growth.compute({ sex: p.sex, dob: p.dob, measured_on: r.measured_on, weight_kg: r.weight_kg, length_cm: r.length_cm, head_cm: r.head_cm, muac_cm: r.muac_cm, lying: r.lying == null ? null : !!r.lying, edema: !!r.edema }) });
function measurements(db, p) {
  const rows = db.prepare('SELECT * FROM growth_measurements WHERE patient_id=? AND voided=0 ORDER BY measured_on, id').all(p.id).map((r) => withResults(p, r));
  rows.forEach((r, i) => { // trend flags compare with the measurement before
    const prev = rows[i - 1]; r.trend = [];
    if (!prev) return; const days = diffDays(r.measured_on, prev.measured_on);
    if (days >= 7 && r.weight_kg != null && prev.weight_kg != null && r.weight_kg < prev.weight_kg) r.trend.push({ code: 'weight_loss', level: 'warn' });
    if (days >= 28 && r.result.z.waz != null && prev.result.z.waz != null && r.result.z.waz - prev.result.z.waz <= -1) r.trend.push({ code: 'waz_falling', level: 'warn' });
  });
  return rows.reverse(); // newest first
}

/* ---- charts ---- */
const INDICATORS = { wfa: ['Age (months)', 'Weight (kg)'], hfa: ['Age (months)', 'Length / height (cm)'], bfa: ['Age (months)', 'BMI'], hcfa: ['Age (months)', 'Head circumference (cm)'], wfh: ['Length / height (cm)', 'Weight (kg)'] };
function curves(db, p, indicator) {
  if (!INDICATORS[indicator]) throw new HttpError(400, 'Unknown chart');
  if (p.sex !== 'M' && p.sex !== 'F') throw new HttpError(400, 'Growth charts need the registered sex to be female or male');
  const pts = measurements(db, p).slice().reverse();
  const ageM = (r) => r.age_days / growth.DAYS_PER_MONTH; const young = diffDays(todayStr(), p.dob) / growth.DAYS_PER_MONTH < 24;
  const rows = []; let points = [];
  if (indicator === 'wfh') {
    const ind = young ? 'wfl' : 'wfh', [lo, hi] = growth.curveRange(ind, p.sex);
    for (let x = lo; x <= hi; x += 1) rows.push({ x, ...growth.curveAt(ind, p.sex, x) });
    points = pts.filter((r) => r.weight_kg != null && r.result.height_used != null && ageM(r) <= 60).map((r) => ({ x: r.result.height_used, y: r.weight_kg, date: r.measured_on }));
  } else {
    for (let m = 0; m <= 60; m += 1) {
      const ind = { wfa: 'wfa', hcfa: 'hcfa', hfa: m < 24 ? 'lhfa_l' : 'lhfa_h', bfa: m < 24 ? 'bfa_l' : 'bfa_h' }[indicator];
      rows.push({ x: m, ...growth.curveAt(ind, p.sex, m) });
    }
    const pick = { wfa: (r) => r.weight_kg, hfa: (r) => r.result.height_used, bfa: (r) => r.result.bmi, hcfa: (r) => r.head_cm }[indicator];
    points = pts.filter((r) => pick(r) != null && ageM(r) <= 60).map((r) => ({ x: Math.round(ageM(r) * 100) / 100, y: pick(r), date: r.measured_on }));
  }
  return { sex: p.sex, indicator, x_label: INDICATORS[indicator][0], y_label: INDICATORS[indicator][1], curves: rows, points };
}

/* ---- overview and registers ---- */
function overview(db, p) {
  const ageDays = diffDays(todayStr(), p.dob);
  if (ageDays > MAX_CHILD_DAYS) return { is_child: false };
  const out = { is_child: true, age_days: ageDays, age_months: Math.round((ageDays / growth.DAYS_PER_MONTH) * 10) / 10, sex: p.sex };
  out.immunization = ageDays <= 6 * 365 ? imm.overview(db, p) : null; // the schedule covers routine childhood doses; catch-up beyond early childhood is not modelled
  const list = measurements(db, p); out.growth = { measurements: list, latest: list[0] || null };
  return out;
}
const NUTRITION_CODES = ['sam', 'sam_muac', 'sam_edema', 'mam', 'mam_muac', 'stunted', 'stunted_severe', 'underweight', 'underweight_severe', 'overweight', 'obese'];
function nutritionRegister(db, today = todayStr()) {
  const kids = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE voided=0 AND dob>? AND dob<=?').all(addDays(today, -1826), today);
  const out = [];
  for (const k of kids) {
    const last = db.prepare('SELECT * FROM growth_measurements WHERE patient_id=? AND voided=0 ORDER BY measured_on DESC, id DESC LIMIT 1').get(k.id); if (!last) continue;
    const r = withResults(k, last); const flags = r.result.flags.filter((f) => NUTRITION_CODES.includes(f.code)); if (!flags.length) continue;
    out.push({ patient: { id: k.id, mrn: k.mrn, name_en: k.restricted ? null : k.name_en, dob: k.dob, restricted: !!k.restricted }, measured_on: last.measured_on, days_ago: diffDays(today, last.measured_on), flags, level: growth.worst(flags),
      z: r.result.z, muac_cm: last.muac_cm, weight_kg: last.weight_kg });
  }
  return out.sort((a, b) => ((b.level === 'critical') - (a.level === 'critical')) || (a.measured_on < b.measured_on ? 1 : -1));
}
module.exports = { addMeasurement, voidMeasurement, measurements, curves, overview, nutritionRegister, patientRow, INDICATORS, NUTRITION_CODES };
