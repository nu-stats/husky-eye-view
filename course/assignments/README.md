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
| A | [Community context for a population](community-context.md) | 9 (describing spatial data) | [City file](data/cities-over-75k.csv): 343 cities above 75,000 residents in 2000, 2006–10 and 2020–24 (variable menu in the assignment) | Profile text (4+ pages) and three comparison figures |
| A-workbook | [Student workbook](data/community-context-workbook.xlsx) | 9 | Pick a group; the workbook finds the top 50 cities and computes the weighted averages (Tasks 1 to 4) | Completed copy of the workbook |
| A-data | [Weighted averages worked example](data/weighted-averages-example.xlsx) | 9 | 10 cities, with formulas | Completed copy of the workbook |

## Weighted averages in one paragraph

A plain average gives every city the same say. A **weighted average** lets each
city count in proportion to how many members of the group live there:

    weighted average = SUM(weight x value) / SUM(weight)

Use it whenever the group is spread unevenly across the cities. The workbook
[`data/weighted-averages-example.xlsx`](data/weighted-averages-example.xlsx)
has ten cities, the formula in live cells, and a comparison with the unweighted
mean and with national values.

## Notes for the instructor

- The unit is the **city** (incorporated place). The 343 cities above 75,000
  residents in all three periods hold about half of the U.S. foreign-born
  population (51.1%, 46.8% and 43.5%), because many foreign-born residents live
  in suburbs, small places and outside any city. The workbook's coverage table
  shows the share for each group, and the assignment asks students to discuss it.
  (An earlier version used the 647 large counties, which hold about 93%.)
- Life expectancy is not in the menu: it is only published for counties and
  tracts, not cities, and it ends in 2019.
- The city file and the group tables are built by
  `scripts/build-city-assignment-data.mjs` from the Census Bureau bulk files:
  `scripts/fetch-sf3-2000-places.mjs` (2000), `scripts/fetch-acs-2010-places.mjs`
  (2006–10), the ACS 2020–2024 place values already in the project
  (`scripts/fetch-acs-social.mjs`), and `scripts/fetch-foreign-born-places.mjs`
  (foreign-born residents by country of birth). Poverty is the share below the
  poverty level; the Census Bureau measured unemployment from different tables
  in 2006–10 and 2020–24 (the fetch scripts name the exact tables). The
  assignment uses plain variable names only.
- The student workbook is built by `scripts/build-assignment-workbook.ps1` and the
  worked example by `scripts/build-example-workbook.ps1` (both need Excel on
  Windows; the example's data come from `scripts/build-example-workbook-data.mjs`).
  The group list holds the 59 countries and regions that the Census Bureau reports
  the same way in all three periods and that had more than 75,000 members in the
  United States in 2000 (`MIN_GROUP_2000` in the city data script); the
  "Other ..." leftover categories are left out. Seventeen smaller groups, such as
  Indonesia, Ghana and Sierra Leone, are not offered.
- Check the example workbook's numbers against the city file before class, and
  replace the national values with the U.S. figures for each period.
- The community-context assignment is adapted from an existing course brief.
  Its video links and external spreadsheet links have been removed.
- Check the Husky Eye View layer names in each lesson against the current build
  before assigning (the course README asks for this too).
