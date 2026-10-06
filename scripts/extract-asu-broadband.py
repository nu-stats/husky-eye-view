"""Turn ASU's county broadband workbook into a plain CSV for the build.

Source: Caroline Tolbert and Karen Mossberger (2020), "U.S. Current Population
Survey & American Community Survey Geographic Estimates of Internet Use,
1997-2018", Technology, Data and Society, Arizona State University:
https://techdatasociety.asu.edu/broadband-data-portal/county-data
(broadband_long2000-2018rev.xlsx, saved in data/source/internet).

Writes data/source/internet/asu_broadband_long.csv with the columns
cfips (5-digit county FIPS), year, broadband (share of households, 0-1).

    uv run --no-project --with openpyxl scripts/extract-asu-broadband.py
"""

import csv
import openpyxl

SOURCE = 'data/source/internet/broadband_long2000-2018rev.xlsx'
OUT = 'data/source/internet/asu_broadband_long.csv'

sheet = openpyxl.load_workbook(SOURCE, read_only=True).worksheets[0]
rows = sheet.iter_rows(values_only=True)
head = [str(h).strip() if h is not None else '' for h in next(rows)]
col = {name: head.index(name) for name in ('cfips', 'year', 'broadband')}
kept = 0
with open(OUT, 'w', newline='', encoding='utf-8') as out:
    writer = csv.writer(out)
    writer.writerow(['cfips', 'year', 'broadband'])
    for row in rows:
        fips, year, value = row[col['cfips']], row[col['year']], row[col['broadband']]
        # The sheet ends with a footnote row; keep only real county-years.
        if fips in (None, '') or year in (None, '') or value in (None, ''):
            continue
        try:
            fips = f'{int(float(fips)):05d}'
            year = int(float(year))
            value = float(value)
        except (TypeError, ValueError):
            continue
        writer.writerow([fips, year, f'{value:.4f}'])
        kept += 1
print(f'{kept} county-years -> {OUT}')
