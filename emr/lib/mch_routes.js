'use strict';
const enc = require('./encounters');
const mch = require('./mch');
const M = require('./maternal');
const audit = require('./audit');
const { can } = require('./permissions');

function handle(ctx) {
  const { db, user, req, res, url, body, ip, send, fail } = ctx;
  const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, patientId, detail) => audit.log(db, user, action, { patientId, detail, ip });
  const open = (patientId) => { const p = enc.needPatient(db, patientId); enc.gate(db, user, p); return p; }; // restricted-record rules apply to all maternal data

  if (method === 'GET' && path === '/api/mch/meta') {
    return run(() => send(res, 200, { danger_signs: M.DANGER_SIGNS, risk_factors: M.RISK_FACTORS, protein: M.PROTEIN, presentations: M.PRESENTATIONS, fetal_movement: M.FETAL_MOVEMENT, liquor: M.LIQUOR,
      mother_danger: M.MOTHER_DANGER, baby_danger: M.BABY_DANGER, fp_methods: M.FP_METHODS, fp_actions: M.FP_ACTIONS, modes: mch.MODES, places: mch.PLACES, tears: mch.TEARS, complications: mch.COMPLICATIONS, outcomes: mch.OUTCOMES }));
  }
  if (method === 'GET' && path === '/api/mch/register') {
    if (!need('mch.read')) return true;
    const tab = ['postnatal', 'fp'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'antenatal';
    return run(() => send(res, 200, { tab, rows: mch.register(db, tab) }));
  }
  if ((m = path.match(/^\/api\/patients\/(\d+)\/(mch|anc-episodes|family-planning)$/))) {
    const pid = Number(m[1]), what = m[2];
    if (what === 'mch' && method === 'GET') { if (!need('mch.read')) return true; return run(() => { open(pid); log('mch_viewed', pid); send(res, 200, mch.overview(db, pid)); }); }
    if (what === 'anc-episodes' && method === 'POST') {
      if (!need('mch.write')) return true;
      return run(() => { open(pid); const r = mch.book(db, user, pid, body); log('anc_booked', pid, `episode ${r.id}`); send(res, 201, r); });
    }
    if (what === 'family-planning' && method === 'POST') {
      if (!need('fp.write')) return true;
      return run(() => { open(pid); const r = mch.addFamilyPlanning(db, user, pid, body); log('fp_visit_recorded', pid, `${body.method}/${body.action}`); send(res, 201, r); });
    }
  }
  if ((m = path.match(/^\/api\/anc-episodes\/(\d+)(?:\/(visits|delivery|partograph|postnatal|close))?$/))) {
    const id = Number(m[1]), sub = m[2];
    const ep = () => { const e = mch.episodeRow(db, id); open(e.patient_id); return e; };
    if (!sub && method === 'GET') { if (!need('mch.read')) return true; return run(() => { const e = ep(); log('mch_viewed', e.patient_id, `episode ${id}`); const pt = enc.needPatient(db, e.patient_id); send(res, 200, { ...mch.getEpisode(db, id), patient: { id: pt.id, mrn: pt.mrn, name_en: pt.name_en, sex: pt.sex, dob: pt.dob, restricted: !!pt.restricted } }); }); }
    if (sub && method === 'POST') {
      if (!need('mch.write')) return true;
      return run(() => {
        const e = ep();
        if (sub === 'visits') { const r = mch.addVisit(db, user, id, body); log('anc_visit_recorded', e.patient_id, `episode ${id}`); send(res, 201, r); }
        else if (sub === 'delivery') {
          const r = mch.recordDelivery(db, user, id, body); log('delivery_recorded', e.patient_id, `episode ${id}: ${r.newborns.length} baby(ies)`);
          for (const n of r.newborns) if (n.patient_id) log('newborn_registered', n.patient_id, `born in episode ${id}`);
          send(res, 201, r);
        }
        else if (sub === 'partograph') { const r = mch.addPartograph(db, user, id, body); log('partograph_entry', e.patient_id, `episode ${id}`); send(res, 201, r); }
        else if (sub === 'postnatal') { const r = mch.addPostnatal(db, user, id, body); log('postnatal_visit_recorded', e.patient_id, `episode ${id}`); send(res, 201, r); }
        else { mch.closeEpisode(db, user, id, body); log('episode_closed', e.patient_id, `episode ${id}: ${String(body.outcome)}`); send(res, 200, { ok: true }); }
      });
    }
  }
  return false;
}
module.exports = { handle };
