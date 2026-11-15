# Plan: Assignment A, AI-app version ("Build it, then break it")

**Summary.** In this version of the immigration-and-crime assignment, students
do not receive the finished workbook. Teams use an AI coding tool to build a
small app that reads the course's raw city files and produces the numbers the
assignment needs: the 50 cities where a group lives, weighted averages of
`population`, `foreign_born_percent`, `poverty_percent` and
`unemployment_percent` for three periods, and weighted `overall_crime_rate`,
`violent_crime_rate` and `property_crime_rate`. Then they check the app against
outside sources (Census Bureau data pages, FBI city tables) and against the
instructor's workbook, and report what the AI got wrong. Understanding is
checked three ways: a few numbers each student looks up by hand, a short video
with a quiz, and a "bug hunt" in which students find planted mistakes. The
plan is honest about security: the repository is public, so anything stored in
it can be read; the checks that matter run in the LMS, not in files. This is a
draft with defaults, listed at the end.

## 1. Learning goals

Students will be able to:
1. Explain how each variable is made (counts versus percents, pooled crime
   rates) and compute a weighted average by hand.
2. Direct an AI tool to build a small data app, and read its output critically.
3. Verify a result against an outside source, and say what "verified" means.
4. Recognize common failure types in AI-built data work (see section 7).
5. Describe the context of a group's cities across three periods and relate
   it to crime (the original Assignment A questions).

## 2. The assignment, end to end

**Weeks (default): three weeks after lesson 9.** Teams of 3 (see 2b); each team
picks one group (of the 59). Individual write-up.

**Inputs the instructor publishes (tidy files, no bulk Census files):**
- `cities-over-75k.csv` (exists): 343 cities, three periods.
- `group-counts-*.csv`: group size per city per period (made by the existing
  scripts; to publish in `data/`).
- `city-crime-counts.csv`: offense counts and population per city-year for
  2000, 2006-2010 and 2020-2024, with blanks left blank (to publish; derived
  from `parse-ucr-city-crime.R`, before the rate step).
- A one-page **data page** that says, in plain words, what each column means,
  where it came from, and the known gaps (blank crime counts, 2021 reporting
  change). No table codes.

**Step 1. Spec (week 1).** Each team writes a one-page spec before it prompts:
inputs, outputs, and three examples it will check. Prompts and AI replies are
saved (copy into a log file); the log is handed in.

**Step 2. Build (week 1-2).** The app must output, for the chosen group:
1. `top50.csv`: the 50 cities with the most members in each period's list
   (fixed tie-break: higher count, then city name), with group count and the
   chosen variables.
2. `weighted.csv`: for each period and variable, the weighted average, the
   unweighted mean, and the national value.
3. `coverage.csv`: share of the group's U.S. residents living in those cities.
4. `crime.csv`: weighted `overall_crime_rate`, `violent_crime_rate`,
   `property_crime_rate` per 100,000 for each period, plus the number of
   cities and city-years left out for missing counts.

Any tool is allowed (Python, R, JavaScript, or a spreadsheet script). The app
must run from a README in under five minutes on a clean laptop.

**Step 3. Verify (week 2).** Section 3.

**Step 4. Write (week 3).** The original profile (4+ pages, questions 1-7
of Assignment A) plus two new questions: *How do the three crime rates differ
between your group's cities and the sample? Why is that not evidence that the
group causes or avoids crime?* and *Which of your checks caught a mistake, and
what does that say about trusting an AI result?*

## 2b. Team structure: one app per person, then one pipeline

Teams of 3. Each person owns **one data app** and must hand a teammate a file
that works without explanation. AI is used as a building tool: students
describe, test and correct; they do not ask it to "write the essay."

| Role | Builds an app that returns | Raw input in its own native shape |
| --- | --- | --- |
| **Community** | `population`, `foreign_born_percent`, `poverty_percent`, `unemployment_percent` for the 343 cities, 3 periods | city file, keyed by `city_code` |
| **Group** | the group's member count in each city and period, with the top 50 and coverage | group tables, keyed by city *name and state* |
| **Crime** | pooled `overall_crime_rate`, `violent_crime_rate`, `property_crime_rate` per city and period | FBI city counts, keyed by agency name |

**The team writes a data contract first (class session 1).** One page: the
shared key (7-digit `city_code`, kept as text so leading zeros survive), period
labels (`2000`, `2006_10`, `2020_24`), units (percent as 12.3, not 0.123),
blank rule (blank stays blank, never zero), tie-break, file names and column
names. Each app is tested against the contract before anyone merges.

