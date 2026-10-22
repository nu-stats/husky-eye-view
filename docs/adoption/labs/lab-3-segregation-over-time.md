# Lab 3: Segregation over time

**Time:** 50–60 minutes · **Level:** undergraduate or graduate ·
**Needs:** Husky Eye View; Excel, Stata or R for Part 3.

## Goal

Has residential segregation in US cities fallen since 2000, and for whom?
You will read the dissimilarity index, compare three periods, and check the
national picture against your own city.

## Background

The dissimilarity index (0–100) is the share of one group that would have to
move to another tract for the two groups to be spread out the same way across
a city. Husky Eye View computes it for every city of 75,000+ people, for Black,
Hispanic or Latino, and Asian residents against non-Hispanic white residents,
on 2010 tracts in every year so the city's area never changes
(docs/METHODS.md).

## Part 1: One city (15 min)

1. **DATA LAYERS ▸ Redlining, Segregation & Housing ▸ Segregation 2000
   (dissimilarity)**. Fly to your city and click it: the card gives the three
   indices and the city's rank.
2. Switch to **Segregation 2010** and **Segregation 2020–24**. Record the three
   indices for each year in a small table.

## Part 2: The country (15 min)

1. Zoom out. Compare a few regions: Rust Belt, Sun Belt, West Coast.
2. Switch to the county and state segregation layers. Does a state's index
   tell you about its cities?

## Part 3: Measure the change (20 min)

1. Open **ANALYSIS ▸ Excel** (or Stata or R). Under **Layer** choose a
   segregation layer (the panel lists the area layers that are on the map),
   under **Areas** **Everywhere**, and press **BROWSE DATA**
   to see the indices. Do the same for the other two years and compute the
   change from 2000 to 2020–24 for each group (or ask in plain English).
2. Which group's segregation fell most, on average? Which cities moved against
   the trend?

## Questions

1. Summarize the national trend in three sentences, with numbers.
2. Why put 2020–24 counts onto 2010 tracts instead of using 2020 tracts? What
   does that cost?
3. Dissimilarity ignores how big each group is. Name a second measure you
   would want and why.

## Hand in

Your table from Part 1, the analysis output from Part 3 and the answers.

## Instructor notes

- ACS 2020–24 estimates are samples: small groups in small cities carry wide
  error. Cities whose group falls below the project's minimum have no index.
- Pairs well with Lab 1: segregation today in cities with large D-graded
  areas in the 1930s.
