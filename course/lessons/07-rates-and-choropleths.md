# Week 7. Rates and choropleth maps

## Goals
- Compute a rate (per 100,000 people) and explain why counts mislead.
- Build a choropleth and say what the shading represents.
- Explain the modifiable areal unit problem (MAUP) and small-number instability.

## Concept (25 min)
- Rate = count / population x 100,000. Choose the right denominator (residents, ambient population, housing units).
- Small populations produce wild rates; suppress or pool.
- MAUP: change the zone boundaries, change the pattern. Compare tracts and counties.

## Lab (50 min)
1. In HEV, show tract life expectancy as a choropleth. Compare the same area at county level.
2. Merge & Export: load your incident CSV and the census tract data to get counts per tract (instructor provides a tract ID column or a prepared file).
3. In Excel or R, compute rates. Sort: which tracts move up or down once population is taken into account?
4. Mark tracts with fewer than 500 residents. Decide how to treat them and justify.

## Midterm map critique (assigned)
Critique a published crime map: source, unit, normalization, classification, color, caption, what it hides.

## Deliverable
Rate table (CSV) and a choropleth screenshot, plus a short paragraph on MAUP in your city.

## ArcGIS Pro equivalent
Spatial Join, Field Calculator, Graduated Colors, Normalization field.

## Gap note
Counting points in polygons is a spatial join, which HEV does not offer. Use a
prepared counts-by-tract file, or export the points and run Count Points in
Polygons in QGIS or ArcGIS Pro. The concept is the point of the week.
