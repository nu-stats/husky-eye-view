# Husky Eye View: methods note

What the research layers are, how they were prepared, and how the analysis
tools work, for anyone citing a map, a table or a merged file made with Husky
Eye View. Licenses and full source citations are in
[DATA_SOURCES.md](../DATA_SOURCES.md); each layer's card in the app names its
source and years. Cite Husky Eye View itself with [CITATION.cff](../CITATION.cff)
**and** the data sources you used.

## 1. Data

Every research layer is a snapshot bundled with the app (`public/context/`,
`src/data/local_data/`), built by a script in `scripts/` from the original
files. Nothing is fetched or changed at run time, so a map made today can be
rebuilt from the same release.

| Theme | Layers | Source (short) | Years | Geography |
| --- | --- | --- | --- | --- |
| Life expectancy | Life Expectancy (tracts), clusters | USALEEP (NCHS, NAPHSIS, RWJF) | 2010–2015 | 2010 tracts |
| | Life Expectancy (counties), clusters | County life expectancy, total and by race and ethnicity | 2000–2019 | counties |
| Redlining | HOLC Redlining (1930s) | *Mapping Inequality*, University of Richmond | 1935–1940 | HOLC graded areas |
| Segregation | Segregation 2000 / 2010 / 2020–24 (dissimilarity), by city, county and state | LTDB (Brown University); ACS 2020–2024 B03002 | 2000, 2010, 2020–24 | 2010 tracts |
| Census | Poverty, Median Household Income, Unemployment, Education, Renter-Occupied Homes, Black and Hispanic or Latino residents, households without a vehicle, broadband | American Community Survey 5-year | 2020–2024 | 2020 tracts, counties |
| Immigration | Foreign-Born Residents (tracts, counties) | Census 2000 SF3; ACS 2006–2010 and 2020–2024 | 2000, 2006–10, 2020–24 | 2020 tracts |
| | Migration & Refugee Flows | UN DESA migrant stock; UNHCR; World Bank remittances (see DATA_SOURCES) | 2021–2025 | countries |
| Internet | Internet use and high-speed internet (states, counties, tracts) | CPS Computer and Internet Use (NTIA); ASU county estimates; ACS | 1998–2024 | states, counties, 2020 tracts |
| Environment | PM2.5, Ozone, Park Access; Nonattainment Areas | CDC Tracking Network; EPA Green Book | 2020–2021 | 2020 tracts |
| History | Enumeration Districts 1900–1930 | S4 Urban Transition HGIS, Brown University | 1900–1930 | ten Northern cities |
| Restricted | Gun Violence Archive 2015, Mass Killing Database, Chicago Homicides 1870–1930 | see DATA_SOURCES | as stated | points |

Restricted layers are encrypted in the repository and open only with a key
from the project owner; their terms of use apply to anything made from them.

## 2. Processing

- **Consistent tracts over time.** Where years are compared, they are put on
  one set of boundaries with the Census tract relationship files:
  - Segregation uses 2010 tracts throughout: LTDB's 2000 and 2010 counts are
    already on 2010 tracts, and ACS 2020–2024 counts (2020 tracts) are moved
    onto 2010 tracts in proportion to shared land area.
  - Foreign-born shares move 2000 tracts onto 2010 tracts (by 2010 population
    in each part) and 2010 tracts onto 2020 tracts (by land area).
- **Segregation index.** The dissimilarity index
  D = ½ Σ |m<sub>i</sub>/M − w<sub>i</sub>/W| over a place's tracts, for Black,
  Hispanic or Latino, and Asian residents (m) against non-Hispanic white
  residents (w), scaled 0–100. Cities are incorporated places of 75,000 or more
  people (Census Vintage 2024 estimates); each 2010 tract belongs to the 2010
  place LTDB assigns it in every year, so a city's tracts never change. An
  index is left out when the group or the number of populated tracts is too
  small (`scripts/build-segregation-layers.mjs`).
- **Clusters.** Life-expectancy cluster layers are local Moran's I clusters
  computed by the project.
- **Map colors** are display classes only; cards, tables and exports report
  the values themselves.

## 3. Analysis tools

- **Merge & Export** (and the stand-alone Husky Merge) adds the map's data to
  the user's file. Rows join by GEOID (state, county, place, tract or block
  group, detected automatically) or by location: each point is placed in its
  state, county and 2020 census tract by point-in-polygon against Census
  TIGER/Line boundaries. A county-level file can be expanded to one row per
  tract (or a state file to one row per county), each row carrying the
  larger unit's values. Every row of the user's file is kept. The download
  includes the merged data, a Stata do-file and an R script that rebuild it
  from the included files, a description of every step and a codebook.
- **Stata, R, SPSS and Excel** run on any layer or the user's own file. Stata,
  R and SPSS run on the user's own computer, with the user's installation;
  plain-English requests are turned into code that the user sees and can edit
  before running. Each run keeps its data, script and log.
- **Moran's I** (global): queen contiguity, row-standardized weights, 999
  permutations.
- **My files** only draws the user's own map files (GeoJSON, KML, KMZ, GPX,
  zipped shapefiles, tables with latitude and longitude); it does not join or
  change them. Files stay in the browser.

## 4. Limitations

- Estimates carry the sampling error of their sources (ACS margins of error
  are not shown on the map); small areas have wide margins.
- Life expectancy (2010–2015, 2010 tracts) and current census measures
  (2020–2024, 2020 tracts) are different periods and boundaries; compare them
  with care, or through Merge & Export, which records how each was joined.
- HOLC maps are historical documents produced by a federal program and carry
  its racist appraisal criteria; they describe how neighborhoods were rated,
  not how they were.
- Community-mapped and project-compiled layers (Chicago gang map, project
  event lists) may be incomplete.
- Live feeds are for context, not research data: they are not archived, and
  what they showed cannot be reproduced later.
