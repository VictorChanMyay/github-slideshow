'use strict';
const enc = require('./encounters');
const prog = require('./programs');
const audit = require('./audit');
const { can } = require('./permissions');

function handle(ctx) {
  const { db, user, req, res, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  const open = (pid) => { const p = enc.needPatient(db, pid); enc.gate(db, user, p); return p; }; // restricted-record rules apply to every programme record
  const writeNeeded = (program) => (program === 'hiv' ? 'hiv.write' : 'prog.write');

  if (method === 'GET' && path === '/api/programs/meta') { if (!need('prog.read')) return true; return run(() => send(res, 200, prog.meta(user))); }
  if (method === 'GET' && path === '/api/programs/register') {
    if (!need('prog.read')) return true;
    return run(() => {
      const program = url.searchParams.get('program') || 'all'; const r = prog.register(db, user, { program, tab: url.searchParams.get('tab') });
      if (program === 'hiv' || (program === 'all' && r.rows.some((x) => x.program === 'hiv'))) log('hiv_register_viewed', null, program);
      send(res, 200, r);
    });
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/programs$/))) {
    const pid = Number(m[1]);
    if (method === 'GET') {
      if (!need('prog.read')) return true;
      return run(() => { open(pid); const list = prog.overview(db, user, pid); log('program_viewed', pid); if (list.some((x) => x.program === 'hiv')) log('hiv_viewed', pid, 'patient page'); send(res, 200, { enrolments: list }); });
    }
    if (method === 'POST') {
      const perm = writeNeeded(body.program); if (!need('prog.read') || !need(perm)) return true;
      return run(() => { open(pid); const r = prog.enrol(db, user, pid, body); log(body.program === 'hiv' ? 'hiv_enrolled' : 'program_enrolled', pid, `${r.registration_no}`); send(res, 201, r); });
    }
  }
  if ((m = path.match(/^\/api\/enrolments\/(\d+)(?:\/(visits|outcome))?$/))) {
    const id = Number(m[1]), sub = m[2];
    const rec = () => { const e = prog.enrolmentRow(db, id); if (prog.hiddenFrom(user, e)) throw new enc.HttpError(404, 'Programme record not found'); open(e.patient_id); return e; };
    if (!sub && method === 'GET') {
      if (!need('prog.read')) return true;
      return run(() => { const e = rec(); const d = prog.detail(db, user, id); log(e.program === 'hiv' ? 'hiv_viewed' : 'program_viewed', e.patient_id, e.registration_no); send(res, 200, d); });
    }
    if (sub && method === 'POST') {
      if (!need('prog.read')) return true;
      return run(() => {
        const e = rec(); if (!need(writeNeeded(e.program))) return;
        if (sub === 'visits') { const r = prog.addVisit(db, user, id, body); log(e.program === 'hiv' ? 'hiv_visit_recorded' : 'program_visit_recorded', e.patient_id, e.registration_no); send(res, 201, r); }
        else { prog.close(db, user, id, body); log(e.program === 'hiv' ? 'hiv_closed' : 'program_closed', e.patient_id, `${e.registration_no}: ${String(body.outcome)}`); send(res, 200, { ok: true }); }
      });
    }
  }
  return false;
}
module.exports = { handle };
