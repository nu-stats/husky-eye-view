# Week 3. Geographic data

## Goals
- Distinguish points, lines, polygons and rasters, and say which suits which crime question.
- Name the census hierarchy: state, county, tract, block group, block; and the historical enumeration district.
- Read a layer's source, date and unit before using it.

## Concept (25 min)
- Vector vs raster; attributes vs geometry; the attribute table.
- Units of analysis: incident, address, block face, tract, police beat.
- Metadata: source, vintage, license. Read `DATA_SOURCES.md` together.

## Lab (50 min)
1. List five HEV layers. For each, fill a table: geometry type, unit, year, source, license.
2. Compare tract life expectancy with county life expectancy for one state. What disappears at the county level?
3. Turn on 1930 enumeration districts and today's tracts for one of the covered cities (Baltimore, Brooklyn, Chicago, Cincinnati, Manhattan, Philadelphia, Pittsburgh). Describe how boundaries changed.
4. Open the HOLC area description for one graded area and list the fields it records.

## Discussion
Why are 1930 and 2020 neighborhood boundaries not directly comparable, and what
would you do about it?

## Deliverable
The layer-inventory table (5 rows) with one sentence on the main limitation of each.

## ArcGIS Pro equivalent
Catalog, Layer properties > Source, Metadata, Attribute table.

## Gap note
Raster analysis is out of scope in HEV; air quality and imagery are viewed only.
