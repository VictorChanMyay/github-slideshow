'use strict';
const enc = require('./encounters');
const reports = require('./reports');
const dashboard = require('./dashboard');
const audit = require('./audit');
const U = require('./report_utils');
const X = require('./xlsx');
const { can } = require('./permissions');
const { today: todayStr, addDays } = require('./maternal');

function handle(ctx) {
  const { db, user, req, res, url, ip, send, fail } = ctx; const method = req.method, path = url.pathname; let m;
  const need = (perm) => { if (!can(user.role, perm)) { fail(res, 403, 'Not allowed'); return false; } return true; };
  const run = (fn) => { try { fn(); } catch (e) { if (e instanceof enc.HttpError) fail(res, e.status, e.message, e.extra); else throw e; } return true; };
  const log = (action, detail) => audit.log(db, user, action, { detail, ip });
  const period = () => { const to = url.searchParams.get('to') || todayStr(); const from = url.searchParams.get('from') || addDays(to, -29); return { from, to }; };

  if (method === 'GET' && path === '/api/dashboard') { if (!need('dash.read')) return true; return run(() => { log('dashboard_viewed', user.role); send(res, 200, dashboard.dashboard(db, user)); }); }
  if (method === 'GET' && path === '/api/reports') { if (!need('report.read')) return true; return run(() => send(res, 200, { reports: reports.catalog(), can_export: can(user.role, 'report.export') })); }
  if ((m = path.match(/^\/api\/reports\/([a-z_]+)(\/export)?$/)) && method === 'GET') {
    const key = m[1], exporting = !!m[2];
    if (!need(exporting ? 'report.export' : 'report.read')) return true;
    return run(() => {
      const { from, to } = period(); const allDx = url.searchParams.get('all_diagnoses') === '1';
      // numbers of sensitive indicators are hidden on screen from roles without HIV access, and always in files
      const r = reports.run(db, key, from, to, { mask: exporting ? true : !can(user.role, 'hiv.read'), allDx });
      if (!exporting) { log('report_viewed', `${key} ${from}..${to}`); send(res, 200, r); return; }
      const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'; const name = `${key}_${from}_${to}.${format}`;
      log('report_exported', `${key} ${from}..${to} ${format}`);
      const body = format === 'xlsx' ? X.buildXlsx(X.sectionsToSheets(r.title, r.meta, r.sections)) : Buffer.from(U.toCsv(r.title, r.sections, r.meta), 'utf8');
      res.writeHead(200, { 'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); res.end(body);
    });
  }
  return false;
}
module.exports = { handle };
