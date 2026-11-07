'use strict';
// DRAFT programme rules (TB, HIV, malaria, malnutrition, chronic disease) in the style of WHO guidance, kept simple on purpose.
// Every threshold and interval here MUST be reviewed and approved by the clinic's clinicians and national programme guidelines.
// Pure functions only (no database), so each rule is unit-tested.
const { addDays, diffDays } = require('./maternal');

const LOST_AFTER = { tb: 60, hiv: 90, malaria: 56, nutrition: 28, chronic: 180 }; // days overdue before "lost to follow-up" is suggested
const SOON = 7; // days before the due date that count as "due soon"

function initialNextDue(program, d, enrolledOn) {
  if (program === 'tb') return addDays(enrolledOn, 14);
  if (program === 'hiv') return addDays(enrolledOn, 28);
  if (program === 'malaria') return addDays(d.treatment_start || enrolledOn, 3);
  if (program === 'nutrition') return addDays(enrolledOn, d.type === 'sam' ? 7 : 14);
  return addDays(enrolledOn, 28);
}
const last = (a) => a[a.length - 1];
const withVal = (v, k) => v.filter((x) => x.data[k] != null);

function lastVl(visits) { const x = last(withVal(visits, 'viral_load')); return x ? { value: x.data.viral_load, date: x.visit_date } : null; }

