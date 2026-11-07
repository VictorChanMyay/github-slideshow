'use strict';
const enc = require('./encounters');
const child = require('./child');
const imm = require('./immunization');
const audit = require('./audit');
const { can } = require('./permissions');

function handle(ctx) {
  const { db, user, req, res, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  const open = (pid) => { const p = enc.needPatient(db, pid); enc.gate(db, user, p); return child.patientRow(db, pid); };

  if (method === 'GET' && path === '/api/child/meta') {
    if (!need('child.read')) return true;
    return run(() => send(res, 200, { schedule: imm.schedule(db), indicators: Object.keys(child.INDICATORS) }));
  }
  if (method === 'GET' && path === '/api/child/register') {
    if (!need('child.read')) return true;
    return run(() => send(res, 200, url.searchParams.get('tab') === 'nutrition' ? { tab: 'nutrition', rows: child.nutritionRegister(db) } : { tab: 'immunization', rows: imm.register(db) }));
  }
  if (method === 'PUT' && (m = path.match(/^\/api\/immunization\/schedule\/(\d+)$/))) {
    if (!need('imm.admin')) return true;
    return run(() => { imm.updateDose(db, Number(m[1]), body); log('schedule_changed', null, `dose ${m[1]}`); send(res, 200, { ok: true }); });
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/(child|immunizations|growth)$/))) {
    const pid = Number(m[1]), what = m[2];
    if (what === 'child' && method === 'GET') { if (!need('child.read')) return true; return run(() => { const p = open(pid); log('child_viewed', pid); send(res, 200, child.overview(db, p)); }); }
    if (what === 'immunizations' && method === 'POST') {
      if (!need('imm.write')) return true;
      return run(() => { open(pid); const r = imm.record(db, user, pid, body); log(r.valid ? 'imm_recorded' : 'imm_recorded_invalid', pid, `${body.vaccine_code} #${body.dose_no}`); send(res, 201, r); });
    }
    if (what === 'growth' && method === 'POST') {
      if (!need('growth.write')) return true;
      return run(() => { open(pid); const r = child.addMeasurement(db, user, pid, body); log('growth_recorded', pid, `measurement ${r.id}`); send(res, 201, r); });
    }
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/growth\/curves$/)) && method === 'GET') {
    if (!need('child.read')) return true;
    return run(() => { const p = open(Number(m[1])); send(res, 200, child.curves(db, p, url.searchParams.get('indicator') || 'wfa')); });
  }
  if ((m = path.match(/^\/api\/(immunizations|growth)\/(\d+)\/void$/)) && method === 'POST') {
    const imms = m[1] === 'immunizations';
    if (!need(imms ? 'imm.write' : 'growth.write')) return true;
    return run(() => {
      const row = db.prepare(imms ? 'SELECT patient_id FROM immunizations WHERE id=?' : 'SELECT patient_id FROM growth_measurements WHERE id=?').get(Number(m[2]));
      if (!row) throw new enc.HttpError(404, 'Record not found'); open(row.patient_id);
      (imms ? imm.voidDose(db, Number(m[2]), body.reason) : child.voidMeasurement(db, Number(m[2]), body.reason));
      log(imms ? 'imm_voided' : 'growth_voided', row.patient_id, `${m[2]}: ${String(body.reason).slice(0, 100)}`); send(res, 200, { ok: true });
    });
  }
  return false;
}
module.exports = { handle };
