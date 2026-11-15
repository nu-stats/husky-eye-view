# Knowledge check for the student site: spec and question bank

**Purpose.** Students do not spend hours combing through data, so make sure they still understand how the values are made. The site holds back the final results (the weighted averages) until the student passes three short gates. They are a teaching nudge, not security: the site is public, so a determined student could read the code.

## Order of the gates

1. **Predict, then reveal.** Before anything is shown, the student picks: the weighted average of Variable 1 in 2020–2024 will be *higher than*, *lower than*, or *about the same as* the plain average. The site then reveals the true answer and one reason, built from the student's own data (for example, "Chicago holds 45% of the weight, and its value is higher than most cities"). No wrong answers are blocked; this gate only needs a choice.
2. **Video and knowledge check.** The student watches the weighted-average video (`video-script.md`), then answers **four questions**, picked at random from the bank below, plus the first own-data question. Every answer must be right to continue. A wrong answer shows the explanation and lets the student try again.
3. **Spot-check look-ups.** The site picks **three cities at random** from the student's top 50 and **hides one value** for each (see the rules below). The student looks each one up on the public source, types it in, and the page accepts it if it is within the allowed tolerance. When all three are accepted, the weighted averages unlock.

After the gates, the page shows a **completion code** (below) that the student pastes into the course system.

## Question bank

Own-data questions use the student's own group and cities; the page fills in the `{...}` parts. Concept questions are the same for everyone. Put the right answer in a random position.

**Own-data**
1. *Which of your top 50 cities carries the most weight in 2020–2024?* Choices: five cities, one correct (`{top_city}`). Why: it has the largest group size.
2. *Is your weighted average of {variable 1} in 2020–2024 higher or lower than the plain average of the 50 cities?* Answer from the data. Why: the weighted average leans toward the cities where the group is largest.
3. *About what share of your group's U.S. residents live in your 50 cities in 2020–2024?* Choices: `{coverage}` rounded, and three other values. Why: that is the coverage line; the results describe those cities, not everyone in the group.

**Concept**
4. *City A has 900 group members and a poverty rate of 10%. City B has 100 and 30%. The weighted average poverty rate is closest to:* 10%, **12%**, 20%, 30%. Why: (900 × 10 + 100 × 30) ÷ 1,000 = 12.
5. *Why not just average the 50 city percentages?* **It treats a city with 50 group members the same as a city with 50,000.** / It is too slow. / Percentages cannot be averaged. / It gives the same answer anyway.
6. *If the city with the largest group size had twice as many group members and nothing else changed, the weighted average would move:* **toward that city's value** / away from that city's value / not change.
7. *The pooled 2020–2024 crime rate for a city equals:* **all offenses over the years divided by all residents over the years, times 100,000** (the same as the population-weighted average of the yearly rates) / the simple average of the yearly rates / the latest year's rate.
8. *A city has no violent crime rate for 2000 (for example, it did not report). What does the workbook do?* **Leaves it out of that variable's averages, and does not count its weight** / counts it as zero / stops.
9. *Which is true?* **The weighted average describes the average member of the group; the plain average describes the average city.** / They are always equal. / The plain average is always larger.
10. *A city of 400,000 people has 800 reported crimes in a year. The rate per 100,000 residents is:* 20 / **200** / 2,000 / 8,000. Why: 800 ÷ 400,000 × 100,000 = 200.

## Spot-check rules

- **What is hidden.** One value per chosen city: a Census variable (`foreign_born_percent`, `poverty_percent`, `unemployment_percent`, `population`) for one of the three periods, or a **2000 crime rate** (a single year, so one look-up gives it). Do **not** hide pooled crime rates (2006–10, 2020–24): no single page shows them.
- **Where to look it up (plain words, no table codes).** Percentages and population: the Census Bureau's public data site, find the city and the matching survey. Crime for 2000: the FBI's published table of offenses by city for 2000, and compute crimes ÷ population × 100,000. The site tells the student *where to go*, not the answer.
- **Tolerance.** Percentages and counts: the student's number, rounded to one decimal (percentages) or to a whole number (population), must match. Crime rates: within ±1.0.
- **How the page checks it without storing the answers in plain text.** For each hidden value, the page stores only a fingerprint (a hash of city code, variable, period and the accepted rounded value, with a public salt) for each accepted value (the true value, and one step either side). When the student types a value, the page hashes it the same way and compares. A student cannot read the answer from the code, but could guess in a loop; looking it up is easier.
- **Fair play.** If the student's number is wrong, say "that does not match; check the city, the period, and the units" and let them try again. No lockouts.
- **Random choices** are made per visit, so a classmate's hidden cities differ.

## Completion code

When the student passes all three gates, the page shows a short code made from the group, the three variables, the ranking period and the answers entered. The instructor can recompute it from the same inputs to confirm that the student went through the steps. The student pastes the code into the course system with their write-up. Because the page code is public, this is evidence of effort, not proof.

## Open questions for the instructor

- Who records the video (about 90 seconds, script in `video-script.md`)?
- Should the question bank be shorter (a minimum of four questions per student is assumed)?
- Do you want the completion code recomputed by a small instructor script, or checked by eye?
