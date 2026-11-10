# Assignment A: What are the living conditions where the group lives, and how have they changed?

*After lesson 9 (describing spatial data). Length: at least 4 pages of text, double-spaced, 1-inch margins, 12-point font. References and tables/figures do not count toward the length.*

Context shapes the link between immigration and crime. It is hard to explain
patterns of crime without knowing where they happen. This assignment asks what
the lived conditions are like in the counties where the "average" member of your
group lives, and whether they changed across three periods.

## Purpose

Describe the counties where your population lives, using three community
indicators from the menu below. Compare the weighted values with the sample of
counties and with national values, and compare the three periods.

## Periods

| Period | Source |
| --- | --- |
| 2000 | Census 2000, Summary File 3 |
| 2006–2010 | ACS 5-year, 2006–2010 |
| 2020–2024 | ACS 5-year, 2020–2024 |

The unit of analysis is the **county**. Use the same list of counties in all
three periods. Your instructor will give you the list, drawn from the course
file below.

## Course file

[`data/counties-over-75k.csv`](data/counties-over-75k.csv) has one row per
county, for the 647 counties with more than 75,000 residents in **all three
periods** (so the same counties can be compared over time). For each period it
has these columns, with the period added at the end of the name (for example
`population_2000`): `population`, `foreign_born_count`, `foreign_born_percent`,
`poverty_percent`, `unemployment_percent` and `life_expectancy`.

Together these counties hold about 93% of the U.S. foreign-born population in
each period (93.7% in 2000, 93.2% in 2006–10 and 2020–24). Connecticut is not in
the file: its counties were replaced by planning regions in the 2020–2024 data,
so they cannot be matched across periods.

## Variable menu

**Choose three variables** from this menu. Use the same three in every period.

| Variable name | What it measures | 2000 | 2006–10 | 2020–24 | Where it comes from |
| --- | --- | --- | --- | --- | --- |
| `population` | Total number of residents in the county | Yes | Yes | Yes | Census 2000; American Community Survey |
| `foreign_born_percent` | Foreign-born residents, as a percent of all residents | Yes | Yes | Yes | Census 2000; American Community Survey |
| `poverty_percent` | People below the poverty level, as a percent of people for whom poverty is determined | Yes | Yes | Yes | Census 2000; American Community Survey |
| `unemployment_percent` | Unemployed people, as a percent of the civilian labor force | Yes | Yes | Yes | Census 2000; American Community Survey |
| `life_expectancy` | Life expectancy at birth, total population (years) | 2000 | 2006–10 mean | 2019 | County life expectancy estimates, 2000–2019 |

Notes:
- `population` is a count, so use it as a descriptor, not as a percentage.
- Use the **whole-county** value of each variable, not the value for your group.
- The unemployment percent means the same thing in all three periods, but the
  Census Bureau measured it from different tables in 2006–10 and 2020–24.
  Mention this in your references.
- `life_expectancy` is for the **total population** only, not by race or
  ethnicity, and it is a county-level measure. The series ends in 2019, so the
  periods are matched as closely as the data allow: the 2000 estimate, the mean
  of the 2006 to 2010 estimates, and the 2019 estimate (the last year available)
  for the 2020–2024 period. If you choose it, say in the text that the last
  period is 2019, and do not describe the change from 2006–10 as covering the
  same span as the other variables.

## Data

**Weights:** the number of your group's residents in each county, for each
period. Use the number of foreign-born residents born in your group's country
(Census 2000 for 2000; the American Community Survey for the two later periods).

**County values:** take the three variables you chose from the course file.

**National values:** for each variable you choose, use the national value from
the matching period (the U.S. figure for that period). The course will provide
these in the workbook.

Practice set: [`data/weighted-averages-example.xlsx`](data/weighted-averages-example.xlsx).
It has ten counties and worked formulas. Your numbers go in the same layout,
one block per period.

## Tasks

1. **Choose three variables** from the menu.
2. **Find the counties.** Use the list your instructor provides. Record the group
   count in each county for each period.
3. **Collect the three variables** for each county and each period, using whole-county values.
4. **Weighted averages.** For each variable and each period, compute:
   - the weighted average for the counties (weights = group count in that period),
   - the unweighted mean of the counties,
   - the difference between the weighted average and the national value for that period.
5. **Visualize.** Make one figure or table per variable, showing all three periods.
   Compare the group's weighted average with the sample mean and with the national value.
6. **Write the profile.** Describe what the "average" member's county is
   like in each period, and how it changed. For example:

   > In 2020–2024, the average member of this group lived in counties where XX.X% of
   > residents were below the poverty level, compared with XX.X% across the sample
   > of counties and XX.X% nationally.

## Questions to answer in the text

1. What are the conditions in the counties where the group lives, for each of your three variables?
2. How did the weighted averages change from 2000 to 2006–10 to 2020–24? Is the change larger for the group than for the sample?
3. Does the group live in counties with high levels of immigration in general, and did that change?
4. Which comparison (with the sample, or with the national value) tells you more about the group's context? Say why.
5. What does a weighted average hide that the unweighted mean shows? Use your own numbers.
6. A county is a large area. What could differ inside the counties you used that these county values do not show?

## Formatting and citation

- Double-spaced, 12-point font, 1-inch margins, minimum 4 pages of text.
- Placeholders such as [Figure 1 about here] are fine while drafting. Insert
  the figures last, once the narrative is written.
- Cite the data source for each period in APA style on a separate references page.

## Hand in

- Profile text (4+ pages)
- One figure or table per chosen variable, showing all three periods
- Your completed workbook with the county data for each period and the weighted averages sheet
- References page
