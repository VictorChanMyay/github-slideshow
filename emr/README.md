# Clinic EMR (volunteer prototype)

A working, multi-user electronic medical record prototype for a community clinic. **Demo data only. Do not enter real patient information.** See `PLAN.md` for the full roadmap (10 milestones). Milestones **M1 (foundation)**, **M2 (outpatient core)** and **M3 (lab, prescribing, dispensing, stock)** **M4 (maternal and child health)** and **M5 (child health)** and **M6 (programmes)** are done.

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

## Added in M5 (child health)
- **Immunization schedule:** a table of vaccines and doses (age due, minimum age, minimum interval, maximum age, "late after"), shown per child as done / due / overdue / upcoming / waiting for an earlier dose / past the maximum age. The seeded schedule is a **draft in the style of the WHO EPI** (BCG, hepatitis B birth dose, OPV, pentavalent, PCV, rotavirus, IPV, measles-containing). An admin can edit every number on the "Immunization schedule" screen, and changes apply to all children at once.
- **Recording doses:** a dose given too early or too soon after the previous one (4-day grace period) is refused unless recorded as an **invalid dose**, which does not count, so the dose becomes due again. Doses given elsewhere can be entered from the vaccination card in any order. A dose can be removed with a reason. Birth doses noted at delivery become immunization records automatically.
- **Growth and nutrition:** weight, length or height, head circumference, MUAC and oedema. **WHO Child Growth Standards 2006 z-scores** (weight-, height-, weight-for-height, BMI- and head-circumference-for-age, 0 to 60 months) with WHO's adjustment beyond +/-3 and the lying/standing 0.7 cm correction. Flags: severe and moderate acute malnutrition (weight-for-height, MUAC from 6 months, bilateral oedema), stunting, underweight, overweight, obesity, implausible values, weight loss and falling weight-for-age between visits.
- **Charts:** weight-, height-, weight-for-height, BMI- and head-circumference charts drawn from the WHO curves with the child's points.
- **Registers (Child health):** children with vaccines due or overdue (most overdue first) and children with a nutrition flag at their latest measurement (severe first). Restricted children appear by MRN only.
- **Data source and checks:** the WHO tables come from the data files of the open-source `pygrowup` package (see `NOTICE.md` and `tools/build_who_tables.py`). The tests check my calculation against **every published reference value in all 8 tables (more than 3,000 comparisons)** and against WHO medians I know independently.

## Added in M6 (programmes: TB, HIV, malaria, malnutrition, chronic disease)
- **One model for five programmes:** an enrolment (with a register number such as `TB-2026-0001`), follow-up visits, a next-visit date, and a closing outcome. The forms are generated from field definitions in `lib/programs_spec.js`, so screens and server stay in step.
- **TB:** type and site, treatment start, planned months. Sputum smear schedule at month 2, month 5 and end of treatment (pulmonary cases), with due and overdue states. A positive smear at month 5 or later is flagged as **possible treatment failure**. Prompts for unknown HIV status, poor adherence, weight loss of 5% or more, and the approaching end of treatment. **"Cured" is only accepted** for a confirmed pulmonary case with a negative end-of-treatment smear and one earlier negative smear.
- **HIV (most protected):** diagnosis and ART dates, viral load, CD4, adherence and TB symptom screen. Alerts for ART not started, viral load of 1000 or more, viral load tests due (6 months after starting, then yearly, or 3 months after an unsuppressed result) and a positive TB screen. **Roles without `hiv.read` cannot tell that an HIV record exists:** it is left out of patient pages, registers and recall lists, its details return "not found", and the HIV status inside a TB record is masked. Only `hiv.write` can set an HIV status. Every view and register view is logged.
- **Malaria:** species, severity, pregnancy, G6PD status and primaquine. Follow-up on day 3 and day 28. Flags for severe malaria, falciparum in pregnancy, **primaquine in pregnancy or with G6PD deficiency**, parasites on day 3 and suspected treatment failure.
- **Malnutrition programme (SAM/MAM):** uses the M5 growth records: each follow-up visit also saves a growth measurement. Flags for weight loss, failed appetite test, oedema and no response after 8 weeks. "Cured" needs the last two visits to meet WHO-style discharge criteria. A list shows children flagged in the growth register who are not enrolled yet.
- **Chronic disease:** hypertension, diabetes, asthma and epilepsy, each with its own control flags. The next visit is 28 days when control is poor and 90 days when it is good.
- **Recall lists:** everyone overdue or due within 7 days, most overdue first. A phone number is shown only if the patient agreed to be contacted for that programme (never for restricted patients). **Nobody is closed automatically:** after a long delay the system only suggests "lost to follow-up".

**Needs clinical review before real use (M6):** every interval, threshold and outcome rule in `lib/programs_rules.js` (smear months, viral load schedule, malaria follow-up days, discharge criteria, visit intervals, the "lost" delays), the fields in `lib/programs_spec.js`, and **which roles may handle HIV records** (nurses and midwives currently can; confirm). Not included: TB contact tracing, drug-resistant TB regimens, ART regimen changes, DOT observer records, infant testing in PMTCT.

**Needs clinical review before real use (M5):** the immunization schedule (which plan the clinic follows: Thai, Myanmar or WHO), maximum ages and intervals, the nutrition classification rules in `lib/growth.js`, and the MUAC cut-offs. Limits: ages between months are interpolated (WHO software uses daily tables, so tiny differences are possible); there is no standard for children over 5 years; vaccine stock and contraindication screening are not modelled; SAM and MAM treatment programme registers come in Milestone 6.

**Needs clinical review before real use (M4):** every threshold and schedule in `lib/maternal.js` (blood pressure, haemoglobin, fundal height, fetal heart rate, contact weeks, postnatal windows, injectable interval), which risk factors and complications to list, the rule that deliveries before 20 weeks are recorded as miscarriages, and which roles may record deliveries. The newborn's birth vaccines are only noted as given; Milestone 5 will turn them into immunization records.

**Needs clinical review before real use (M3):** the starter medicine list and allergy words (`lib/formulary_seed.js`), lab menu and reference ranges, which tests count as sensitive, and the rule that numeric tests are not interpreted for children under 12 until the clinic adds child ranges.

**Needs clinical review before real use:** alert thresholds (`lib/clinical.js`), the ICD-10 subset (`lib/icd10.js`), and who may sign visits (midwives are allowed here; confirm).

## Quick start on your own computer (Windows, macOS or Linux)
1. **Install Node.js** (the current LTS version) from https://nodejs.org. Check it with `node -v` (it must say 22.13 or higher).
2. **Get the code:** `git clone --branch claude/hopeful-albattani-2ur1zv https://github.com/victorchanmyay/github-slideshow.git`, or download the branch as a ZIP from GitHub and unzip it.
3. **Start the demo:** open the `emr` folder and
   - **Windows:** double-click `start-demo.bat`
   - **macOS / Linux:** run `sh start-demo.sh`
   - or, in any terminal inside the `emr` folder: `node server.js --demo`
4. **Open http://localhost:3000** in your browser and sign in with `doctor1` and the password `demo-pass-12345` (other users: `nurse1 midwife1 pharm1 lab1 reg1 his1 prog1 admin`).

It uses fake data only and keeps everything in the file `data/emr.db`. To start again from scratch, stop the server (Ctrl+C) and delete that file. If port 3000 is busy, add `--port=3001`.

## Run it
Needs Node.js 22.13 or newer. No packages to install.

```
cd emr
npm run demo        # fake data + demo users, http://localhost:3000 (same as: node server.js --demo)
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
