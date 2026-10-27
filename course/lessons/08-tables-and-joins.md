# Week 8. Tables and joins

## Goals
- Explain keys (FIPS codes, GEOIDs) and what a join does.
- Merge your own table with the map's data and check the result.
- Record every step so someone else can repeat it.

## Concept (25 min)
- A table row is one place; a key links two tables. One-to-one vs one-to-many.
- Typical failures: leading zeros dropped from FIPS codes, mismatched vintages, unmatched rows.
- Merge report: how many matched, how many did not, and why.

## Lab (50 min)
1. In Merge & Export, load a CSV with a tract or county ID column (for example county arrests by year).
2. Merge with the map's data at the matching level. Read the description of each step that HEV produces.
3. Break it on purpose: strip leading zeros from the ID and re-merge. Compare match counts.
4. Download the merged file with its do-file or R script. Read the script line by line; annotate what each does.
5. Send the merged data to the R or Excel panel; confirm the row count equals what the report said.

## Discussion
Your merge matched 96% of rows. Who lives in the missing 4%, and does it matter?

## Deliverable
Merged file, the generated script with your annotations, and a one-paragraph merge log.

## ArcGIS Pro equivalent
Add Join, Join Field, Table Join cardinality, Geoprocessing History.

## Gap note
Merges are attribute joins on keys. Location-based joins are not available.
