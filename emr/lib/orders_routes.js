'use strict';
const enc = require('./encounters');
const lab = require('./lab');
const pharm = require('./pharmacy');
const visit = require('./visit');
const audit = require('./audit');
const { can } = require('./permissions');

function handle(ctx) {
  const { db, user, req, res, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const needAny = (...perms) => { if (!perms.some((p) => can(user.role, p))) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  // Open a visit for ordering: needs record access (restricted rules apply) and an unsigned visit.
  const openForOrder = (id) => {
    const e = enc.encounterRow(db, id); const p = enc.needPatient(db, e.patient_id); enc.gate(db, user, p);
    if (e.status === 'signed') throw new enc.HttpError(409, 'Visit is signed and locked. Add an addendum instead.');
    if (e.status === 'cancelled') throw new enc.HttpError(409, 'Visit was cancelled');
    return e;
  };
  const openPatientOf = (patientId) => { const p = enc.needPatient(db, patientId); enc.gate(db, user, p); };

  /* formulary + lab menu */
  if (method === 'GET' && path === '/api/lab/tests') { if (!needAny('lab.order', 'lab.read')) return true; return run(() => send(res, 200, { tests: lab.listTests(db) })); }
  if (method === 'GET' && path === '/api/drugs') {
    if (!needAny('rx.write', 'rx.read', 'stock.read', 'formulary.admin')) return true;
    return run(() => send(res, 200, { drugs: pharm.listDrugs(db, url.searchParams.get('q') || '', url.searchParams.get('all') === '1' && can(user.role, 'formulary.admin')) }));
  }
  if (method === 'POST' && path === '/api/drugs') {
    if (!need('formulary.admin')) return true;
    return run(() => { const id = pharm.addDrug(db, body); log('drug_added', null, `${body.name} ${body.strength}`); send(res, 201, { id }); });
  }
  if ((m = path.match(/^\/api\/drugs\/(\d+)$/)) && method === 'PUT') {
    if (!need('formulary.admin')) return true;
    return run(() => { pharm.updateDrug(db, Number(m[1]), body); log('drug_updated', null, m[1]); send(res, 200, { ok: true }); });
  }

  /* lab */
  if ((m = path.match(/^\/api\/encounters\/(\d+)\/lab-orders$/)) && method === 'POST') {
    if (!need('lab.order')) return true;
    return run(() => { const e = openForOrder(Number(m[1])); const id = lab.order(db, user, e, body); log('lab_ordered', e.patient_id, `order ${id}`); send(res, 201, visit.getVisit(db, user, e.id)); });
  }
  if ((m = path.match(/^\/api\/lab-orders\/(\d+)\/(cancel|collect|result)$/)) && method === 'POST') {
    const id = Number(m[1]), act = m[2];
    if (act === 'cancel') {
      if (!need('lab.order')) return true;
      return run(() => { const o = lab.orderRow(db, id); openPatientOf(o.patient_id); lab.cancelOrder(db, id, body); log('lab_cancelled', o.patient_id, `order ${id}`); send(res, 200, visit.getVisit(db, user, o.encounter_id)); });
    }
    if (act === 'collect') {
      if (!need('lab.collect')) return true;
      return run(() => { const o = lab.collect(db, user, id); log('lab_collected', o.patient_id, `order ${id}`); send(res, 200, { ok: true }); });
    }
    if (!need('lab.result')) return true;
    return run(() => { const r = lab.enterResult(db, user, id, body); log(body.amend_reason ? 'lab_amended' : 'lab_resulted', r.order.patient_id, `order ${id}: ${r.flag}${body.amend_reason ? ' reason: ' + String(body.amend_reason).slice(0, 100) : ''}`); send(res, 200, { ok: true, flag: r.flag }); });
  }
  if (method === 'GET' && path === '/api/lab/worklist') {
    if (!needAny('lab.collect', 'lab.result', 'lab.read')) return true;
    return run(() => send(res, 200, { orders: lab.worklist(db, user, url.searchParams.get('status')) }));
  }

  /* prescribing + dispensing */
  if ((m = path.match(/^\/api\/encounters\/(\d+)\/prescriptions$/)) && method === 'POST') {
    if (!need('rx.write')) return true;
    return run(() => { const e = openForOrder(Number(m[1])); const r = pharm.prescribe(db, user, e, body); log(r.overrode_allergy ? 'rx_prescribed_allergy_override' : 'rx_prescribed', e.patient_id, `rx ${r.id}`); send(res, 201, visit.getVisit(db, user, e.id)); });
  }
  if ((m = path.match(/^\/api\/prescriptions\/(\d+)\/cancel$/)) && method === 'POST') {
    if (!need('rx.write')) return true;
    return run(() => { const r = pharm.rxRow(db, Number(m[1])); openPatientOf(r.patient_id); pharm.cancelRx(db, r.id, body); log('rx_cancelled', r.patient_id, `rx ${r.id}`); send(res, 200, visit.getVisit(db, user, r.encounter_id)); });
  }
  if (method === 'GET' && path === '/api/pharmacy/worklist') {
    if (!needAny('rx.dispense', 'rx.read')) return true;
    return run(() => send(res, 200, { prescriptions: pharm.worklist(db, url.searchParams.get('status')) }));
  }
  if ((m = path.match(/^\/api\/prescriptions\/(\d+)\/dispense$/)) && method === 'POST') {
    if (!need('rx.dispense')) return true;
    return run(() => { const r = pharm.dispense(db, user, Number(m[1]), body); log('rx_dispensed', r.patient_id, `rx ${m[1]}: ${r.status}`); send(res, 200, r); });
  }

  /* stock */
  if (method === 'GET' && path === '/api/stock') { if (!need('stock.read')) return true; return run(() => send(res, 200, { drugs: pharm.stockSummary(db) })); }
  if (method === 'GET' && path === '/api/stock/movements') { if (!need('stock.read')) return true; return run(() => send(res, 200, { movements: pharm.movements(db, url.searchParams.get('limit')) })); }
  if (method === 'POST' && path === '/api/stock/receive') {
    if (!need('stock.write')) return true;
    return run(() => { const r = pharm.receive(db, user, body); log('stock_received', null, `drug ${body.drug_id} batch ${String(body.batch_no).slice(0, 40)} qty ${body.qty}`); send(res, 201, r); });
  }
  if ((m = path.match(/^\/api\/stock\/(\d+)\/(adjust|writeoff)$/)) && method === 'POST') {
    if (!need('stock.write')) return true;
    return run(() => { const b = m[2] === 'adjust' ? pharm.adjust(db, user, Number(m[1]), body) : pharm.writeOff(db, user, Number(m[1]), body); log(m[2] === 'adjust' ? 'stock_adjusted' : 'stock_writeoff', null, `batch ${b.id}: ${String(body.reason).slice(0, 100)}`); send(res, 200, { ok: true }); });
  }
  return false;
}
module.exports = { handle };
