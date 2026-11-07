'use strict';
// WHO Child Growth Standards (2006) z-scores for children aged 0-60 months, using the LMS method.
// Tables: lib/who_tables.json (see tools/build_who_tables.py for the source). Age tables are by completed month, so L, M and S are
// linearly interpolated for ages between months (an approximation: WHO software uses daily tables). Classification rules are DRAFT and
// must be approved by the clinic's clinicians. No standard is included for children over 5 years.
const TABLES = require('./who_tables.json').tables;
const DAY = 86400000;
const DAYS_PER_MONTH = 30.4375;
const round2 = (v) => Math.round(v * 100) / 100;

function lms(ind, sex, x) {
  const rows = (TABLES[ind] || {})[sex]; if (!rows) return null;
  if (!(x >= rows[0][0] && x <= rows[rows.length - 1][0])) return null;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= x) lo = mid; else hi = mid; }
  const a = rows[lo], b = rows[hi]; const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
  return { L: a[1] + (b[1] - a[1]) * t, M: a[2] + (b[2] - a[2]) * t, S: a[3] + (b[3] - a[3]) * t };
}
const valueAtZ = ({ L, M, S }, z) => (L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L));
const rawZ = (v, { L, M, S }) => (L === 0 ? Math.log(v / M) / S : (Math.pow(v / M, L) - 1) / (L * S));

// z-score of a value at x (age in months, or length/height in cm). weightBased = apply WHO's adjustment beyond +/-3 SD.
function zscore(ind, sex, x, value, weightBased) {
  const p = lms(ind, sex, x); if (!p || !(value > 0)) return null;
  let z = rawZ(value, p);
  if (weightBased && Math.abs(z) > 3) {
    const s3p = valueAtZ(p, 3), s2p = valueAtZ(p, 2), s3n = valueAtZ(p, -3), s2n = valueAtZ(p, -2);
    z = z > 0 ? 3 + (value - s3p) / (s3p - s2p) : -3 + (value - s3n) / (s2n - s3n);
  }
  return round2(z);
}
// Reference curve values (for charts) at x
const curveAt = (ind, sex, x) => { const p = lms(ind, sex, x); return p ? Object.fromEntries([-3, -2, 0, 2, 3].map((z) => [z, valueAtZ(p, z)])) : null; };
const curveRange = (ind, sex) => { const r = TABLES[ind][sex]; return [r[0][0], r[r.length - 1][0]]; };

const diffDays = (a, b) => Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / DAY);
const ageMonthsOn = (dob, on) => diffDays(on, dob) / DAYS_PER_MONTH;

// m: { sex, dob, measured_on, weight_kg, length_cm, head_cm, muac_cm, lying, edema }
function compute(m) {
  const ageDays = diffDays(m.measured_on, m.dob), ageM = ageDays / DAYS_PER_MONTH;
  const out = { age_days: ageDays, age_months: Math.round(ageM * 10) / 10, z: { waz: null, haz: null, whz: null, baz: null, hcz: null }, bmi: null, height_used: null, flags: [] };
  const add = (code, level) => out.flags.push({ code, level });
  const sex = m.sex === 'M' || m.sex === 'F' ? m.sex : null;
  const under5 = ageM <= 60;
  let h = m.length_cm != null ? Number(m.length_cm) : null;
  if (h != null) { // WHO: standing measurement under 24 months is 0.7 cm shorter than lying; lying measurement from 24 months is 0.7 cm longer
    const lying = m.lying == null ? ageM < 24 : !!m.lying;
    if (ageM < 24 && !lying) h += 0.7; else if (ageM >= 24 && lying) h -= 0.7;
    out.height_used = Math.round(h * 10) / 10;
  }
  if (!sex) add('sex_unspecified', 'info'); else if (!under5) add('no_standard_over_5y', 'info');
  if (sex && under5) {
    const young = ageM < 24;
    if (m.weight_kg != null) out.z.waz = zscore('wfa', sex, ageM, m.weight_kg, true);
    if (h != null) out.z.haz = zscore(young ? 'lhfa_l' : 'lhfa_h', sex, ageM, h, false);
    if (m.weight_kg != null && h != null) {
      out.z.whz = zscore(young ? 'wfl' : 'wfh', sex, h, m.weight_kg, true);
      if (out.z.whz == null) add('height_out_of_range', 'info');
      out.bmi = Math.round((m.weight_kg / ((h / 100) ** 2)) * 10) / 10;
      out.z.baz = zscore(young ? 'bfa_l' : 'bfa_h', sex, ageM, out.bmi, true);
    }
    if (m.head_cm != null) out.z.hcz = zscore('hcfa', sex, ageM, m.head_cm, false);
    const { waz, haz, whz, baz } = out.z;
    if (waz != null && (waz < -6 || waz > 5)) add('implausible_waz', 'warn');
    if (haz != null && (haz < -6 || haz > 6)) add('implausible_haz', 'warn');
    if (whz != null && (whz < -5 || whz > 5)) add('implausible_whz', 'warn');
    if (baz != null && (baz < -5 || baz > 5)) add('implausible_baz', 'warn');
    if (haz != null) { if (haz < -3) add('stunted_severe', 'warn'); else if (haz < -2) add('stunted', 'warn'); }
    if (waz != null) { if (waz < -3) add('underweight_severe', 'warn'); else if (waz < -2) add('underweight', 'warn'); }
    const wh = whz != null ? whz : baz; // weight-for-height, or BMI-for-age if height is outside the table
    if (whz != null && whz < -3) add('sam', 'critical'); else if (whz != null && whz < -2) add('mam', 'warn');
    if (wh != null) { if (wh > 3) add('obese', 'warn'); else if (wh > 2) add('overweight', 'warn'); }
  }
  if (ageM >= 6 && ageM < 60 && m.muac_cm != null) { if (m.muac_cm < 11.5) add('sam_muac', 'critical'); else if (m.muac_cm < 12.5) add('mam_muac', 'warn'); }
  if (m.edema) add('sam_edema', 'critical'); // bilateral pitting oedema means severe acute malnutrition whatever the measurements
  return out;
}
const worst = (flags) => (flags.some((f) => f.level === 'critical') ? 'critical' : flags.some((f) => f.level === 'warn') ? 'warn' : null);

module.exports = { zscore, compute, worst, curveAt, curveRange, lms, valueAtZ, ageMonthsOn, diffDays, DAYS_PER_MONTH, TABLES };
