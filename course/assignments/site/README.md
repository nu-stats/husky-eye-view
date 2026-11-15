# Immigration and Crime: Community Context

A small website for Assignment A (`../community-context.md`). A student chooses a group (country of birth), a ranking period and three indicators from a menu of seven (population and foreign_born_percent are given). The page shows:

- the 50 cities where the group is largest, with the group size and the three variables in each of the three periods;
- the weighted-average calculation step by step (sum of the weights, sum of weight x value, the division, the plain average, the national value, the weighted average minus the plain average);
- the share of the group's U.S. residents who live in those 50 cities;
- a button to download the table as a CSV file.

It does the same as the course workbook (`../data/community-context-workbook.xlsx`). It uses Census data only (Census 2000, ACS 2006-2010, ACS 2020-2024). There is no crime data.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `app.js`, `style.css` | The page, with five tabs: Start here, Top 50, Data, Weighted averages and Test this site. Plain HTML and JavaScript, no build step, no packages. The look follows Husky Eye View (dark, glass panels). |
| `data/cities.json` | 343 cities: code, name, state and the four variables for three periods. |
| `data/national.json` | National value of each menu indicator for three periods. |
| `data/groups.json` | 59 groups: group size in each city for three periods, and the U.S. total. |
| `build-data.mjs` | Rebuilds the two JSON files from the validated source tables. |
| `STUDENT-TEST.md` | A walkthrough for a student who tests the site. |

## Run it locally

The page loads its data with `fetch`, so open it from a web server, not by double-clicking `index.html`. From this folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>. Any static server works (for example `npx serve`).

## Rebuild the data

Only needed if the Census files change. From the repository root:

```bash
node scripts/build-city-assignment-data.mjs <temporary folder>
node course/assignments/site/build-data.mjs <temporary folder>
```

The first command writes the three `group-*.tsv` tables (it also rewrites `course/assignments/data/cities-over-75k.csv`; run `git diff` afterward to see whether that file changed). The second reads those tables and the city CSV and writes `data/cities.json` and `data/groups.json`. It needs the git-ignored files in `data/source/census/`.

## How the numbers are made

