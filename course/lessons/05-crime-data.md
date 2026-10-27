# Week 5. Crime data: where it comes from and what it misses

## Goals
- Name the main crime data sources and who produces each.
- Explain the "dark figure" of unreported crime and how recording practices shape maps.
- Prepare a clean incident file (date, category, latitude, longitude).

## Concept (25 min)
- Sources: police records (calls for service, incidents, arrests), UCR/NIBRS, victimization surveys (NCVS), hospital and medical examiner data, open-data portals.
- Homicide is the best-measured crime; property and drug crime depend heavily on reporting and enforcement.
- Geocoding: addresses to coordinates, match rates, and why hundred-block rounding is common.

## Lab (50 min)
1. Download a public incident extract from one city's open-data portal (instructor supplies a tested list). Open it in Excel.
2. Check: how many rows, date range, categories, rows with missing coordinates, rows outside the city.
3. Clean it: keep four columns, drop impossible coordinates, standardize categories. Save as CSV.
4. Load the Miami-Dade homicide layer in HEV and compare its fields to your file.

## Discussion
Two neighborhoods have the same burglary count. One calls the police more often.
What does the map measure?

## Deliverable
The cleaned CSV plus a data note: source, dates, rows kept and dropped, and two reasons the file undercounts crime.

## ArcGIS Pro equivalent
Geocoding tools, Display XY Data, Select by Attributes.

## Gap note
HEV does not geocode addresses in the lab flow; use a portal extract that already
has coordinates.
