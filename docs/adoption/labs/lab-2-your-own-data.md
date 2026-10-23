# Lab 2: Your own data on the map

**Time:** 45–60 minutes · **Level:** any · **Needs:** Husky Eye View, or Husky
Merge in a browser for Part 2 only (https://nu-stats.github.io/husky-eye-view/husky-merge/).

## Goal

Start from a list of places you care about (clinics, schools, survey sites,
field visits) and leave with a tract-level dataset you can analyze and that
someone else can rebuild exactly.

## Data

Any CSV or Excel file with **latitude** and **longitude** columns, or a GeoJSON,
KML/KMZ, GPX or zipped shapefile. Your instructor may provide one (for example,
community health centers in your state).

## Part 1: See it (10 min)

1. Open **DATA LAYERS**. At the top, under **MY FILES**, press **+ ADD**
   (or drag the file onto the globe). The map flies to it.
2. Switch on a context layer, for example **People & Economy (Census) ▸
   Poverty (tracts)**. Use the row's eye button to show and hide your file.

**Write down:** two things you notice about where your places are.

## Part 2: Join it (15 min)

1. On your file's row, press **Analyze** (the chart button). Merge & Export
   opens with your file already loaded and says how it found the locations.
2. Choose **COUNT POINTS** per tract to get a count of your places in each
   tract, or **ADD THE DATA** to give every row of your file its tract's
   measures (poverty, income, life expectancy and so on).
3. **DOWNLOAD** the result. Open the ZIP: the merged data, a Stata do-file, an
   R script, a description of every step and a codebook.

## Part 3: Check it (15 min)

1. Run the do-file or the R script on the files in the ZIP. Do you get the
   same merged file?
2. Open the steps description. How was each point placed in a tract?

## Questions

1. What share of your places sit in high-poverty tracts (above 20%)? How did
   you compute it?
2. Your file's points were placed by point-in-polygon against 2020 tracts.
   What could go wrong for a point near a tract boundary, or with a wrong
   coordinate?
3. Why is it worth handing in the do-file or R script with the data?

## Hand in

The ZIP, your answers, and one screenshot of your file over a context layer.

## Instructor notes

- My files keeps files in the browser only; they are gone on reload, and
  nothing is uploaded. Merge & Export likewise runs in the browser.
- A file with only GEOIDs (no coordinates) skips Part 1: load it straight into
  Merge & Export, which joins by GEOID.
