# Lab 1: Redlining and health in your city

**Time:** 60–75 minutes · **Level:** undergraduate methods or intro graduate ·
**Needs:** Husky Eye View (Pinokio install); Stata or R for Part 3, or the
built-in Excel workbooks.

## Goal

Ninety years ago, federal appraisers graded neighborhoods from A ("best") to D
("hazardous", outlined in red). Do the neighborhoods they redlined differ
today in health and income? You will look first, then measure.

## Part 1: Look (15 min)

1. Open Husky Eye View. On the first-run card choose **BOSTON NEIGHBORHOODS**,
   or use the Location bar to fly to your own city (HOLC maps exist for about
   200 US cities; Mapping Inequality lists them).
2. Open **DATA LAYERS ▸ Redlining, Segregation & Housing** and switch on
   **HOLC Redlining (1930s)**. Click two graded areas, one A or B and one D,
   and read their cards.
3. In the same group, open **Time Lens (1930s ↔ today)**. Choose **SWIPE** in
   the Time Lens bar. Keep **HOLC redlining (1930s)** in the **Left** picker and
   choose **Median household income (2020–24)** in the **Right** picker. Drag
   the divider slowly across the city.
4. Switch the **Right** picker to **Life expectancy (2010–15)** and sweep again.
   Either picker can show any of the comparable layers (for example,
   enumeration districts of 1930 against segregation in 2000).

**Write down:** three places where the 1930s grade and today's map seem to
line up, and one place where they do not.

## Part 2: Measure (20 min)

1. Zoom so your city fills the screen. Open **ANALYSIS ▸ Stata** (or **R**, or
   **Excel**). Under **Layer** choose **Census tracts: all measures**; under
   **Areas**, **In the map view**.
2. Press **BROWSE DATA** and click a few rows: each lights up its tract on the
   map. Find the variables for life expectancy and median household income in
   the **Variables** list.

## Part 3: Test (25 min)

1. In **Ask in plain English**, type: *regress life expectancy on median
   household income*, and press **WRITE THE STATA CODE** (or R / Excel). Check
   the variable names it chose against the **Variables** list, then run it.
2. Export the table (Word, PDF, LaTeX or Excel) and download the session ZIP:
   it keeps the data, the script and the log.
3. Press **MORAN'S I** for life expectancy. Is it clustered?

## Questions to answer

1. In one paragraph: what did the swipe suggest, and what did the regression
   say? Do they agree?
2. Life expectancy is for 2010–2015 on 2010 tracts; income is 2020–2024 on
   2020 tracts. Why does that matter for your regression? (See
   docs/METHODS.md, Limitations.)
3. A HOLC grade describes how appraisers rated a place, not who lived there.
   Name one confounder that would make the redlining–health link look
   stronger or weaker than it is.

## Hand in

The regression table, the session ZIP and the answers above.

## Instructor notes

- Boston works out of the box; for other cities, check that HOLC areas and
  tracts load at the zoom level you want (counties show from far out, tracts
  as you zoom in).
- No Stata or R? The Excel panel builds workbooks itself, with live formulas.
- Extension: bring the HOLC grade into the regression by joining HOLC areas to
  tracts in Stata or R from the session data.