- Cities are ranked by the group's size in the chosen period. If two cities have the same size, the lower city code comes first.
- Weighted average = sum of (group size x value) / sum of group size, over the 50 cities, using the group size of the same period.
- A city with no value for a variable is left out of that variable's calculation (its weight is not counted either).
- National values: filled in for all indicators and periods from Census Bureau U.S.-level tables (50 states and DC, same definitions as the city values): `data/national.json` for the seven menu indicators (computed by `fetch/fetch-national.mjs`), plus foreign_born_percent (11.1, 12.7, 14.1) and population (281,421,906; 303,965,272; 334,922,499) in `app.js`. Income can be shown in 2024 dollars (a box on Start here, ticked by default; 2000 and 2006-2010 are restated with the annual CPI-U: 1999 = 166.575, 2010 = 218.056, 2024 = 313.689) or in the published dollars of each period. Students can overtype any value.
- Menu: poverty_percent, unemployment_percent, median_household_income, bachelors_percent, renter_percent, black_percent, hispanic_percent. The five indicators beyond poverty and unemployment come from site/fetch/ (Census 2000 SF3 and ACS 2006-2010 bulk files) and the existing 2020-2024 ACS file; income is in each period's own dollars.
- Part 3 (crime): choosing "Part 3" on Start here gives the three crime rates (overall_crime_rate, violent_crime_rate, property_crime_rate: reported crimes per 100,000 residents, FBI Uniform Crime Reporting; 2000 is one year; 2006-2010 and 2020-2024 are pooled, that is a population-weighted average of the single years' rates, which is the same as all offenses over the period divided by all residents over the period; arson not counted). They come from the crime columns of `../data/cities-over-75k.csv`; rebuild `data/cities.json` with `node course/assignments/site/build-data.mjs` (no folder argument: groups.json is kept). The single-year rates used by the look-ups (`year_values` in `cities.json`) come from `data/source/census/city-crime-years.json`, made by `build-crime-years.mjs` from the same FBI file and the same city matching as the pooled rates:

```bash
node scripts/fetch-ucr-city-crime.mjs <temporary folder>
Rscript scripts/parse-ucr-city-crime.R <temporary folder> <temporary folder>/ucr-city.csv
node course/assignments/site/build-crime-years.mjs <temporary folder>/ucr-city.csv
``` A city with no value is blank and left out of that rate's calculation. No national value is filled in for the crime rates; the student types it.
- The CSV has plain variable names only, for example `poverty_percent_2020_24`. City codes with a leading zero lose it if a spreadsheet opens the file and treats the column as numbers.

## Publish on GitHub Pages (not done)

This has not been published. All paths are relative, so the folder works as it is. One way to do it:

1. Make sure the repository (or a separate repository holding a copy of this folder) is public. The two JSON files are the only data; they hold Census numbers only.
2. In the repository settings, open Pages and choose a source: either a branch and folder, or a GitHub Actions workflow that uploads `course/assignments/site/`. GitHub's built-in "branch" option only offers `/` or `/docs`, so for this subfolder use the Actions option, or copy the folder's contents to the root or `docs/` of a small separate repository.
3. The site would then be at `https://<account>.github.io/<repository>/`. Test it once from that address before giving students the link.

## Knowledge-check gates (local only until approved)

The Weighted averages tab hides the results until the student passes three steps (spec: `../knowledge-check/knowledge-check.md`): (A) predict higher, lower or about the same, then see the true answer with a reason from her own data; (B) a video slot and five questions (the top-weight-city question plus four drawn at random; every answer must be right, a wrong one shows the explanation); (C) three look-ups from her top 50, where one value per city is hidden ("look up" in the Top 50 and Data tabs and blank in the CSV) and she types it from the public source. The page checks typed values against salted fingerprints in `data/spot.json` (built by `build-spot.mjs`), never against stored answers: percentages to one decimal and population to a whole number, accepting one step either side; crime rates within 1.0. A pooled crime rate (2006-2010, 2020-2024) is a weighted average of the yearly rates, so no FBI page shows it: when one is hidden the page names one single year inside the period (drawn from the years that city has, and depending on the student's email) and checks that year's rate, from `cities.json` -> `year_values`. Those single-year rates are built by `build-crime-years.mjs`. At the end the page shows a completion code and a record line; `check-code.mjs "<record line>"` recomputes the code.

The weighted-average video is `media/weighted-average.mp4` (captions `media/weighted-average.vtt`), set in one place, `VIDEO_URL` at the top of `gates.js`; a text version is always shown under it. It plays in Step B and on the lockout screen. It is built from `../knowledge-check/video-script.md` by the scripts in the Community-Context-Media `wavg-work` folder.

### Guessing, waits and the meeting rule

A wrong answer gives a hint only. Missing the same question twice is a lockout: the questions close for `WAIT_MINUTES` (60), the video and a text version stay on screen with unlimited three-city practice examples, and after the wait that question is replaced by a new one. The third lockout in a visit (counted across groups and kept in the browser) stops the page and asks the student to meet with the instructor, who gives a release word; the page keeps only its fingerprint (`RELEASE_FINGERPRINT` in `gates.js`; the word itself is in no published file; change it with `make-release.mjs`). Three wrong entries for the same look-up start the same wait (they do not count toward the meeting, since a mismatch can come from the source, not from understanding). Setting `AFTER_TWO_WRONG` to `task` replaces the wait with a three-city task. The completion record shows the wrong tries, lockouts and meetings. All of these live in the browser (clearing site data resets them) and the page code is public: a nudge, not security.

### Northeastern email (what it does and does not do)

The student types her Northeastern email on Start here (only @northeastern.edu addresses are accepted; it stays in her browser and is never sent anywhere). The page does not check that it is hers. The email seeds the random draws: the same email always gets the same quiz questions and the same three look-ups for the same choices, and a classmate's email gets different ones, so shared answers do not help. It also goes into the completion record, which your instructor checks against who submitted it in Canvas. Setting `ASSIGN_GROUP` to `true` in `gates.js` also fixes the group by email (off by default). There is no sign-in and no usage log: a static page cannot verify who is using it. Real sign-in with tracking needs a server and Northeastern IT approval.

### Opening and locking each part (data/schedule.json)

`data/schedule.json` controls when each part is open: `part2` (the Census indicators) and `part3` (the crime rates) are separate. Each has `opens` and `closes` (a date and time with the Boston offset, `-05:00` in winter and `-04:00` in summer; `null` = no limit) and `locked` (`true` closes that part right now; `message` is optional text shown to students). Part 3 is set to open 2026-11-21 at 12:00 AM Eastern. To change anything, edit that one file and publish it; the page re-reads it every minute, so a lock reaches students who already have the page open. A closed part hides its results and, in the Data tab, its columns. The page takes the time from the web server's clock, so changing a computer's clock does not open a part early. Students only use the tool, so this is a lock at the page level; anyone reading the page code could still find the data.

### Video and instructions tab, and the phone check

The **Video and instructions** tab holds the 2-minute overview video (`media/overview.mp4`, captions in `media/overview.vtt`) and the full student instructions. It opens only after the student saves her Northeastern email. A link ending in `#how` (`https://nu-stats.github.io/community-context/#how`) opens that tab directly. The text is written in one place, `STUDENT-INSTRUCTIONS.md`; after editing it run `node course/assignments/site/build-instructions.mjs`, which writes `data/instructions.html` for the tab. The posted PDF is made from the same text.

On a phone the page shows "Please use a computer" and does not load the tool (`isPhone()` in `app.js`: phone browsers, or a touch screen narrower than 600 pixels). Tablets and computers get through. A phone set to "desktop site" can still get past it.
