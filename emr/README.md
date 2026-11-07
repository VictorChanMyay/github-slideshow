# Clinic EMR (volunteer prototype)

A working, multi-user electronic medical record prototype for a community clinic. **Demo data only. Do not enter real patient information.** See `PLAN.md` for the full roadmap (10 milestones). Milestones **M1 (foundation)**, **M2 (outpatient core)** and **M3 (lab, prescribing, dispensing, stock)** and **M4 (maternal and child health)** are done.

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

## Added in M3 (lab, medicines, stock)
- **Lab:** doctors and midwives order tests inside a visit; nurses or lab staff mark the specimen collected; lab staff enter results. Qualitative tests use fixed options; numeric results are flagged normal / abnormal / critical / invalid. Amending a result needs a reason and keeps the old value in a history table. Results never go into the audit log, only the flag.
- **Sensitive tests (HIV, hepatitis B, syphilis):** the result is hidden from roles without permission (nurse, HIS, pharmacist, admin), and every time someone views a sensitive result it is logged.
- **Prescribing:** from a draft medicine list. The system **never calculates doses**; the prescriber types dose, frequency, duration and quantity. It blocks on a possible allergy match (needs a typed reason, stored with the prescription and shown to the pharmacist) and asks for confirmation on duplicate medicines or groups.
- **Dispensing:** first-expiry-first-out across batches, **expired stock is never dispensed**, partial dispensing is supported, and a failed dispense changes nothing (it runs as one transaction). Cancelling is only possible before dispensing.
- **Stock:** batches with expiry, receive (expired batches refused), adjust and write-off (reason required, never below zero), low-stock and expiry alerts, and a movement log. Admins can add medicines to the list.
- **Restricted patients:** lab and pharmacy staff can process the *task* (by MRN, name hidden) without opening the patient's record. This is a design decision the clinic should confirm.

## Added in M4 (maternal and child health)
- **Pregnancy record (booking):** LMP, gravida and para, risk factors (age under 18, 35 or over, and 5 or more births are added automatically). The due date is LMP + 280 days; an ultrasound scan can replace it when the LMP is doubtful or the scan differs by more than 7 days before 22 weeks. Only one active record per patient.
- **Antenatal visits:** recorded as part of a clinic visit. Alerts for danger signs, high blood pressure, pre-eclampsia (raised BP with protein after 20 weeks), anaemia, reduced or absent fetal movement, abnormal fetal heart rate, fundal height mismatch and breech near term. The next contact is suggested from the WHO 8-contact schedule, and overdue contacts are flagged in the register.
- **Labour observations:** each observation is flagged on its own (fetal heart rate, liquor, blood pressure, fever, contractions). The system does **not** judge progress of labour (no alert or action lines): the clinic must say which protocol it follows.
- **Delivery and newborns:** mode, place, blood loss (500 ml or more is recorded as postpartum haemorrhage automatically), complications, mother's outcome, and up to 4 babies. Every live baby gets **its own patient record linked to the mother**; stillbirths are recorded without a patient record. A baby of a restricted mother is restricted too and named by the mother's MRN. The whole delivery is saved in one step: if anything fails, nothing is saved.
- **Postnatal care:** mother and baby danger signs and alerts, and the four contact windows (day 0-1, day 3, day 7-14, week 6) with missed or due contacts in the register.
- **Family planning:** methods and visits, a pregnancy check before starting most methods, a block for active pregnancy, safety warnings for the combined pill (raised blood pressure or hypertension, first 6 weeks after delivery), and an automatic reminder date for injectables (84 days, editable). The register lists overdue clients first.
- **Registers (Maternal & child):** antenatal (alerts first), postnatal (missed or due contacts first) and family planning (overdue first). Restricted patients appear by MRN only.

**Needs clinical review before real use (M4):** every threshold and schedule in `lib/maternal.js` (blood pressure, haemoglobin, fundal height, fetal heart rate, contact weeks, postnatal windows, injectable interval), which risk factors and complications to list, the rule that deliveries before 20 weeks are recorded as miscarriages, and which roles may record deliveries. The newborn's birth vaccines are only noted as given; Milestone 5 will turn them into immunization records.

**Needs clinical review before real use (M3):** the starter medicine list and allergy words (`lib/formulary_seed.js`), lab menu and reference ranges, which tests count as sensitive, and the rule that numeric tests are not interpreted for children under 12 until the clinic adds child ranges.

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
