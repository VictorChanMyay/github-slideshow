# Clinic EMR (volunteer prototype)

A working, multi-user electronic medical record prototype for a community clinic. **Demo data only. Do not enter real patient information.** See `PLAN.md` for the full roadmap (10 milestones). Milestones **M1 (foundation)** and **M2 (outpatient core)** are done.

## What works now (M1)
- Sign-in with roles (doctor, nurse, midwife, pharmacist, lab, registration, HIS, program officer, admin); lockout after 5 failed attempts; forced password change for new users
- Patient registry: MRN, alternate-script names (Burmese, Karen, Thai), ID documents (Thai ID, Myanmar ID, UNHCR/camp card, passport, none), estimated age, duplicate warning, search by name / MRN / phone / ID number
- Restricted records: opening one needs a stated reason, and only some roles may; every access is logged
- Audit log (who opened or changed what), admin user management
- Screens in English, Burmese (draft), Karen (empty, falls back to English)

## Added in M2 (outpatient core)
- Daily queue: check-in with visit type and urgent flag, queue numbers, status (waiting, triaged, in consultation, signed), alerts shown on the queue
- Triage: vital signs with sanity limits (impossible values are rejected) and **draft** alert rules for fever, oxygen, blood pressure, pulse, breathing (WHO child cut-offs), BMI, and MUAC malnutrition screening
- Consultation: chief complaint, SOAP notes, ICD-10 diagnoses (draft subset of about 70 codes; one primary diagnosis), suspected or confirmed
- Signing locks the visit. Later changes are only possible as addenda, so history is never silently overwritten
- Allergies (with severity, removal needs a reason) and a problem list, shown as a warning banner on every visit
- Printable patient summary
- Restricted records: after a reason is given, access lasts 60 minutes for that user and covers visits, allergies and summaries; the queue never shows a restricted patient's name
- Roles: nurse does triage, doctor/midwife consult and sign, registration clerks check patients in but see no clinical data

**Needs clinical review before real use:** alert thresholds (`lib/clinical.js`), the ICD-10 subset (`lib/icd10.js`), and who may sign visits (midwives are allowed here; confirm).

## Run it
Needs Node.js 22.13 or newer. No packages to install.

```
cd emr
npm run demo        # fake data + demo users, http://127.0.0.1:3000
npm test            # automated tests
```
Try this flow: sign in as `reg1` and check in a patient, then `nurse1` (triage), then `doctor1` (consult, diagnose, sign).
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
