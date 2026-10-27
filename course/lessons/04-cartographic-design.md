# Week 4. Cartographic design

## Goals
- Choose a color scheme that fits the data (sequential, diverging, categorical) and works for color-blind readers.
- Compare classification methods: equal interval, quantile, natural breaks.
- Build a legend a stranger can read.

## Concept (25 min)
- Visual variables: position, size, value, hue. Normalize before you color.
- Same data, three class breaks, three stories (Monmonier, *How to Lie with Maps*).
- Basemap choice: a quiet base lets the data speak.

## Lab (50 min)
1. Pick one tract-level layer. Apply two different styles or break schemes in HEV; take a screenshot of each.
2. Switch base map and sensor look (for example Noir) and note what it does to legibility. Use the clean view for the final screenshot.
3. Export the layer's values (Merge & Export to CSV) and compute quantile and equal-interval breaks in Excel or R.
4. Redo the map with the breaks you chose, and write a caption naming source, year, unit and classification.

## Discussion
Show the class both maps without labels. Which would a city council use, and who
chose the breaks?

## Deliverable
Two maps of one variable with opposite messages, plus a caption for the honest one.

## ArcGIS Pro equivalent
Symbology pane (Graduated Colors, Classification method), Layout legends.

## Gap note
Custom break values may not be settable in HEV; the exported-values step shows
the logic, and students mimic it with the closest available style.
