'use strict';
// Field definitions for each programme. The screens are built from these, so the server and the forms cannot drift apart.
// DRAFT: fields, option lists and ranges must be confirmed against the clinic's own registers and national guidelines.
const e = (key, values, o = {}) => ({ key, type: 'enum', values, ...o });
const i = (key, min, max, o = {}) => ({ key, type: 'int', min, max, ...o });
const n = (key, min, max, o = {}) => ({ key, type: 'num', min, max, ...o });
const d = (key, o = {}) => ({ key, type: 'date', ...o });
const b = (key, o = {}) => ({ key, type: 'bool', ...o });
const x = (key, max = 200, o = {}) => ({ key, type: 'text', max, ...o });
const l = (key, values) => ({ key, type: 'list', values });
const ADH = ['good', 'some_missed', 'many_missed'];

const PROGRAMS = {
  tb: { prefix: 'TB', sensitive: false,
    enrol: [e('tb_type', ['new', 'relapse', 'after_failure', 'after_lost', 'transfer_in', 'other'], { required: true }), e('site', ['pulmonary', 'extrapulmonary'], { required: true }), b('bacteriologically_confirmed'),
      d('treatment_start', { required: true }), i('planned_months', 6, 24, { default: 6 }), x('regimen', 100), e('hiv_status', ['unknown', 'negative', 'positive'], { sensitive: true, default: 'unknown' })],
    visit: [n('weight_kg', 2, 250), e('adherence', ADH), i('doses_missed', 0, 60), e('smear_for', ['month2', 'month5', 'end_of_treatment', 'other']), e('smear_result', ['neg', 'scanty', '1+', '2+', '3+', 'not_done']), x('side_effects', 300)],
    outcomes: ['cured', 'treatment_completed', 'treatment_failed', 'died', 'lost_to_follow_up', 'not_evaluated', 'transferred_out'] },
  hiv: { prefix: 'HIV', sensitive: true,
    enrol: [d('diagnosed_on'), i('who_stage', 1, 4), d('art_start_on'), x('regimen', 100), i('baseline_cd4', 0, 3000), b('pmtct')],
    visit: [n('weight_kg', 2, 250), i('who_stage', 1, 4), e('adherence', ADH), i('viral_load', 0, 10000000), i('cd4', 0, 3000), i('art_months_supplied', 0, 6), l('tb_symptoms', ['cough', 'fever', 'weight_loss', 'night_sweats']), x('notes', 300)],
    outcomes: ['transferred_out', 'died', 'lost_to_follow_up', 'stopped_care'] },
  malaria: { prefix: 'MAL', sensitive: false,
    enrol: [e('species', ['pf', 'pv', 'pf_pv', 'po_pm', 'other'], { required: true }), e('severity', ['uncomplicated', 'severe'], { required: true }), d('treatment_start', { required: true }), x('treatment', 100), b('pregnant'), e('g6pd', ['unknown', 'normal', 'deficient'], { default: 'unknown' }), b('primaquine')],
    visit: [e('follow_up_day', ['day3', 'day28', 'other']), n('temp', 30, 45), e('parasite_result', ['neg', 'pos', 'not_done']), b('symptoms_resolved'), x('notes', 300)],
    outcomes: ['recovered', 'treatment_failure', 'referred', 'died', 'lost_to_follow_up'] },
  nutrition: { prefix: 'NUT', sensitive: false,
    enrol: [e('type', ['sam', 'mam'], { required: true }), n('admission_weight_kg', 0.3, 60), n('admission_muac_cm', 5, 40), b('admission_edema'), e('admission_appetite', ['pass', 'fail'])],
    visit: [n('weight_kg', 0.3, 60), n('length_cm', 20, 140), n('muac_cm', 5, 40), b('edema'), e('appetite', ['pass', 'fail']), i('rutf_sachets', 0, 200), x('notes', 300)],
    outcomes: ['cured', 'non_responder', 'defaulted', 'died', 'referred', 'transferred_out'] },
  chronic: { prefix: 'NCD', sensitive: false,
    enrol: [e('condition', ['hypertension', 'diabetes', 'asthma', 'epilepsy'], { required: true })],
    visit: [n('sys', 40, 300), n('dia', 20, 200), n('glucose_mgdl', 20, 900), e('glucose_type', ['fasting', 'random']), n('hba1c', 3, 20), n('weight_kg', 2, 250), e('adherence', ADH), e('asthma_control', ['controlled', 'partly', 'uncontrolled']), i('seizures_since_last', 0, 100), x('notes', 300)],
    outcomes: ['transferred_out', 'died', 'lost_to_follow_up', 'stopped_treatment'] },
};
const PROGRAM_KEYS = Object.keys(PROGRAMS);
module.exports = { PROGRAMS, PROGRAM_KEYS };
