# Administrator guide

For the person who looks after the EMR computer. No programming needed.

## 1. What you need
- A computer that stays on during clinic hours (Windows, macOS or Linux), with **Node.js 22.13 or newer** (https://nodejs.org). Check with `node --version`.
- The `emr` folder from the project.
- A USB drive or second computer for backups.

## 2. Starting and stopping
- **Windows:** double-click `start-demo.bat` (demo with fake data) . Real use: open a terminal in the `emr` folder and run `node server.js`.
- **macOS/Linux:** `./start-demo.sh` (demo) or `node server.js`.
- Open `http://localhost:3000`. Stop with Ctrl+C in the terminal window.
- Another port: `node server.js --port=3001`.
- **First real run:** the screen prints a one-time password for the user `admin`. Sign in and you will be asked to choose a new password. Write the new password down and keep it in a safe place.
- Data lives in `data/emr.db` (plus `emr.db-wal` and `emr.db-shm` while running). **Never copy only emr.db while the server runs: use the backup command below.**

## 3. People: creating, removing and helping users
Sign in as an administrator and open **Users**.
- **Create user:** username, full name, role, temporary password (at least 10 characters, letters and numbers). They must change it at first sign-in. One account per person; never share accounts, because the audit log records who did what.
- **Role:** choose the narrowest role that does the job. The roles and what each may do are in `lib/permissions.js` (one readable file).
- **Reset password:** the person forgot it. Type a new temporary password; give it to them privately. Their old sessions end.
- **Unlock:** appears when an account is locked after 5 wrong passwords (it also unlocks itself after 15 minutes).
- **Deactivate:** when someone leaves. They are signed out at once and cannot sign in. Records they wrote stay and still show their name. You cannot deactivate yourself, so there is always an administrator.
- Review **Audit log** regularly: failed sign-ins, many record views by one person, exports.

## 4. Backups (do this every day)
Run `backup.bat` (Windows) or `./backup.sh` (macOS/Linux) in the `emr` folder. It is safe while the server is running. It writes `backups/emr-YYYYMMDD-HHMMSS.db`, a `.sha256` checksum, checks the copy, and keeps the newest 30.

**Encrypt backups.** Set a passphrase before running:
- Windows: `set EMR_BACKUP_PASSPHRASE=your long passphrase` then `backup.bat`
- macOS/Linux: `EMR_BACKUP_PASSPHRASE='your long passphrase' ./backup.sh`
The file ends in `.db.enc`. **Without the passphrase it cannot be opened. Store the passphrase separately from the backups, in a safe place the clinic's leaders know about.**

**Copy every backup to a second place** (USB drive kept elsewhere, or another computer). A backup next to the database does not protect against a stolen or broken computer.

**Schedule it (Windows):** Task Scheduler, Create Basic Task, daily at closing time, action "Start a program", program `node`, arguments `tools\backup.js`, start in the full path of the `emr` folder. Set the passphrase as a system environment variable.
**Schedule it (Linux/macOS):** `crontab -e`, add `30 18 * * * cd /path/to/emr && EMR_BACKUP_PASSPHRASE='...' node --no-warnings tools/backup.js`.

Options: `--db=<file>`, `--dir=<folder>`, `--keep=<number>`.

## 5. Restoring (and practising it)
A backup you have never restored is a hope, not a backup. **Practise once a quarter on a spare computer or a copy.**
1. Stop the server.
2. Check the backup only: `node tools/restore.js backups/emr-20260101-180000.db --check-only` (for an encrypted one set `EMR_BACKUP_PASSPHRASE` first). You should see `GOOD`.
3. Restore: `node tools/restore.js <backup file> --yes`. Your current database is **kept** as `data/emr.db.before-restore-<time>`; nothing is deleted.
4. Start the server, sign in, and look at recent patients and visits. Anything entered after the backup time is not in the restored copy (it is in the `before-restore` file if you must recover it).
5. A backup from an **older** version of the program is upgraded automatically at start-up. A backup from a **newer** version is refused: update the program first.

If a backup check says `BAD` or `MISMATCH`, do not use that file; use the previous day's and tell the developer.

## 6. Updating the program
1. Take a backup. 2. Stop the server. 3. Replace the program files (everything except `data/` and `backups/`). 4. Start. The database upgrades itself. If something looks wrong, stop, restore the backup, and put the old program files back.

## 7. Everyday editing the clinic can do in the program
- **Immunization schedule** (admin screen "Immunization schedule"): vaccine doses, ages, intervals.
- **Medicines list:** admins can add medicines on the pharmacy/stock screen.
- Wards, beds, procedure types, referral destinations and the diagnosis list are tables in the database; ask the developer to add screens or edit them until the clinic decides what it wants to manage itself.

## 8. If something goes wrong
| Symptom | What to do |
|---|---|
| "Port 3000 is already in use" | Another copy is running. Close it, or use `--port=3001`. |
| Cannot sign in, locked | Another admin presses **Unlock**, or wait 15 minutes. |
| Everyone is signed out | Normal after 60 minutes idle or after a restart of the server. |
| "This database was made by a newer version" | You are running old program files on new data. Use the newer files. |
| Server will not start after a power cut | Run a backup copy check; start again. SQLite recovers from power cuts by itself; if it does not, restore the latest backup. |
| Suspected data leak or lost USB drive | Disable the affected accounts, change passwords, record what happened, follow the clinic's breach plan. |

## 9. Speed on a weak computer
Run `node tools/loadtest.js` to build a **fake** database of 30,000 patients and see how long screens take. On the development machine, searches took under 40 ms and the slowest report (morbidity for a whole year) under 1 second. Use `--patients=100000` for a larger test. Anything slower than a few seconds on the clinic's computer: tell the developer.
