'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dbm = require('./lib/db');
const auth = require('./lib/auth');
const audit = require('./lib/audit');
const patients = require('./lib/patients');
const { seed } = require('./lib/seed');
const { can, ROLES } = require('./lib/permissions');
const enc = require('./lib/encounters');
const clinicalRoutes = require('./lib/clinical_routes');
const ordersRoutes = require('./lib/orders_routes');
const mchRoutes = require('./lib/mch_routes');
const childRoutes = require('./lib/child_routes');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const LANGS = ['en', 'my', 'kar'];

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
const fail = (res, status, message, extra = {}) => send(res, status, { error: message, ...extra });

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, lang: u.lang,
  must_change: !!u.must_change, perms: Object.keys(require('./lib/permissions').P).filter((p) => can(u.role, p)) });

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return fail(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return fail(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function createServer(db, opts = {}) {
  const secure = !!opts.secureCookies;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
      const ip = req.socket.remoteAddress;
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'emr') return fail(res, 403, 'Missing request header');
      const body = req.method === 'GET' ? {} : await readBody(req);
      const route = req.method + ' ' + url.pathname;
      const token = cookies(req).sid;

      if (route === 'POST /api/login') {
        const r = auth.login(db, body.username, body.password);
        if (r.error) {
          audit.log(db, null, 'login_failed', { detail: String(body.username || '').slice(0, 60), ip });
          return fail(res, r.error === 'locked' ? 429 : 401, r.error === 'locked' ? 'Account temporarily locked' : 'Wrong username or password');
        }
        audit.log(db, r.user, 'login', { ip });
        const cookie = `sid=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${auth.SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
        return send(res, 200, { user: publicUser(r.user) }, { 'Set-Cookie': cookie });
      }
      const user = auth.userFromToken(db, token);
      if (route === 'POST /api/logout') {
        if (user) audit.log(db, user, 'logout', { ip });
        auth.logout(db, token);
        return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (!user) return fail(res, 401, 'Not signed in');

      if (route === 'GET /api/me') return send(res, 200, { user: publicUser(user) });
      if (route === 'POST /api/me/password') {
        if (!auth.verifyPassword(String(body.current || ''), user.pass_hash, user.pass_salt)) return fail(res, 400, 'Current password is wrong');
        const weak = auth.checkPasswordStrength(body.new); if (weak) return fail(res, 400, weak);
        const { hash, salt } = auth.hashPassword(body.new);
        db.prepare('UPDATE users SET pass_hash=?, pass_salt=?, must_change=0 WHERE id=?').run(hash, salt, user.id);
        audit.log(db, user, 'password_changed', { ip });
        return send(res, 200, { ok: true });
      }
      if (user.must_change) return fail(res, 403, 'Password change required');
      if (route === 'PUT /api/me/lang') {
        if (!LANGS.includes(body.lang)) return fail(res, 400, 'Unknown language');
        db.prepare('UPDATE users SET lang=? WHERE id=?').run(body.lang, user.id);
        return send(res, 200, { ok: true });
      }
      if (route === 'GET /api/meta') return send(res, 200, { id_types: patients.ID_TYPES, scripts: patients.SCRIPTS, langs: LANGS, roles: Object.keys(ROLES) });

      if (route === 'GET /api/patients') {
        if (!can(user.role, 'patient.read')) return fail(res, 403, 'Not allowed');
        return send(res, 200, { patients: patients.search(db, url.searchParams.get('q') || '') });
      }
      if (route === 'POST /api/patients') {
        if (!can(user.role, 'patient.write')) return fail(res, 403, 'Not allowed');
        try {
          const r = patients.create(db, body, user);
          audit.log(db, user, 'patient_created', { patientId: r.id, detail: r.mrn, ip });
          return send(res, 201, r);
        } catch (e) {
          if (e.status === 409) return fail(res, 409, 'Possible duplicate', { duplicates: e.duplicates });
          if (e.status === 400) return fail(res, 400, e.message, { field: e.field });
          throw e;
        }
      }
      if (clinicalRoutes.handle({ db, user, req, res, url, body, ip, send, fail })) return;
      if (ordersRoutes.handle({ db, user, req, res, url, body, ip, send, fail })) return;
      if (mchRoutes.handle({ db, user, req, res, url, body, ip, send, fail })) return;
      if (childRoutes.handle({ db, user, req, res, url, body, ip, send, fail })) return;
      let m;
      if ((m = url.pathname.match(/^\/api\/patients\/(\d+)$/)) && req.method === 'GET') {
        if (!can(user.role, 'patient.read')) return fail(res, 403, 'Not allowed');
        const p = patients.getFull(db, Number(m[1]));
        if (!p) return fail(res, 404, 'Patient not found');
        if (p.restricted) {
          if (!can(user.role, 'patient.restricted')) {
            audit.log(db, user, 'restricted_denied', { patientId: p.id, ip });
            return fail(res, 403, 'Restricted record');
          }
          const reason = String(url.searchParams.get('reason') || '').trim();
          if (reason.length >= 5) {
            enc.createGrant(db, user, p.id, reason.slice(0, 300));
            audit.log(db, user, 'restricted_access', { patientId: p.id, detail: reason.slice(0, 300), ip });
          } else if (!enc.hasGrant(db, user, p.id)) {
            return fail(res, 428, 'Reason required for restricted record', { restricted: true });
          } else {
            audit.log(db, user, 'patient_viewed', { patientId: p.id, detail: 'restricted, active grant', ip });
          }
        } else {
          audit.log(db, user, 'patient_viewed', { patientId: p.id, ip });
        }
        const extra = can(user.role, 'encounter.read') ? enc.patientClinical(db, p.id) : {};
        return send(res, 200, { patient: p, ...extra });
      }
      if (route === 'GET /api/audit') {
        if (!can(user.role, 'audit.read')) return fail(res, 403, 'Not allowed');
        const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
        return send(res, 200, { entries: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) });
      }
      if (route === 'GET /api/users') {
        if (!can(user.role, 'user.admin')) return fail(res, 403, 'Not allowed');
        return send(res, 200, { users: db.prepare('SELECT id,username,full_name,role,lang,active,must_change FROM users ORDER BY id').all() });
      }
      if (route === 'POST /api/users') {
        if (!can(user.role, 'user.admin')) return fail(res, 403, 'Not allowed');
        const username = String(body.username || '').trim(), full = String(body.full_name || '').trim();
        if (!/^[a-z0-9._-]{3,30}$/i.test(username) || !full) return fail(res, 400, 'Username (3-30 letters/numbers) and full name are required');
        if (!ROLES[body.role]) return fail(res, 400, 'Unknown role');
        const weak = auth.checkPasswordStrength(body.password); if (weak) return fail(res, 400, weak);
        if (db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(username)) return fail(res, 409, 'Username already exists');
        const { hash, salt } = auth.hashPassword(body.password);
        db.prepare('INSERT INTO users(username,full_name,role,pass_hash,pass_salt,must_change) VALUES(?,?,?,?,?,1)').run(username, full, body.role, hash, salt);
        audit.log(db, user, 'user_created', { detail: username + ' (' + body.role + ')', ip });
        return send(res, 201, { ok: true });
      }
      return fail(res, 404, 'Unknown API route');
    } catch (e) {
      if (e.status) return fail(res, e.status, e.message);
      console.error(e);
      return fail(res, 500, 'Server error');
    }
  });
}

if (require.main === module) {
  const file = process.env.EMR_DB || path.join(__dirname, 'data', 'emr.db');
  const db = dbm.open(file);
  const info = seed(db, { demo: process.env.EMR_DEMO === '1' });
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createServer(db, { secureCookies: process.env.EMR_SECURE === '1' }).listen(port, host, () => {
    console.log(`EMR prototype running at http://${host}:${port}`);
    if (info && info.demo_password) console.log(`DEMO MODE: fake data. Users: doctor1, nurse1, midwife1, pharm1, lab1, reg1, his1, prog1, admin  Password: ${info.demo_password}`);
    if (info && info.admin_password) console.log(`First run. Sign in as "admin" with the one-time password: ${info.admin_password}  (you must change it)`);
  });
}
module.exports = { createServer };
