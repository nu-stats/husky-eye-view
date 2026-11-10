# Assignment pack: Crime, immigration and place

A short assignment pack for the Husky Eye View course. Each assignment is
tied to a lesson in [`../lessons/`](../lessons/) and has the same parts:
**Purpose, Data, Tasks, Questions, Hand in.** Data files for each assignment
sit in [`data/`](data/).

This is a planning draft. Assignment numbers and due weeks follow the course
schedule in [`../README.md`](../README.md) and may move.

## Pack contents

| # | Assignment | After lesson | Data | Hand in |
| --- | --- | --- | --- | --- |
| A | [Community context for a population](community-context.md) | 9 (describing spatial data) | [County file](data/counties-over-75k.csv): 647 counties above 75,000 residents in 2000, 2006–10 and 2020–24 (variable menu in the assignment) | Profile text (4+ pages) and three comparison figures |
| A-data | [Weighted averages worked example](data/weighted-averages-example.xlsx) | 9 | 10 counties, with formulas | Completed copy of the workbook |

## Weighted averages in one paragraph

A plain average gives every county the same say. A **weighted average** lets each
county count in proportion to how many members of the group live there:

    weighted average = SUM(weight x value) / SUM(weight)

Use it whenever the group is spread unevenly across the counties. The workbook
[`data/weighted-averages-example.xlsx`](data/weighted-averages-example.xlsx)
has ten counties, the formula in live cells, and a comparison with the unweighted
mean and with national values.

## Notes for the instructor

- The unit is the **county**, not the city. The 647 counties above 75,000
  residents in all three periods hold about 93% of the U.S. foreign-born
  population; the 355 places above 75,000 held only 44–52%, because most
  foreign-born residents live in suburbs and small places.
- Connecticut is left out of the county file: its counties were replaced by
  planning regions in the 2020–2024 data.
- The county file is built by `scripts/build-county-assignment-data.mjs` from
  `scripts/fetch-sf3-2000-places.mjs --county` (2000),
  `scripts/fetch-acs-2010-places.mjs --county` (2006–10), and the ACS 2020–2024
  county values already in the project. Poverty is the share below the poverty
  level; unemployment uses B23001 for 2006–10 and B23025 for 2020–24.
- Life expectancy is for the total population, from the project's county life
  expectancy layer (2000–2019). Because it ends in 2019, the three periods are
  the 2000 estimate, the mean of 2006–2010, and 2019. The last period is not
  the same span as the ACS periods, and the assignment tells students so.
- Check the example workbook's numbers against the county file before class, and
  replace the national values with the U.S. rows of each period's tables.
- The community-context assignment is adapted from an existing course brief.
  Its video links and external spreadsheet links have been removed.
- Check the Husky Eye View layer names in each lesson against the current build
  before assigning (the course README asks for this too).
