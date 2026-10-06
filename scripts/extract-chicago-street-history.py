"""
Chicago street history for geocoding the historical homicides, read from
the text layers of two scanned books (saved in data/source/chicago-homicides):

1. renumbering_1909.json — Chicago's 1909 house renumbering: old-to-new
number pairs for each street,
read from the OCR text layer of the Chicago Directory Company's "Plan of
Re-Numbering, City of Chicago" (August 1909, streets outside the Loop).

Each page is a grid of narrow columns that alternate New / Old numbers, in
five bands; a street's heading ("North Halsted St.", "Eberly Avenue") sits
above its rows, and a street that runs past the bottom of a band continues
at the top of the next band (or page). Words are read by their position on
the page, OCR slips are repaired (O->0, l->1, ...), and pairs that do not
fit their neighbours are dropped, so a street keeps only consistent pairs.

Input:  plan_of_renumbering_1909.pdf
Output: renumbering_1909.json  [{heading, dir, name, pairs: [[new, old], ...]}]

2. street_renamings.json — William Martin's 1948 compilation of Chicago
street-name changes ("Chicago Streets", Living History of Illinois:
http://livinghistoryofillinois.com/pdf_files/Chicago%20Streets%20Renaming%201909.pdf).
Each former name is a line starting with "-": "-Milton Ave., Cleveland Ave.
460W 800 to 1200N." Those lines are saved as they are; the homicide build
parses them (scripts/build-chicago-homicides.mjs, parseRenaming).

Input:  street_renaming_1909_lhi.pdf
Output: street_renamings.json  ["-Milton Ave., Cleveland Ave. 460W ...", ...]

    uv run --no-project --with pymupdf scripts/extract-chicago-street-history.py
"""
import json
import re
from pathlib import Path

import pymupdf

SOURCE = Path("data/source/chicago-homicides")
PDF = SOURCE / "plan_of_renumbering_1909.pdf"
OUT = SOURCE / "renumbering_1909.json"
RENAMING_PDF = SOURCE / "street_renaming_1909_lhi.pdf"
RENAMING_OUT = SOURCE / "street_renamings.json"

STREET_TYPES = {
    "st", "street", "sts", "av", "ave", "avenue", "pl", "place", "ct", "court",
    "blvd", "boulevard", "boul", "sq", "square", "ter", "terrace", "road", "rd",
    "drive", "dr", "parkway", "pkwy", "way", "row", "lane", "park", "alley",
}
DIRECTIONS = {"north": "N", "south": "S", "east": "E", "west": "W"}
NOISE_WORDS = {"odd", "even", "nos", "no", "new", "old", "contd", "cont'd",
               "continued", "and", "house", "numbers"}
UNITS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
         "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
         "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14,
         "fifteenth": 15, "sixteenth": 16, "seventeenth": 17,
         "eighteenth": 18, "nineteenth": 19, "twentieth": 20,
         "thirtieth": 30, "fortieth": 40, "fiftieth": 50, "sixtieth": 60,
         "seventieth": 70, "eightieth": 80, "ninetieth": 90}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
        "seventy": 70, "eighty": 80, "ninety": 90}
OCR_DIGITS = str.maketrans({"O": "0", "o": "0", "D": "0", "Q": "0", "U": "0",
                            "u": "0", "I": "1", "l": "1", "i": "1", "|": "1",
                            "!": "1", "J": "1", "j": "1", "Z": "2", "z": "2",
                            "S": "5", "s": "5", "G": "6", "b": "6", "B": "8",
                            "g": "9", "q": "9"})


def ordinal(n):
    if 11 <= n % 100 <= 13:
        return f"{n}TH"
    return f"{n}{ {1: 'ST', 2: 'ND', 3: 'RD'}.get(n % 10, 'TH') }"


def number_words(words):
    """'One Hundred and Third' / 'Twenty-second' -> '103RD' / '22ND'."""
    text = " ".join(words).lower().replace("-", " ")
    parts = [p for p in text.split() if p != "and"]
    total, ok = 0, False
    for p in parts:
        if p == "one" and "hundred" in parts:
            continue
        if p == "hundred":
            total += 100
            ok = True
        elif p in TENS:
            total += TENS[p]
            ok = True
        elif p in UNITS:
            total += UNITS[p]
            ok = True
        else:
            return None
    return ordinal(total) if ok and total else None


def parse_heading(words):
    """['North', 'Halsted', 'St.'] -> ('N', 'HALSTED'), or None."""
    clean = [re.sub(r"[^A-Za-z'-]", "", w) for w in words]
    clean = [w for w in clean if w]
    for end, w in enumerate(clean):
        if w.lower().rstrip(".") in STREET_TYPES and end > 0:
            body = clean[:end]
            break
    else:
        return None
    direction = None
    if len(body) > 1 and body[0].lower() in DIRECTIONS:
        direction = DIRECTIONS[body[0].lower()]
        body = body[1:]
    if not body or any(w.lower() in NOISE_WORDS for w in body):
        return None
    name = number_words(body) or " ".join(body).upper()
    if not re.fullmatch(r"[A-Z0-9' -]{2,40}", name):
        return None
    return direction, name


