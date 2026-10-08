export const ACTION_DESCRIPTIONS = {
  fly_to_location: {
    description:
      "Fly the God's Eye View camera to a known city, geocoded country/region/city/landmark, or explicit WGS84 coordinate. Countries/cities frame the whole place; landmarks/buildings use close framing.",
    $position: 1,
    parameters: {
      properties: {
        locationId: {
          description:
            'Known city preset ID. Use when the requested place matches one of these cities.',
          $position: 2,
        },
        query: {
          description:
            'Plain place search query, e.g. "London", "Eiffel Tower", or "Dubai Marina".',
          $position: 1,
        },
        viewMode: {
          description:
            'Optional framing intent. Usually omit this; GEV infers whole-place framing for countries/cities and close framing for landmarks.',
          $position: 2,
        },
        rangeM: {
          description:
            'Optional camera range from the target in meters. Omit it for automatic whole-country/whole-city or close-landmark framing; provide it only when the user explicitly requests a numeric height or distance.',
          $position: 3,
        },
        waitForArrival: {
          description:
            'Set true when a later tool depends on the destination viewport. The result then waits for the camera flight and returns arrived=true; cancellation returns ok=false.',
          $position: 1,
        },
      },
    },
  },
  select_nearest_aircraft: {
    description:
      'Atomically fly to a place, wait for arrival, enable and load Flights or Military Flights in that viewport, exclude on-ground records, and select/follow the nearest airborne aircraft. Healthy fallback feeds remain usable and are reported in the result. This does not open Contacts or Cockpit.',
    $position: 1,
    parameters: {
      properties: {
        layerId: {
          description:
            'Aircraft layer to enable and search. Use flights unless the user explicitly asks for military aircraft.',
          $position: 2,
        },
        locationId: {
          description:
            'Known city preset ID when the place matches one of these cities.',
          $position: 2,
        },
        locationQuery: {
          description: 'Free-form destination when no locationId matches.',
          $position: 2,
        },
      },
    },
  },
  adjust_camera_zoom: {
    description:
      'Move the current Cesium camera closer to or farther from what it is presently looking at. Use for relative zoom requests without changing location.',
    $position: 1,
    parameters: {
      properties: {
        amount: {
          description:
            'Use little for phrases like "a bit" or "a little", medium for ordinary zoom requests, and lot for "way out/in".',
          $position: 2,
        },
      },
    },
  },
  zoom_to_globe: {
    description:
      'Pull the camera out to an ABSOLUTE full-Earth globe view (~18,000 km altitude, the whole planet in frame), keeping the current region centered. Use for "globe view", "whole earth", "see the planet", "zoom all the way out". Never use adjust_camera_zoom for these — its relative steps cannot reach the globe.',
    $position: 1,
  },
  set_layer_visibility: {
    description: "Enable or disable one registered God's Eye View data layer.",
    $position: 1,
    parameters: {
      properties: {
        layerId: {
          description:
            'Every layer in the Data Layers panel is listed; a local-* id names its panel row (local-chicago-events = Chicago Events, local-gang-map = gang territories, local-gang-map-labels = gang names, local-famous-shootings = Famous Shootings, local-miami-homicides-1980s = Miami homicides of the 1980s, and so on). Common-name mapping for the non-obvious ids: space mission(s) → rocket-launches; fires/wildfires/active fires → local-firms (NASA FIRMS); ships/vessels/boats → ais-live-vessels; undersea/submarine cables → telegeography-submarine-cables; datacenters → local-datacenters; dams → local-dams; bikes/bike share → bikeshare; street traffic/congestion → traffic; traffic cameras → cctv; internet radio/stations → radio; ALPR/license plate readers/Flock cameras → alpr-cameras; life expectancy (census tracts) → local-life-expectancy; county life expectancy → local-county-life-expectancy; life expectancy clusters/hot spots (tracts) → local-tract-le-clusters; county life expectancy clusters → local-county-le-clusters; HOLC/redlining map (1930s) → local-holc-redlining; Miami homicide hotspots/homicide density → local-miami-homicide-hotspots; public housing/housing projects → local-public-housing; trauma centers/trauma units → local-trauma-centers; 2015 gun deaths/Gun Violence Archive → local-gva-2015; mass killings/MKDB/Mass Killing Database → local-mkdb.',
          $position: 1,
        },
      },
    },
  },
  show_data_layers_menu: {
    description:
      'Open the data layers dropdown/menu and optionally scroll to a specific layer row without toggling it.',
    $position: 1,
    parameters: {
      properties: {
        layerId: {
          description: 'Optional layer row to scroll into view and highlight.',
          $position: 2,
        },
      },
    },
  },
  set_panel_open: {
    description: 'Open or close a GEV UI panel/dropdown.',
    $position: 1,
  },
  set_context_mode: {
    description:
      'Enter or exit the Global Context sub-mode used by Contacts and Space Missions. Use Contacts only when the user explicitly requests Contacts, and Space Missions only when explicitly requested. A request to open the parent Context panel alone uses set_panel_open and must not activate either sub-mode. Selecting an aircraft does not imply Context.',
    $position: 1,
    parameters: {
      properties: {
        mode: {
          description: 'Use off to exit context mode.',
          $position: 2,
        },
      },
    },
  },
  start_ground_view: {
    description:
      'Start Walking View (first person at street level) or Drone View (hovering 30–120 m up) at the center of the current view. The user then moves with W/A/S/D (Q/E for height) and leaves with Esc. Use only when the user asks to walk, go to street level, or fly a drone.',
  },
  run_stata_analysis: {
    description:
      'Run a statistical analysis in Stata (on this computer) on a layer\'s data: counties, the census tracts of one state, states, or the areas in the current map view. Pass the user\'s words as request whenever you can: the app turns them into Stata code itself. Only if the user dictates code, write each step as one Stata command line. Allowed commands: regress, logit, nbreg, poisson, spregress, spreg, correlate, summarize, tabulate (tab), fre, fs, egen, twoway — with if, in and options, e.g. "regress foreign_born_share poverty unemployment if median_income != ., vce(robust)". Variables: population, foreign_born_count, foreign_born_share (_2010, _2000), poverty, unemployment, bachelors, renters, black, hispanic, no_vehicle, internet, broadband, median_income, life_expectancy (counties; _2000), cluster_status (counties, text), pm25, ozone, park_access, asu_broadband (counties), ntia_internet_use (states), segregation_bw / _hw / _aw (counties, states), plus geoid, state, name, lon, lat. Spatial models: a weights matrix W (inverse distance) is built on the areas with valid values, e.g. "spregress life_expectancy poverty, gs2sls dvarlag(W)". For contiguity weights: "spshape2dta areas" (the session shapefile), then "spmatrix create contiguity W if !missing(y, x)", then the model with the same if; spmatrix also allows summarize, dir, drop, copy, normalize, note, clear, fromdata. The session\'s do-file and log are saved. After it runs, report the key results in plain words (coefficients, significance, N) and any failed step.',
    parameters: {
      properties: {
        geography: {
          description:
            'view = the areas in the current map view (tracts zoomed in, counties zoomed out); county (default); tract (needs state); state.',
        },
        layer: {
          description:
            'Analyze one area layer instead (all of its fields), by its Data Layers name or id, e.g. "Foreign-Born Residents (tracts)" or "local-acs-poverty". Use with geography view (the default) or a state.',
        },
        state: {
          description:
            'Limit to one state (name or postal code). Required for tract data unless geography is view.',
        },
        request: {
          description:
            'Preferred: the user\'s request in their own words, e.g. "spatial regression of the foreign-born share on the poverty rate" or "summarize poverty and unemployment". The app writes the Stata code with its plain-English translator (the same one as the panel), shows it, and runs it. Give request or commands, not both.',
        },
        commands: {
          description:
            'Stata command lines, run in order — only when the user dictates exact Stata code.',
        },
      },
    },
  },
  open_in_stata: {
    description:
      "Open the Stata program itself on this computer with a layer's data loaded and labeled (default: the areas in the current map view), so the user can work in Stata directly. Everything they type and the output are saved as a do-file and a log in the session folder.",
    parameters: {
      properties: {
        geography: {
          description:
            'view (default) = the areas in the current map view; county; tract (needs state); state.',
        },
        layer: {
          description:
            'Analyze one area layer instead (all of its fields), by its Data Layers name or id, e.g. "Foreign-Born Residents (tracts)" or "local-acs-poverty". Use with geography view (the default) or a state.',
        },
        state: {
          description: 'Limit to one state (name or postal code).',
        },
      },
    },
  },
  run_r_analysis: {
    description:
      'Run a statistical analysis in R (on this computer) on a layer data set: counties, the census tracts of one state, states, or the areas in the current map view. Pass the user\'s words as request whenever you can: the app turns them into R code itself. The data frame is d, with the same variables as run_stata_analysis (foreign_born_share, poverty, unemployment, bachelors, median_income, life_expectancy for counties, and so on, plus geoid, state, name, lon, lat). Write each step as one R expression, e.g. "m <- lm(foreign_born_share ~ poverty + unemployment, data = d)", then "summary(m)". Lines may call models (lm, glm with family = binomial or poisson, glm.nb), summaries, tests (cor.test, t.test, chisq.test), plots (plot, hist, boxplot; saved as PNG) and spatial tools: contiguity weights W are ready, e.g. "moran.test(d$poverty, W)" or "lagsarlm(foreign_born_share ~ poverty, data = d, listw = W)"; spatial models run on the areas with valid values. The script and log are saved. After it runs, report the key results in plain words and any failed line.',
    parameters: {
      properties: {
        geography: {
          description:
            'view = the areas in the current map view; county (default); tract (needs state); state.',
        },
        layer: {
          description:
            'Analyze one area layer instead (all of its fields), by its Data Layers name or id, e.g. "Foreign-Born Residents (tracts)" or "local-acs-poverty". Use with geography view (the default) or a state.',
        },
        state: {
          description:
            'Limit to one state (name or postal code). Required for tract data unless geography is view.',
        },
        request: {
          description:
            "Preferred: the user's request in their own words; the app writes the R code with its plain-English translator, shows it and runs it. Give request or lines, not both.",
        },
        lines: {
          description:
            'R expressions, run in order (the data frame is d) — only when the user dictates exact R code.',
        },
      },
    },
  },
  open_in_r: {
    description:
      'Open R itself on this computer (RStudio when installed) with a layer data set loaded as the data frame d (default: the areas in the current map view), so the user can work in R directly. Output is saved as session.log and the commands as session_commands.R.',
    parameters: {
      properties: {
        geography: {
          description:
            'view (default) = the areas in the current map view; county; tract (needs state); state.',
        },
        layer: {
          description:
            'Analyze one area layer instead (all of its fields), by its Data Layers name or id, e.g. "Foreign-Born Residents (tracts)" or "local-acs-poverty". Use with geography view (the default) or a state.',
        },
        state: {
          description: 'Limit to one state (name or postal code).',
        },
      },
    },
  },
  run_spss_analysis: {
    description:
      'Run a statistical analysis in IBM SPSS Statistics (on this computer) on a layer data set: counties, the census tracts of one state, states, or the areas in the current map view. Pass the user\'s words as request whenever you can: the app turns them into SPSS syntax itself. The variables are the same as for run_stata_analysis. Only if the user dictates SPSS syntax, give one command per line (the period is optional), e.g. "REGRESSION /DEPENDENT foreign_born_share /METHOD=ENTER poverty unemployment" or "DESCRIPTIVES VARIABLES=poverty median_income". Allowed commands: REGRESSION, LOGISTIC REGRESSION, GENLIN (Poisson, negative binomial, robust errors), UNIANOVA, GLM, DESCRIPTIVES, FREQUENCIES, CORRELATIONS, CROSSTABS, MEANS, EXAMINE, T-TEST, ONEWAY, NPAR TESTS, FACTOR, RELIABILITY, GRAPH, COMPUTE, RECODE … INTO, RANK, SELECT IF, TEMPORARY. SPSS has no spatial regression; use Stata or R for that. The syntax, the output (output.spv) and the log are saved. After it runs, report the key results in plain words and any failed line.',
    parameters: {
      properties: {
        geography: {
          description:
            'view = the areas in the current map view; county (default); tract (needs state); state.',
        },
        layer: {
          description:
            'Analyze one area layer instead (all of its fields), by its Data Layers name or id, e.g. "Foreign-Born Residents (tracts)" or "local-acs-poverty". Use with geography view (the default) or a state.',
        },
        state: {
          description:
            'Limit to one state (name or postal code). Required for tract data unless geography is view.',
        },
        request: {
          description:
            "Preferred: the user's request in their own words; the app writes the SPSS syntax with its plain-English translator, shows it and runs it. Give request or commands, not both.",
        },
        commands: {
          description:
            'SPSS commands, one per line, run in order — only when the user dictates exact SPSS syntax.',
        },
      },
    },
  },
  open_in_spss: {
    description:
      'Open IBM SPSS Statistics itself on this computer with a syntax window (open.sps) that loads a layer data set, labeled (default: the areas in the current map view); the user chooses Run ▸ All to load it, then works in SPSS directly. The data is also saved as data.sav, and what they run is logged to session.log.',
    parameters: {
      properties: {
        geography: {
          description:
            'view (default) = the areas in the current map view; county; tract (needs state); state.',
        },
        layer: {
          description:
            'Analyze one area layer instead (all of its fields), by its Data Layers name or id, e.g. "Foreign-Born Residents (tracts)" or "local-acs-poverty". Use with geography view (the default) or a state.',
        },
        state: {
          description: 'Limit to one state (name or postal code).',
        },
      },
    },
  },
  generate_area_report: {
    description:
      'Gather data and generate a report that ranks US counties, census tracts (within one state) or states by one measure and lists other measures as columns, saved as PDF, CSV and XLSX (one ZIP). Use for requests like "a report of the 50 counties with the largest immigrant populations with poverty, unemployment, life expectancy and cluster status". Identifiers (state and county FIPS codes, state and county names) are always included. No key needed. After it runs, say the report title, the file name and the first few areas with their values; mention any problems the result lists.',
    parameters: {
      properties: {
        geography: {
          description: 'county (default), tract (needs state), or state.',
        },
        rank_by: {
          description:
            'The measure to rank by: population, foreign-born-count (immigrant population size), foreign-born-share (% foreign-born; -2010 and -2000 for earlier years), poverty, unemployment, bachelors, renters, black, hispanic, no-vehicle, internet, broadband, median-income, life-expectancy (counties), life-expectancy-2000, pm25, ozone, park-access, asu-broadband (counties), ntia-internet-use (states), segregation-bw / segregation-hw / segregation-aw (counties and states). cluster-status and top-countries are columns only.',
        },
        order: {
          description:
            'largest (default: largest, highest, most) or smallest (lowest, fewest).',
        },
        count: {
          description: 'How many areas to list (default 50, at most 500).',
        },
        columns: {
          description:
            'Other measures to list, in the order said (same names as rank_by, plus cluster-status = county life expectancy clustering status and top-countries = largest countries of birth). Omit to use the default columns: population, foreign-born count and share, poverty, unemployment, life expectancy, cluster status.',
        },
        state: {
          description:
            'Limit to one state (name or postal code), e.g. "Massachusetts". Required for tract reports.',
        },
        formats: {
          description: 'Any of pdf, csv, xlsx; default all three.',
        },
      },
    },
  },
  plan_curated_flight: {
    description:
      'Plan (and optionally start) a Curated Flight: a guided tour comparing up to 3 US cities of 100,000+ people on up to 6 data layers, with city / county / state averages and a downloadable report. Needs the Curated Flights key (POWER UP); if locked, tell the user to enter it. Ask for missing cities or layers before calling. Read back the plan and any problems the result lists.',
    parameters: {
      properties: {
        cities: {
          description:
            'City names as said, with the state when given ("Detroit", "Springfield, MA"). At most 3.',
        },
        layers: {
          description:
            'Layer keys: life-expectancy, short-life-clusters (low life expectancy clusters), pm25 (fine particles / air quality), ozone, park-access (parks, green space), holc-hazardous (redlining), public-housing, trauma-centers, poverty, median-income, unemployment, bachelors (college education), renters, black (Black residents), hispanic (Hispanic or Latino residents), no-vehicle, broadband (internet at home), gva-2015 (gun deaths; needs the research key), mkdb (mass killings; needs the research key). The Census measures (poverty through broadband) are ACS 2020–2024 social-structural characteristics. At most 6.',
        },
        record: {
          description:
            'True when the user wants the flight recorded as a video.',
        },
        start: {
          description:
            'True to start flying right away; false to only fill in the plan.',
        },
      },
    },
  },
  control_curated_flight: {
    description:
      'Control the Curated Flights panel and the current tour: open it, read status, start the planned flight, pause, resume, skip to the next step, stop, show_layer (switch the running tour to one of its layers and pause there; give layer), or download the report (PDF), the data (CSV or XLSX), the comparison charts (PNG or JPG images in a ZIP), or download_all (one ZIP with the report, data, charts and city views).',
    parameters: {
      properties: {
        layer: {
          description:
            'For show_layer: the layer as said, e.g. "poverty" or "life expectancy".',
        },
      },
    },
  },
  control_cockpit: {
    description:
      'Read or control Cockpit when the user explicitly requests Cockpit: establish Contacts and enter from a selected or tracked aircraft; exit; or navigate nearby Contacts with optional filters. Selecting or viewing an aircraft alone must not enter Cockpit.',
    $position: 1,
    parameters: {
      properties: {
        action: {
          description:
            'previous/next (or prev) navigates through nearby contacts in Cockpit context. zoom_in/zoom_out step the Cockpit view magnification (zoom out below 1x widens the view for context), zoom_reset returns to 1x, and zoom sets the magnification given in zoom. look_left/look_right/look_up/look_down turn the Cockpit view from the nose; look_ahead faces forward again.',
          $position: 2,
        },
        zoom: {
          description:
            'Magnification from 0.5 (wide) to 8 for action zoom (for example 4 for "zoom 4x"). Only works while Cockpit is active.',
          $position: 2,
        },
        targetLayer: {
          description:
            'Optional contact layer filter for next/previous (for example military for a military-only cycle).',
          $position: 2,
        },
        aircraftClass: {
          description:
            'Optional aircraft class filter (for example helicopter) when using next/previous navigation.',
          $position: 1,
        },
      },
    },
  },
  set_visual_style: {
    description: "Set the active God's Eye View visual filter/style.",
    $position: 1,
  },
  get_entity_context: {
    description:
      'Get current GEV scene context, including basemap/3D-tile target context, selected entity metadata if active, and entities currently visible in the camera view. Area and site layers (life expectancy, life expectancy clusters, HOLC redlining, Miami homicide hotspots, public housing, trauma centers, 2015 gun deaths) are reported under areas: the area under the screen center (atPoint) or the nearest sites (nearby, with distanceKm; countWithin within withinKm), and legend counts; a zoom-in status means fly closer first.',
    $position: 1,
    parameters: {
      properties: {
        scope: {
          description:
            'Use auto by default. selected returns the clicked/selected entity; in_view returns visible entities near the screen center.',
          $position: 2,
        },
        layerId: {
          description:
            'Optional layer filter for visible entity context; any Data Layers panel layer.',
          $position: 2,
        },
      },
    },
  },
  get_current_view_state: {
    description:
      'Read the current camera, style, Context, Cockpit, HUD, detection, map stack, post-processing, scene-playback, tracked-entity, and layer state before choosing another action.',
    $position: 1,
  },
  set_hud: {
    description:
      'Control the intelligence HUD overlay: visibility and/or layout variant.',
    $position: 1,
    parameters: {
      properties: {
        visible: {
          description: 'auto restores style-driven show/hide.',
          $position: 2,
        },
      },
    },
  },
  set_detection: {
    description:
      'Control the detection overlay: on/off, density-derived Sparse/Balanced/Dense profile, and Elastic/Weighted layer allocation.',
    $position: 1,
    parameters: {
      properties: {
        enabled: {
          description:
            'false turns detection OFF; true restores the current density-derived profile.',
          $position: 1,
        },
        densityPct: {
          description:
            'Density snaps to 0, 25, 50, 75, or 100 and derives the active profile.',
          $position: 1,
        },
        allocationStrategy: {
          description:
            'Elastic splits evenly then lends unused slots; Weighted follows demand and semantic weight.',
          $position: 2,
        },
      },
    },
  },
  set_map_stack: {
    description:
      'Switch the basemap/imagery stack (NOT the satellites data layer and NOT a visual style filter).',
    $position: 1,
    parameters: {
      properties: {
        stack: {
          description:
            'photoreal = Google 3D. Use bing-aerial only when the user explicitly says "Bing aerial" — "satellite(s)" never means a basemap; only the explicit phrase "Esri" / "Esri imagery" means esri-imagery.',
          $position: 2,
        },
      },
    },
  },
  set_post_processing: {
    description:
      'Control bloom and sharpen post-processing toggles and intensities.',
    $position: 1,
    parameters: {
      properties: {
        bloom: {
          properties: {
            intensityPct: {
              description: '0-200 (UI percent).',
              $position: 1,
            },
          },
        },
        sharpen: {
          properties: {
            intensityPct: {
              description: '0-100 (UI percent).',
              $position: 1,
            },
          },
        },
      },
    },
  },
  control_scene: {
    description:
      'Cinematic scene playback: list scenes, play one scene by name, stop, advance, or read status. Play starts a single named scene and returns immediately.',
    $position: 1,
    parameters: {
      properties: {
        sceneId: {
          description: 'Scene id or (partial) title for play.',
          $position: 1,
        },
      },
    },
  },
  control_cctv: {
    description:
      'CCTV camera operations: enable/disable the layer, select a camera by name, next/prev/nearest/focus, toggle coverage wedges / projection overlay / auto-hop, "viewshed" for color-coded per-camera coverage volumes, and "adjust" for the on-camera calibration gizmo.',
    $position: 1,
    parameters: {
      properties: {
        cameraQuery: {
          description: 'Camera name or id for select.',
          $position: 1,
        },
        enabled: {
          description:
            'Explicit on/off for coverage/viewshed/adjust/projection/autohop; omit to toggle.',
          $position: 1,
        },
      },
    },
  },
  control_radio: {
    description:
      'Control Internet Radio playback without moving the map. Use select whenever the request includes a station category, name, country, coordinates, or nearby place—even when the user says play. Use play only for an unqualified "turn on/start the radio" request so the current or nearest station begins. Enable only reveals the Radio layer/markers without audio. Also supports disable, resume, pause, stop, next/previous, volume, and status.',
    $position: 1,
    parameters: {
      properties: {
        action: {
          description:
            'Use select for any request qualified by category, station, country, coordinates, or place. Use play only for an unqualified turn on/start/listen request. Use enable only when the user explicitly asks to show or enable the Radio layer or its markers without requesting audio.',
          $position: 2,
        },
        volumePct: {
          description:
            'Required for volume; sets the persistent Radio playback volume.',
          $position: 3,
        },
        category: {
          description:
            'Station category for select/next/previous. When the user requests playback with a category, action must be select, not play.',
          $position: 2,
        },
        locationId: {
          description: 'Known nearby-city anchor for select.',
          $position: 2,
        },
        locationQuery: {
          description:
            'Place to search near, such as "Austin, Texas" or "Seattle". Selection does not fly the camera.',
          $position: 2,
        },
        country: {
          description:
            'Country code or name filter, for example US or United States.',
          $position: 2,
        },
        stationQuery: {
          description: 'Optional station name/tag substring.',
          $position: 2,
        },
      },
    },
  },
  track_entity: {
    description:
      'Find and follow a specific aircraft (callsign/ICAO hex), ship (name/MMSI), or satellite (name/NORAD id) on enabled layers. Camera follows the entity.',
    $position: 1,
    parameters: {
      properties: {
        query: {
          description:
            'Callsign, ship name, satellite name, ICAO hex, MMSI, or NORAD id.',
          $position: 1,
        },
        layerId: {
          description:
            'Optional layer hint: flights | military | ais-live-vessels | satellites.',
          $position: 1,
        },
      },
    },
  },
  stop_tracking: {
    description:
      'Stop following the tracked aircraft/satellite and clear any selected vessel.',
    $position: 1,
  },
  frame_overhead: {
    description:
      'Cinematically frame entities near the current view: pulls the camera back and angles it so nearby aircraft, ships, or satellites are visible together.',
    $position: 1,
    parameters: {
      properties: {
        radiusKm: {
          description:
            'Search radius around the view target. Defaults: 150 aircraft, 120 ships, 3000 satellites.',
          $position: 1,
        },
      },
    },
  },
  annotate_map: {
    description:
      'Draw annotations on the 3D map to visually point out what you are talking about — like sketching on a whiteboard over the world. Use this whenever you mention a specific place, building, campus, boundary, district, or a relationship between two places, so the user can SEE what you mean. Give place NAMES (preferred) or explicit lat/lng; the app resolves them to real-world positions and real building/area outlines — never guess pixel positions. Call this as you begin describing something, and you may mark several places in one call.',
    $position: 1,
    parameters: {
      properties: {
        annotations: {
          description:
            'One or more things to mark. Mark multiple related places together when describing them as a group.',
          $position: 1,
          items: {
            properties: {
              type: {
                description:
                  'pin = planted marker at a spot; highlight = pulsing ring drawing the eye to a point; area = trace the outline of a building/campus/compound/district; arrow = a connector from one place to another (use target as the origin and toTarget as the destination); route = a path through several waypoints (use the points array); label = a floating text callout.',
                $position: 2,
              },
              target: {
                description:
                  'Place name to resolve, e.g. "Palace of Fine Arts, San Francisco", "the Pentagon", "Presidio of San Francisco". Preferred over coordinates. For a specific monument/statue/feature that sits within a larger landmark, use its OWN name + city ("Tejano Monument, Austin", "Texas African American History Memorial, Austin") — do NOT phrase it as "X at the Texas State Capitol", which makes the geocoder collapse several of them onto the same centroid so they stack on one spot.',
                $position: 2,
              },
              points: {
                description:
                  'For type=route: 2+ ordered waypoints the path passes through, each a place name (or coordinates / screen point).',
                $position: 1,
                items: {
                  properties: {
                    target: {
                      description: 'Waypoint place name.',
                      $position: 2,
                    },
                  },
                },
              },
              mode: {
                description:
                  'For type=route: travel mode for a real street-following route (the app returns distance + time). Pick from the verb the user used ("walk" → walking, "drive" → driving). Defaults to walking.',
                $position: 2,
              },
              latitude: {
                description:
                  'Explicit latitude (use only if no good place name exists).',
                $position: 3,
              },
              toTarget: {
                description: 'For type=arrow: the destination place name.',
                $position: 2,
              },
              label: {
                description:
                  'Short caption shown on the map (a few words). Optional.',
                $position: 2,
              },
              color: {
                description:
                  'Accent color. primary = neutral, amber = point of interest, cyan = infrastructure, green = confirmed/safe, red = alert.',
                $position: 2,
              },
              footprint: {
                description:
                  'For type=area/highlight: trace the real building or campus outline from map data. Defaults true for area.',
                $position: 1,
              },
              intent: {
                description:
                  'For type=area: "the_thing" (default) outlines the place itself (its footprint/boundary); "around_the_thing" highlights a surrounding zone (a buffered radius around it). Infer from phrasing: "the Capitol"/"show me X" → the_thing; "around/near/by X" or "the area around X" → around_the_thing.',
                $position: 2,
              },
              entityKind: {
                description:
                  'What KIND of thing the target IS — a fact, not a style choice: building = one structure; compound = campus/grounds/mall/park; district = neighborhood or area of a city; street = a named road/corridor; point_feature = monument/statue/memorial/plaque/fountain or other small point landmark. Set it whenever you know it — it routes the resolver to the right footprint source (point_feature anchors monuments as precise points instead of adopting a nearby building outline).',
                $position: 2,
              },
              screenX: {
                description:
                  'Fallback only: when you cannot name/geocode the place but can SEE it in the latest viewport screenshot, the normalized horizontal position (0=left, 1=right) of the spot. The app converts it back to a real world point under that pixel.',
                $position: 3,
              },
              screenY: {
                description:
                  'Fallback only: normalized vertical position (0=top, 1=bottom) of the spot in the latest viewport screenshot.',
                $position: 3,
              },
              toScreenX: {
                description:
                  'For type=arrow: normalized x of the arrow destination from the screenshot (pixel fallback).',
                $position: 3,
              },
              toScreenY: {
                description:
                  'For type=arrow: normalized y of the arrow destination from the screenshot (pixel fallback).',
                $position: 3,
              },
            },
          },
        },
        flyTo: {
          description:
            'Also move the camera to frame the first annotation. Default false — leave false if the user is already looking at the spot.',
          $position: 1,
        },
        persist: {
          description:
            'Keep annotations until cleared (true, default) or let them auto-fade after ~20s (false).',
          $position: 1,
        },
      },
    },
  },
  clear_annotations: {
    description:
      'Erase ALL map annotations previously drawn with annotate_map. Call this ONLY when the user EXPLICITLY asks to clear or reset the map. Annotations accumulate and persist across navigation and topic changes by design — never clear on your own initiative.',
    $position: 1,
  },
  move_camera: {
    description:
      'Direct the camera like a drone operator: orbit the current view target, pan, tilt, or rotate — one bounded nudge (mode=once) or continuous motion until stopped (mode=continuous). Continuous motion also stops on any manual camera input or when a navigation tool runs. Say the RESULTING state when confirming ("Orbiting slowly").',
    $position: 1,
    parameters: {
      properties: {
        direction: {
          description:
            'Required except for orbit (defaults right/clockwise) and stop.',
          $position: 2,
        },
        mode: {
          description:
            'once = bounded eased nudge (default); continuous = until stop/manual input.',
          $position: 2,
        },
      },
    },
  },
  fly_route: {
    description:
      'Cinematic dolly along an EXISTING route annotation (drawn earlier with annotate_map type=route) — flies the street-following path from start to end. Omit label for the newest route. If no route is drawn, this fails with guidance: draw the route first.',
    $position: 1,
    parameters: {
      properties: {
        label: {
          description: 'Match an existing route mark by (partial) label.',
          $position: 1,
        },
      },
    },
  },
  analyst_query: {
    description:
      'Answer questions ABOUT the data currently loaded on the map — counts, lists, superlatives, and attribute filters over live layers (flights, military, ships, fires, earthquakes). Examples: "how many flights over Texas", "biggest fire near LA", "which ships are headed to Oakland", "anything above 40,000 feet", "fastest thing in view". Queries ONLY client-side data from ENABLED layers — if the needed layer is off, say so and offer to enable it. For a follow-up about the previous answer\'s set ("which of those is closest?"), set followUp=true and send only the new filters/sort.',
    $position: 1,
    parameters: {
      properties: {
        layers: {
          description:
            'Layers to query. fires/wildfires → local-firms; ships/vessels → ais-live-vessels.',
          $position: 2,
        },
        scope: {
          description:
            'Spatial scope. Default: view (near the camera). Use kind=region for "over Texas"-style asks; kind=anywhere for global questions.',
          $position: 2,
          properties: {
            name: {
              description:
                'For kind=region: a state/country ("Texas", "France") or a named natural region ("the Alps", "Gulf of Mexico").',
              $position: 1,
            },
            km: {
              description: 'For kind=radius.',
              $position: 1,
            },
          },
        },
        filters: {
          description:
            'Attribute predicates, ANDed. ALTITUDE IS METERS (40,000 ft = 12192). Fields: altitudeM, speedMps, military, onGround, aircraftClass, callsign, operator, routeOrigin, routeDestination, originCountry (flights); speedKts, shipType, destination (ships); frp, confidence (fires); magnitude, depthKm, place (earthquakes).',
          $position: 1,
        },
        sortBy: {
          description: 'Field to rank by, or "distance" for nearest-first.',
          $position: 1,
        },
        followUp: {
          description:
            'true = re-query the PREVIOUS result set instead of fresh data.',
          $position: 1,
        },
      },
    },
  },
  next_iss_pass: {
    description:
      "When the user asks when the ISS / the space station will next fly over: returns the next visible ISS pass for the current camera location (or an explicit lat/lon) — rise time (ISO + minutes from now), rise compass direction, peak elevation, and duration. Requires the satellites layer to have loaded its catalog at least once this session; if it hasn't, tell the user to enable the satellites layer and try again.",
    $position: 1,
    parameters: {
      properties: {
        latitude: {
          description:
            'Optional observer latitude. Omit to use the current camera position.',
          $position: 3,
        },
        longitude: {
          description:
            'Optional observer longitude. Omit to use the current camera position.',
          $position: 3,
        },
        minElevationDeg: {
          description:
            'Minimum peak elevation (deg) to count as a pass. Default 10.',
          $position: 3,
        },
      },
    },
  },
};
