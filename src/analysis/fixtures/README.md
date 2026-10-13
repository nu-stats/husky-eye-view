# Statistics-file fixtures

Small files written by R's **haven** package (2.5, through the ReadStat
library) on 2026-10-13, an implementation independent of Husky Eye View's
own readers and writers. They hold the same four-row data frame: integers
and numbers with missing values, text with accents and a dash, a 300-character
text (244 in the Stata 8–12 files), a date, a date-time, a factor (Female /
Male) and a labelled variable (1 = Low, 2 = Mid, 3 = High) with a variable
label.

- `haven-v8.dta`, `haven-v10.dta`, `haven-v11.dta`, `haven-v13.dta`,
  `haven-v14.dta`, `haven-v15.dta` — Stata formats 113, 114, 115, 117, 118
  and 119 (`write_dta(version = 8 … 15)`).
- `haven-none.sav`, `haven-byte.sav`, `haven-z.zsav` — SPSS, uncompressed,
  bytecode-compressed and zlib-compressed (`write_sav(compress = …)`).
- `haven-d.rds`, `haven-d.RData` — R's own `saveRDS` / `save` (gzip); the
  .RData also holds a second, smaller data frame.

Used by `statRead.test.mjs`. No real data: every value is made up.
