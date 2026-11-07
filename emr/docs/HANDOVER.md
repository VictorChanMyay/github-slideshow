# Handover

Everything the clinic needs to own, run and judge this prototype. Written for the clinic's project owner and Tech Team.

## 1. What is delivered
A working, multi-user EMR prototype: 10 milestones, 245 automated tests, **zero npm dependencies**, one SQLite file. See `README.md` for the feature list by milestone and `PLAN.md` for design decisions.

| Area | What exists |
|---|---|
| Foundation | Sign-in and 9 roles, audit log, 3 languages, patient registry with ID types, alternate-script names, duplicate check, restricted records |
| Outpatient | Queue, triage with alert rules, SOAP, ICD-10 (draft subset), allergies, problems, signing and addenda |
| Orders | Lab with ranges and amendments, formulary, prescribing safety, FEFO dispensing, stock and expiry |
| Mother and child | Antenatal, labour, delivery, newborn records, postnatal, family planning; immunization schedule; WHO growth z-scores |
| Programmes | TB, HIV (hidden from unauthorised roles), malaria, malnutrition, chronic disease, recall lists |
| Continuity | Referrals out and back, take-home summary, appointments and reminder call list, role-limited follow-up list |
| Wards | Beds, admissions, ward notes, discharge, procedures with WHO checklist, blood bank |
| Reporting | Dashboard, 10 reports, 2 donor templates, CSV and Excel export, small-number protection |
| Operations | Backup (verified, optional encryption), restore, user administration, load test, security review |

## 2. What is NOT delivered (honest list)
- **Nothing here is approved for real patient data.** It has had no independent security review, no clinical sign-off, no legal or data-protection review.
- Karen translation (empty) and Burmese (partial draft, not reviewed by a native speaker).
- Interoperability (FHIR, DHIS2), SMS gateway, lab instrument links, billing, mobile or offline-first apps, barcode scanning, photo or card printing.
- Medication administration chart, fluid balance, nutrition orders, TB contact tracing, drug-resistant TB regimens, ART switching rules, PMTCT infant testing, donor counselling (all need the clinic's own protocols).
- Importing data from the existing HIS or paper records.
- Wards, procedure types and diagnosis list editing screens (data is editable by the developer in the database).

## 3. Clinical content that needs clinician review (all are DRAFT)
Each is isolated in one file so it can be changed without touching the rest.

| Content | File |
|---|---|
| Triage alert thresholds (fever, SpO2, BP, pulse, breathing, BMI, MUAC) | `lib/clinical.js` |
| ICD-10 subset (about 70 codes) | `lib/icd10.js` |
| Drug list and drug groups | `lib/formulary_seed.js` |
| Lab test list, units and reference ranges | `lib/lab.js` |
| Antenatal danger signs and risk factors, postnatal windows, family-planning rules | `lib/maternal.js`, `lib/mch.js` |
| Immunization schedule (EPI-style) | `lib/immunization_seed.js` (editable in the app) |
| WHO growth standards (2006, verified against published values) | `lib/who_tables.json`, `NOTICE.md` |
| Programme rules, outcomes, lost-to-follow-up delays | `lib/programs_rules.js`, `lib/programs_spec.js` |
| Referral feedback deadlines, appointment purposes | `lib/continuity_rules.js` |
| Ward rules, WHO surgical checklist, blood screening and compatibility | `lib/inpatient_rules.js`, `lib/inpatient_seed.js` |
| 67 report indicators, age groups, donor templates | `lib/indicators.js`, `lib/reports.js` |

Method: sit with a clinician for each row, change what is wrong, run `npm test` (the tests describe each rule in plain sentences and will tell you what you broke).

## 4. Decisions the clinic should confirm
Listed in `PLAN.md` under "M6", "M7", "M8", "M9 design decisions". The biggest:
1. HIV existence hidden from roles without permission (not just masked).
2. Restricted patients can be processed by lab, pharmacy and ward staff by MRN without opening the record.
3. Referral letters never include sensitive lab results or HIV data.
4. Appointments never name a diagnosis; HIV follow-up is never an appointment purpose.
5. Reports are aggregate only; small counts of sensitive indicators show as "<5".
6. Nobody is closed from a programme automatically; a clinician closes with an outcome.
7. Who may export reports (records officers, programme officers, admins).

## 5. Running and owning it
- **Run, back up, restore, update:** `docs/ADMIN_GUIDE.md`.
- **Daily use:** `docs/USER_GUIDE.md`. **Training:** `docs/TRAINING.md`. **Security:** `docs/SECURITY_REVIEW.md`.
- **Code map:** `server.js` (web server and sign-in), `lib/*_routes.js` (API by area), `lib/*.js` (services and pure rule files), `public/*.js` (screens), `public/i18n/*.json` (text), `test/` (tests), `tools/` (backup, restore, load test, i18n report).
- **Change the language text:** edit `public/i18n/my.json` / `kar.json` (same keys as `en.json`); `npm run i18n:report` lists missing keys.
- **Tests:** `npm test` (needs Node 22.13+). Add a test whenever a rule changes.
- **Licences:** project code is the volunteer's contribution to the clinic (confirm the licence in writing; suggested: the clinic owns it, with an open-source licence of its choice). WHO growth data credits are in `NOTICE.md`. No third-party code is bundled.

## 6. Risks to keep in view
| Risk | Mitigation |
|---|---|
| Single volunteer knows the system | Tech Team reviews code now; two trained staff; this documentation |
| `node:sqlite` is experimental | Isolated in `lib/db.js`; swap to `better-sqlite3` if needed |
| Data loss | Daily encrypted backups copied off-site; quarterly restore drill |
| Wrong clinical rule | Review table in section 3; every rule is tested; alerts support, never replace, judgement |
| Privacy breach | Security review go-live gate; least-privilege roles; audit review |
| Scope creep | Clinic's project owner sets priorities from staff feedback |

## 7. Suggested path from here
1. **Meeting with the clinic:** show the demo (about 20 minutes), ask the first-meeting questions in `emr-prototype/DISCOVERY_QUESTIONS.md`, agree an owner, a Tech Team contact and a written volunteer agreement.
2. **Pilot on fake data** with two departments (for example outpatient and mother-and-child). Collect feedback with the training sessions.
3. **Clinical review** sessions (section 3) and native-speaker review of Burmese and Karen.
4. **Go-live gate** (`docs/SECURITY_REVIEW.md`), then a small real-data pilot with consent and parallel paper records.
5. **Grow** from the clinic's priorities: data import, offline devices, donor templates, SMS reminders.
