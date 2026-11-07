'use strict';
// DRAFT maternal and child health rules, based on widely used WHO-style guidance and kept deliberately simple.
// Every threshold here MUST be reviewed and approved by the clinic's midwives and doctors before real use.
// Pure functions only (no database), so they can be unit-tested.

const DAY = 86400000;
const parseDate = (s) => new Date(s + 'T00:00:00Z');
const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => isoDate(new Date(parseDate(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY); // a - b
const today = () => isoDate(new Date());
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseDate(s)) === s;

/* ---- dates and gestational age ---- */
const eddFromLmp = (lmp) => addDays(lmp, 280); // Naegele's rule
const gaDays = (edd, on = today()) => 280 - diffDays(edd, on); // days of gestation on a date
const gaText = (days) => (days < 0 ? '–' : `${Math.floor(days / 7)}w ${days % 7}d`);
const gaWeeks = (days) => Math.floor(days / 7);
const ageYearsAt = (dob, on = today()) => { const d = parseDate(dob), n = parseDate(on); let a = n.getUTCFullYear() - d.getUTCFullYear(); if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a -= 1; return a; };

// Choose the due date. us = { date, weeks, days } (gestational age found on an ultrasound scan on that date).
// Uncertain LMP: use the scan. Certain LMP: keep LMP unless the scan differs by more than 7 days (scan before 22 weeks).
function chooseEdd({ lmp, lmp_certain, us }) {
  const eddLmp = eddFromLmp(lmp);
  if (!us) return { edd: eddLmp, source: 'lmp', discrepancy_days: 0 };
  const eddUs = addDays(us.date, 280 - (us.weeks * 7 + (us.days || 0)));
  const diff = diffDays(eddUs, eddLmp);
  const scanGa = us.weeks * 7 + (us.days || 0);
  if (!lmp_certain) return { edd: eddUs, source: 'ultrasound', discrepancy_days: diff };
  if (scanGa < 22 * 7 && Math.abs(diff) > 7) return { edd: eddUs, source: 'ultrasound', discrepancy_days: diff };
  return { edd: eddLmp, source: 'lmp', discrepancy_days: diff };
}

/* ---- antenatal ---- */
const DANGER_SIGNS = ['bleeding', 'severe_headache', 'blurred_vision', 'convulsions', 'severe_abdominal_pain', 'fever', 'reduced_fetal_movement', 'leaking_fluid', 'difficulty_breathing', 'severe_pallor', 'swelling_face_hands'];
const RISK_FACTORS = ['age_under_18', 'age_35_plus', 'grand_multipara', 'previous_caesarean', 'previous_stillbirth', 'previous_pph', 'previous_preeclampsia', 'chronic_hypertension', 'diabetes', 'multiple_pregnancy', 'anaemia', 'rh_negative', 'short_birth_interval', 'other_medical'];
const PROTEIN = ['neg', 'trace', '1+', '2+', '3+'];
const PRESENTATIONS = ['cephalic', 'breech', 'transverse', 'unknown'];
const FETAL_MOVEMENT = ['present', 'reduced', 'absent', 'na'];

// Risk factors found from the data (age, parity). The midwife can add others.
function autoRisks({ age, para }) {
  const r = [];
  if (age != null && age < 18) r.push('age_under_18');
  if (age != null && age >= 35) r.push('age_35_plus');
  if (para != null && para >= 5) r.push('grand_multipara');
  return r;
}

function ancAlerts(v, ga) { // v: visit values, ga: gestational days on the visit date
  const a = []; const add = (code, level) => a.push({ code, level }); const wk = gaWeeks(ga);
  for (const s of v.danger_signs || []) add('danger.' + s, 'critical');
  const sys = v.sys, dia = v.dia;
  const hyper = (sys != null && sys >= 140) || (dia != null && dia >= 90);
  const severe = (sys != null && sys >= 160) || (dia != null && dia >= 110);
  const prot = PROTEIN.indexOf(v.urine_protein);
  if (severe) add('bp_severe', 'critical'); else if (hyper) add('bp_high', 'warn');
  if (hyper && prot >= 2 && wk >= 20) add('preeclampsia_suspected', 'critical'); // protein 1+ or more with raised BP after 20 weeks
  else if (prot >= 3) add('proteinuria', 'warn');
  if (v.hb != null) { if (v.hb < 7) add('anaemia_severe', 'critical'); else if (v.hb < 11) add('anaemia', 'warn'); }
  if (wk >= 20) {
    if (v.fetal_movement === 'absent') add('fetal_movement_absent', 'critical'); else if (v.fetal_movement === 'reduced') add('fetal_movement_reduced', 'warn');
    if (v.fhr != null) { if (v.fhr === 0) add('fhr_absent', 'critical'); else if (v.fhr < 110 || v.fhr > 160) add('fhr_abnormal', 'warn'); }
  }
  if (wk >= 24 && v.fundal_height != null && Math.abs(v.fundal_height - wk) > 3) add('fundal_mismatch', 'warn');
  if (wk >= 36 && (v.presentation === 'breech' || v.presentation === 'transverse')) add('malpresentation', 'warn');
  if (v.temp != null && v.temp >= 38) add('fever', 'warn');
  return a;
}
function episodeAlerts(ep, ga, risks) {
  const a = [];
  if (ga >= 42 * 7) a.push({ code: 'post_term_42', level: 'critical' }); else if (ga >= 41 * 7) a.push({ code: 'post_term_41', level: 'warn' });
  if (risks.length) a.push({ code: 'high_risk', level: 'warn' });
  return a;
}

// WHO 8-contact model: recommended contacts at these completed weeks.
const CONTACT_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40];
function nextContact(lastVisitGaDays, currentGaDays) {
  if (lastVisitGaDays == null) return { week: CONTACT_WEEKS[0], overdue: gaWeeks(currentGaDays) > CONTACT_WEEKS[0], first: true };
  const lastWk = gaWeeks(lastVisitGaDays);
  const week = CONTACT_WEEKS.find((w) => w > lastWk);
  if (week == null) return { week: null, overdue: false, done: true };
  return { week, overdue: gaWeeks(currentGaDays) > week };
}

