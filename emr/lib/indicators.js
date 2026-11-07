'use strict';
// Every number in a report comes from an indicator defined here, with its written definition, so a donor can see exactly what was counted.
// DRAFT: definitions follow common health-information practice but must be agreed with the clinic and each donor.
const growth = require('./growth');
const { suppress } = require('./report_utils');
const { addDays, diffDays } = require('./maternal');

const one = (db, sql, ...a) => { const r = db.prepare(sql).get(...a); return r ? Object.values(r)[0] || 0 : 0; };
const AGE_DAYS = (to) => `(julianday(${to})-julianday(p.dob))`;
const REGISTERED_AT_END = (to) => `(e.enrolled_on<='${to}' AND (e.status='active' OR e.outcome_on>'${to}'))`;
const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

const L = []; // registry
const add = (code, group, label, definition, compute, sensitive = false) => L.push({ code, group, label, definition, compute, sensitive });

/* ---- activity ---- */
add('opd_visits', 'activity', 'Clinic visits (signed)', 'Visits that were signed by a clinician with a visit date in the period. Cancelled and unsigned visits are not counted.', (db, f, t) => one(db, "SELECT COUNT(*) FROM encounters WHERE status='signed' AND visit_date BETWEEN ? AND ?", f, t));
add('opd_visits_u5', 'activity', 'Clinic visits by children under 5', 'Signed visits where the patient was under 5 years old on the visit date.', (db, f, t) => one(db, "SELECT COUNT(*) FROM encounters e JOIN patients p ON p.id=e.patient_id WHERE e.status='signed' AND e.visit_date BETWEEN ? AND ? AND (julianday(e.visit_date)-julianday(p.dob))<1826.25", f, t));
add('opd_new_patients', 'activity', 'New patients', 'Patients whose first-ever clinic visit (not cancelled) falls in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM (SELECT patient_id, MIN(visit_date) m FROM encounters WHERE status!='cancelled' GROUP BY patient_id) WHERE m BETWEEN ? AND ?", f, t));
/* ---- maternal ---- */
add('anc_bookings', 'maternal', 'Antenatal bookings', 'Pregnancy records created in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM anc_episodes WHERE date(booked_at) BETWEEN ? AND ?', f, t));
add('anc_visits_total', 'maternal', 'Antenatal visits', 'Antenatal visits recorded with a visit date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM anc_visits WHERE visit_date BETWEEN ? AND ?', f, t));
add('anc_4plus', 'maternal', 'Women with 4 or more antenatal visits', 'Numerator: pregnancies with at least 4 antenatal visits in total. Denominator: pregnancies with at least one antenatal visit in the period (only pregnancies seen in the period are counted).', (db, f, t) => ({
  value: one(db, 'SELECT COUNT(*) FROM anc_episodes e WHERE (SELECT COUNT(*) FROM anc_visits v WHERE v.episode_id=e.id)>=4 AND EXISTS (SELECT 1 FROM anc_visits v WHERE v.episode_id=e.id AND v.visit_date BETWEEN ? AND ?)', f, t),
  denominator: one(db, 'SELECT COUNT(*) FROM anc_episodes e WHERE EXISTS (SELECT 1 FROM anc_visits v WHERE v.episode_id=e.id AND v.visit_date BETWEEN ? AND ?)', f, t) }));
