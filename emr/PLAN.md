# Build Plan: Clinic EMR (volunteer prototype for Mae Tao Clinic)

Decisions made with the owner: Node.js + SQLite, full scope from `emr-prototype/PROPOSAL.md`, languages English + Burmese + Karen. Demo uses **fake data only**.

## 1. Goals and non-goals

**Goal:** a working, multi-user EMR the clinic can try on its own network, to earn trust and to learn what they really need.

**Non-goals (for the prototype):** real patient data, replacing the clinic's HIS, regulatory certification, billing, a mobile app.

**Honest limits:**
- Clinical content (drug list, ICD-10 subset, immunization schedule, danger signs, alert rules) is **draft** and must be validated by the clinic's clinicians.
- Burmese and Karen text is drafted by me and **must be reviewed by native speakers** before staff see it. Untranslated keys fall back to English.
- This is a prototype, not security-audited. Do not put real patient data in it.

## 2. Architecture

- **Server:** Node.js 22.13+ only, **zero npm dependencies** (built-in `node:http`, `node:sqlite`, `node:crypto`). Easy to install offline on a PC or Raspberry Pi. `node:sqlite` is marked experimental in Node 22; if it changes, swap to `better-sqlite3` behind `lib/db.js`.
- **Database:** one SQLite file (`data/emr.db`), WAL mode, foreign keys on, schema versioned with migrations. Daily backup script copies the file.
- **API:** JSON REST under `/api`. Every route checks session and role permission. Every read of a patient record and every write is audited.
- **Front end:** vanilla JS single-page app, no build step, responsive for tablet and phone. Fonts must render Burmese (Myanmar) and Karen (Sgaw Karen uses Myanmar script); use system fonts with Noto Sans Myanmar fallback.
- **Auth:** username + password, scrypt hashing, random session token in HttpOnly cookie, lockout after repeated failures, forced password change for seeded demo users. HTTPS expected in real use (reverse proxy); prototype runs on HTTP on the local network.
- **i18n:** `public/i18n/en.json`, `my.json`, `kar.json`; key-based; fallback to English; language switch per user.
- **Offline:** server runs on the clinic's LAN, so staff keep working without internet. True per-device offline (PWA sync) is a later option.
- **Data standards:** ICD-10 subset for diagnoses; coded drug and lab lists in tables the clinic can edit; export design aligned with FHIR resources (Patient, Encounter, Observation, MedicationRequest, ServiceRequest) for later interoperability.

## 3. Data model (tables)

`users, roles, sessions, audit_log, patients, patient_ids (id type + number), patient_names (alternate scripts), households, encounters, vitals, notes (SOAP), diagnoses, problems, allergies, orders (lab / drug / imaging / referral), lab_tests, lab_results, drugs, stock_items, stock_movements, dispensing, anc_episodes, anc_visits, deliveries, newborns, immunization_schedule, immunizations, growth_measurements, programs (TB, HIV, malaria, nutrition, chronic), program_visits, referrals, admissions, beds, procedures, blood_units, appointments, queue, consents, settings, reports_log`.

Rules: no hard deletes of clinical data (void with reason); every table has created/updated by and time; sensitive records have a `restricted` flag and a break-glass reason log.

## 4. Roles and permissions

Doctor/medic, Nurse, Midwife, Pharmacist, Lab technician, Registration clerk, HIS/Records officer, Program officer (TB/HIV/malaria), Admin. Permission matrix in one file (`lib/permissions.js`) so the clinic can review it. HIV and child-protection data need extra permission plus break-glass.

## 5. Milestones (each ends with a working demo and tests)

| # | Milestone | Contents |
|---|---|---|
| M1 ✅ | Foundation | Server, DB + migrations, login/roles, audit log, i18n (3 languages), patient registry (ID types, alternate-script names, duplicate check, estimated age, restricted records with break-glass), seed demo data |
| M2 ✅ | Outpatient core | Queue, triage vitals (with abnormal flags), encounter SOAP, ICD-10 diagnoses, problems, allergies, patient summary print |
| M3 ✅ | Orders: lab and pharmacy | Lab orders/results with reference ranges, drug formulary, prescribing with allergy and duplicate checks, dispensing that decreases stock, stock batches/expiry alerts |
| M4 | Reproductive, maternal and child health | Antenatal episodes/visits, risk and danger-sign alerts, EDD, delivery/partograph summary, newborn, postnatal, family planning, mother-baby link |
| M5 | Child health | Immunization schedule with due/overdue, growth charts (WHO z-scores), nutrition screening |
| M6 | Programs | TB, HIV (extra confidentiality), malaria, chronic disease follow-up with recall lists |
| M7 | Referrals and continuity | Referral out/back, printable referral and discharge summaries, appointments and reminders |
| M8 | Inpatient and procedures | Admissions, beds, ward notes, discharge, procedures log, blood bank inventory |
| M9 | Reporting | Morbidity, MCH, immunization, stock, workload; donor report templates; CSV/Excel export; dashboards |
| M10 | Hardening and handover | Backups and restore test, security review checklist, performance on low-spec PC, user guide, admin guide, training deck, source handover |

Scope warning: "everything" is about 10 milestones. Plan to show M1–M3 to the clinic early and adjust the rest from their feedback instead of finishing all ten blind.

## 6. Quality plan

- Automated tests per milestone: API tests (auth, permissions, validation, audit), calculation tests (EDD, gestational age, z-scores, age), migration tests.
- Clinical safety tests: allergy alert, duplicate drug, danger signs, abnormal vitals, restricted access.
- Browser tests (Playwright) for the main flows in each language, including long Burmese/Karen text layout.
- Fake data generator; no real names or numbers.
- Review checklist before each demo: terminology reviewed by a clinician, translations reviewed by native speakers, privacy review.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope too big for one volunteer | Milestones, early demo, clinic chooses order |
| Wrong clinical content | Mark as draft, clinician validation per milestone |
| Poor translations | Native speaker review, fallback to English, glossary file |
| `node:sqlite` is experimental | Isolate in `lib/db.js`, tests, swap if needed |
| Clinic cannot maintain | Zero dependencies, README, admin guide, two trained staff |
| Patient safety/data harm | Fake data only until agreement and approval; audit log; restricted records |

## 8. Questions that will shape later milestones

See `emr-prototype/DISCOVERY_QUESTIONS.md`. Answers on forms, drug list, lab list, donor indicators and languages will adjust M2–M9.
