# A first try with no setup (step 2)

The question: can someone open a link and use Husky Eye View without
installing Pinokio, Node or any keys?

## What the app needs

Husky Eye View is a browser app with its own small server (the same Node
process Pinokio starts). The pieces split cleanly:

| Part | Needs the server? | Why |
| --- | --- | --- |
| Research layers (life expectancy, HOLC, segregation, census, internet, air and green space, enumeration districts, migration flows) | No | Bundled files under `public/context/`, read by the browser. |
| My files, Time Lens, Area Reports, Moran's I, Merge & Export, Excel workbooks | No | Run in the browser. |
| Live feeds (flights, ships, traffic, cameras, weather, fires, transit) | Yes | The server calls the providers, holds any keys and caches results (`/api/...`). |
| Restricted research data (GVA, MKDB, Chicago homicides) | Yes | The server checks the research key (`/api/research`). |
| Stata, R and SPSS runs | Yes, on the user's own computer | The server starts the program locally. |
| POWER UP keys, voice | Yes | Keys are entered into the local server (`/api/setup`, `/api/realtime`). |

## Options

1. **Point first-time visitors to Husky Merge (available now).** It is on the
   web at https://nu-stats.github.io/husky-eye-view/husky-merge/ with no setup:
   your file joined to tracts or counties, a map, and the merged file with its
   do-file and R script. It is the "first win" of step 1 without the globe.
2. **A static research viewer on GitHub Pages (recommended next).** A build
   flag that leaves out every server-backed feature (live feeds, POWER UP,
   voice, Stata/R/SPSS runs, restricted data) and keeps the research layers,
   My files, Time Lens, Merge & Export and Area Reports. Free to host, nothing
   to secure, nothing to keep running. Work: a viewer build that skips the
   `/api` features and hides their menus (the menus-on-screen code from step 3
   already does the hiding), plus a check that the bundled data fits GitHub
   Pages limits (1 GB site, 100 MB per file). Estimate: two to three days.
3. **A hosted server (Render, Fly.io, or a Northeastern VM).** The full app
   minus the statistics programs. **The Stata, R and SPSS run endpoints must
   never be reachable from the internet**: they run code on the machine. A
   public server also needs rate limits, a keys policy and someone to keep it
   up. Only worth it for a class or a lab that needs the live feeds.

## Recommendation

Use option 1 in every invitation now ("try it in your browser, then install
the full app"), and build option 2 when the labs (step 5) are first taught:
students then get the research layers and the swipe with one link, and
install Pinokio only for Stata or R.