add('anc_high_risk', 'maternal', 'High-risk pregnancies booked', "Pregnancy records created in the period with at least one risk factor (including age under 18, 35 or over, and 5 or more births).", (db, f, t) => one(db, "SELECT COUNT(*) FROM anc_episodes WHERE date(booked_at) BETWEEN ? AND ? AND risk_factors!='[]'", f, t));
add('deliveries', 'maternal', 'Deliveries', 'Deliveries recorded with a delivery date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM deliveries WHERE delivered_on BETWEEN ? AND ?', f, t));
add('deliveries_clinic', 'maternal', 'Deliveries at the clinic', 'Deliveries in the period where the place of delivery was the clinic.', (db, f, t) => one(db, "SELECT COUNT(*) FROM deliveries WHERE delivered_on BETWEEN ? AND ? AND place='clinic'", f, t));
add('deliveries_caesarean', 'maternal', 'Caesarean deliveries', 'Deliveries in the period by caesarean section.', (db, f, t) => one(db, "SELECT COUNT(*) FROM deliveries WHERE delivered_on BETWEEN ? AND ? AND mode='caesarean'", f, t));
add('live_births', 'maternal', 'Live births', 'Babies born alive in deliveries recorded in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM newborns n JOIN deliveries d ON d.id=n.delivery_id WHERE d.delivered_on BETWEEN ? AND ? AND n.outcome='live'", f, t));
add('stillbirths', 'maternal', 'Stillbirths', 'Babies born without signs of life (fresh or macerated) in deliveries recorded in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM newborns n JOIN deliveries d ON d.id=n.delivery_id WHERE d.delivered_on BETWEEN ? AND ? AND n.outcome!='live'", f, t));
add('low_birth_weight', 'maternal', 'Low birth weight (under 2500 g)', 'Numerator: live births under 2500 g. Denominator: live births in the period with a birth weight.', (db, f, t) => ({
  value: one(db, "SELECT COUNT(*) FROM newborns n JOIN deliveries d ON d.id=n.delivery_id WHERE d.delivered_on BETWEEN ? AND ? AND n.outcome='live' AND n.birth_weight_g<2500", f, t),
  denominator: one(db, "SELECT COUNT(*) FROM newborns n JOIN deliveries d ON d.id=n.delivery_id WHERE d.delivered_on BETWEEN ? AND ? AND n.outcome='live' AND n.birth_weight_g IS NOT NULL", f, t) }));
add('preterm_births', 'maternal', 'Preterm live births (before 37 weeks)', 'Numerator: live births at under 37 completed weeks (259 days). Denominator: all live births in the period.', (db, f, t) => ({
  value: one(db, "SELECT COUNT(*) FROM newborns n JOIN deliveries d ON d.id=n.delivery_id WHERE d.delivered_on BETWEEN ? AND ? AND n.outcome='live' AND d.ga_days<259", f, t),
  denominator: one(db, "SELECT COUNT(*) FROM newborns n JOIN deliveries d ON d.id=n.delivery_id WHERE d.delivered_on BETWEEN ? AND ? AND n.outcome='live'", f, t) }));
add('pph_cases', 'maternal', 'Postpartum haemorrhage', 'Deliveries in the period with blood loss of 500 ml or more, or a recorded PPH complication.', (db, f, t) => one(db, "SELECT COUNT(*) FROM deliveries WHERE delivered_on BETWEEN ? AND ? AND (blood_loss_ml>=500 OR complications LIKE '%\"pph\"%')", f, t));
add('maternal_deaths', 'maternal', 'Maternal deaths recorded at delivery', 'Deliveries in the period where the mother\'s outcome was recorded as died. Deaths outside the delivery record are not captured here.', (db, f, t) => one(db, "SELECT COUNT(*) FROM deliveries WHERE delivered_on BETWEEN ? AND ? AND maternal_outcome='died'", f, t), true);
add('pnc_visits', 'maternal', 'Postnatal visits', 'Postnatal visits recorded with a visit date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM postnatal_visits WHERE visit_date BETWEEN ? AND ?', f, t));
add('fp_visits', 'maternal', 'Family planning visits', 'Family planning visits recorded in the period (all actions).', (db, f, t) => one(db, 'SELECT COUNT(*) FROM family_planning WHERE visit_date BETWEEN ? AND ?', f, t));
add('fp_new_acceptors', 'maternal', 'Family planning: methods started', "Family planning visits in the period where a method (not 'none') was started.", (db, f, t) => one(db, "SELECT COUNT(*) FROM family_planning WHERE visit_date BETWEEN ? AND ? AND action='start' AND method!='none'", f, t));
/* ---- child health ---- */
add('immunization_doses', 'child', 'Vaccine doses given', 'Valid vaccine doses (not removed, not marked invalid) with a date given in the period, including birth doses and doses entered from vaccination cards.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM immunizations WHERE voided=0 AND valid=1 AND given_on BETWEEN ? AND ?', f, t));
add('penta3_doses', 'child', 'Pentavalent dose 3 given', 'Valid third pentavalent doses with a date given in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM immunizations WHERE voided=0 AND valid=1 AND vaccine_code='PENTA' AND dose_no=3 AND given_on BETWEEN ? AND ?", f, t));
add('mr1_doses', 'child', 'Measles-containing vaccine dose 1 given', 'Valid first measles-containing doses with a date given in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM immunizations WHERE voided=0 AND valid=1 AND vaccine_code='MR' AND dose_no=1 AND given_on BETWEEN ? AND ?", f, t));
const coverage = (code, dose, label) => add(code, 'child', label, `Among the clinic's REGISTERED children aged 12 to 23 months on the last day of the period: the percentage with a valid ${dose}. This is coverage among registered patients, not the whole community.`, (db, f, t) => {
  const kids = db.prepare('SELECT id FROM patients p WHERE p.voided=0 AND (julianday(?)-julianday(p.dob)) BETWEEN 365 AND 729.99').all(t); const [v, n] = code === 'penta3_coverage' ? ['PENTA', 3] : ['MR', 1];
  const has = db.prepare("SELECT COUNT(*) c FROM immunizations WHERE patient_id=? AND voided=0 AND valid=1 AND vaccine_code=? AND dose_no=? AND given_on<=?"); return { value: kids.filter((k) => has.get(k.id, v, n, t).c > 0).length, denominator: kids.length };
});
coverage('penta3_coverage', 'third pentavalent dose', 'Pentavalent 3 coverage (registered children 12-23 months)'); coverage('mr1_coverage', 'first measles-containing dose', 'Measles dose 1 coverage (registered children 12-23 months)');
add('growth_measurements', 'child', 'Growth measurements recorded', 'Growth measurements (not removed) with a measurement date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM growth_measurements WHERE voided=0 AND measured_on BETWEEN ? AND ?', f, t));
// Prevalence among children under 5 measured in the period, using each child's latest measurement in the period
const prevalence = (code, label, code2s) => add(code, 'child', label, `Among children under 5 with a growth measurement in the period (latest measurement per child): the percentage with ${label.toLowerCase().replace(' (children under 5)', '')}. WHO Child Growth Standards 2006.`, (db, f, t) => {
  const rows = db.prepare(`SELECT g.*, p.sex, p.dob FROM growth_measurements g JOIN patients p ON p.id=g.patient_id WHERE g.voided=0 AND g.measured_on BETWEEN ? AND ? AND (julianday(g.measured_on)-julianday(p.dob))<=1826 ORDER BY g.measured_on, g.id`).all(f, t);
  const latest = {}; for (const r of rows) latest[r.patient_id] = r; let v = 0, d = 0;
  for (const r of Object.values(latest)) { const res = growth.compute({ sex: r.sex, dob: r.dob, measured_on: r.measured_on, weight_kg: r.weight_kg, length_cm: r.length_cm, head_cm: r.head_cm, muac_cm: r.muac_cm, lying: r.lying == null ? null : !!r.lying, edema: !!r.edema }); d += 1; if (res.flags.some((x) => code2s.includes(x.code))) v += 1; }
  return { value: v, denominator: d };
});
prevalence('sam_prevalence', 'Severe acute malnutrition (children under 5)', ['sam', 'sam_muac', 'sam_edema']); prevalence('stunting_prevalence', 'Stunting (children under 5)', ['stunted', 'stunted_severe']); prevalence('underweight_prevalence', 'Underweight (children under 5)', ['underweight', 'underweight_severe']);
add('nutrition_admissions', 'child', 'Malnutrition programme admissions', 'Children enrolled in the malnutrition (SAM or MAM) programme with an enrolment date in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='nutrition' AND enrolled_on BETWEEN ? AND ?", f, t));
add('nutrition_cured', 'child', 'Malnutrition programme: cured', "Malnutrition programme records closed as 'cured' with a closing date in the period. Denominator: all malnutrition records closed in the period.", (db, f, t) => ({ value: one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='nutrition' AND outcome='cured' AND outcome_on BETWEEN ? AND ?", f, t), denominator: one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='nutrition' AND status='closed' AND outcome_on BETWEEN ? AND ?", f, t) }));
add('nutrition_defaulted', 'child', 'Malnutrition programme: defaulted', "Malnutrition programme records closed as 'defaulted' with a closing date in the period.", (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='nutrition' AND outcome='defaulted' AND outcome_on BETWEEN ? AND ?", f, t));
/* ---- programmes ---- */
add('tb_cases', 'programme', 'TB cases enrolled', 'People enrolled in the TB programme with an enrolment date in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='tb' AND enrolled_on BETWEEN ? AND ?", f, t));
add('tb_confirmed', 'programme', 'TB cases bacteriologically confirmed', 'TB cases enrolled in the period recorded as bacteriologically confirmed.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='tb' AND enrolled_on BETWEEN ? AND ? AND json_extract(details,'$.bacteriologically_confirmed')=1", f, t));
add('tb_success', 'programme', 'TB treatment success', "TB records closed as 'cured' or 'treatment completed' with a closing date in the period. Denominator: all TB records closed in the period. Note: this counts outcomes in the period, not a cohort of people who started treatment together.", (db, f, t) => ({ value: one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='tb' AND outcome IN ('cured','treatment_completed') AND outcome_on BETWEEN ? AND ?", f, t), denominator: one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='tb' AND status='closed' AND outcome_on BETWEEN ? AND ?", f, t) }));
add('tb_lost', 'programme', 'TB: lost to follow-up', "TB records closed as 'lost to follow-up' with a closing date in the period.", (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='tb' AND outcome='lost_to_follow_up' AND outcome_on BETWEEN ? AND ?", f, t));
add('tb_died', 'programme', 'TB: died', "TB records closed as 'died' with a closing date in the period.", (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='tb' AND outcome='died' AND outcome_on BETWEEN ? AND ?", f, t), true);
add('malaria_cases', 'programme', 'Malaria cases registered', 'People registered in the malaria programme with an enrolment date in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='malaria' AND enrolled_on BETWEEN ? AND ?", f, t));
add('malaria_falciparum', 'programme', 'Malaria cases: P. falciparum (including mixed)', 'Malaria cases registered in the period with species P. falciparum or mixed P. falciparum and P. vivax.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='malaria' AND enrolled_on BETWEEN ? AND ? AND json_extract(details,'$.species') IN ('pf','pf_pv')", f, t));
add('malaria_severe', 'programme', 'Severe malaria cases', 'Malaria cases registered in the period recorded as severe.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='malaria' AND enrolled_on BETWEEN ? AND ? AND json_extract(details,'$.severity')='severe'", f, t));
add('hiv_new', 'programme', 'HIV programme: new enrolments', 'People enrolled in the HIV programme with an enrolment date in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM program_enrolments WHERE program='hiv' AND enrolled_on BETWEEN ? AND ?", f, t), true);
add('hiv_active', 'programme', 'HIV programme: in care at the end of the period', 'People enrolled on or before the last day of the period who were still in the programme on that day.', (db, f, t) => one(db, `SELECT COUNT(*) FROM program_enrolments e WHERE e.program='hiv' AND ${REGISTERED_AT_END(t)}`), true);
add('hiv_on_art', 'programme', 'HIV programme: on ART at the end of the period', 'People in care at the end of the period with an ART start date on or before that day. Denominator: people in care.', (db, f, t) => ({
  value: one(db, `SELECT COUNT(*) FROM program_enrolments e WHERE e.program='hiv' AND ${REGISTERED_AT_END(t)} AND json_extract(e.details,'$.art_start_on') IS NOT NULL AND json_extract(e.details,'$.art_start_on')<='${t}'`), denominator: one(db, `SELECT COUNT(*) FROM program_enrolments e WHERE e.program='hiv' AND ${REGISTERED_AT_END(t)}`) }), true);
add('hiv_vl_suppressed', 'programme', 'HIV programme: viral load suppressed (under 1000)', 'Among people in care at the end of the period who had a viral load result in the previous 12 months: the share whose latest result was under 1000 copies/mL.', (db, f, t) => {
  const from12 = addDays(t, -365); let v = 0, d = 0;
  for (const e of db.prepare(`SELECT e.id FROM program_enrolments e WHERE e.program='hiv' AND ${REGISTERED_AT_END(t)}`).all()) {
    const vis = db.prepare('SELECT visit_date, data FROM program_visits WHERE enrolment_id=? AND visit_date BETWEEN ? AND ? ORDER BY visit_date, id').all(e.id, from12, t).map((x) => ({ d: x.visit_date, vl: parse(x.data).viral_load })).filter((x) => x.vl != null);
    if (vis.length) { d += 1; if (vis[vis.length - 1].vl < 1000) v += 1; }
  }
  return { value: v, denominator: d };
}, true);
for (const c of ['hypertension', 'diabetes', 'asthma', 'epilepsy']) add('ncd_' + c, 'programme', `Chronic disease in care: ${c}`, `People with ${c} enrolled on or before the last day of the period and still in care on that day.`, (db, f, t) => one(db, `SELECT COUNT(*) FROM program_enrolments e WHERE e.program='chronic' AND e.condition='${c}' AND ${REGISTERED_AT_END(t)}`));
add('hypertension_controlled', 'programme', 'Hypertension controlled', 'Among people in care for hypertension at the end of the period with a visit in the previous 180 days: the share whose latest blood pressure was under 140/90.', (db, f, t) => {
  let v = 0, d = 0; const from = addDays(t, -180);
  for (const e of db.prepare(`SELECT e.id FROM program_enrolments e WHERE e.program='chronic' AND e.condition='hypertension' AND ${REGISTERED_AT_END(t)}`).all()) {
    const x = db.prepare('SELECT data FROM program_visits WHERE enrolment_id=? AND visit_date BETWEEN ? AND ? ORDER BY visit_date DESC, id DESC LIMIT 1').get(e.id, from, t); const data = x ? parse(x.data) : null;
    if (data && data.sys != null) { d += 1; if (data.sys < 140 && data.dia < 90) v += 1; }
  }
  return { value: v, denominator: d };
});
/* ---- laboratory ---- */
add('lab_tests_resulted', 'lab', 'Laboratory tests resulted', 'Laboratory tests with a result entered in the period (all tests).', (db, f, t) => one(db, "SELECT COUNT(*) FROM lab_orders WHERE status='resulted' AND date(resulted_at) BETWEEN ? AND ?", f, t));
add('malaria_rdt_positivity', 'lab', 'Malaria rapid test positivity', "Numerator: malaria rapid tests resulted in the period with a positive species result. Denominator: all malaria rapid tests with a valid (not 'invalid') result.", (db, f, t) => ({
  value: one(db, "SELECT COUNT(*) FROM lab_orders o JOIN lab_tests x ON x.id=o.test_id WHERE x.code='MAL_RDT' AND o.status='resulted' AND date(o.resulted_at) BETWEEN ? AND ? AND o.result_flag='abnormal'", f, t),
  denominator: one(db, "SELECT COUNT(*) FROM lab_orders o JOIN lab_tests x ON x.id=o.test_id WHERE x.code='MAL_RDT' AND o.status='resulted' AND date(o.resulted_at) BETWEEN ? AND ? AND o.result_flag IN ('normal','abnormal')", f, t) }));
add('hiv_tests', 'lab', 'HIV screening tests done', 'HIV rapid tests resulted in the period (any result).', (db, f, t) => one(db, "SELECT COUNT(*) FROM lab_orders o JOIN lab_tests x ON x.id=o.test_id WHERE x.code='HIV_RDT' AND o.status='resulted' AND date(o.resulted_at) BETWEEN ? AND ?", f, t), true);
add('hiv_reactive', 'lab', 'HIV screening tests reactive', 'HIV rapid tests resulted in the period with a reactive screening result (not a confirmed diagnosis). Denominator: valid HIV tests.', (db, f, t) => ({
  value: one(db, "SELECT COUNT(*) FROM lab_orders o JOIN lab_tests x ON x.id=o.test_id WHERE x.code='HIV_RDT' AND o.status='resulted' AND date(o.resulted_at) BETWEEN ? AND ? AND o.result_flag='abnormal'", f, t),
  denominator: one(db, "SELECT COUNT(*) FROM lab_orders o JOIN lab_tests x ON x.id=o.test_id WHERE x.code='HIV_RDT' AND o.status='resulted' AND date(o.resulted_at) BETWEEN ? AND ? AND o.result_flag IN ('normal','abnormal')", f, t) }), true);
/* ---- pharmacy and blood ---- */
add('rx_dispensed', 'pharmacy', 'Prescriptions dispensed', 'Prescriptions with at least one dispensing in the period (a partly dispensed prescription counts once).', (db, f, t) => one(db, 'SELECT COUNT(DISTINCT prescription_id) FROM dispensing WHERE date(at) BETWEEN ? AND ?', f, t));
add('stock_below_reorder_now', 'pharmacy', 'Medicines below reorder level (today)', 'Medicines in the list whose in-date stock today is at or below the reorder level. A snapshot of today, not of the period.', (db) => one(db, "SELECT COUNT(*) FROM drugs d WHERE d.active=1 AND COALESCE((SELECT SUM(qty_on_hand) FROM stock_batches b WHERE b.drug_id=d.id AND b.expiry>=date('now')),0)<=d.reorder_level"));
add('blood_units_registered', 'pharmacy', 'Blood units registered', 'Blood units registered in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM blood_units WHERE date(registered_at) BETWEEN ? AND ?', f, t));
add('blood_units_screen_discarded', 'pharmacy', 'Blood units discarded after screening', 'Units registered in the period that were discarded because a screening test was reactive.', (db, f, t) => one(db, "SELECT COUNT(*) FROM blood_units WHERE date(registered_at) BETWEEN ? AND ? AND discard_code='screening_reactive'", f, t), true);
add('transfusions', 'pharmacy', 'Transfusions given', 'Transfusions recorded with a start date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM transfusions WHERE substr(started_at,1,10) BETWEEN ? AND ?', f, t));
add('transfusion_reactions', 'pharmacy', 'Transfusion reactions', 'Transfusions in the period with a mild or severe reaction recorded. Denominator: transfusions in the period.', (db, f, t) => ({ value: one(db, "SELECT COUNT(*) FROM transfusions WHERE substr(started_at,1,10) BETWEEN ? AND ? AND reaction!='none'", f, t), denominator: one(db, 'SELECT COUNT(*) FROM transfusions WHERE substr(started_at,1,10) BETWEEN ? AND ?', f, t) }));
/* ---- inpatient and procedures ---- */
add('admissions', 'inpatient', 'Admissions', 'Patients admitted to a bed with an admission date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM admissions WHERE date(admitted_at) BETWEEN ? AND ?', f, t));
add('discharges', 'inpatient', 'Discharges (all outcomes)', 'Admissions that ended in the period (discharged, referred, transferred, left without notice or died).', (db, f, t) => one(db, "SELECT COUNT(*) FROM admissions WHERE status='discharged' AND date(discharged_at) BETWEEN ? AND ?", f, t));
add('inpatient_deaths', 'inpatient', 'Deaths in hospital', 'Admissions that ended in death in the period.', (db, f, t) => one(db, "SELECT COUNT(*) FROM admissions WHERE discharge_type='died' AND date(discharged_at) BETWEEN ? AND ?", f, t), true);
add('avg_length_of_stay', 'inpatient', 'Average length of stay (days)', 'Average number of calendar days in hospital for admissions that ended in the period (same-day discharge counts as 0).', (db, f, t) => { const r = db.prepare("SELECT AVG(julianday(date(discharged_at))-julianday(date(admitted_at))) a FROM admissions WHERE status='discharged' AND date(discharged_at) BETWEEN ? AND ?").get(f, t); return r.a == null ? 0 : Math.round(r.a * 10) / 10; });
add('bed_occupancy', 'inpatient', 'Bed occupancy', "Occupied bed-days in the period divided by available bed-days (beds in service today multiplied by the days in the period). A bed-day is a night; the discharge day is not counted. Uses today's number of beds in service.", (db, f, t) => {
  const days = diffDays(t, f) + 1; const beds = one(db, "SELECT COUNT(*) FROM beds WHERE status='active'"); let used = 0;
  for (const a of db.prepare('SELECT date(admitted_at) s, date(discharged_at) e FROM admissions').all()) { const start = a.s > f ? a.s : f; const endEx = a.e ? (a.e < addDays(t, 1) ? a.e : addDays(t, 1)) : addDays(t, 1); used += Math.max(0, diffDays(endEx, start)); }
  return { value: used, denominator: beds * days };
});
add('procedures_total', 'inpatient', 'Procedures recorded', 'Procedures (not voided) with a procedure date in the period.', (db, f, t) => one(db, 'SELECT COUNT(*) FROM procedures WHERE voided=0 AND performed_on BETWEEN ? AND ?', f, t));
add('major_surgery', 'inpatient', 'Surgical procedures', 'Procedures in the period of a type marked as surgical (major surgery, minor surgery, caesarean, evacuation, chest drain).', (db, f, t) => one(db, 'SELECT COUNT(*) FROM procedures p JOIN procedure_types t ON t.code=p.type_code WHERE p.voided=0 AND t.surgical=1 AND p.performed_on BETWEEN ? AND ?', f, t));
/* ---- referrals ---- */
add('referrals_out', 'referral', 'Referrals written', 'Referrals written in the period (cancelled referrals not counted).', (db, f, t) => one(db, "SELECT COUNT(*) FROM referrals WHERE date(created_at) BETWEEN ? AND ? AND status!='cancelled'", f, t));
add('referrals_replied', 'referral', 'Referrals with a reply received', 'Numerator: referrals written in the period that now have a reply recorded. Denominator: referrals written in the period (not cancelled).', (db, f, t) => ({ value: one(db, "SELECT COUNT(*) FROM referrals WHERE date(created_at) BETWEEN ? AND ? AND status='completed'", f, t), denominator: one(db, "SELECT COUNT(*) FROM referrals WHERE date(created_at) BETWEEN ? AND ? AND status!='cancelled'", f, t) }));

const BY_CODE = Object.fromEntries(L.map((x) => [x.code, x]));
// Run one indicator. mask: hide small numbers of sensitive indicators. Returns { code, label, definition, sensitive, value, denominator, percent, text }
function run(db, code, from, to, { mask }) {
  const ind = BY_CODE[code]; const r = ind.compute(db, from, to); const hasDen = typeof r === 'object'; let value = hasDen ? r.value : r; const den = hasDen ? r.denominator : null; const show = (n) => (ind.sensitive && mask ? suppress(n) : n);
  const percent = hasDen ? pct(value, den) : null; const pv = show(value), pd = den == null ? null : show(den);
  const hide = ind.sensitive && mask && (typeof pv === 'string' || typeof pd === 'string'); // never show a percentage that could reveal a small number
  const text = hasDen ? `${pv} / ${pd}${!hide && percent != null ? ` (${percent}%)` : ''}` : String(pv);
  return { code, group: ind.group, label: ind.label, definition: ind.definition, sensitive: ind.sensitive, value: hide ? pv : value, denominator: hide ? pd : den, percent: hide ? null : percent, text };
}
module.exports = { INDICATORS: L, BY_CODE, run, pct };
