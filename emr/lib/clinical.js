'use strict';
// DRAFT clinical rules. Thresholds are common reference values (WHO / PALS style) kept simple on purpose.
// They MUST be reviewed and approved by the clinic's clinicians before real use.

const LIMITS = { // hard limits for data-entry sanity (reject impossible values)
  temp: [30, 45], sys: [40, 300], dia: [20, 200], pulse: [20, 300], rr: [4, 100],
  spo2: [30, 100], weight: [0.3, 400], height: [20, 260], muac: [3, 60],
};
const FIELDS = Object.keys(LIMITS);

function ageInMonths(dob, onDate = new Date()) {
  const d = new Date(dob + 'T00:00:00Z'), n = new Date(onDate);
  let m = (n.getUTCFullYear() - d.getUTCFullYear()) * 12 + (n.getUTCMonth() - d.getUTCMonth());
  if (n.getUTCDate() < d.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

// Returns { values, errors } where values has numbers or null.
function parseVitals(input) {
  const values = {}, errors = {};
  for (const f of FIELDS) {
    const raw = input[f];
    if (raw === undefined || raw === null || raw === '') { values[f] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { errors[f] = 'not_a_number'; continue; }
    if (n < LIMITS[f][0] || n > LIMITS[f][1]) { errors[f] = 'out_of_range'; continue; }
    values[f] = n;
  }
  if (values.sys != null && values.dia != null && values.dia >= values.sys) errors.dia = 'dia_not_below_sys';
  return { values, errors };
}

function bmi(v) {
  if (v.weight == null || v.height == null) return null;
  const m = v.height / 100; return Math.round((v.weight / (m * m)) * 10) / 10;
}

// flags: [{ field, level: 'warn'|'critical', code }]  (codes map to translated text in the UI)
function flagVitals(v, ageMonths) {
  const f = []; const add = (field, level, code) => f.push({ field, level, code });
  const adult = ageMonths >= 144; // 12 years and over
  if (v.temp != null) { if (v.temp >= 39.5) add('temp', 'critical', 'high_fever'); else if (v.temp >= 38) add('temp', 'warn', 'fever'); else if (v.temp < 35.5) add('temp', 'warn', 'low_temp'); }
  if (v.spo2 != null) { if (v.spo2 < 90) add('spo2', 'critical', 'spo2_critical'); else if (v.spo2 < 94) add('spo2', 'warn', 'spo2_low'); }
  if (adult) {
    if (v.sys != null || v.dia != null) {
      if ((v.sys ?? 0) >= 180 || (v.dia ?? 0) >= 120) add('sys', 'critical', 'bp_severe');
      else if ((v.sys ?? 0) >= 140 || (v.dia ?? 0) >= 90) add('sys', 'warn', 'bp_high');
      else if (v.sys != null && v.sys < 90) add('sys', 'warn', 'bp_low');
    }
    if (v.pulse != null) { if (v.pulse > 100) add('pulse', 'warn', 'tachycardia'); else if (v.pulse < 50) add('pulse', 'warn', 'bradycardia'); }
    if (v.rr != null) { if (v.rr > 30) add('rr', 'critical', 'rr_very_fast'); else if (v.rr > 20) add('rr', 'warn', 'rr_fast'); else if (v.rr < 10) add('rr', 'warn', 'rr_slow'); }
    const b = bmi(v); if (b != null) { if (b < 18.5) add('weight', 'warn', 'underweight'); else if (b >= 30) add('weight', 'warn', 'obese'); }
  } else {
    if (v.rr != null) { // WHO fast-breathing cut-offs
      const cut = ageMonths < 2 ? 60 : ageMonths < 12 ? 50 : 40;
      if (v.rr >= cut) add('rr', 'warn', 'rr_fast_child');
    }
    if (v.pulse != null) {
      const [lo, hi] = ageMonths < 12 ? [100, 160] : ageMonths < 72 ? [70, 140] : [60, 120];
      if (v.pulse > hi) add('pulse', 'warn', 'tachycardia'); else if (v.pulse < lo) add('pulse', 'warn', 'bradycardia');
    }
    if (v.muac != null && ageMonths >= 6 && ageMonths < 60) { if (v.muac < 11.5) add('muac', 'critical', 'muac_sam'); else if (v.muac < 12.5) add('muac', 'warn', 'muac_mam'); }
  }
  return f;
}

module.exports = { LIMITS, FIELDS, ageInMonths, parseVitals, flagVitals, bmi };
