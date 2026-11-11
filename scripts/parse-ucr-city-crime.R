# Reads the FBI "Offenses Known to Law Enforcement by City" tables (Table 8) for the years used in the
# community-context assignment and writes one tidy file: year, state, city, population and the
# number of offenses reported. Needs R with the readxl package.
#
#   Rscript scripts/parse-ucr-city-crime.R <folder with the tables> <output.csv>
#
# The folder holds, per year, the unpacked files (see scripts/fetch-ucr-city-crime.mjs):
#   2000, 2006-2010   one Excel table (.xls) named t<year>.xls
#   2020-2024         per-state Excel files (or one all-states file) under z<year>/
# Columns are found by their headings, because the layout differs from year to year.
suppressPackageStartupMessages(library(readxl))
args <- commandArgs(trailingOnly = TRUE)
raw <- args[1]; out <- args[2]

norm <- function(x) { x <- tolower(gsub("[\r\n]+", " ", as.character(x))); x <- gsub("\\s+", " ", trimws(x)); gsub("[0-9]+$", "", x) }
# A dash means zero offenses (the 2000 table); an empty cell means the agency did not report that count.
num <- function(x) { x <- trimws(as.character(x)); x[!is.na(x) & x %in% c("-", "–", "—")] <- "0"; suppressWarnings(as.numeric(gsub("[, ]", "", x))) }
clean_name <- function(x) trimws(gsub("([A-Za-z.)])[0-9]+$", "\\1", trimws(as.character(x))))
title_state <- function(x) { x <- tolower(trimws(gsub("[0-9, ]+$", "", clean_name(x)))); gsub("(^|[ ])([a-z])", "\\1\\U\\2", x, perl = TRUE) }

read_table8 <- function(path, year, file_state = NA) {
  x <- suppressMessages(read_excel(path, col_names = FALSE, col_types = "text", .name_repair = "minimal"))
  h <- which(apply(x, 1, function(r) any(norm(r) == "population")))[1]
  if (is.na(h)) return(NULL)
  head <- norm(unlist(x[h, ]))
  pick <- function(pattern) { i <- which(grepl(pattern, head)); if (length(i)) i[1] else NA }
  col <- list(
    state = pick("^state$"), city = pick("^city( by state)?$"), pop = pick("^population$"),
    murder = pick("^murder"), rape = pick("^(forcible )?rape"), robbery = pick("^robbery"),
    agg = pick("^aggravated"), burglary = pick("^burglary"), larceny = pick("^larceny"), mvt = pick("^motor vehicle")
  )
  if (any(is.na(unlist(col[c("city", "pop", "murder", "rape", "robbery", "agg", "burglary", "larceny", "mvt")])))) {
    stop(paste("missing columns in", path, ":", paste(names(col)[is.na(unlist(col))], collapse = ", ")))
  }
  d <- x[(h + 1):nrow(x), , drop = FALSE]
  city <- as.character(d[[col$city]]); pop <- num(d[[col$pop]])
  # state: a State column (filled down), or section rows in the city column (2000), or the file name
  if (!is.na(col$state)) {
    st <- as.character(d[[col$state]]); st[!is.na(st) & nchar(trimws(st)) == 0] <- NA
    st <- title_state(st); last <- NA
    for (i in seq_along(st)) { if (!is.na(st[i])) last <- st[i] else st[i] <- last }
  } else if (is.na(file_state)) {
    st <- rep(NA_character_, length(city)); last <- NA
    for (i in seq_along(city)) {
      if (is.na(pop[i]) && !is.na(city[i]) && grepl("^[A-Z][A-Z .]+[0-9, ]*$", trimws(city[i])) && nchar(trimws(city[i])) > 3) last <- title_state(city[i])
      st[i] <- last
    }
  } else st <- rep(file_state, length(city))
  g <- function(k) if (is.na(col[[k]])) rep(NA_real_, length(city)) else num(d[[col[[k]]]])
  r <- data.frame(year = year, state = st, city = clean_name(city), population = pop,
                  murder = g("murder"), rape = g("rape"), robbery = g("robbery"), agg = g("agg"),
                  burglary = g("burglary"), larceny = g("larceny"), mvt = g("mvt"), stringsAsFactors = FALSE)
  r[!is.na(r$population) & !is.na(r$city) & !is.na(r$state) & nchar(r$city) > 0, ]
}

state_from_file <- function(f) {
  s <- sub("^.*Law_Enforcement_(.*)_by_City_[0-9]{4}\\.xlsx$", "\\1", basename(f))
  if (identical(s, basename(f))) return(NA)
  gsub("_", " ", s)
}

all <- list()
for (y in c(2000, 2006:2010)) {
  all[[as.character(y)]] <- read_table8(file.path(raw, paste0("t", y, ".xls")), y)
}
for (y in 2020:2024) {
  files <- list.files(file.path(raw, paste0("z", y)), pattern = "Table_?_?0?8.*by_(State_by_)?City.*\\.xlsx$", recursive = TRUE, full.names = TRUE, ignore.case = TRUE)
  if (!length(files)) stop(paste("no Table 8 files for", y))
  parts <- lapply(files, function(f) read_table8(f, y, state_from_file(f)))
  d <- do.call(rbind, parts)
  d <- d[!duplicated(paste(d$state, d$city)), ]       # the 2023 download holds both cuts
  all[[as.character(y)]] <- d
}
res <- do.call(rbind, all)
write.csv(res, out, row.names = FALSE, na = "")
cat("rows per year:\n"); print(table(res$year))