**Why the merge is real.** The three sources do not share a key. The Group and
Crime apps must be matched to cities by name, so consolidated governments,
"St." versus "Saint", and a city under two agency names are the team's
problem. The merge step (a small script written by all three together, with AI
help) must produce one table: 343 cities by three periods, plus the weighted
averages. The team reports how many cities failed to match at each step and
what it did.

**Why everyone has to do their own work.**
- Each app has its own **hidden test**: the instructor runs it on a source file
  the student has not seen (a second group, or a city list with a few rows
  swapped), so a borrowed app tuned to the sample fails. Run in class or
  through the LMS.
- Each person's 6 look-ups (section 4) come from **their own source**, and a
  5-minute individual oral check asks them to explain one trap in their app.
- File history shows who wrote what; the prompt log is individual.
- The integration session is **live**: each person runs their own app on
  screen. A missing or broken piece blocks the team, so teammates have a reason
  to help early.
- A short peer rating, plus a note on "what I had to fix in a teammate's output."

**Swap lab:** after merging, swap apps and have each person find one bug in a
teammate's output, so verification becomes a team habit.

## 3. Verification checkpoints (each logged on a one-page "check sheet")

| # | Check | Pass rule |
| --- | --- | --- |
| V1 | **Known answer.** Run the app on the 10-city practice file (`weighted-averages-example.xlsx`). | All values match the worked example to 2 decimals. |
| V2 | **Reconcile.** 343 cities; 59 groups; 50 rows per period; group counts across cities do not exceed the group's U.S. total; coverage between 0 and 100%; crime rates in a plausible range (violent below property; no negatives). | Each reconcile line is checked and any exception explained. |
| V3 | **Outside spot-check.** Look up **8 values** (default: 5 Census, 3 FBI) in the original sources, not in the course files: 3 different cities, all 3 periods covered, at least one count, one percent, and one crime rate worked from raw counts by hand. | All 8 match after rounding, or the difference is explained in a sentence. |
| V4 | **Compare with the instructor workbook** (released after V1-V3 are submitted). | Differences under 0.1 for percents and under 1 for crime rates; every larger one is traced to a cause. |
| V5 | **Re-run.** A teammate runs the app from the README on another machine. | Same output files, byte for byte, or the difference is explained. |

## 4. Idea 1: values students look up by hand