/* ---- delivery, newborn, partograph ---- */
const pphLevel = (ml) => (ml == null ? null : ml >= 1000 ? 'severe' : ml >= 500 ? 'pph' : null);
function newbornAlerts(n, gaDaysAtBirth) {
  const a = []; const add = (code, level) => a.push({ code, level });
  if (n.birth_weight_g != null) { if (n.birth_weight_g < 1500) add('vlbw', 'critical'); else if (n.birth_weight_g < 2500) add('lbw', 'warn'); }
  if (n.apgar5 != null) { if (n.apgar5 < 4) add('apgar_very_low', 'critical'); else if (n.apgar5 < 7) add('apgar_low', 'warn'); }
  if (gaDaysAtBirth != null) { if (gaDaysAtBirth < 32 * 7) add('very_preterm', 'critical'); else if (gaDaysAtBirth < 37 * 7) add('preterm', 'warn'); }
  if (n.resuscitation) add('resuscitated', 'warn');
  return a;
}
const LIQUOR = ['intact', 'clear', 'meconium', 'blood'];
function partographFlags(e) {
  const f = []; const add = (code, level) => f.push({ code, level });
  if (e.fhr != null) { if (e.fhr < 100 || e.fhr > 180) add('fhr_abnormal', 'critical'); else if (e.fhr < 110 || e.fhr > 160) add('fhr_abnormal', 'warn'); }
  if (e.liquor === 'blood') add('liquor_blood', 'critical'); else if (e.liquor === 'meconium') add('liquor_meconium', 'warn');
  if (e.temp != null && e.temp >= 38) add('fever', 'warn');
  if ((e.sys != null && e.sys >= 160) || (e.dia != null && e.dia >= 110)) add('bp_severe', 'critical');
  else if ((e.sys != null && e.sys >= 140) || (e.dia != null && e.dia >= 90)) add('bp_high', 'warn');
  if (e.pulse != null && e.pulse > 120) add('tachycardia', 'warn');
  if (e.cervix_cm != null && e.cervix_cm >= 4 && e.contractions != null) { if (e.contractions < 3) add('contractions_weak', 'warn'); else if (e.contractions > 5) add('contractions_excessive', 'warn'); }
  return f;
}

