'use strict';
// DRAFT starter lists. The clinic must replace these with its own formulary and lab menu.
// No dosing information is stored: prescribers type the dose themselves.
// [name, strength, form, class (for duplicate-therapy warning), tags (for allergy matching), reorder_level]
const DRUGS = [
['Paracetamol','500 mg','tablet','analgesic','paracetamol,acetaminophen',500],
['Ibuprofen','400 mg','tablet','nsaid','nsaid,ibuprofen,aspirin',300],
['Amoxicillin','250 mg','capsule','penicillin','penicillin,beta-lactam,amoxicillin',300],
['Amoxicillin','500 mg','capsule','penicillin','penicillin,beta-lactam,amoxicillin',300],
['Cotrimoxazole','480 mg','tablet','sulfonamide','sulfa,sulfonamide,sulphonamide,cotrimoxazole,trimethoprim',300],
['Ciprofloxacin','500 mg','tablet','quinolone','quinolone,fluoroquinolone,ciprofloxacin',100],
['Metronidazole','400 mg','tablet','nitroimidazole','metronidazole,nitroimidazole',200],
['Doxycycline','100 mg','capsule','tetracycline','tetracycline,doxycycline',100],
['Azithromycin','250 mg','tablet','macrolide','macrolide,azithromycin',100],
['Oral rehydration salts','1 L sachet','sachet','rehydration','ors',200],
['Zinc sulfate','20 mg','dispersible tablet','zinc','zinc',300],
['Artemether-lumefantrine','20/120 mg','tablet','antimalarial','artemether,lumefantrine,artemisinin',200],
['Chloroquine','150 mg base','tablet','antimalarial','chloroquine,quinoline',200],
['Primaquine','7.5 mg','tablet','antimalarial','primaquine,quinoline',200],
['Ferrous sulfate + folic acid','200 mg + 0.4 mg','tablet','iron-folate','iron,folic acid',500],
['Folic acid','5 mg','tablet','folate','folic acid',200],
['Salbutamol inhaler','100 mcg/dose','inhaler','bronchodilator','salbutamol,albuterol',30],
['Omeprazole','20 mg','capsule','ppi','omeprazole,ppi',200],
['Amlodipine','5 mg','tablet','calcium-channel-blocker','amlodipine',200],
['Enalapril','5 mg','tablet','ace-inhibitor','enalapril,ace inhibitor',200],
['Metformin','500 mg','tablet','biguanide','metformin',300],
['Cetirizine','10 mg','tablet','antihistamine','cetirizine,antihistamine',200],
['Albendazole','400 mg','tablet','anthelmintic','albendazole,benzimidazole',100],
['Vitamin A','200,000 IU','capsule','vitamin-a','vitamin a,retinol',100],
];
// [code, name, kind, unit, ref_low, ref_high, crit_low, crit_high, options(json), abnormal(json), sensitive, adult_only, ref_low_m, ref_high_m, ref_low_f, ref_high_f]
const J = JSON.stringify, POS = ['Negative', 'Positive'];
const LABS = [
['MAL_RDT','Malaria rapid test','qualitative',null,null,null,null,null,J(['Negative','Positive P. falciparum','Positive P. vivax','Positive mixed','Invalid']),J(['Positive P. falciparum','Positive P. vivax','Positive mixed']),0,0],
['HB','Haemoglobin','numeric','g/dL',12,16,7,null,null,null,0,1,13,17,12,15],
['GLU_R','Random blood glucose','numeric','mg/dL',70,140,54,400,null,null,0,1],
['WBC','White blood cell count','numeric','x10^3/uL',4,11,2,30,null,null,0,1],
['PLT','Platelet count','numeric','x10^3/uL',150,450,50,null,null,null,0,1],
['UPT','Urine pregnancy test','qualitative',null,null,null,null,null,J(['Negative','Positive','Invalid']),J(['Positive']),0,0],
['UA_PROT','Urine protein','qualitative',null,null,null,null,null,J(['Negative','Trace','1+','2+','3+']),J(['1+','2+','3+']),0,0],
['UA_GLU','Urine glucose','qualitative',null,null,null,null,null,J(['Negative','Trace','1+','2+','3+']),J(['1+','2+','3+']),0,0],
['AFB','Sputum AFB smear','qualitative',null,null,null,null,null,J(['Negative','Scanty','1+','2+','3+']),J(['Scanty','1+','2+','3+']),0,0],
['HIV_RDT','HIV rapid test (screening)','qualitative',null,null,null,null,null,J(['Non-reactive','Reactive','Invalid']),J(['Reactive']),1,0],
['HBSAG','Hepatitis B surface antigen','qualitative',null,null,null,null,null,J(['Non-reactive','Reactive','Invalid']),J(['Reactive']),1,0],
['SYPH','Syphilis rapid test','qualitative',null,null,null,null,null,J(['Non-reactive','Reactive','Invalid']),J(['Reactive']),1,0],
['BLOODGRP','Blood group (ABO/Rh)','qualitative',null,null,null,null,null,J(['A+','A-','B+','B-','AB+','AB-','O+','O-']),J([]),0,0],
];
module.exports = { DRUGS, LABS };
