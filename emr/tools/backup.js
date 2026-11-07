#!/usr/bin/env node
'use strict';
// Usage: node tools/backup.js [--db=data/emr.db] [--dir=backups] [--keep=30] [--passphrase-env=EMR_BACKUP_PASSPHRASE]
// Safe to run while the server is running (for example every night from Task Scheduler or cron).
const path = require('node:path');
const dbm = require('../lib/db');
const b = require('../lib/backup');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const root = path.join(__dirname, '..');
const file = path.resolve(arg('db', process.env.EMR_DB || path.join(root, 'data', 'emr.db')));
const dir = path.resolve(arg('dir', path.join(root, 'backups')));
const pass = process.env[arg('passphrase-env', 'EMR_BACKUP_PASSPHRASE')] || undefined;
try {
  const db = dbm.open(file);
  const r = b.backup(db, dir, { passphrase: pass, keep: Number(arg('keep', 30)) });
  console.log(`Backup OK: ${r.file}\n  size ${r.bytes} bytes, ${r.check.counts.patients} patients, ${r.check.counts.encounters} visits, integrity ${r.check.integrity}\n  ${pass ? 'encrypted' : 'NOT encrypted (set EMR_BACKUP_PASSPHRASE to encrypt)'}\n  Copy it to a second place (USB drive or another computer): a backup next to the database is not enough.`);
  db.close();
} catch (e) { console.error('BACKUP FAILED: ' + e.message); process.exit(1); }
