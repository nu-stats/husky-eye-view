# Week 11. Hot spots and clustering

## Goals
- Explain density surfaces, hot spots, and spatial autocorrelation in plain terms.
- Judge whether a visible cluster could be chance.
- Write a final project proposal.

## Concept (25 min)
- "Everything is related to everything else, but near things are more related" (Tobler).
- Kernel density, grid counts, hot spot tests (Getis-Ord Gi*), Moran's I, and the law of crime concentration at places (Weisburd).
- Hot spots depend on bandwidth, unit and baseline; they describe past records, not risk.

## Lab (50 min)
1. In HEV, view tract data with clustering enabled where a layer offers it (for example the tract life expectancy cluster files). Describe what is clustered.
2. Make a hand version of a hot spot map: divide a city into a grid in Excel, count incidents per cell, shade the top decile.
3. Change the cell size and redo. How much did the "hot spots" move?
4. Export the tract data (CSV or shapefile) for an optional Moran's I in R or QGIS with the instructor's script.

## Final project proposal (due)
Question, city, data, method, one risk to validity.

## Deliverable
Two grid maps at different cell sizes, and a paragraph on stability.

## ArcGIS Pro equivalent
Kernel Density, Hot Spot Analysis (Getis-Ord Gi*), Spatial Autocorrelation (Moran's I).

## Gap note
No native density or hot spot tool. Teach the logic with the grid exercise;
offer the Moran's I run as an optional export step.
