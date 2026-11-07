'use strict';
const { HttpError } = require('./encounters');
const I = require('./indicators');
const U = require('./report_utils');
const { validDate, diffDays, today: todayStr } = require('./maternal');

const SENSITIVE_DX = ['B24']; // HIV disease: shown as a total only, with small numbers hidden
const col = (key, label) => ({ key, label });
const INDICATOR_COLS = [col('label', 'Indicator'), col('value', 'Value'), col('definition', 'Definition')];
const all = (db, sql, ...a) => db.prepare(sql).all(...a).map((r) => ({ ...r })); // plain objects (the database returns null-prototype ones)

function checkPeriod(from, to) {
  if (!validDate(from) || !validDate(to)) throw new HttpError(400, 'Choose a start and an end date', { field: 'from' });
  if (diffDays(to, from) < 0) throw new HttpError(400, 'The end date is before the start date', { field: 'to' });
  if (diffDays(to, from) > 366) throw new HttpError(400, 'The period can be at most one year', { field: 'to' });
}
// An indicator table; hidden numbers of sensitive indicators become "<5"
function indSection(db, title, pick, from, to, mask, withCode) {
  const list = I.INDICATORS.filter((x) => (typeof pick === 'string' ? x.group === pick : pick.includes(x.code)));
  const order = typeof pick === 'string' ? list : pick.map((c) => I.BY_CODE[c]);
  const rows = order.map((x) => { const r = I.run(db, x.code, from, to, { mask }); return { code: x.code, label: x.label, value: r.denominator == null && typeof r.value === 'number' ? r.value : r.text, definition: x.definition + (x.sensitive ? ' (Sensitive: counts of 1 to 4 are hidden.)' : '') }; });
  return { title, columns: withCode ? [col('code', 'Code'), ...INDICATOR_COLS] : INDICATOR_COLS, rows };
}
const sexCols = (r) => ({ female: r.f, male: r.m, other: r.o });

