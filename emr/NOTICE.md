# Third-party data

## WHO Child Growth Standards (2006)
`lib/who_tables.json` contains the LMS reference tables of the WHO Child Growth Standards (weight-for-age, length/height-for-age,
weight-for-length/height, BMI-for-age and head-circumference-for-age, 0 to 60 months), published by the World Health Organization at
https://www.who.int/tools/child-growth-standards.

The file was built by `tools/build_who_tables.py` from the data files shipped in the `pygrowup` 0.8.2 package
(https://pypi.org/project/pygrowup/, BSD licence, copyright the pygrowup authors). The script only reshapes the tables; it does not change any number.
The SHA-256 of each source file is stored inside `who_tables.json` under `sha256_of_source_files`.

`test/growth.test.js` checks the tables and the z-score engine against the rounded reference columns published with the tables and against
WHO medians known independently. If the clinic prefers to load the tables directly from WHO, rebuild the file with the same script.
