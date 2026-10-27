# Crime Mapping with Husky Eye View

A 14-week introductory course in the fundamentals of mapping and spatial
analysis, taught with Husky Eye View (HEV) in place of ArcGIS Pro. It assumes
no GIS background. Each week has one lesson in [`lessons/`](lessons/): a
concept segment (about 25 minutes), a hands-on lab (about 50 minutes), a
discussion and a short deliverable. The structure fits a 75-minute class plus
homework, or a 2-hour studio.

## Why HEV instead of ArcGIS Pro

- Free, runs in a browser, nothing to license or install in a lab.
- Neighborhood and historical data are already loaded: tract life expectancy,
  1930s HOLC redlining and area descriptions, census enumeration districts
  1900-1930, segregation 2000-today, trauma centers, public housing, green
  space, air quality, Chicago historical homicides, Miami-Dade homicides.
- Analysis runs through the Stata / R / SPSS / Excel panels and Merge & Export,
  and every run is saved with its script and log. That teaches reproducibility
  from week 1.

## What HEV is not

HEV is not a desktop GIS. It has no geoprocessing toolbox (buffer, spatial
join, overlay, kriging). The course is honest about this. Where a method
needs one, the lesson teaches the idea, does what HEV can do, and exports the
data (shapefile, CSV, Stata, R) so students can finish in R, QGIS or ArcGIS
Pro if they want. See the "gap" note in each lesson.

## ArcGIS Pro to HEV crosswalk

| Task in ArcGIS Pro | In HEV |
| --- | --- |
| Add data to a map | Turn on a layer in the layer catalog |
| Symbology (graduated colors, unique values) | Layer style and legend controls |
| Attribute table | Layer data / analyst records; Analysis panels |
| Table join, Join Field | Merge & Export: merge your file with the map's data |
| Export features, Table to Table | Merge & Export: shapefile, CSV, Excel, .dta, .sav, .RData |
| Summary statistics, Field Calculator | Stata / R / SPSS / Excel panels |
| Time slider | Time Lens |
| Bookmarks, Layout view | Scenes, Scene Director, Curated Flights (PDF report) |
| Share web map | Share Links |
| Geoprocessing history | Saved session folder (script + log) |

Menu names above follow the project README. **Check each against the current
build before the first class** and fix any that have moved.

## Schedule

| Wk | Lesson | Core idea |
| --- | --- | --- |
| 1 | [What is a map?](lessons/01-what-is-a-map.md) | Maps are arguments; tour of HEV |
| 2 | [Where things are](lessons/02-coordinates-and-projections.md) | Coordinates, datums, projections |
| 3 | [Geographic data](lessons/03-geographic-data.md) | Points, polygons, rasters, units |
| 4 | [Cartographic design](lessons/04-cartographic-design.md) | Color, classes, legends |
| 5 | [Crime data](lessons/05-crime-data.md) | Sources, the dark figure, geocoding |
| 6 | [Mapping points](lessons/06-mapping-points.md) | Point maps, annotation, overplotting |
| 7 | [Rates and choropleths](lessons/07-rates-and-choropleths.md) | Counts vs rates, MAUP |
| 8 | [Tables and joins](lessons/08-tables-and-joins.md) | Merge your data to the map |
| 9 | [Describing spatial data](lessons/09-descriptive-statistics.md) | Summaries, correlation, regression basics |
| 10 | [Space and time](lessons/10-space-and-time.md) | Time Lens, redlining and violence |
| 11 | [Hot spots and clustering](lessons/11-hot-spots.md) | Density, autocorrelation |
| 12 | [Place and access](lessons/12-place-and-access.md) | Proximity, trauma centers, green space |
| 13 | [Ethics and prediction](lessons/13-ethics-and-prediction.md) | Bias, privacy, predictive policing |
| 14 | [Storytelling and final](lessons/14-storytelling-and-final.md) | Scenes, reports, presentations |

## Assessment (suggested)

| Component | Weight |
| --- | --- |
| Weekly lab deliverables (12 best of 14) | 35% |
| Midterm map critique (week 7) | 15% |
| Reproducibility check (week 9; rerun a classmate's saved session) | 10% |
| Final project: proposal (wk 11), draft (wk 13), presentation (wk 14) | 35% |
| Participation | 5% |

## Final project

Pick a city and a question, build a three-scene HEV story, and submit the
saved scripts, the data you merged, and a 1,500-word memo that states the
question, data and its limits, method, finding and what it cannot show.

## Data and ethics notes for the instructor

- GVA, MKDB and Chicago homicide data are **key-locked research data**. Confirm
  student access and terms before assigning them; offer the Miami-Dade
  homicide file or a public city portal download as the open alternative.
- Do not map individual victims or addresses in class materials. Aggregate or
  jitter, and use the week 13 rules.
- Third-party data keeps its own license; see `DATA_SOURCES.md`.

## Instructor check (once, before the term)

- [ ] Run HEV from a clean install on a lab machine; confirm the layers each lesson names.
- [ ] Confirm which statistics commands the R panel allows (it whitelists functions); adjust weeks 9 and 11.
- [ ] Download one public city crime extract (CSV with lat/long and date) for weeks 5, 6 and 8, and test it in Merge & Export.
- [ ] Decide whether students use Stata, R, SPSS or Excel; the labs give R and Excel versions.
