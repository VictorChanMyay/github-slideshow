'use strict';
const { tx } = require('./db');
const { HttpError, encounterRow } = require('./encounters');
const patients = require('./patients');
const M = require('./maternal');
const imm = require('./immunization');

const text = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const j = (v) => JSON.stringify(v);
const parseJ = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const bool = (v) => (v ? 1 : 0);

// Optional number with a range. Returns null when blank.
function num(v, label, min, max, { int = false } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${label} must be ${int ? 'a whole number ' : 'a number '}from ${min} to ${max}`, { field: label });
  return n;
}
function oneOf(v, list, label, { optional = true } = {}) {
  if (v === undefined || v === null || v === '') { if (optional) return null; throw new HttpError(400, `${label} is required`); }
  if (!list.includes(v)) throw new HttpError(400, `${label} is not a valid option`);
  return v;
}
function subset(v, list, label) {
  const arr = Array.isArray(v) ? v : [];
  for (const x of arr) if (!list.includes(x)) throw new HttpError(400, `${label}: unknown value`);
  return [...new Set(arr)];
}
function bp(input) {
  const sys = num(input.sys, 'Systolic BP', 40, 300), dia = num(input.dia, 'Diastolic BP', 20, 200);
  if (sys != null && dia != null && dia >= sys) throw new HttpError(400, 'Diastolic BP must be lower than systolic');
  return { sys, dia };
}
const patientRow = (db, id) => { const p = db.prepare('SELECT * FROM patients WHERE id=? AND voided=0').get(id); if (!p) throw new HttpError(404, 'Patient not found'); return p; };
const episodeRow = (db, id) => { const e = db.prepare('SELECT * FROM anc_episodes WHERE id=?').get(id); if (!e) throw new HttpError(404, 'Pregnancy record not found'); return e; };
function linkedEncounter(db, encounterId, patientId, { required }) {
  if (encounterId == null || encounterId === '') { if (required) throw new HttpError(400, 'Check the patient in first: a visit is required'); return null; }
  const e = encounterRow(db, Number(encounterId));
  if (e.patient_id !== patientId) throw new HttpError(400, 'That visit belongs to a different patient');
  if (e.status === 'signed' || e.status === 'cancelled') throw new HttpError(409, 'That visit is already closed');
  return e;
}

/* ---- booking ---- */
function book(db, user, patientId, input) {
  const p = patientRow(db, patientId);
  const lmp = text(input.lmp, 10);
  if (!M.validDate(lmp)) throw new HttpError(400, 'LMP must be a valid date (YYYY-MM-DD)', { field: 'lmp' });
  const lmpGa = M.gaDays(M.eddFromLmp(lmp));
  if (lmpGa < 0) throw new HttpError(400, 'LMP is in the future', { field: 'lmp' });
  if (lmpGa > 301) throw new HttpError(400, 'LMP is more than 43 weeks ago. Check the date, or record as a past pregnancy.', { field: 'lmp' });
  if (M.ageYearsAt(p.dob, lmp) < 10) throw new HttpError(400, 'Patient was under 10 years old at the LMP. Check the date of birth.', { field: 'lmp' });
  const gravida = num(input.gravida, 'Gravida', 1, 20, { int: true }), para = num(input.para, 'Para', 0, 19, { int: true });
  if (gravida == null || para == null) throw new HttpError(400, 'Gravida and para are required');
  if (para > gravida - 1) throw new HttpError(400, 'Para cannot be higher than gravida minus one (this pregnancy)');
  const living = num(input.living_children ?? 0, 'Living children', 0, 25, { int: true });
  let us = null;
  if (input.us_date) {
    const date = text(input.us_date, 10);
    if (!M.validDate(date) || M.diffDays(date, M.today()) > 0 || M.diffDays(date, lmp) < 0) throw new HttpError(400, 'Ultrasound date is not valid', { field: 'us_date' });
    us = { date, weeks: num(input.us_weeks, 'Ultrasound weeks', 4, 42, { int: true }), days: num(input.us_days ?? 0, 'Ultrasound days', 0, 6, { int: true }) };
    if (us.weeks == null) throw new HttpError(400, 'Ultrasound gestational weeks are required', { field: 'us_weeks' });
  }
  const chosen = M.chooseEdd({ lmp, lmp_certain: !!input.lmp_certain, us });
  const risks = [...new Set([...subset(input.risk_factors, M.RISK_FACTORS, 'Risk factors'), ...M.autoRisks({ age: M.ageYearsAt(p.dob), para })])];
  try {
    const r = db.prepare(`INSERT INTO anc_episodes(patient_id,lmp,lmp_certain,edd,edd_source,gravida,para,living_children,risk_factors,notes,booked_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(patientId, lmp, bool(input.lmp_certain), chosen.edd, chosen.source, gravida, para, living, j(risks), text(input.notes), user.id);
    return { id: Number(r.lastInsertRowid), edd: chosen.edd, edd_source: chosen.source, discrepancy_days: chosen.discrepancy_days, risks };
  } catch (e) {
    if (/UNIQUE/.test(String(e.message))) { const ex = db.prepare("SELECT id FROM anc_episodes WHERE patient_id=? AND status='active'").get(patientId); throw new HttpError(409, 'This patient already has an active pregnancy record', { episode_id: ex && ex.id }); }
    throw e;
  }
}

