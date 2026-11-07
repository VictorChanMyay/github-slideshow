'use strict';
const enc = require('./encounters');
const inpatient = require('./inpatient');
const procedures = require('./procedures');
const blood = require('./blood');
const audit = require('./audit');
const { can } = require('./permissions');

function handle(ctx) {
  const { db, user, req, res, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const needAny = (...p) => { if (!p.some((x) => can(user.role, x))) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  const open = (pid) => { const p = enc.needPatient(db, pid); enc.gate(db, user, p); return p; }; // clinical content: restricted-record rules apply
  const exists = (pid) => enc.needPatient(db, pid); // ward logistics and charting by MRN: no clinical content is returned

  /* wards and beds */
  if (method === 'GET' && path === '/api/wards') { if (!need('adm.read')) return true; return run(() => send(res, 200, inpatient.board(db))); }
  if (method === 'POST' && path === '/api/wards') { if (!need('bed.admin')) return true; return run(() => { const id = inpatient.addWard(db, body); log('ward_added', null, String(body.name).slice(0, 80)); send(res, 201, { id }); }); }
  if ((m = path.match(/^\/api\/wards\/(\d+)\/beds$/)) && method === 'POST') { if (!need('bed.admin')) return true; return run(() => { const id = inpatient.addBed(db, Number(m[1]), body); log('bed_added', null, `ward ${m[1]}: ${String(body.label).slice(0, 20)}`); send(res, 201, { id }); }); }
  if ((m = path.match(/^\/api\/beds\/(\d+)$/)) && method === 'PUT') { if (!need('bed.admin')) return true; return run(() => { inpatient.setBedStatus(db, Number(m[1]), body.status); log('bed_status_changed', null, `${m[1]}: ${body.status}`); send(res, 200, { ok: true }); }); }

  /* admissions */
  if ((m = path.match(/^\/api\/patients\/(\d+)\/(admissions|procedures|blood|blood-issues)$/))) {
    const pid = Number(m[1]), what = m[2];
    if (what === 'admissions' && method === 'GET') { if (!need('adm.read')) return true; return run(() => { open(pid); send(res, 200, { admissions: inpatient.forPatient(db, pid) }); }); }
    if (what === 'admissions' && method === 'POST') { if (!need('adm.write')) return true; return run(() => { open(pid); const r = inpatient.admit(db, user, pid, body); log('admitted', pid, r.adm_no); send(res, 201, r); }); }
    if (what === 'procedures' && method === 'GET') { if (!need('proc.read')) return true; return run(() => { open(pid); send(res, 200, { procedures: procedures.forPatient(db, pid) }); }); }
    if (what === 'procedures' && method === 'POST') {
      if (!need('proc.write')) return true;
      return run(() => { open(pid); const t = procedures.typeRow(db, body.type_code); if (t.surgical && !need('proc.surgical')) return; const r = procedures.log(db, user, pid, body); log('procedure_recorded', pid, `${t.code} #${r.id}`); send(res, 201, r); });
    }
    if (what === 'blood' && method === 'GET') { if (!need('blood.read')) return true; return run(() => { open(pid); log('blood_viewed', pid); send(res, 200, blood.forPatient(db, user, pid)); }); }
    if (what === 'blood-issues' && method === 'POST') {
      if (!need('blood.issue')) return true;
      return run(() => { open(pid); const r = blood.issue(db, user, pid, body); log(r.crossmatch === 'emergency_uncrossmatched' ? 'blood_issued_emergency' : 'blood_issued', pid, `issue ${r.id}`); send(res, 201, r); });
    }
  }
  if ((m = path.match(/^\/api\/admissions\/(\d+)(?:\/(transfer|notes|obs|discharge|summary))?$/))) {
    const id = Number(m[1]), sub = m[2]; const adm = () => inpatient.admRow(db, id);
    if (!sub && method === 'GET') { if (!need('adm.read')) return true; return run(() => { const a = adm(); open(a.patient_id); log('admission_viewed', a.patient_id, a.adm_no); send(res, 200, inpatient.detail(db, id)); }); }
    if (sub === 'summary' && method === 'GET') { if (!need('adm.read')) return true; return run(() => { const a = adm(); open(a.patient_id); const s = inpatient.summary(db, id); log('discharge_summary_viewed', a.patient_id, a.adm_no); send(res, 200, s); }); }
    if (sub === 'discharge' && method === 'POST') {
      if (!need('adm.discharge')) return true;
      return run(() => { const a = adm(); open(a.patient_id); inpatient.discharge(db, user, id, body); log('discharged', a.patient_id, `${a.adm_no}: ${body.discharge_type}`); send(res, 200, inpatient.detail(db, id)); });
    }
    if (sub === 'transfer' && method === 'POST') { if (!need('adm.write')) return true; return run(() => { const a = adm(); exists(a.patient_id); inpatient.transfer(db, user, id, body); log('bed_moved', a.patient_id, a.adm_no); send(res, 200, { ok: true }); }); }
    if (sub === 'notes' && method === 'POST') { if (!need('ward.write')) return true; return run(() => { const a = adm(); exists(a.patient_id); inpatient.addNote(db, user, id, body); log('ward_note', a.patient_id, `${a.adm_no}: ${body.kind}`); send(res, 201, { ok: true }); }); }
    if (sub === 'obs' && method === 'POST') { if (!need('ward.write')) return true; return run(() => { const a = adm(); exists(a.patient_id); const r = inpatient.addObs(db, user, id, body); log('obs_recorded', a.patient_id, a.adm_no); send(res, 201, r); }); }
  }

  /* procedures */
  if (method === 'GET' && path === '/api/procedure-types') { if (!needAny('proc.read', 'proc.write')) return true; return run(() => send(res, 200, { types: procedures.types(db) })); }
  if (method === 'GET' && path === '/api/procedures') {
    if (!need('proc.read')) return true;
    return run(() => { const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10); const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); send(res, 200, { procedures: procedures.register(db, from, to) }); });
  }
  if ((m = path.match(/^\/api\/procedures\/(\d+)\/void$/)) && method === 'POST') {
    if (!need('proc.write')) return true;
    return run(() => { const r = db.prepare('SELECT patient_id FROM procedures WHERE id=?').get(Number(m[1])); if (!r) throw new enc.HttpError(404, 'Procedure not found'); open(r.patient_id); procedures.voidProcedure(db, Number(m[1]), body.reason); log('procedure_voided', r.patient_id, `${m[1]}: ${String(body.reason).slice(0, 100)}`); send(res, 200, { ok: true }); });
  }

  /* blood bank */
  if (method === 'GET' && path === '/api/blood/summary') { if (!need('blood.read')) return true; return run(() => send(res, 200, blood.summary(db))); }
  if (method === 'GET' && path === '/api/blood/units') { if (!need('blood.read')) return true; return run(() => send(res, 200, { units: blood.listUnits(db, user, url.searchParams.get('status')) })); }
  if (method === 'GET' && path === '/api/blood/pending') {
    if (!need('blood.read')) return true;
    return run(() => send(res, 200, { issues: db.prepare("SELECT i.id,i.issued_at,i.patient_id,u.unit_no,u.abo,u.rh,u.component FROM blood_issues i JOIN blood_units u ON u.id=i.unit_id WHERE i.status='issued' ORDER BY i.id").all().map((i) => { const p = db.prepare('SELECT id,mrn,name_en,restricted FROM patients WHERE id=?').get(i.patient_id); return { id: i.id, issued_at: i.issued_at, unit_no: i.unit_no, abo: i.abo, rh: i.rh, component: i.component, patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, restricted: !!p.restricted } }; }) }));
  }
  if (method === 'POST' && path === '/api/blood/units') { if (!need('blood.write')) return true; return run(() => { const r = blood.addUnit(db, user, body); log('blood_unit_added', null, String(body.unit_no).slice(0, 40)); send(res, 201, r); }); }
  if ((m = path.match(/^\/api\/blood\/units\/(\d+)\/(screening|discard)$/)) && method === 'POST') {
    if (!need('blood.write')) return true;
    return run(() => {
      const u = blood.unitRow(db, Number(m[1]));
      if (m[2] === 'screening') { const outcome = blood.recordScreening(db, u.id, body); log('blood_screening_recorded', null, `${u.unit_no}: ${outcome}`); send(res, 200, { outcome }); } // results themselves are never written to the audit log
      else { blood.discard(db, u.id, body.reason); log('blood_unit_discarded', null, `${u.unit_no}: ${String(body.reason).slice(0, 80)}`); send(res, 200, { ok: true }); }
    });
  }
  if ((m = path.match(/^\/api\/blood-issues\/(\d+)\/(transfusion|return)$/)) && method === 'POST') {
    const perm = m[2] === 'transfusion' ? 'blood.transfuse' : 'blood.issue'; if (!need(perm)) return true;
    return run(() => {
      const i = blood.issueRow(db, Number(m[1])); open(i.patient_id);
      if (m[2] === 'transfusion') { const r = blood.recordTransfusion(db, user, i.id, body); log(r.reaction === 'none' ? 'transfusion_recorded' : 'transfusion_reaction', i.patient_id, `issue ${i.id}: ${r.reaction}`); send(res, 201, r); }
      else { blood.returnUnit(db, i.id, body.reason); log('blood_returned', i.patient_id, `issue ${i.id}`); send(res, 200, { ok: true }); }
    });
  }
  return false;
}
module.exports = { handle };