**Design.** Each student gets 6 look-ups, drawn by student ID (so neighbors
do not share them): a city and period plus the variable (for example "poverty
percent of city X, 2006-2010"; "offenses of type Y reported by city Z in
2022"). Students find the value in the source tables or on the data page, enter it
in the workbook or app, and add a "receipt": the page name, the row and the
column they read it from. A look-up that includes a **count and a population** is
then used to compute a rate by hand (that is where the pooled-rate idea is
learned).

**Validation, and what is realistic.** The check is "not just any number":
- *In the file (typo guard only).* Store a salted hash of each rounded correct
  value. The workbook or app hashes what the student types and accepts a match.
  Anyone can read the file on GitHub and a percent with one decimal has only
  about 1,000 possible values, so a determined student can brute-force it. It
  stops guessing and typos, not cheating. State this in the syllabus.
- *In the LMS (the real check).* Put the same look-ups in an LMS quiz with
  numeric answers and a tolerance, drawn per student from a question bank. The
  answer key is not in the public repository.
- *Receipts* are graded on a sample: ask for the receipt of two of the six.
  An AI tool can also look values up, so the receipt and a short oral or
  written "show me where" in class matter more than the hash.
- A hosted check (a small serverless function or an Apps Script form that
  holds the key) is the only way to keep a key truly secret and give instant
  feedback. It is optional; the LMS does the job for a course this size.

Because the data are public by design, secrecy is not the goal. The goal is
that a student has opened a source table at least once.

## 5. Idea 2: weighted-average video and quiz

- **Video (about 4 minutes):** three cities, one tiny group, the formula in
  words and with numbers (sum of weight times value, over sum of weights); why
  the plain average is wrong for unevenly spread groups; why crime rates for
  several years are total offenses over total population times 100,000, not an
  average of yearly rates.
- **Quiz (6 questions, unlimited tries, per-student numbers):** compute a
  weighted average; say which of two numbers is the plain average; identify
  the wrong rate method; say what to do with a blank offense count; and say
  why a percent cannot be summed across cities.
- **Gate.** In the LMS, set the quiz as a module requirement that unlocks the
  page holding the instructor workbook and the V4 comparison. That is a real
  gate. A password or code inside a public xlsx or script is not: sheet
  protection and hidden cells in Excel are decoration and anyone can read the
  file. If a workbook must show "unlocked" results, the code the student
  types should come from the LMS after the quiz, and the file may accept it
  (hash check) only as a convenience.

**Fun, not a bummer.** Call the checks a **bug bounty**: each real bug found
earns a point (and a short caption for the class gallery, "My AI said ...").
Plant two bugs in a **starter buggy app** that every team debugs in class
(for example a tie-break that changes the list, and an averaged rate). Teams
that catch a trap before the instructor mentions it get a badge. Wrong AI
answers are the content, not the failure.

## 6. Rubric (100 points)

| Part | Pts | Full marks |
| --- | --- | --- |
| Spec and prompt log | 10 | Clear spec; log shows iteration, not one prompt |
| Own app and hidden test | 15 | Runs from the README; meets the contract; passes the hidden test |
| Team merge | 10 | Contract kept; unmatched cities counted and handled; merged table reconciles |
| Verification (V1-V5) | 20 | All checks done with evidence; exceptions explained |
| Hand look-ups and quiz | 15 | 6 look-ups valid with receipts; quiz passed |
| Bug report and peer rating | 10 | At least three traps found or reasoned about, with the fix |
| Profile and crime comparison | 15 | Original questions plus the two new ones; correct reading of weighted versus plain; no causal claims |
| Reflection on trusting AI | 5 | Names a specific mistake and how it was caught |

## 7. Traps an AI-built app can fall into (from this pipeline)

1. **Fixed-width offset.** The Census 2000 county code sits in columns 32-34;
   reading 30-32 matched only about two counties per state. *Check:* V2
   counts of matched cities.
2. **Name collision.** In PowerShell, `$P` and `$p` are the same variable, so
   a loop overwrote a ranking and it came out as #N/A. *Check:* reproduce on
   the 10-city file.
3. **Places that are not cities.** 355 places were really 343 cities because
   unincorporated census-designated places were included. *Check:* V2 count.
4. **Ties at the cutoff.** Without a fixed tie-break, the list of 50 changes
   from run to run. *Check:* V5.
5. **Blank crime counts.** Chicago reported no rape counts before 2013, so
   its violent and overall totals are blank; the 2021 reporting change left
   many agencies out. The app must leave a rate blank, not treat blank as zero.
   *Check:* V3 on Chicago.
6. **Names that do not match.** FBI city names differ from Census names for
   consolidated governments. A silent "no match" drops the city. *Check:*
   V2 count of unmatched cities, listed.
7. **Average of rates.** Averaging yearly rates is wrong for pooled years;
   use total offenses over total population times 100,000. *Check:* V3
   by-hand worked rate.
8. **Sum versus average.** Summing percents across cities, or using a plain
   average where the weighted one is needed. *Check:* V1.
9. **Mixed sources.** 2020-2024 unemployment comes from a different Census
   table than 2006-2010; the app must say so, not pretend one source. *Check:*
   the references page.
10. **Join mismatches.** Key read as a number (leading zero lost), period labels
    that differ between apps, percent versus fraction, a name that matches two
    cities. *Check:* merged-table counts and the contract.
11. **Confident wrong answers.** The AI may produce nice figures with no
    source. *Check:* every number in the write-up traces to a file or a page.

## 8. Instructor answer key

- **Key set:** the validated workbook `community-context-workbook.xlsx`,
  plus a script that re-creates it (`build-city-assignment-data.mjs` and
  `match-city-crime.mjs` outputs). Keep a private folder (not in the
  repository) with the per-group expected `top50`, `weighted` and `crime`
  files for the 59 groups, and the per-student look-up answers.
- **Golden cases:** the 10-city example (all values), Chicago (blank crime
  rate), one consolidated-government city, and one group with near ties at the
  cutoff.
- **Checking a team:** diff their four output files against the key with a
  small script (tolerance 0.1 for percents, 1 for rates); the diff points to
  the trap.
- **Private versus public:** the key files can sit in the public repository
  after the course ends. During the term, share them only through the LMS.

## Choices I made (redirect me)

1. Teams of 3, one data app each (Community, Group, Crime), then a joint merge; the write-up is individual.
2. The app reads tidy course files; students do not parse the raw Census or
   FBI bulk files (which would take hours).
3. Two new data files must be published first: group counts and raw crime
   counts.
4. Three weeks after lesson 9; any language or tool allowed.
5. 8 outside spot-checks (5 Census, 3 FBI) and 6 hand look-ups per student.
6. Hash check in the file is only a typo guard; the real check is an LMS quiz
   with a module gate. No hosted service.
7. Video about 4 minutes, quiz 6 questions, unlimited tries.
8. "Bug bounty" framing, with a starter buggy app planted with two bugs.
9. Rubric: verification 20, own app 15, team merge 10 (total still 100). Hidden
   per-student tests and a short oral check enforce individual work; no hosted
   service needed.
10. Student wording uses plain variable names only; table codes stay in the
    instructor notes and scripts.
