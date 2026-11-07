"""Builds lib/who_tables.json from the WHO Child Growth Standards (2006) LMS tables.

Source used: the data files shipped with the pygrowup 0.8.2 package (BSD licence), which in turn contain the WHO tables
published at https://www.who.int/tools/child-growth-standards. This script only reshapes them; it changes no numbers.

Usage:  python3 -I tools/build_who_tables.py <path-to>/pygrowup/tables  lib/who_tables.json
Keep the downloaded package in its own folder and never run code from it.
"""
import hashlib, json, sys

src, out = sys.argv[1], sys.argv[2]
SPEC = {  # indicator: (file pattern, x column, label)
    'wfa':   ('wfa_{g}_0_5',   'Month',  'weight-for-age 0-60 months'),
    'lhfa_l': ('lhfa_{g}_0_2', 'Month',  'length-for-age 0-24 months (lying)'),
    'lhfa_h': ('lhfa_{g}_2_5', 'Month',  'height-for-age 24-60 months (standing)'),
    'wfl':   ('wfl_{g}_0_2',   'Length', 'weight-for-length 45-110 cm'),
    'wfh':   ('wfh_{g}_2_5',   'Height', 'weight-for-height 65-120 cm'),
    'bfa_l': ('bmifa_{g}_0_2', 'Month',  'BMI-for-age 0-24 months'),
    'bfa_h': ('bmifa_{g}_2_5', 'Month',  'BMI-for-age 24-60 months'),
    'hcfa':  ('hcfa_{g}_0_5',  'Month',  'head circumference-for-age 0-60 months'),
}
SD = ['SD3neg', 'SD2neg', 'SD1neg', 'SD0', 'SD1', 'SD2', 'SD3']
tables, hashes = {}, {}
for ind, (pat, xcol, label) in SPEC.items():
    tables[ind] = {'label': label, 'x': xcol.lower()}
    for sex, g in (('M', 'boys'), ('F', 'girls')):
        fn = f'{src}/{pat.format(g=g)}_zscores.json'
        raw = open(fn, 'rb').read(); hashes[fn.split('/')[-1]] = hashlib.sha256(raw).hexdigest()
        rows = [[float(r[xcol]), float(r['L']), float(r['M']), float(r['S'])] + [float(r[k]) for k in SD] for r in json.loads(raw)]
        rows.sort(key=lambda r: r[0])
        tables[ind][sex] = rows
json.dump({'source': 'WHO Child Growth Standards (2006) via pygrowup 0.8.2 (BSD)', 'columns': ['x', 'L', 'M', 'S', 'sd-3', 'sd-2', 'sd-1', 'sd0', 'sd+1', 'sd+2', 'sd+3'], 'sha256_of_source_files': hashes, 'tables': tables},
          open(out, 'w'), separators=(',', ':'))
print('wrote', out)
