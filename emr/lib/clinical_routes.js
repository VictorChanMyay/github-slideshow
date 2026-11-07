'use strict';
const enc = require('./encounters');
const visit = require('./visit');
const audit = require('./audit');
const { can } = require('./permissions');

// Returns true if the request was handled. ctx: { db, user, req, url, body, ip, send, fail }
function handle(ctx) {
  const { db, user, req, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname;
  let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(ctx.res, 403, 'Not allowed'); return false; } return true; };
  const needAny = (...perms) => { if (!perms.some((p) => can(user.role, p))) { fail(ctx.res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => {
    try { fn(); } catch (e) {
      if (e instanceof enc.HttpError) fail(ctx.res, e.status, e.message, e.extra); else throw e;
    }
    return true;
  };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  const res = ctx.res;

  if (method === 'GET' && path === '/api/queue') {
    if (!need('queue.read')) return true;
    return run(() => send(res, 200, { queue: enc.queue(db, url.searchParams.get('date')) }));
  }
  if (method === 'GET' && path === '/api/icd10') {
    if (!needAny('consult.write', 'encounter.read', 'problem.write')) return true;
    return run(() => send(res, 200, { codes: enc.searchIcd(db, url.searchParams.get('q') || '') }));
  }

  /* patient-level */
  if ((m = path.match(/^\/api\/patients\/(\d+)\/(checkin|allergies|problems|summary)$/))) {
    const pid = Number(m[1]), what = m[2];
    if (method === 'POST' && what === 'checkin') {
      if (!need('encounter.checkin')) return true;
      return run(() => { const r = enc.checkin(db, user, pid, body); log('checkin', pid, `queue ${r.queue_no}`); send(res, 201, r); });
    }
    if (method === 'POST' && what === 'allergies') {
      if (!need('allergy.write')) return true;
      return run(() => { const p = enc.needPatient(db, pid); enc.gate(db, user, p); const id = enc.addAllergy(db, user, pid, body); log('allergy_added', pid, String(body.allergen || '').slice(0, 100)); send(res, 201, { id }); });
    }
    if (method === 'POST' && what === 'problems') {
      if (!need('problem.write')) return true;
      return run(() => { const p = enc.needPatient(db, pid); enc.gate(db, user, p); const id = enc.addProblem(db, user, pid, body); log('problem_added', pid, String(body.text || '').slice(0, 100)); send(res, 201, { id }); });
    }
    if (method === 'GET' && what === 'summary') {
      if (!need('encounter.read')) return true;
      return run(() => {
        const p = enc.needPatient(db, pid); enc.gate(db, user, p);
        const full = require('./patients').getFull(db, pid);
        log('summary_viewed', pid);
        send(res, 200, { patient: full, ...enc.patientClinical(db, pid) });
      });
    }
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/allergies\/(\d+)\/deactivate$/)) && method === 'POST') {
    if (!need('allergy.write')) return true;
    return run(() => { const pid = Number(m[1]); const p = enc.needPatient(db, pid); enc.gate(db, user, p); enc.deactivateAllergy(db, pid, Number(m[2]), body); log('allergy_removed', pid, String(body.reason || '').slice(0, 200)); send(res, 200, { ok: true }); });
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/problems\/(\d+)\/resolve$/)) && method === 'POST') {
    if (!need('problem.write')) return true;
    return run(() => { const pid = Number(m[1]); const p = enc.needPatient(db, pid); enc.gate(db, user, p); enc.resolveProblem(db, pid, Number(m[2])); log('problem_resolved', pid, m[2]); send(res, 200, { ok: true }); });
  }

  /* encounter-level */
  if ((m = path.match(/^\/api\/encounters\/(\d+)(?:\/(vitals|notes|diagnoses|sign|addendum|cancel)(?:\/(\d+))?)?$/))) {
    const id = Number(m[1]), sub = m[2], sid = m[3] ? Number(m[3]) : null;
    const open = () => { const e = enc.encounterRow(db, id); const p = enc.needPatient(db, e.patient_id); enc.gate(db, user, p); return e; };
    if (!sub && method === 'GET') {
      if (!need('encounter.read')) return true;
      return run(() => { const e = open(); const v = visit.getVisit(db, user, id); log('encounter_viewed', e.patient_id, String(id)); if (v.lab_orders.some((o) => o.sensitive && o.status === 'resulted' && !o.hidden)) log('sensitive_result_viewed', e.patient_id, String(id)); send(res, 200, v); });
    }
    if (sub === 'vitals' && method === 'PUT') {
      if (!need('triage.write')) return true;
      return run(() => { const e = open(); enc.saveVitals(db, user, id, body); log('vitals_saved', e.patient_id, String(id)); send(res, 200, visit.getVisit(db, user, id)); });
    }
    if (sub === 'notes' && method === 'PUT') {
      if (!need('consult.write')) return true;
      return run(() => { const e = open(); enc.saveNotes(db, user, id, body); log('notes_saved', e.patient_id, String(id)); send(res, 200, visit.getVisit(db, user, id)); });
    }
    if (sub === 'diagnoses' && method === 'POST') {
      if (!need('consult.write')) return true;
      return run(() => { const e = open(); const r = enc.addDiagnosis(db, user, id, body); log('diagnosis_added', e.patient_id, `${id}: ${r.code}`); send(res, 200, visit.getVisit(db, user, id)); });
    }
    if (sub === 'diagnoses' && sid && method === 'DELETE') {
      if (!need('consult.write')) return true;
      return run(() => { const e = open(); enc.removeDiagnosis(db, id, sid); log('diagnosis_removed', e.patient_id, `${id}: ${sid}`); send(res, 200, visit.getVisit(db, user, id)); });
    }
    if (sub === 'sign' && method === 'POST') {
      if (!need('consult.sign')) return true;
      return run(() => { const e = open(); enc.sign(db, user, id); log('encounter_signed', e.patient_id, String(id)); send(res, 200, visit.getVisit(db, user, id)); });
    }
    if (sub === 'addendum' && method === 'POST') {
      if (!need('consult.sign')) return true;
      return run(() => { const e = open(); enc.addAddendum(db, user, id, body); log('addendum_added', e.patient_id, String(id)); send(res, 200, visit.getVisit(db, user, id)); });
    }
    if (sub === 'cancel' && method === 'POST') {
      if (!needAny('encounter.checkin', 'consult.write')) return true;
      return run(() => { const e = open(); enc.cancel(db, user, id, body); log('encounter_cancelled', e.patient_id, `${id}: ${String(body.reason || '').slice(0, 100)}`); send(res, 200, { ok: true }); });
    }
  }
  return false;
}
module.exports = { handle };
