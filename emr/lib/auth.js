'use strict';
const crypto = require('node:crypto');

const SESSION_HOURS = 10;       // absolute limit
const IDLE_MINUTES = 60;        // signed out after this long without activity
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  const a = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password needs letters and numbers.';
  return null;
}

function login(db, username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(String(username || ''));
  const now = Date.now();
  if (!u || !u.active) { // same cost as a real check, to limit user-guessing by timing
    hashPassword(String(password || ''), 'x'.repeat(32));
    return { error: 'invalid' };
  }
  if (u.locked_until > now) return { error: 'locked' };
  if (!verifyPassword(String(password || ''), u.pass_hash, u.pass_salt)) {
    const fails = u.failed_count + 1;
    const lock = fails >= MAX_FAILS ? now + LOCK_MINUTES * 60000 : 0;
    db.prepare('UPDATE users SET failed_count=?, locked_until=? WHERE id=?').run(lock ? 0 : fails, lock, u.id);
    return { error: lock ? 'locked' : 'invalid', user: u };
  }
  db.prepare('UPDATE users SET failed_count=0, locked_until=0 WHERE id=?').run(u.id);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,last_seen) VALUES(?,?,?,?)')
    .run(sha(token), u.id, now + SESSION_HOURS * 3600000, now);
  return { token, user: u };
}

function userFromToken(db, token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(sha(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash); return null; }
  const now = Date.now();
  if (now - s.last_seen > IDLE_MINUTES * 60000) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash); return null; }
  const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(s.user_id);
  if (u && now - s.last_seen > 60000) db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now, s.token_hash);
  return u || null;
}
function logout(db, token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token)); }

// End a user's sessions (all of them, or all except the one in use).
function endSessions(db, userId, keepToken) {
  if (keepToken) db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId, sha(keepToken));
  else db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

// Per-address throttle for failed sign-ins (in memory; complements the per-account lock).
function makeThrottle(max = 20, windowMs = 15 * 60000) {
  const hits = new Map();
  const recent = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => now - t < windowMs); hits.set(ip, a); return a; };
  return { blocked: (ip) => recent(ip).length >= max, fail: (ip) => { recent(ip).push(Date.now()); }, clear: (ip) => hits.delete(ip) };
}

module.exports = { endSessions, makeThrottle, IDLE_MINUTES, hashPassword, verifyPassword, checkPasswordStrength, login, userFromToken, logout, SESSION_HOURS };
