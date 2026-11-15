# Immigration and Crime: Community Context. How to use the tool

*Instructions for Assignment A (Part 2: the Census data) and the crime data (Part 3).*

**Tool link:** <https://nu-stats.github.io/community-context/>  
**Video (2 minutes):** <https://nu-stats.github.io/community-context/#how> (the tool's **Video and instructions** tab; it opens once you save your Northeastern email)

---

## Read this first: a tool, not a replacement for understanding

This tool gathers and organizes public data for you: the cities where your group lives, the Census values for each city, the FBI crime rates, and the weighted averages. It saves you hours of looking up numbers by hand. It does **not** replace understanding how those numbers are made. You will be asked to explain them in your paper, and the point of the assignment is that you can say where each number came from and what it means.

For that reason the tool has **built-in learning checks**. You cannot see the final results until you pass them. They are short, and if you read the data you are working with and watch the video, you will pass them without trouble. They are described in detail in [The learning checks](#the-learning-checks) below. Please read that section before you start, so nothing surprises you.

Also: **do not rush.** The two parts open on different dates on purpose. Take each part in a few sittings. Use the same browser each time, and do not clear your browser's saved data between sittings, because the tool keeps your place there.

---

## Before you start

1. Use a laptop or desktop computer with a current browser (Chrome, Edge, Firefox or Safari). **The tool will not work on a smartphone.**
2. Open the link above. Do not open a downloaded copy of the page.
3. Use the same browser and the same computer each time, and not a private or incognito window. The tool remembers your progress in your browser. A private window forgets it when you close it.
4. Have your own Northeastern email ready.
5. Have the assignment text open next to the tool (`community-context.md`).

---

## Part 2. How to get the Census data for your group

### Step 1. Start here: tell the tool who you are

On the **Start here** tab:

1. **Your Northeastern email.** Type it and press **Save**. Only addresses ending in `@northeastern.edu` are accepted. The email stays in your browser and is not sent anywhere. It does two things: it makes your quiz questions and look-ups your own (a classmate gets different ones), and it goes into the completion code you hand in. Use your own email. Your instructor checks the code against who submitted it.
2. **Group (country of birth).** Pick your group from the list. The list has 59 countries and regions of birth that had more than 75,000 members in the United States in 2000 and that the Census Bureau reports the same way in 2000, 2006-2010 and 2020-2024.
3. **Rank the cities by.** Pick one of the three periods: 2000 Census, 2006-2010 survey, or 2020-2024 survey. This period decides *which* 50 cities you get: the 50 cities where your group is largest in that period. (If two cities have exactly the same group size, the one with the lower city code is ranked first.) Use the period your assignment tells you to use. The tool starts on 2020-2024.
4. **Part of the profile.** Choose **Part 2**.
5. **Given 1 and Given 2.** These are fixed: `population` (the number of residents of the city) and `foreign_born_percent` (foreign-born residents as a percent of all residents of the city). Every student gets these two.
6. **Indicators 1, 2 and 3.** These start **blank on purpose**: you must choose them yourself, each from the drop-down. Choose three different indicators from the menu:

| Indicator | What it measures |
| --- | --- |
| `poverty_percent` | People below the poverty level, as a percent of the people for whom poverty is determined |
| `unemployment_percent` | Unemployed people, as a percent of the civilian labor force |
| `median_household_income` | The middle household income in the city, in dollars (see the 2024-dollars box below) |
| `bachelors_percent` | Adults 25 and over with a bachelor's degree or higher, as a percent of adults 25 and over |
| `renter_percent` | Occupied homes that are rented, as a percent of occupied homes |
| `black_percent` | Black or African American alone (not Hispanic), as a percent of residents |
| `hispanic_percent` | Hispanic or Latino of any race, as a percent of residents |

Choose the three that best fit the question you want to ask about your group, and be ready to say why you chose them. You use the same three in every period.

7. **Median income in 2024 dollars.** The box under the drop-downs is ticked by default. Income is published in the dollars of each period (1999, 2010 and 2024), and prices rose a lot between them, so incomes from different periods are not directly comparable. With the box ticked, the tool restates the 2000 and 2006-2010 incomes in 2024 dollars (using the consumer price index), for both the cities and the national value. Untick it to see the published dollars. Say in your paper which one you used.

### Step 2. The Top 50 tab: your cities and their values

Once you have saved your email, chosen a group, and chosen your three indicators, the **Top 50** tab shows a table:

- **rank, city, state, city_code.** The 50 cities, largest group first.
- **group size** (three columns, one for each period). The number of people in that city who were born in your group's country. This is the **weight** you will use for the weighted averages.
- **Five indicators, three columns each** (one for each period): `population`, `foreign_born_percent`, and your three indicators. These are **whole-city** values, not values for your group.
- A **blank** means the Census Bureau has no value for that city. A cell that says **look up** is one of your spot-check values; see Step C of the learning checks.

You can download the table as a **CSV file** with the button above it, to open in Excel or Google Sheets. The column names are the same plain names as in the tool, for example `poverty_percent_2020_24`. If you ticked the 2024-dollars box, income columns are named `median_household_income_2024_dollars_...`.

### Step 3. The Data tab: everything behind the table

The **Data** tab lists all 343 cities (the incorporated places with more than 75,000 residents in all three periods) with every indicator at the three time points, and the size of your group in each city. Click a column heading to sort, and click again to reverse. To find your top 50 by hand, sort by the group size column for your period, largest first: the first 50 rows are your cities. Sorting here does not change the Top 50 tab.

### Step 4. The Weighted averages tab: the learning checks, then the results

Open **Weighted averages**. The results are hidden at first. You pass three short steps (A, B and C, described below), and then the results appear:

- **Step 1. National values.** The national (U.S.) value of each indicator for each period, filled in for you from Census Bureau tables. You can overtype them. Use them in your paper as the national comparison.
- **Step 2. Results for each of your three indicators**, for each period, built step by step:
  - *Number of cities with a value* (a city with no value is left out of that indicator's calculation, and so is its weight).
  - *Sum of the group sizes (the weights)*.
  - *Sum of (group size x value)*: each city's group size times its value, added up.
  - **Weighted average** = the sum of (group size x value) divided by the sum of the group sizes. This describes the typical **member of your group**.
  - *Plain average of the cities*: every city counts the same. This describes the typical **city**.
  - *National value*.
  - *Weighted average minus plain average*. (The tool does not subtract the national value for you: the assignment asks you to compute "weighted average minus national" yourself, so do that subtraction in your own table.)
- **Step 3. How much of your group lives in these 50 cities.** The group's residents in your 50 cities, the group's residents in the whole United States, and the share. A low share means your results describe the large cities where your group lives, not everywhere it lives. Say this in your paper.
- **Check it yourself.** Four lines showing how to rebuild any weighted average by hand from the Top 50 table. Do this once for one number, so you can explain where it comes from.

### What to take into your paper (Part 2)

For each of your three indicators and each period: the weighted average, the plain average, and the national value, plus the share of your group in your 50 cities. The tables and the assignment questions ask you to describe the "average member's" city and how it changed. The CSV from the Top 50 tab is your data appendix.

---

## Part 3. How to get the crime data for the same cities

**Part 3 opens on a later date than Part 2.** Until then, the Part 3 option is marked "(closed)" and the crime columns do not appear. Finish Part 2 first.

### What the crime data are

Three rates, for every one of the 343 cities, for each of the three periods:

| Rate | What it is |
| --- | --- |
| `overall_crime_rate` | Reported violent and property crimes together, per 100,000 residents |
| `violent_crime_rate` | Reported violent crimes (murder, rape, robbery, aggravated assault), per 100,000 residents |
| `property_crime_rate` | Reported property crimes (burglary, larceny-theft, motor vehicle theft), per 100,000 residents |

They come from the FBI's Uniform Crime Reporting city tables (offenses reported to the police). Arson is not counted. **2000 is a single year.** For **2006-2010** and **2020-2024** the rate is **pooled** over the years in the period: all offenses over the years divided by all residents over the years, times 100,000, which equals the population-weighted average of the yearly rates.

Reported crime is not all crime. It depends on what people report and what the police record. Say so when you interpret the numbers.

### Step 1. Choose Part 3

On **Start here**, keep the same email, group and ranking period as in Part 2 (so the cities are the same), then set **Part of the profile** to **Part 3**. The three indicator boxes fill in with the three crime rates and lock: there is nothing to choose.

### Step 2. The Top 50 tab, with crime

The table now shows `population`, `foreign_born_percent` and the three crime rates for your 50 cities (the same cities and the same group sizes as in Part 2).

**Some cities have no value for a period.** The city did not report to the FBI, reported incomplete data, or is not in the table. (For example, Chicago has no rape counts before 2013, so its violent and overall rates are blank for 2000 and 2006-2010.) A blank stays blank. That city is left out of that rate's calculation: the sum of the weights counts only cities with a value, the plain average uses only those cities, and the results show **the number of cities with a value**. Fewer cities means your weighted average describes fewer of your 50 cities. Report this in your paper.

### Step 3. Learning checks, then the results

The learning checks (A, B and C) start again for Part 3, with new questions and new look-ups. In Part 3 Step C, one of your look-ups may be a **crime rate**: the tool names one city, one rate and **one year**, and you work that year's rate out from the FBI's table for that year (the tool tells you how). For 2000 that is the period itself. For a pooled period the hidden cell is the 2006-2010 or 2020-2024 rate, which is a **weighted average of the single years in the period** (each year weighted by the city's population that year), so no one page shows it; the tool asks you for one of those years instead, and which year it asks for depends on your email.

Then the **Weighted averages** tab shows the same step-by-step block for each crime rate. The national value boxes for the crime rates are empty: type the national value your assignment tells you to use.

### What to take into your paper (Part 3)

For each crime rate and each period: the weighted average (the typical member's city), the plain average, and the number of cities with a value. Compare them with the Part 2 results for the same cities.

---

## The learning checks

### Why they are there

A weighted average is simple, but it is easy to produce a number without understanding it. The checks make sure you can say, in your own words, what the weights are, why the plain average and the weighted average differ, and where a number in the table comes from. They also confirm you looked at your own data. They are a teaching step, not a trap.

### The three steps, in order

**Step A. Predict, then see.** Before you see anything, you choose whether the weighted average of your first indicator in 2020-2024 will be *higher than*, *lower than*, or *about the same as* the plain average of your 50 cities. There is no wrong choice. The tool then tells you the true answer and gives a one-line reason built from your own data, for example which city carries the most weight and how its value compares with the others. ("About the same" means within 2% of the plain average.)

**Step B. Video and questions.** Watch the short video on what a weighted average is (under 2 minutes, with captions). A text version is under "Read it instead". Then answer **five questions**. They are drawn from a larger bank, and which ones you get depends on your email, so a classmate's set is different. Two kinds:

- *Questions about your own data*: for example, which of your 50 cities carries the most weight; whether your weighted average is higher or lower than the plain average; what share of your group's U.S. residents live in your 50 cities. You answer these from your own Top 50 table.
- *Concept questions*: for example, a small two-city example to calculate, why you should not just average the city percentages, what happens to the weighted average if the biggest city's group doubles, what the tool does with a city that has no value. In Part 3 there are also questions on how a crime rate per 100,000 residents is built.

Every answer must be right to move on.

**Step C. Look three values up.** The tool picks **three cities at random** from your top 50 and **hides one value** for each. It shows as **look up** in the Top 50 and Data tabs, and it is blank in the CSV. You find each value on the public source yourself and type it in:

- *Population and Census percentages* (foreign-born, poverty, unemployment): the Census Bureau's public data site, data.census.gov. Search for the city and open the profile for the survey the tool names (Census 2000, or the American Community Survey for 2006-2010 or 2020-2024).
- *Crime rates* (Part 3 only): the FBI's published table of offenses known to law enforcement, by city, **for the one year the tool names**. Add up the offenses for that year, divide by the city's population in that table, and multiply by 100,000. The tool asks for a single year because the 2006-2010 and 2020-2024 rates in the table are weighted averages of the single years in the period, which no one FBI page shows. Your year depends on your email, so a classmate gets another one.

The tool accepts your number if it matches to the rounding shown: percentages to one decimal, population to a whole number, crime rates within 1.0. A small difference in the last digit is fine. The point is that you have seen where one number in the table comes from. When all three match, your results unlock.

### What happens when you miss

- **Questions in Step B.**
  - *First wrong answer:* you get a **hint** (not the answer). Try again.
  - *Second wrong answer on the same question:* that is a **lockout**. The questions close for **60 minutes**. A "take a break" box shows the time left. While you wait, watch the video again, read the text version, and try the **practice examples** (small three-city weighted averages, as many as you like). When the 60 minutes are over, the question you missed is replaced by a **new question**.
  - *Third lockout* (counted across your whole visit, over all groups and parts): the tool stops and says **"Something is not landing."** You are asked to **meet with your instructor**. They will go over how a weighted average is made with you and give you a **release word** to continue. This is meant as help: three lockouts is a sign something is not clear yet, and a conversation is faster than more guessing.
- **Look-ups in Step C.** If a number does not match, the tool says to check the city, the period and the units. After **three wrong entries for the same look-up** there is the same **60-minute wait**. Look-up waits do not count toward the "meet with your instructor" rule, because a mismatch can come from the source you used rather than from not understanding.
- **Everything is recorded.** Your completion record (below) includes your wrong tries on questions and look-ups, your lockouts, and any meeting release. Your instructor can see these.

Because of the waits, **do not leave the checks to the last minute.** A lockout late at night before a deadline cannot be waited out in time.

### After you pass: your completion code

When all three steps are passed, the results appear and the page shows a **completion code**, for example `4EE2-24C7-19FC`, and a **record line** under it that lists your email, group, period, indicators, prediction, answers, look-up entries, and wrong tries. Use the **Copy** button and paste **both** into the course system with your write-up. Your instructor can recompute the code from the record line. It is evidence that you went through the steps, together with the numbers in your paper.

---

## If something goes wrong

- **"Part 2 (or 3) opens ..." or "is closed for now."** The part has not opened yet, or your instructor has paused it. Come back later. The tool checks again every minute.
- **The page will not load the data.** Open the tool from the link, not from a saved file. Try another browser.
- **Your email is rejected.** It must end in `@northeastern.edu`.
- **A look-up does not match.** Check, in this order: the right city *and state*; the right survey or year; the right units (a percent to one decimal, a whole number for population, crimes per 100,000 residents for crime); and for the crime look-up, that you divided by the population in the *FBI's table*.
- **Your progress is gone.** You may be in a private window, a different browser, or you cleared saved site data. Go back to the same browser and window you used before. Tell your instructor if you cannot.
- **A number looks wrong.** Say so. Tell your instructor which group, period, indicator and city. A real error in the data is useful to know about.

---

## A last reminder

The tool gets you the data. The assignment is about what you do with it: why you chose your indicators, what the weighted averages say about the cities where the average member of your group lives, how that compares with the plain average and with the nation, how it changed across the three periods, and what the numbers cannot tell you (for example, differences inside a city, or crimes that are not reported).

And tell us how it went. Your experiences with the tool, and your thoughts on how to improve it, are welcome: what was confusing, what was slow, what you wanted it to do. Use the **Test this site** tab, or just say so in class.