/* ---- views ---- */
function lastVisit(db, epId) { return db.prepare('SELECT * FROM anc_visits WHERE episode_id=? ORDER BY visit_date DESC, id DESC').get(epId); }
function summary(db, ep, on = M.today()) {
  const risks = parseJ(ep.risk_factors);
  const ga = ep.status === 'active' ? M.gaDays(ep.edd, on) : null;
  const lv = lastVisit(db, ep.id);
  const alerts = ep.status === 'active' ? M.episodeAlerts(ep, ga, risks) : [];
  let latest = [];
  if (lv && ep.status === 'active') latest = M.ancAlerts(visitValues(lv), lv.ga_days); // old antenatal alerts are not shown once the pregnancy has ended
  const next = ep.status === 'active' ? M.nextContact(lv ? lv.ga_days : null, ga) : null;
  return { id: ep.id, patient_id: ep.patient_id, status: ep.status, lmp: ep.lmp, lmp_certain: !!ep.lmp_certain, edd: ep.edd, edd_source: ep.edd_source, gravida: ep.gravida, para: ep.para, living_children: ep.living_children,
    risks, notes: ep.notes, ga_days: ga, ga_text: ga == null ? null : M.gaText(ga), alerts, latest_visit_alerts: latest, latest_visit_date: lv ? lv.visit_date : null, next_contact: next, closed_reason: ep.closed_reason };
}
const visitValues = (v) => ({ ...v, danger_signs: parseJ(v.danger_signs) });
function visitView(v) { const x = visitValues(v); return { ...x, alerts: M.ancAlerts(x, x.ga_days), ga_text: M.gaText(x.ga_days) }; }
function newbornView(n, deliveryGa) { return { ...n, alerts: M.newbornAlerts(n, deliveryGa) }; }

function getEpisode(db, id) {
  const ep = episodeRow(db, id); const s = summary(db, ep);
  const visits = db.prepare('SELECT * FROM anc_visits WHERE episode_id=? ORDER BY visit_date DESC, id DESC').all(id).map(visitView);
  const d = db.prepare('SELECT * FROM deliveries WHERE episode_id=?').get(id) || null;
  const delivery = d ? { ...d, complications: parseJ(d.complications), ga_text: M.gaText(d.ga_days), pph: M.pphLevel(d.blood_loss_ml),
    newborns: db.prepare('SELECT n.*, p.mrn baby_mrn FROM newborns n LEFT JOIN patients p ON p.id=n.patient_id WHERE delivery_id=? ORDER BY birth_order').all(d.id).map((n) => newbornView(n, d.ga_days)) } : null;
  const partograph = db.prepare('SELECT * FROM partograph_entries WHERE episode_id=? ORDER BY recorded_at, id').all(id).map((e) => ({ ...e, flags: M.partographFlags(e) }));
  const pn = db.prepare('SELECT * FROM postnatal_visits WHERE episode_id=? ORDER BY visit_date DESC, id DESC').all(id).map((v) => { const x = { ...v, mother_danger: parseJ(v.mother_danger), baby_danger: parseJ(v.baby_danger) }; return { ...x, alerts: M.postnatalAlerts(x) }; });
  const pnc = d ? M.pncStatus(d.delivered_on, pn.map((v) => v.visit_date)) : null;
  return { episode: s, visits, delivery, partograph, postnatal: pn, pnc };
}