const REPORTS = {
  morbidity: { title: 'Morbidity: diagnoses by age and sex', run(db, from, to, { mask, allDx }) {
    const ag = U.ageGroupSql('e.visit_date', 'p.dob');
    const rows = all(db, `SELECT x.code, i.name, COUNT(*) total, SUM(x.sex='F') f, SUM(x.sex='M') m, SUM(x.sex='O') o,
      SUM(x.g='u1') a1, SUM(x.g='1_4') a2, SUM(x.g='5_14') a3, SUM(x.g='15_24') a4, SUM(x.g='25_49') a5, SUM(x.g='50p') a6
      FROM (SELECT code, sex, ${U.ageGroupOfDays('days')} g FROM (SELECT d.code code, p.sex sex, (julianday(e.visit_date)-julianday(p.dob)) days FROM diagnoses d JOIN encounters e ON e.id=d.encounter_id JOIN patients p ON p.id=e.patient_id
      WHERE e.status='signed' AND e.visit_date BETWEEN ? AND ? ${allDx ? '' : "AND d.kind='primary'"})) x JOIN icd10 i ON i.code=x.code GROUP BY x.code ORDER BY total DESC, x.code`, from, to).map((r) => {
      if (SENSITIVE_DX.includes(r.code)) return { code: r.code, diagnosis: r.name + ' (sensitive: total only)', total: mask ? U.suppress(r.total) : r.total };
      return { code: r.code, diagnosis: r.name, total: r.total, female: r.f, male: r.m, other: r.o, u1: r.a1, a1_4: r.a2, a5_14: r.a3, a15_24: r.a4, a25_49: r.a5, a50p: r.a6 };
    });
    return [{ title: allDx ? 'All recorded diagnoses' : 'Main (primary) diagnosis of each signed visit', columns: [col('code', 'ICD-10'), col('diagnosis', 'Diagnosis'), col('total', 'Total'), col('female', 'Female'), col('male', 'Male'), col('other', 'Other'), ...U.AGE_GROUPS.map(([k, l]) => col(k === 'u1' ? 'u1' : 'a' + k, l))], rows,
      notes: ['Counts visits with a signed diagnosis in the period. A person seen twice counts twice. Age is the age on the visit date. The list of ICD-10 codes is a draft subset.'] }];
  } },
  workload: { title: 'Clinic workload', run(db, from, to, { mask }) {
    const ag = U.ageGroupSql('e.visit_date', 'p.dob');
    return [indSection(db, 'Summary', 'activity', from, to, mask),
      { title: 'Visits per day', columns: [col('date', 'Date'), col('visits', 'Signed visits')], rows: all(db, "SELECT visit_date date, COUNT(*) visits FROM encounters WHERE status='signed' AND visit_date BETWEEN ? AND ? GROUP BY visit_date ORDER BY visit_date", from, to) },
      { title: 'Visits by type', columns: [col('type', 'Visit type'), col('visits', 'Signed visits')], rows: all(db, "SELECT type, COUNT(*) visits FROM encounters WHERE status='signed' AND visit_date BETWEEN ? AND ? GROUP BY type ORDER BY visits DESC", from, to) },
      { title: 'Visits by age and sex', columns: [col('age', 'Age group'), col('female', 'Female'), col('male', 'Male'), col('other', 'Other'), col('total', 'Total')],
        rows: (() => { // one pass over the visits, not one per age group
          const by = Object.fromEntries(all(db, `SELECT g, COUNT(*) t, SUM(sex='F') f, SUM(sex='M') m, SUM(sex='O') o FROM (SELECT ${U.ageGroupOfDays('days')} g, sex FROM (SELECT (julianday(e.visit_date)-julianday(p.dob)) days, p.sex sex FROM encounters e JOIN patients p ON p.id=e.patient_id WHERE e.status='signed' AND e.visit_date BETWEEN ? AND ?)) GROUP BY g`, from, to).map((r) => [r.g, r]));
          return U.AGE_GROUPS.map(([k, l]) => { const r = by[k] || { t: 0, f: 0, m: 0, o: 0 }; return { age: l, ...sexCols(r), total: r.t }; });
        })() }];
  } },
  maternal: { title: 'Maternal health and family planning', run(db, from, to, { mask }) {
    return [indSection(db, 'Indicators', 'maternal', from, to, mask),
      { title: 'Deliveries by mode and place', columns: [col('mode', 'Mode'), col('place', 'Place'), col('count', 'Deliveries')], rows: all(db, 'SELECT mode, place, COUNT(*) count FROM deliveries WHERE delivered_on BETWEEN ? AND ? GROUP BY mode, place ORDER BY count DESC', from, to) },
      { title: 'Family planning by method', columns: [col('method', 'Method'), col('visits', 'Visits'), col('started', 'Started')], rows: all(db, "SELECT method, COUNT(*) visits, SUM(action='start') started FROM family_planning WHERE visit_date BETWEEN ? AND ? AND method!='none' GROUP BY method ORDER BY visits DESC", from, to) }];
  } },
  child: { title: 'Child health: vaccines, growth and nutrition', run(db, from, to, { mask }) {
    return [indSection(db, 'Indicators', 'child', from, to, mask),
      { title: 'Vaccine doses given', columns: [col('vaccine', 'Vaccine'), col('dose', 'Dose'), col('count', 'Valid doses given')], rows: all(db, "SELECT v.name vaccine, i.dose_no dose, COUNT(*) count FROM immunizations i JOIN vaccines v ON v.code=i.vaccine_code WHERE i.voided=0 AND i.valid=1 AND i.given_on BETWEEN ? AND ? GROUP BY i.vaccine_code, i.dose_no ORDER BY v.name, i.dose_no", from, to) }];
  } },
  programmes: { title: 'Programmes: TB, HIV, malaria, malnutrition and chronic disease', run(db, from, to, { mask }) {
    const m = (program, n) => (program === 'hiv' && mask ? U.suppress(n) : n);
    return [indSection(db, 'Indicators', 'programme', from, to, mask),
      { title: 'Records by programme', columns: [col('program', 'Programme'), col('new', 'Enrolled in the period'), col('active', 'In care at the end')], rows: ['tb', 'hiv', 'malaria', 'nutrition', 'chronic'].map((p) => ({ program: p,
        new: m(p, db.prepare('SELECT COUNT(*) c FROM program_enrolments WHERE program=? AND enrolled_on BETWEEN ? AND ?').get(p, from, to).c), active: m(p, db.prepare("SELECT COUNT(*) c FROM program_enrolments e WHERE e.program=? AND e.enrolled_on<=? AND (e.status='active' OR e.outcome_on>?)").get(p, to, to).c) })) },
      { title: 'Outcomes of records closed in the period', columns: [col('program', 'Programme'), col('outcome', 'Outcome'), col('count', 'Count')], rows: all(db, "SELECT program, outcome, COUNT(*) count FROM program_enrolments WHERE status='closed' AND outcome_on BETWEEN ? AND ? GROUP BY program, outcome ORDER BY program, count DESC", from, to).map((r) => ({ ...r, count: m(r.program, r.count) })),
        notes: ['HIV counts of 1 to 4 are hidden. Outcomes are counted in the period they were recorded, not as a treatment cohort.'] }];
  } },
  lab: { title: 'Laboratory', run(db, from, to, { mask }) {
    const rows = all(db, "SELECT t.name, t.sensitive, COUNT(*) resulted, SUM(o.result_flag IN ('abnormal','critical')) abnormal FROM lab_orders o JOIN lab_tests t ON t.id=o.test_id WHERE o.status='resulted' AND date(o.resulted_at) BETWEEN ? AND ? GROUP BY t.id ORDER BY resulted DESC", from, to)
      .map((r) => (r.sensitive ? { test: r.name + ' (sensitive: total only)', resulted: mask ? U.suppress(r.resulted) : r.resulted } : { test: r.name, resulted: r.resulted, abnormal: r.abnormal, percent: r.resulted ? Math.round((r.abnormal / r.resulted) * 1000) / 10 : null }));
    return [indSection(db, 'Indicators', 'lab', from, to, mask), { title: 'Tests resulted', columns: [col('test', 'Test'), col('resulted', 'Resulted'), col('abnormal', 'Abnormal or critical'), col('percent', '% abnormal')], rows }];
  } },
  pharmacy: { title: 'Pharmacy, stock and blood bank', run(db, from, to, { mask }) {
    const stock = all(db, "SELECT d.name||' '||d.strength||' '||d.form drug, d.reorder_level reorder, COALESCE((SELECT SUM(qty_on_hand) FROM stock_batches b WHERE b.drug_id=d.id AND b.expiry>=date('now')),0) usable, COALESCE((SELECT SUM(qty_on_hand) FROM stock_batches b WHERE b.drug_id=d.id AND b.expiry<date('now')),0) expired FROM drugs d WHERE d.active=1 ORDER BY d.name, d.strength").map((r) => ({ ...r, status: r.usable <= r.reorder ? 'Low or out of stock' : 'OK' }));
    return [indSection(db, 'Indicators', 'pharmacy', from, to, mask),
      { title: 'Medicines dispensed', columns: [col('drug', 'Medicine'), col('quantity', 'Units dispensed'), col('prescriptions', 'Prescriptions')], rows: all(db, "SELECT d.name||' '||d.strength||' '||d.form drug, SUM(x.qty) quantity, COUNT(DISTINCT x.prescription_id) prescriptions FROM dispensing x JOIN prescriptions p ON p.id=x.prescription_id JOIN drugs d ON d.id=p.drug_id WHERE date(x.at) BETWEEN ? AND ? GROUP BY d.id ORDER BY quantity DESC LIMIT 60", from, to) },
      { title: 'Medicine stock today (a snapshot, not the period)', columns: [col('drug', 'Medicine'), col('usable', 'In stock (in date)'), col('expired', 'Expired'), col('reorder', 'Reorder level'), col('status', 'Status')], rows: stock }];
  } },
  inpatient: { title: 'Inpatient care and procedures', run(db, from, to, { mask }) {
    return [indSection(db, 'Indicators', 'inpatient', from, to, mask),
      { title: 'How stays ended', columns: [col('type', 'Outcome'), col('count', 'Admissions')], rows: all(db, "SELECT discharge_type type, COUNT(*) count FROM admissions WHERE status='discharged' AND date(discharged_at) BETWEEN ? AND ? GROUP BY discharge_type ORDER BY count DESC", from, to).map((r) => ({ ...r, count: r.type === 'died' && mask ? U.suppress(r.count) : r.count })) },
      { title: 'Procedures by type', columns: [col('name', 'Procedure'), col('count', 'Done')], rows: all(db, 'SELECT t.name, COUNT(*) count FROM procedures p JOIN procedure_types t ON t.code=p.type_code WHERE p.voided=0 AND p.performed_on BETWEEN ? AND ? GROUP BY t.code ORDER BY count DESC', from, to) }];
  } },
  referrals: { title: 'Referrals', run(db, from, to, { mask }) {
    return [indSection(db, 'Indicators', 'referral', from, to, mask),
      { title: 'By destination', columns: [col('destination', 'Destination'), col('total', 'Referrals'), col('urgent', 'Urgent or emergency'), col('replied', 'Reply received'), col('open', 'Still open')], rows: all(db, "SELECT destination_name destination, COUNT(*) total, SUM(urgency!='routine') urgent, SUM(status='completed') replied, SUM(status IN ('open','attended')) open FROM referrals WHERE date(created_at) BETWEEN ? AND ? AND status!='cancelled' GROUP BY destination_name ORDER BY total DESC", from, to) }];
  } },
  dataquality: { title: 'Data quality checks', run(db) {
    const n = (sql) => db.prepare(sql).get().c; const total = n('SELECT COUNT(*) c FROM patients WHERE voided=0');
    const checks = [['Patients registered', total, total, 'All patients that are not voided.'], ['Patients with an estimated date of birth', n('SELECT COUNT(*) c FROM patients WHERE voided=0 AND dob_estimated=1'), total, 'Estimated ages make age-based reports less exact.'],
      ['Patients with no village or address', n("SELECT COUNT(*) c FROM patients WHERE voided=0 AND (village IS NULL OR village='')"), total, 'Needed to find patients who need follow-up.'],
      ['Possible duplicate patients', n('SELECT COUNT(*) c FROM (SELECT 1 FROM patients WHERE voided=0 GROUP BY lower(name_en), dob HAVING COUNT(*)>1)'), total, 'Groups of patients with the same name and date of birth. Check and correct the registration.'],
      ['Visits left unsigned for over 2 days', n("SELECT COUNT(*) c FROM encounters WHERE status IN ('waiting','triaged','in_consult') AND visit_date<date('now','-2 day')"), n("SELECT COUNT(*) c FROM encounters WHERE status!='cancelled'"), 'Visits that were never finished: they are missing from every report.'],
      ['Laboratory tests waiting over 2 days', n("SELECT COUNT(*) c FROM lab_orders WHERE status IN ('ordered','collected') AND ordered_at<datetime('now','-2 day')"), n("SELECT COUNT(*) c FROM lab_orders WHERE status!='cancelled'"), 'Tests ordered but not resulted.'],
      ['Prescriptions waiting over 2 days', n("SELECT COUNT(*) c FROM prescriptions WHERE status IN ('prescribed','partial') AND prescribed_at<datetime('now','-2 day')"), n("SELECT COUNT(*) c FROM prescriptions WHERE status!='cancelled'"), 'Medicines prescribed but not (fully) dispensed.'],
      ['Signed visits without vital signs', n("SELECT COUNT(*) c FROM encounters e WHERE e.status='signed' AND NOT EXISTS (SELECT 1 FROM vitals v WHERE v.encounter_id=e.id)"), n("SELECT COUNT(*) c FROM encounters WHERE status='signed'"), 'Triage may have been skipped.']];
    return [{ title: 'Checks on the data as it is today', columns: [col('check', 'Check'), col('count', 'Count'), col('of', 'Out of'), col('percent', '%'), col('why', 'Why it matters')], rows: checks.map(([check, count, of, why]) => ({ check, count, of, percent: of ? Math.round((count / of) * 1000) / 10 : null, why })), notes: ['These checks look at all the data as it is today and ignore the period you chose.'] }];
  } },
};
// Donor report templates: fixed lists of indicators. Drafts to agree with each donor.
const TEMPLATES = {
  monthly_activity: { title: 'Monthly clinic activity report (donor template, draft)', indicators: ['opd_visits', 'opd_new_patients', 'opd_visits_u5', 'anc_bookings', 'anc_visits_total', 'anc_4plus', 'deliveries', 'live_births', 'low_birth_weight', 'immunization_doses', 'penta3_doses', 'mr1_doses', 'malaria_cases', 'malaria_rdt_positivity', 'tb_cases', 'nutrition_admissions', 'referrals_out', 'admissions', 'discharges', 'procedures_total', 'hiv_new'] },
  quarterly_programme: { title: 'Quarterly programme report (donor template, draft)', indicators: ['tb_cases', 'tb_confirmed', 'tb_success', 'tb_lost', 'malaria_cases', 'malaria_falciparum', 'malaria_severe', 'nutrition_admissions', 'nutrition_cured', 'nutrition_defaulted', 'sam_prevalence', 'stunting_prevalence', 'underweight_prevalence', 'penta3_coverage', 'mr1_coverage', 'ncd_hypertension', 'ncd_diabetes', 'hypertension_controlled', 'hiv_new', 'hiv_active', 'hiv_on_art', 'hiv_vl_suppressed', 'avg_length_of_stay', 'bed_occupancy'] },
};
const catalog = () => [...Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, kind: 'report' })), ...Object.entries(TEMPLATES).map(([key, t]) => ({ key, title: t.title, kind: 'template' }))];
function run(db, key, from, to, opts) {
  checkPeriod(from, to); const mask = !!opts.mask; let sections, title;
  if (REPORTS[key]) { title = REPORTS[key].title; sections = REPORTS[key].run(db, from, to, { mask, allDx: !!opts.allDx }); }
  else if (TEMPLATES[key]) { title = TEMPLATES[key].title; sections = [indSection(db, 'Indicators', TEMPLATES[key].indicators, from, to, mask, true)]; }
  else throw new HttpError(404, 'Unknown report');
  const meta = [`Period: ${from} to ${to}`, `Prepared: ${todayStr()}`, 'Clinic EMR prototype. Demo or draft data unless stated otherwise. Aggregate numbers only.' + (mask ? ' Counts of 1 to 4 for sensitive indicators are shown as <5.' : '')];
  return { key, title, from, to, masked: mask, meta, sections };
}
module.exports = { REPORTS, TEMPLATES, catalog, run, checkPeriod };