// evaluate: schedule items, alert flags, and the default next due date. visits are ascending by date.
function evaluate(program, enrol, visits, today) {
  const d = enrol.details || {}, flags = [], schedule = []; const seen = new Set();
  const add = (code, level) => { if (!seen.has(code)) { seen.add(code); flags.push({ code, level }); } };
  const lv = last(visits); let interval = null; // days until the next visit if the clinician does not choose a date

  if (program === 'tb') {
    const start = d.treatment_start, planned = d.planned_months || 6;
    if (d.site === 'pulmonary') {
      const smears = visits.filter((x) => x.data.smear_result && x.data.smear_result !== 'not_done');
      for (const [key, days] of [['month2', 60], ['month5', 150], ['end_of_treatment', planned * 30]]) {
        const dueOn = addDays(start, days), done = smears.find((s) => s.data.smear_for === key);
        const state = done ? 'done' : diffDays(today, dueOn) > 30 ? 'overdue' : diffDays(today, dueOn) >= -SOON ? 'due' : 'upcoming';
        schedule.push({ key, due_on: dueOn, state, result: done ? done.data.smear_result : null, done_on: done ? done.visit_date : null });
        if (state === 'overdue') add('tb_smear_overdue', 'warn');
        if (done && done.data.smear_result !== 'neg') { if (key === 'month2') add('tb_smear_positive_m2', 'warn'); else add('tb_failure_suspected', 'critical'); }
      }
    }
    if (diffDays(addDays(start, planned * 30), today) <= 14) add('tb_end_near', 'warn');
    if (lv && lv.data.adherence === 'many_missed') add('tb_adherence_poor', 'warn');
    const w = withVal(visits, 'weight_kg'); if (w.length >= 2 && last(w).data.weight_kg < w[w.length - 2].data.weight_kg * 0.95) add('weight_loss_5pct', 'warn');
    if (d.hiv_status === 'unknown') add('tb_hiv_unknown', 'warn');
    interval = 30;
  }
  if (program === 'hiv') {
    const vl = lastVl(visits), months = d.art_start_on ? diffDays(today, d.art_start_on) / 30.4375 : null;
    if (!d.art_start_on && d.diagnosed_on && diffDays(today, d.diagnosed_on) >= 14) add('hiv_art_not_started', 'warn');
    if (vl && vl.value >= 1000) add('hiv_vl_unsuppressed', 'critical');
    if (months != null && ((!vl && months >= 6) || (vl && vl.value >= 1000 && diffDays(today, vl.date) >= 90) || (vl && vl.value < 1000 && diffDays(today, vl.date) >= 365))) add('hiv_vl_due', 'warn');
    if (lv && Array.isArray(lv.data.tb_symptoms) && lv.data.tb_symptoms.length) add('hiv_tb_screen_positive', 'warn');
    const cd4 = last(withVal(visits, 'cd4')); if (cd4 && cd4.data.cd4 < 200) add('hiv_advanced', 'warn');
    if (lv && lv.data.adherence === 'many_missed') add('hiv_adherence_poor', 'warn');
    interval = (vl && vl.value >= 1000) || (lv && lv.data.adherence && lv.data.adherence !== 'good') ? 28 : 90;
  }
  if (program === 'malaria') {
    const start = d.treatment_start; const pf = d.species === 'pf' || d.species === 'pf_pv';
    if (d.severity === 'severe') add('malaria_severe', 'critical');
    if (pf && d.pregnant) add('malaria_pf_pregnant', 'warn');
    if (d.primaquine && d.pregnant) add('malaria_primaquine_pregnancy', 'critical');
    if (d.primaquine && d.g6pd === 'deficient') add('malaria_primaquine_g6pd_deficient', 'critical');
    if (d.primaquine && d.g6pd === 'unknown') add('malaria_primaquine_g6pd_unknown', 'warn');
    for (const [key, days] of [['day3', 3], ['day28', 28]]) {
      const dueOn = addDays(start, days), done = visits.find((v) => v.data.follow_up_day === key && v.data.parasite_result && v.data.parasite_result !== 'not_done');
      const state = done ? 'done' : diffDays(today, dueOn) > 7 ? 'overdue' : diffDays(today, dueOn) >= 0 ? 'due' : 'upcoming';
      schedule.push({ key, due_on: dueOn, state, result: done ? done.data.parasite_result : null, done_on: done ? done.visit_date : null });
      if (state === 'overdue') add('malaria_followup_overdue', 'warn');
      if (done && done.data.parasite_result === 'pos') add(key === 'day3' ? 'malaria_day3_positive' : 'malaria_failure_suspected', key === 'day3' ? 'warn' : 'critical');
    }
    interval = 7;
  }
  if (program === 'nutrition') {
    const sam = d.type === 'sam'; const w = withVal(visits, 'weight_kg');
    if (w.length >= 2 && last(w).data.weight_kg < w[w.length - 2].data.weight_kg) add('nut_weight_loss', 'warn');
    if (lv && lv.data.appetite === 'fail') add('nut_appetite_failed', 'critical');
    if (lv && lv.data.edema) add('nut_edema', 'warn');
    if (nutritionDischargeOk(visits)) add('nut_discharge_criteria_met', 'info');
    else if (diffDays(today, enrol.enrolled_on) >= 56 && visits.length >= 2) add('nut_no_response', 'warn');
    interval = sam ? 7 : 14;
  }
  if (program === 'chronic') {
    const c = d.condition; let bad = false;
    if (lv) {
      const v = lv.data;
      if (c === 'hypertension' && v.sys != null) { if (v.sys >= 180 || v.dia >= 110) { add('ncd_bp_severe', 'critical'); bad = true; } else if (v.sys >= 140 || v.dia >= 90) { add('ncd_bp_high', 'warn'); bad = true; } }
      if (c === 'diabetes') {
        const g = v.glucose_mgdl;
        if (g != null) { if (g < 70) { add('ncd_hypoglycaemia', 'critical'); bad = true; } else if (g >= 300) { add('ncd_glucose_very_high', 'critical'); bad = true; } else if ((v.glucose_type === 'fasting' && g > 130) || (v.glucose_type !== 'fasting' && g >= 200)) { add('ncd_glucose_high', 'warn'); bad = true; } }
        if (v.hba1c != null && v.hba1c >= 8) { add('ncd_hba1c_high', 'warn'); bad = true; }
      }
      if (c === 'asthma' && v.asthma_control === 'uncontrolled') { add('ncd_asthma_uncontrolled', 'warn'); bad = true; }
      if (c === 'epilepsy' && v.seizures_since_last >= 1) { add('ncd_seizures', 'warn'); bad = true; }
      if (v.adherence === 'many_missed') add('ncd_adherence_poor', 'warn');
    }
    interval = bad ? 28 : 90;
  }
  const dueOn = enrol.next_due || null;
  const od = dueOn ? diffDays(today, dueOn) : 0;
  const due = { next_due: dueOn, overdue_days: Math.max(0, od), state: !dueOn ? null : od > 0 ? 'overdue' : od >= -SOON ? 'due_soon' : 'ok' };
  if (enrol.status === 'active' && od > LOST_AFTER[program]) add('lost_suggested', 'critical');
  return { schedule, flags, due, default_interval: interval };
}
const defaultNextDue = (program, enrol, visits, today, visitDate) => addDays(visitDate || today, evaluate(program, enrol, visits, visitDate || today).default_interval || 28);