function overview(db, patientId) {
  const episodes = db.prepare('SELECT * FROM anc_episodes WHERE patient_id=? ORDER BY id DESC').all(patientId).map((e) => {
    const s = summary(db, e); const d = db.prepare('SELECT delivered_on,mode FROM deliveries WHERE episode_id=?').get(e.id);
    return { ...s, delivered_on: d ? d.delivered_on : null, mode: d ? d.mode : null };
  });
  const fp = db.prepare('SELECT * FROM family_planning WHERE patient_id=? ORDER BY visit_date DESC, id DESC LIMIT 20').all(patientId).map((f) => ({ ...f, warnings_acked: parseJ(f.warnings_acked) }));
  return { episodes, family_planning: fp };
}

/* ---- antenatal visit ---- */
function addVisit(db, user, epId, input) {
  const ep = episodeRow(db, epId);
  if (ep.status !== 'active') throw new HttpError(409, 'This pregnancy record is closed');
  const enc = linkedEncounter(db, input.encounter_id, ep.patient_id, { required: true });
  const today = M.today(); const ga = M.gaDays(ep.edd, today);
  const { sys, dia } = bp(input);
  const v = { weight: num(input.weight, 'Weight', 20, 250), sys, dia, temp: num(input.temp, 'Temperature', 30, 45), fundal_height: num(input.fundal_height, 'Fundal height', 5, 50),
    fhr: num(input.fhr, 'Fetal heart rate', 0, 250, { int: true }), presentation: oneOf(input.presentation, M.PRESENTATIONS, 'Presentation'), fetal_movement: oneOf(input.fetal_movement, M.FETAL_MOVEMENT, 'Fetal movement'),
    urine_protein: oneOf(input.urine_protein, M.PROTEIN, 'Urine protein'), hb: num(input.hb, 'Haemoglobin', 2, 20), danger_signs: subset(input.danger_signs, M.DANGER_SIGNS, 'Danger signs') };
  const next = input.next_visit_date ? text(input.next_visit_date, 10) : null;
  if (next && (!M.validDate(next) || M.diffDays(next, today) < 0)) throw new HttpError(400, 'Next visit date must be today or later');
  if (Object.entries(v).every(([k, x]) => (k === 'danger_signs' ? x.length === 0 : x == null)) && !text(input.counselling)) throw new HttpError(400, 'Enter at least one finding');
  let id;
  try {
    id = Number(db.prepare(`INSERT INTO anc_visits(episode_id,encounter_id,visit_date,ga_days,weight,sys,dia,temp,fundal_height,fhr,presentation,fetal_movement,urine_protein,hb,danger_signs,iron_folate,td_vaccine,counselling,next_visit_date,notes,recorded_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(epId, enc.id, today, ga, v.weight, v.sys, v.dia, v.temp, v.fundal_height, v.fhr, v.presentation, v.fetal_movement, v.urine_protein, v.hb, j(v.danger_signs),
      bool(input.iron_folate), bool(input.td_vaccine), text(input.counselling), next, text(input.notes), user.id).lastInsertRowid);
  } catch (e) { if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'An antenatal visit is already recorded for this clinic visit'); throw e; }
  return { id, alerts: M.ancAlerts(v, ga), ga_text: M.gaText(ga) };
}

/* ---- delivery and newborns ---- */
const MODES = ['svd', 'assisted_vacuum', 'assisted_forceps', 'caesarean', 'breech_vaginal'];
const PLACES = ['clinic', 'home', 'other'];
const TEARS = ['none', '1', '2', '3', '4'];
const COMPLICATIONS = ['pph', 'pre_eclampsia', 'eclampsia', 'sepsis', 'obstructed_labour', 'retained_placenta', 'cord_prolapse', 'shoulder_dystocia', 'uterine_rupture', 'other'];
const OUTCOMES = ['live', 'stillbirth_fresh', 'stillbirth_macerated'];
function recordDelivery(db, user, epId, input) {
  const ep = episodeRow(db, epId);
  if (ep.status !== 'active') throw new HttpError(409, 'This pregnancy record is closed or already delivered');
  const mother = patientRow(db, ep.patient_id);
  const on = text(input.delivered_on, 10);
  if (!M.validDate(on) || M.diffDays(on, M.today()) > 0) throw new HttpError(400, 'Delivery date must be a valid date, not in the future', { field: 'delivered_on' });
  const ga = M.gaDays(ep.edd, on);
  if (ga < 20 * 7) throw new HttpError(400, 'Before 20 weeks, close the record as a miscarriage instead of recording a delivery');
  if (ga > 301) throw new HttpError(400, 'Gestation at this date is more than 43 weeks. Check the delivery date and the pregnancy dates.');
  const time = input.delivered_time ? text(input.delivered_time, 5) : null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Time must be HH:MM');
  const mode = oneOf(input.mode, MODES, 'Mode of delivery', { optional: false }), place = oneOf(input.place, PLACES, 'Place of delivery', { optional: false });
  const outcome = oneOf(input.maternal_outcome, ['well', 'referred', 'died'], 'Maternal outcome', { optional: false });
  const referredTo = text(input.referred_to, 100);
  if (outcome === 'referred' && !referredTo) throw new HttpError(400, 'Say where the mother was referred');
  const blood = num(input.blood_loss_ml, 'Blood loss', 0, 10000, { int: true });
  const comps = subset(input.complications, COMPLICATIONS, 'Complications');
  if (M.pphLevel(blood) && !comps.includes('pph')) comps.push('pph'); // blood loss of 500 ml or more is recorded as PPH automatically
  const nbs = Array.isArray(input.newborns) ? input.newborns : [];
  if (nbs.length < 1 || nbs.length > 4) throw new HttpError(400, 'Record 1 to 4 babies');
  const babies = nbs.map((n, i) => {
    const out = oneOf(n.outcome, OUTCOMES, `Baby ${i + 1} outcome`, { optional: false }); const live = out === 'live';
    const sex = live ? oneOf(n.sex, ['F', 'M', 'O'], `Baby ${i + 1} sex`, { optional: false }) : oneOf(n.sex, ['F', 'M', 'O'], `Baby ${i + 1} sex`);
    const w = num(n.birth_weight_g, `Baby ${i + 1} birth weight (g)`, 300, 7000, { int: true });
    if (w == null) throw new HttpError(400, `Baby ${i + 1}: birth weight is required`);
    const a1 = num(n.apgar1, 'APGAR at 1 minute', 0, 10, { int: true }), a5 = num(n.apgar5, 'APGAR at 5 minutes', 0, 10, { int: true });
    if (live && (a1 == null || a5 == null)) throw new HttpError(400, `Baby ${i + 1}: APGAR scores are required for a live birth`);
    return { out, live, sex, w, a1, a5, n };
  });
  return tx(db, () => {
    const d = Number(db.prepare(`INSERT INTO deliveries(episode_id,patient_id,delivered_on,delivered_time,ga_days,mode,place,labour_hours,blood_loss_ml,third_stage,oxytocin,perineal_tear,complications,maternal_outcome,referred_to,notes,recorded_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(epId, ep.patient_id, on, time, ga, mode, place, num(input.labour_hours, 'Labour hours', 0, 72), blood, oneOf(input.third_stage, ['active', 'physiological'], 'Third stage'),
      bool(input.oxytocin), oneOf(input.perineal_tear, TEARS, 'Perineal tear'), j(comps), outcome, referredTo || null, text(input.notes), user.id).lastInsertRowid);
    const liveCount = babies.filter((b) => b.live).length; const out = [];
    babies.forEach((b, i) => {
      let pid = null, mrn = null;
      if (b.live) { const baby = patients.createBaby(db, mother, { sex: b.sex, dob: on, label: nbs.length > 1 ? String.fromCharCode(65 + i) : null }, user); pid = baby.id; mrn = baby.mrn; }
      const n = b.n;
      if (b.live) imm.recordBirthDoses(db, user, pid, on, n); // birth vaccines noted at delivery become immunization records
      const nid = Number(db.prepare(`INSERT INTO newborns(delivery_id,birth_order,outcome,patient_id,sex,birth_weight_g,apgar1,apgar5,resuscitation,breastfed_within_hour,skin_to_skin,vitamin_k,bcg_given,opv0_given,hepb0_given,referred,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d, i + 1, b.out, pid, b.sex, b.w, b.a1, b.a5, bool(n.resuscitation), bool(n.breastfed_within_hour), bool(n.skin_to_skin), bool(n.vitamin_k), bool(n.bcg_given), bool(n.opv0_given), bool(n.hepb0_given), bool(n.referred), text(n.notes)).lastInsertRowid);
      out.push({ id: nid, patient_id: pid, mrn, outcome: b.out, alerts: M.newbornAlerts({ birth_weight_g: b.w, apgar5: b.a5, resuscitation: n.resuscitation }, ga) });
    });
    db.prepare("UPDATE anc_episodes SET status='delivered' WHERE id=?").run(epId);
    return { delivery_id: d, ga_text: M.gaText(ga), pph: M.pphLevel(blood), live_births: liveCount, newborns: out, complications: comps };
  });
}

/* ---- partograph observations ---- */
function addPartograph(db, user, epId, input) {
  const ep = episodeRow(db, epId);
  if (ep.status !== 'active') throw new HttpError(409, 'Labour observations can only be added before the delivery is recorded');
  let at = text(input.recorded_at, 16) || new Date().toISOString().slice(0, 16).replace('T', ' ');
  at = at.replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(at) || !M.validDate(at.slice(0, 10))) throw new HttpError(400, 'Time must be YYYY-MM-DD HH:MM');
  const { sys, dia } = bp(input);
  const e = { cervix_cm: num(input.cervix_cm, 'Cervical dilatation (cm)', 0, 10, { int: true }), descent: num(input.descent, 'Head descent (fifths)', 0, 5, { int: true }), contractions: num(input.contractions, 'Contractions per 10 min', 0, 10, { int: true }),
    fhr: num(input.fhr, 'Fetal heart rate', 0, 250, { int: true }), pulse: num(input.pulse, 'Maternal pulse', 30, 250, { int: true }), sys, dia, temp: num(input.temp, 'Temperature', 30, 45),
    liquor: oneOf(input.liquor, M.LIQUOR, 'Liquor'), moulding: num(input.moulding, 'Moulding', 0, 3, { int: true }) };
  if (Object.values(e).every((x) => x == null)) throw new HttpError(400, 'Enter at least one observation');
  const flags = M.partographFlags(e);
  const prev = db.prepare('SELECT cervix_cm FROM partograph_entries WHERE episode_id=? AND cervix_cm IS NOT NULL AND recorded_at<=? ORDER BY recorded_at DESC, id DESC LIMIT 1').get(epId, at);
  if (e.cervix_cm != null && prev && e.cervix_cm < prev.cervix_cm) flags.push({ code: 'dilatation_decreased', level: 'warn' });
  const id = Number(db.prepare(`INSERT INTO partograph_entries(episode_id,recorded_at,cervix_cm,descent,contractions,fhr,pulse,sys,dia,temp,liquor,moulding,notes,by_user) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(epId, at, e.cervix_cm, e.descent, e.contractions, e.fhr, e.pulse, e.sys, e.dia, e.temp, e.liquor, e.moulding, text(input.notes), user.id).lastInsertRowid);
  return { id, flags };
}

/* ---- postnatal ---- */
const BLEEDING = ['none', 'normal', 'heavy', 'offensive'];
function addPostnatal(db, user, epId, input) {
  const ep = episodeRow(db, epId);
  const d = db.prepare('SELECT * FROM deliveries WHERE episode_id=?').get(epId);
  if (ep.status !== 'delivered' || !d) throw new HttpError(409, 'Postnatal visits need a recorded delivery');
  const today = M.today(); const days = M.diffDays(today, d.delivered_on);
  if (days < 0) throw new HttpError(400, 'Delivery date is in the future');
  linkedEncounter(db, input.encounter_id, ep.patient_id, { required: false });
  let newbornId = null;
  if (input.newborn_id) { const n = db.prepare('SELECT id FROM newborns WHERE id=? AND delivery_id=?').get(Number(input.newborn_id), d.id); if (!n) throw new HttpError(400, 'Unknown baby for this delivery'); newbornId = n.id; }
  const { sys, dia } = bp(input);
  const v = { sys, dia, temp: num(input.temp, 'Temperature', 30, 45), pulse: num(input.pulse, 'Pulse', 30, 250, { int: true }), bleeding: oneOf(input.bleeding, BLEEDING, 'Bleeding'), uterus: oneOf(input.uterus, ['contracted', 'boggy'], 'Uterus'),
    perineum: oneOf(input.perineum, ['healed', 'healing', 'infected', 'na'], 'Perineum'), mood: oneOf(input.mood, ['well', 'low', 'concerning'], 'Mood'), mother_danger: subset(input.mother_danger, M.MOTHER_DANGER, 'Mother danger signs'),
    baby_weight_g: num(input.baby_weight_g, 'Baby weight (g)', 300, 8000, { int: true }), baby_temp: num(input.baby_temp, 'Baby temperature', 30, 45), baby_rr: num(input.baby_rr, 'Baby breaths per minute', 5, 150, { int: true }),
    feeding: oneOf(input.feeding, ['exclusive', 'mixed', 'formula', 'not_feeding'], 'Feeding'), cord: oneOf(input.cord, ['clean', 'infected'], 'Cord'), baby_danger: subset(input.baby_danger, M.BABY_DANGER, 'Baby danger signs') };
  if (Object.entries(v).every(([k, x]) => (Array.isArray(x) ? x.length === 0 : x == null)) && !text(input.notes)) throw new HttpError(400, 'Enter at least one finding');
  const id = Number(db.prepare(`INSERT INTO postnatal_visits(episode_id,encounter_id,visit_date,days_postpartum,newborn_id,sys,dia,temp,pulse,bleeding,uterus,perineum,mood,mother_danger,baby_weight_g,baby_temp,baby_rr,feeding,cord,jaundice,baby_danger,counselled_fp,notes,recorded_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(epId, input.encounter_id ? Number(input.encounter_id) : null, today, days, newbornId, v.sys, v.dia, v.temp, v.pulse, v.bleeding, v.uterus, v.perineum, v.mood, j(v.mother_danger),
    v.baby_weight_g, v.baby_temp, v.baby_rr, v.feeding, v.cord, bool(input.jaundice), j(v.baby_danger), bool(input.counselled_fp), text(input.notes), user.id).lastInsertRowid);
  return { id, days_postpartum: days, alerts: M.postnatalAlerts(v) };
}

function closeEpisode(db, user, epId, input) {
  const ep = episodeRow(db, epId);
  if (ep.status !== 'active') throw new HttpError(409, 'Only an active pregnancy record can be closed');
  const outcome = oneOf(input.outcome, ['miscarriage', 'transferred', 'closed'], 'Outcome', { optional: false });
  const reason = text(input.reason, 300); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  db.prepare("UPDATE anc_episodes SET status=?, closed_reason=?, closed_at=datetime('now') WHERE id=?").run(outcome, reason, epId);
  return ep;
}

/* ---- family planning ---- */
function addFamilyPlanning(db, user, patientId, input) {
  const p = patientRow(db, patientId);
  const method = oneOf(input.method, M.FP_METHODS, 'Method', { optional: false }), action = oneOf(input.action, M.FP_ACTIONS, 'Action', { optional: false });
  const startsMethod = action === 'start' || action === 'switch';
  if (startsMethod && M.NEEDS_PREG_CHECK.includes(method) && !input.pregnancy_excluded) throw new HttpError(400, 'Confirm that pregnancy has been reasonably excluded before starting this method', { field: 'pregnancy_excluded' });
  if (startsMethod && ['coc', 'pop', 'injectable', 'implant', 'iud'].includes(method) && db.prepare("SELECT 1 FROM anc_episodes WHERE patient_id=? AND status='active'").get(patientId)) throw new HttpError(409, 'This patient has an active pregnancy record');
  linkedEncounter(db, input.encounter_id, patientId, { required: false });
  const { sys, dia } = bp(input);
  const del = db.prepare("SELECT delivered_on FROM deliveries WHERE patient_id=? ORDER BY delivered_on DESC LIMIT 1").get(patientId);
  const daysPP = del ? M.diffDays(M.today(), del.delivered_on) : null;
  const htn = !!db.prepare("SELECT 1 FROM problems WHERE patient_id=? AND status='active' AND (icd_code='I10' OR icd_code='O14' OR lower(text) LIKE '%hypertens%')").get(patientId);
  const warnings = M.fpWarnings({ method, action, sys, dia, daysPostpartum: daysPP != null && daysPP >= 0 ? daysPP : null, hasHypertensionProblem: htn });
  const acked = subset(input.acknowledged_warnings, ['coc_hypertension', 'coc_postpartum'], 'Warnings');
  const missing = warnings.filter((w) => !acked.includes(w));
  if (missing.length) throw new HttpError(409, 'Safety check needs confirmation', { warnings: missing });
  const today = M.today();
  let nextDue = input.next_due ? text(input.next_due, 10) : null;
  if (nextDue && (!M.validDate(nextDue) || M.diffDays(nextDue, today) < 0)) throw new HttpError(400, 'Next due date must be today or later');
  if (!nextDue && method === 'injectable' && action !== 'stop' && action !== 'counselling') nextDue = M.addDays(today, M.INJECTABLE_DEFAULT_DAYS);
  if (action === 'stop' || method === 'none') nextDue = null;
  const id = Number(db.prepare(`INSERT INTO family_planning(patient_id,encounter_id,visit_date,method,action,pregnancy_excluded,sys,dia,side_effects,next_due,warnings_acked,notes,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(patientId, input.encounter_id ? Number(input.encounter_id) : null, today, method, action, bool(input.pregnancy_excluded), sys, dia, text(input.side_effects, 300), nextDue, j(warnings), text(input.notes), user.id).lastInsertRowid);
  void p; return { id, next_due: nextDue, warnings_acknowledged: warnings };
}

/* ---- registers (worklists) ---- */
function register(db, tab) {
  const t = M.today();
  const who = (pid) => { const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=?').get(pid); return { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, dob: p.dob, restricted: !!p.restricted }; };
  if (tab === 'postnatal') {
    return db.prepare("SELECT e.id, e.patient_id, d.delivered_on, d.id did FROM anc_episodes e JOIN deliveries d ON d.episode_id=e.id WHERE e.status='delivered'").all()
      .filter((r) => M.diffDays(t, r.delivered_on) >= 0 && M.diffDays(t, r.delivered_on) <= 49)
      .map((r) => { const visits = db.prepare('SELECT visit_date FROM postnatal_visits WHERE episode_id=?').all(r.id).map((v) => v.visit_date); const windows = M.pncStatus(r.delivered_on, visits);
        return { episode_id: r.id, patient: who(r.patient_id), delivered_on: r.delivered_on, days: M.diffDays(t, r.delivered_on), windows, attention: windows.some((w) => w.state === 'due' || w.state === 'missed'),
          babies: db.prepare('SELECT outcome,birth_weight_g FROM newborns WHERE delivery_id=?').all(r.did) }; })
      .sort((a, b) => (b.attention - a.attention) || (a.days - b.days));
  }
  if (tab === 'fp') {
    const rows = db.prepare(`SELECT f.* FROM family_planning f WHERE f.id=(SELECT id FROM family_planning g WHERE g.patient_id=f.patient_id ORDER BY visit_date DESC, id DESC LIMIT 1) AND f.action!='stop' AND f.method!='none'`).all();
    return rows.map((f) => ({ patient: who(f.patient_id), method: f.method, last_visit: f.visit_date, next_due: f.next_due, overdue: !!f.next_due && M.diffDays(f.next_due, t) < 0, days_overdue: f.next_due ? Math.max(0, M.diffDays(t, f.next_due)) : 0 }))
      .sort((a, b) => (b.overdue - a.overdue) || ((a.next_due || '9') < (b.next_due || '9') ? -1 : 1));
  }
  const rows = db.prepare("SELECT * FROM anc_episodes WHERE status='active'").all().map((e) => ({ ...summary(db, e), patient: who(e.patient_id) }));
  const level = (r) => (r.alerts.concat(r.latest_visit_alerts).some((a) => a.level === 'critical') ? 2 : r.alerts.concat(r.latest_visit_alerts).length ? 1 : 0);
  return rows.map((r) => ({ ...r, alert_level: level(r), overdue: !!(r.next_contact && r.next_contact.overdue) })).sort((a, b) => (b.alert_level - a.alert_level) || ((b.ga_days || 0) - (a.ga_days || 0)));
}

module.exports = { book, summary, getEpisode, overview, addVisit, recordDelivery, addPartograph, addPostnatal, closeEpisode, addFamilyPlanning, register, episodeRow, MODES, PLACES, TEARS, COMPLICATIONS, OUTCOMES };
