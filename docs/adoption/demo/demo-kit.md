# Demo kit (step 7)

For a conference booth, a methods workshop, a department talk or a class
visit. Rehearse with the clock: the five-minute version always runs long.

## Before you start (15 minutes ahead)

- Husky Eye View started from Pinokio; Google 3D tiles loading (POWER UP key
  set); the first-run card dismissed.
- **MENUS ON SCREEN** (tune button) set to **Research**: Data Layers,
  Analysis and Location only.
- Boston loaded once so tiles are cached; a CSV of 20–50 places with
  latitude and longitude on the desktop.
- Stata or R installed if you will show a regression (Excel works without).
- Wired internet if you can; a recorded backup video
  (Husky_Eye_View_Highlight.mp4) one click away.

## The five-minute demo

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Globe, then fly to Boston | "Neighborhood research usually lives in three windows: a map, a stats package and a spreadsheet. This is one window." |
| 0:30 | HOLC Redlining (1930s), click a D area | "The 1930s redlining maps, with the appraisers' own descriptions." |
| 1:00 | Time Lens ▸ SWIPE over median income, drag slowly | "The same place at two times. Drag, and today shows through." |
| 1:45 | DATA LAYERS ▸ MY FILES ▸ drop the CSV | "Your own data, any format: it never leaves the browser." |
| 2:15 | Row ▸ Analyze ▸ COUNT POINTS per tract ▸ DOWNLOAD | "One click joins it to census tracts; the download comes with a Stata do-file and an R script that rebuild it." |
| 3:15 | ANALYSIS ▸ Stata ▸ plain English: *regress life expectancy on median household income* | "You can ask in plain English; it writes the code you can check." |
| 4:00 | Table export, then MORAN'S I | "A publication-ready table, and spatial clustering in one click." |
| 4:30 | Back to the globe | "Free, open source, installs in one click. Here's the link." |

## The ninety-second version

Boston → HOLC → Time Lens swipe → drop a file → Analyze → download with the
do-file. Stop there.

## Hand-out (half a page)

- What it is: neighborhood research on a 3D globe, with your data and your
  statistics package.
- Try it now in a browser: MergeCraft,
  https://nu-stats.github.io/husky-eye-view/husky-merge/
- Install the full app: in Pinokio, download from
  https://github.com/nu-stats/husky-eye-view and press Install.
- Teaching: three ready labs (docs/adoption/labs/).
- Cite it: CITATION.cff in the repository.
- Contact: the project owner.

## Abstract template (about 200 words)

> **Husky Eye View: neighborhood research, data and statistics in one window.**
> Research on neighborhoods moves between maps, statistics packages and
> spreadsheets, and the steps between them are rarely reproducible. We
> present Husky Eye View, a free, open-source application that places a
> century of U.S. neighborhood data (1930s HOLC redlining maps, segregation
> indices from 2000 to 2024, life expectancy, American Community Survey
> measures, internet access, air quality and green space) on a photorealistic
> 3D globe. Users map their own files, join them to census tracts or counties
> by GEOID or location, and export the merged data with the Stata do-file and
> R script that rebuild it. Stata, R, SPSS and Excel run on any layer from
> plain-English requests, and results return to the map. We demonstrate
> [one worked example, e.g. redlining and life expectancy in Boston] and
> discuss uses in teaching quantitative methods.