def as_number(token):
    """An OCR'd house number, or None when it is not one."""
    raw = token.strip(".,:;'`~-_")
    if not raw or len(raw) > 5:
        return None
    digits = sum(ch.isdigit() for ch in raw)
    if digits == 0 or digits < len(raw) - 1:
        return None
    fixed = raw.translate(OCR_DIGITS)
    return int(fixed) if fixed.isdigit() and int(fixed) > 0 else None


def consistent(pairs):
    """Keep pairs that agree with a neighbour: same direction of change and a
    sensible ratio of old to new steps (OCR slips break both)."""
    pairs = sorted(set(pairs))
    keep = []
    for i, (new, old) in enumerate(pairs):
        good = False
        for j in (i - 2, i - 1, i + 1, i + 2):
            if 0 <= j < len(pairs):
                dn = pairs[j][0] - new
                do = pairs[j][1] - old
                if dn and do and 0.2 <= abs(do / dn) <= 5 and abs(dn) <= 120:
                    good = True
                    break
        if good:
            keep.append([new, old])
    return keep


def extract_renamings():
    doc = pymupdf.open(RENAMING_PDF)
    lines = []
    for page in doc:
        for line in page.get_text().split("\n"):
            line = " ".join(line.split())
            if line.startswith("-") and len(line) > 4:
                lines.append(line)
            elif lines and line and not re.match(r"^[A-Z0-9-]", line) and not lines[-1].endswith("."):
                lines[-1] += " " + line  # a former name wrapped onto the next line
    RENAMING_OUT.write_text(json.dumps(lines))
    print(f"street renamings: {len(lines)} former names -> {RENAMING_OUT}")


def extract_renumbering():
    doc = pymupdf.open(PDF)
    sections = []
    current = None
    for page in doc:
        words = page.get_text("words")
        if not any("NUMBERS" in w[4].upper() for w in words[:40]):
            continue
        nums = [(w[0], w[1], as_number(w[4])) for w in words]
        nums = [n for n in nums if n[2]]
        if len(nums) < 20:
            continue
        left = min(n[0] for n in nums)
        right = max(w[2] for w in words if as_number(w[4]))
        band_w = (right - left) / 5
        band_of = lambda x: max(0, min(4, int((x - left + 4) // band_w)))
        # Headings: runs of words on one line within a band.
        lines = {}
        for w in words:
            if re.search(r"[A-Za-z]{2,}", w[4]) and w[1] > 30:
                lines.setdefault((band_of(w[0]), round(w[1] / 3)), []).append(w)
        heads = []
        for (band, _), ws in lines.items():
            ws.sort(key=lambda w: w[0])
            parsed = parse_heading([w[4] for w in ws])
            if parsed:
                heads.append((band, ws[0][1], parsed))
        # Reading order: down each band, left to right.
        events = [(band, y, "h", parsed) for band, y, parsed in heads]
        rows = {}
        for x, y, value in nums:
            if y < 30:
                continue
            rows.setdefault((band_of(x), round(y / 2.5)), []).append((x, value))
        for (band, ry), cells in rows.items():
            events.append((band, ry * 2.5, "r", sorted(cells)))
        events.sort(key=lambda e: (e[0], e[1], e[2] == "r"))
        for band, y, kind, payload in events:
            if kind == "h":
                direction, name = payload
                if not current or (current["dir"], current["name"]) != (direction, name):
                    current = {"heading": " ".join(filter(None, [direction, name])),
                               "dir": direction, "name": name, "pairs": []}
                    sections.append(current)
            elif current:
                cells = payload
                for k in range(0, len(cells) - 1, 2):
                    (x1, new), (x2, old) = cells[k], cells[k + 1]
                    if 8 <= x2 - x1 <= 34:
                        current["pairs"].append((new, old))
    merged = {}
    for s in sections:
        key = (s["dir"], s["name"])
        merged.setdefault(key, {"heading": s["heading"], "dir": s["dir"],
                                "name": s["name"], "pairs": []})
        merged[key]["pairs"] += s["pairs"]
    out = []
    for s in merged.values():
        s["pairs"] = consistent(s["pairs"])
        if len(s["pairs"]) >= 2:
            out.append(s)
    out.sort(key=lambda s: (s["name"], s["dir"] or ""))
    OUT.write_text(json.dumps(out))
    print(f"renumbering 1909: {len(out)} street sections, "
          f"{sum(len(s['pairs']) for s in out)} old/new pairs -> {OUT}")


if __name__ == "__main__":
    extract_renumbering()
    extract_renamings()
