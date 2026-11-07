'use strict';
// DRAFT subset of ICD-10 3-character categories commonly seen in primary care and maternal/child health.
// The clinic should confirm and extend this list. Stored in the icd10 table so it can be edited.
module.exports = [
['A01','Typhoid and paratyphoid fevers'],['A06','Amoebiasis'],['A09','Diarrhoea and gastroenteritis of presumed infectious origin'],
['A15','Respiratory tuberculosis, confirmed'],['A16','Respiratory tuberculosis, not confirmed'],['A37','Whooping cough'],['A90','Dengue fever'],
['B01','Varicella (chickenpox)'],['B05','Measles'],['B24','Unspecified human immunodeficiency virus [HIV] disease'],['B34','Viral infection of unspecified site'],
['B35','Dermatophytosis'],['B50','Plasmodium falciparum malaria'],['B51','Plasmodium vivax malaria'],['B54','Unspecified malaria'],['B86','Scabies'],
['D50','Iron deficiency anaemia'],['D64','Other anaemias'],
['E11','Type 2 diabetes mellitus'],['E43','Unspecified severe protein-energy malnutrition'],['E44','Moderate and mild protein-energy malnutrition'],['E46','Unspecified protein-energy malnutrition'],
['F32','Depressive episode'],['G40','Epilepsy'],['G43','Migraine'],['H10','Conjunctivitis'],['H66','Suppurative and unspecified otitis media'],
['I10','Essential (primary) hypertension'],['J00','Acute nasopharyngitis (common cold)'],['J02','Acute pharyngitis'],['J03','Acute tonsillitis'],
['J06','Acute upper respiratory infections of multiple and unspecified sites'],['J18','Pneumonia, organism unspecified'],['J20','Acute bronchitis'],['J45','Asthma'],
['K02','Dental caries'],['K29','Gastritis and duodenitis'],['K30','Functional dyspepsia'],['L02','Cutaneous abscess, furuncle and carbuncle'],
['L08','Other local infections of skin and subcutaneous tissue'],['L30','Other dermatitis'],['M54','Dorsalgia (back pain)'],['N39','Other disorders of urinary system (incl. urinary tract infection)'],
['N76','Other inflammation of vagina and vulva'],['O03','Spontaneous abortion'],['O14','Pre-eclampsia'],['O20','Haemorrhage in early pregnancy'],['O80','Single spontaneous delivery'],
['O99','Other maternal diseases classifiable elsewhere'],['P07','Disorders related to short gestation and low birth weight'],['P22','Respiratory distress of newborn'],
['R05','Cough'],['R10','Abdominal and pelvic pain'],['R50','Fever of other and unknown origin'],['R51','Headache'],
['S01','Open wound of head'],['S61','Open wound of wrist, hand and fingers'],['S82','Fracture of lower leg, including ankle'],['T14','Injury of unspecified body region'],
['T78','Adverse effects, not elsewhere classified (allergy)'],['Z00','General examination and investigation of persons without complaint'],['Z23','Encounter for immunization'],
['Z30','Contraceptive management'],['Z34','Supervision of normal pregnancy'],['Z39','Postpartum care and examination'],['Z71','Counselling, not elsewhere classified'],
];
