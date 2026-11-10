# Assignment A: What are the living conditions where the group lives, and how have they changed?

*After lesson 9 (describing spatial data). Length: at least 4 pages of text, double-spaced, 1-inch margins, 12-point font. References and tables/figures do not count toward the length.*

Context shapes the link between immigration and crime. It is hard to explain
patterns of crime without knowing where they happen. This assignment asks what
the lived conditions are like in the cities where the "average" member of your
group lives, and whether they changed across three periods.

## Purpose

Describe the cities where your population lives, using three community
indicators from the menu below. Compare the weighted values with the sample of
cities and with national values, and compare the three periods.

## Periods

| Period | Source |
| --- | --- |
| 2000 | Census 2000, Summary File 3 |
| 2006–2010 | ACS 5-year, 2006–2010 |
| 2020–2024 | ACS 5-year, 2020–2024 |

The unit of analysis is the **city** (an incorporated place). Use the same list
of cities in all three periods. Your instructor will give you the number of
cities to use (50 in the workbook), drawn from the course file below.

## Course file

[`data/cities-over-75k.csv`](data/cities-over-75k.csv) has one row per city, for
the 343 cities with more than 75,000 residents in **all three periods** (so the
same cities can be compared over time). For each period it has these columns,
with the period added at the end of the name (for example `population_2000`):
`population`, `foreign_born_count`, `foreign_born_percent`, `poverty_percent`
and `unemployment_percent`.

Together these cities hold about half of the U.S. foreign-born population (51.1%
in 2000, 46.8% in 2006–10 and 43.5% in 2020–24). The rest live in smaller cities,
suburbs and outside any city, so what you learn is about large cities, not about
everywhere your group lives.

## Variable menu

**Choose three variables** from this menu. Use the same three in every period.

| Variable name | What it measures | 2000 | 2006–10 | 2020–24 | Where it comes from |
| --- | --- | --- | --- | --- | --- |
| `population` | Total number of residents in the city | Yes | Yes | Yes | Census 2000; American Community Survey |
| `foreign_born_percent` | Foreign-born residents, as a percent of all residents | Yes | Yes | Yes | Census 2000; American Community Survey |
| `poverty_percent` | People below the poverty level, as a percent of people for whom poverty is determined | Yes | Yes | Yes | Census 2000; American Community Survey |
| `unemployment_percent` | Unemployed people, as a percent of the civilian labor force | Yes | Yes | Yes | Census 2000; American Community Survey |

Notes:
- `population` is a count, so use it as a descriptor, not as a percentage.
- Use the **whole-city** value of each variable, not the value for your group.
- The unemployment percent means the same thing in all three periods, but the
  Census Bureau measured it from different tables in 2006–10 and 2020–24.
  Mention this in your references.
- Life expectancy is not in this menu. It is only published for counties and
  tracts, not for cities, and it ends in 2019.

## Data

**Weights:** the number of your group's residents in each city, for each
period. Use the number of foreign-born residents born in your group's country
(Census 2000 for 2000; the American Community Survey for the two later periods).

**City values:** take the three variables you chose from the course file.

**National values:** for each variable you choose, use the national value from
the matching period (the U.S. figure for that period). The course will provide
these in the workbook.

Your workbook: [`data/community-context-workbook.xlsx`](data/community-context-workbook.xlsx).
Choose your group on the first sheet and it lists the 50 cities where most of
your group lives, with the weights, the city values and the weighted averages
for Tasks 1 to 4. (You can also find the cities by hand by sorting the Cities
sheet.) A coverage table shows what share of your group's U.S. residents live
in those 50 cities.

The workbook offers 59 groups: the countries and regions of birth that had more
than 75,000 members in the United States in 2000 and that the Census Bureau
reports the same way in all three periods.

Practice set: [`data/weighted-averages-example.xlsx`](data/weighted-averages-example.xlsx).
It has ten cities and worked formulas. Your numbers go in the same layout, one
block per period.

## Tasks

1. **Choose three variables** from the menu.
2. **Find the cities.** Use the list your instructor provides, or the workbook.
   Record the group count in each city for each period.
3. **Collect the three variables** for each city and each period, using whole-city values.
4. **Weighted averages.** For each variable and each period, compute:
   - the weighted average for the cities (weights = group count in that period),
   - the unweighted mean of the cities,
   - the difference between the weighted average and the national value for that period.
5. **Visualize.** Make one figure or table per variable, showing all three periods.
   Compare the group's weighted average with the sample mean and with the national value.
6. **Write the profile.** Describe what the "average" member's city is
   like in each period, and how it changed. For example:

   > In 2020–2024, the average member of this group lived in cities where XX.X% of
   > residents were below the poverty level, compared with XX.X% across the sample
   > of cities and XX.X% nationally.

## Questions to answer in the text

1. What are the conditions in the cities where the group lives, for each of your three variables?
2. How did the weighted averages change from 2000 to 2006–10 to 2020–24? Is the change larger for the group than for the sample?
3. Does the group live in cities with high levels of immigration in general, and did that change?
4. Which comparison (with the sample, or with the national value) tells you more about the group's context? Say why.
5. What does a weighted average hide that the unweighted mean shows? Use your own numbers.
6. A city boundary is a political line, not a neighborhood. What could differ inside the cities you used that these city values do not show?
7. What share of your group lives in the cities you used (see the coverage table)? What does that mean for how far your results describe the whole group?

## Formatting and citation

- Double-spaced, 12-point font, 1-inch margins, minimum 4 pages of text.
- Placeholders such as [Figure 1 about here] are fine while drafting. Insert
  the figures last, once the narrative is written.
- Cite the data source for each period in APA style on a separate references page.

## Hand in

- Profile text (4+ pages)
- One figure or table per chosen variable, showing all three periods
- Your completed workbook with the city data for each period and the weighted averages sheet
- References page