// WHO-style CMAM discharge: the last two visits each show recovery (MUAC 12.5 cm or more, or weight-for-height z of -2 or more) and no oedema
function nutritionDischargeOk(visits) {
  const v = visits.filter((x) => x.data.muac_cm != null || x.data.whz != null).slice(-2); if (v.length < 2) return false;
  return v.every((x) => !x.data.edema && ((x.data.muac_cm != null && x.data.muac_cm >= 12.5) || (x.data.whz != null && x.data.whz >= -2)));
}
// Returns an error message when the data do not support the outcome, otherwise null
function outcomeCheck(program, outcome, enrol, visits) {
  const d = enrol.details || {};
  if (program === 'tb' && outcome === 'cured') {
    if (!d.bacteriologically_confirmed || d.site !== 'pulmonary') return 'cured_needs_confirmed';
    const smears = visits.filter((x) => x.data.smear_result && x.data.smear_result !== 'not_done'); const lastS = last(smears);
    if (!lastS || lastS.data.smear_result !== 'neg' || smears.filter((s) => s.data.smear_result === 'neg').length < 2) return 'cured_needs_negative_smears';
  }
  if (program === 'tb' && outcome === 'treatment_completed' && d.bacteriologically_confirmed && d.site === 'pulmonary') { /* completed is allowed when smears are missing or incomplete */ }
  if (program === 'malaria' && outcome === 'recovered') { const p = last(visits.filter((x) => x.data.parasite_result && x.data.parasite_result !== 'not_done')); if (p && p.data.parasite_result === 'pos') return 'recovered_but_positive'; }
  if (program === 'nutrition' && outcome === 'cured' && !nutritionDischargeOk(visits)) return 'nutrition_cured_needs_criteria';
  return null;
}
const FLAG_CODES = ['tb_smear_overdue', 'tb_smear_positive_m2', 'tb_failure_suspected', 'tb_end_near', 'tb_adherence_poor', 'weight_loss_5pct', 'tb_hiv_unknown', 'hiv_art_not_started', 'hiv_vl_unsuppressed', 'hiv_vl_due', 'hiv_tb_screen_positive', 'hiv_advanced', 'hiv_adherence_poor',
  'malaria_severe', 'malaria_pf_pregnant', 'malaria_primaquine_pregnancy', 'malaria_primaquine_g6pd_deficient', 'malaria_primaquine_g6pd_unknown', 'malaria_followup_overdue', 'malaria_day3_positive', 'malaria_failure_suspected',
  'nut_weight_loss', 'nut_appetite_failed', 'nut_edema', 'nut_discharge_criteria_met', 'nut_no_response', 'ncd_bp_severe', 'ncd_bp_high', 'ncd_hypoglycaemia', 'ncd_glucose_very_high', 'ncd_glucose_high', 'ncd_hba1c_high', 'ncd_asthma_uncontrolled', 'ncd_seizures', 'ncd_adherence_poor', 'lost_suggested'];
module.exports = { evaluate, initialNextDue, defaultNextDue, outcomeCheck, nutritionDischargeOk, LOST_AFTER, SOON, FLAG_CODES };