/* ---- postnatal ---- */
const MOTHER_DANGER = ['heavy_bleeding', 'fever', 'offensive_discharge', 'severe_headache', 'convulsions', 'difficulty_breathing', 'severe_pain', 'low_mood_concern'];
const BABY_DANGER = ['not_feeding', 'convulsions', 'fast_breathing', 'chest_indrawing', 'fever', 'low_temperature', 'severe_jaundice', 'cord_infection', 'lethargic'];
function postnatalAlerts(v) {
  const a = []; const add = (code, level) => a.push({ code, level });
  for (const s of v.mother_danger || []) add('mother.' + s, 'critical');
  for (const s of v.baby_danger || []) add('baby.' + s, 'critical');
  if (v.temp != null && v.temp >= 38) add('fever', 'warn');
  if ((v.sys != null && v.sys >= 140) || (v.dia != null && v.dia >= 90)) add('bp_high', 'warn');
  if (v.bleeding === 'heavy' || v.bleeding === 'offensive') add('bleeding_' + v.bleeding, 'critical');
  if (v.baby_temp != null) { if (v.baby_temp >= 37.5) add('baby_fever', 'critical'); else if (v.baby_temp < 36.5) add('baby_cold', 'critical'); }
  if (v.baby_rr != null && v.baby_rr >= 60) add('baby_fast_breathing', 'critical');
  return a;
}
// WHO-style postnatal contacts: day 0-1, day 3 (2-4), day 7-14, week 6 (days 38-49).
const PNC_WINDOWS = [{ key: 'day1', from: 0, to: 1 }, { key: 'day3', from: 2, to: 4 }, { key: 'day7_14', from: 6, to: 14 }, { key: 'week6', from: 38, to: 49 }];
function pncStatus(deliveryDate, visitDates, on = today()) {
  const d = diffDays(on, deliveryDate); const days = visitDates.map((x) => diffDays(x, deliveryDate));
  return PNC_WINDOWS.map((w) => {
    const done = days.some((x) => x >= w.from && x <= w.to);
    return { key: w.key, done, state: done ? 'done' : d > w.to ? 'missed' : d >= w.from ? 'due' : 'upcoming' };
  });
}

/* ---- family planning ---- */
const FP_METHODS = ['none', 'coc', 'pop', 'injectable', 'implant', 'iud', 'condom', 'sterilization_f', 'lam', 'natural', 'emergency'];
const FP_ACTIONS = ['start', 'continue', 'switch', 'stop', 'counselling'];
const NEEDS_PREG_CHECK = ['coc', 'pop', 'injectable', 'implant', 'iud', 'emergency'];
function fpWarnings({ method, action, sys, dia, daysPostpartum, hasHypertensionProblem }) {
  const w = [];
  if (method === 'coc' && (action === 'start' || action === 'switch' || action === 'continue')) {
    if ((sys != null && sys >= 140) || (dia != null && dia >= 90) || hasHypertensionProblem) w.push('coc_hypertension');
    if (daysPostpartum != null && daysPostpartum < 42) w.push('coc_postpartum');
  }
  return w;
}
const INJECTABLE_DEFAULT_DAYS = 84; // default reminder interval, editable by the clinician

module.exports = { addDays, diffDays, today, validDate, eddFromLmp, gaDays, gaText, gaWeeks, ageYearsAt, chooseEdd, DANGER_SIGNS, RISK_FACTORS, PROTEIN, PRESENTATIONS, FETAL_MOVEMENT, autoRisks, ancAlerts, episodeAlerts,
  CONTACT_WEEKS, nextContact, pphLevel, newbornAlerts, LIQUOR, partographFlags, MOTHER_DANGER, BABY_DANGER, postnatalAlerts, PNC_WINDOWS, pncStatus, FP_METHODS, FP_ACTIONS, NEEDS_PREG_CHECK, fpWarnings, INJECTABLE_DEFAULT_DAYS };
