# Clinic EMR (volunteer prototype)

A working, multi-user electronic medical record prototype for a community clinic. **Demo data only. Do not enter real patient information.** See `PLAN.md` for the full roadmap (10 milestones). This is **Milestone 1: foundation**.

## What works now (M1)
- Sign-in with roles (doctor, nurse, midwife, pharmacist, lab, registration, HIS, program officer, admin); lockout after 5 failed attempts; forced password change for new users
- Patient registry: MRN, alternate-script names (Burmese, Karen, Thai), ID documents (Thai ID, Myanmar ID, UNHCR/camp card, passport, none), estimated age, duplicate warning, search by name / MRN / phone / ID number
- Restricted records: opening one needs a stated reason, and only some roles may; every access is logged
- Audit log (who opened or changed what), admin user management
- Screens in English, Burmese (draft), Karen (empty, falls back to English)

## Run it
Needs Node.js 22.13 or newer. No packages to install.

```
cd emr
npm run demo        # fake data + demo users, http://127.0.0.1:3000
npm test            # automated tests
```
Demo users: `doctor1 nurse1 midwife1 pharm1 lab1 reg1 his1 prog1 admin`, password `demo-pass-12345`.

First run without demo mode (`npm start`) creates one `admin` user with a one-time password printed in the console; it must be changed at first sign-in.

To let other computers on the clinic network connect: `HOST=0.0.0.0 PORT=3000 npm start`. Use HTTPS (a reverse proxy) and set `EMR_SECURE=1` before using this anywhere real.

## Translations
Burmese text is a **draft by a non-native speaker and needs review**. Karen has no translations yet. Untranslated text shows in English.
`npm run i18n:report` shows what is missing; add `-- --csv` style export with `node tools/i18n-report.js --csv` to give a translator a spreadsheet. Files: `public/i18n/*.json`.

## Notes and limits
- The database is one SQLite file in `data/`. Uses Node's built-in SQLite, which Node still labels experimental; the code is isolated in `lib/db.js` so it can be swapped.
- Clinical content (drug lists, codes, alerts) added in later milestones is draft and must be checked by the clinic's clinicians.
- Not security-audited. Prototype only.
