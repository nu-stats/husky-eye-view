# Week 2. Where things are: coordinates and projections

## Goals
- Read latitude/longitude and say which is x and which is y.
- Explain datum, projection and why area, distance and shape cannot all be preserved.
- Know what HEV stores and displays, and what an export keeps.

## Concept (25 min)
- Geographic vs projected coordinates; WGS 84; Web Mercator; state plane.
- Distortion: Greenland vs Africa; why a "1 km buffer" in degrees is wrong.
- Why crime analysts use local projected systems for distance work.

## Lab (50 min)
1. In HEV, fly to a location by typing coordinates; confirm with search. Swap lat/long on purpose and see where you land.
2. Compare the same city on the 3D globe at a tilt and from straight above. Where does the globe avoid Mercator's distortion?
3. Measure the distance between two trauma centers by eye, then by the HEV measurement or route tool if present; compare to a straight line.
4. Open Merge & Export, convert a small CSV of coordinates to a shapefile. Inspect the `.prj`: it declares WGS 84 longitude/latitude. Open the `.dbf` in Excel.
5. Make a deliberate error: put longitude in the latitude column. Describe the result.

## Discussion
When is a degree-based answer good enough, and when does it mislead a police
patrol allocation question?

## Deliverable
One page: three common coordinate mistakes with a screenshot of one you made.

## ArcGIS Pro equivalent
Map Properties > Coordinate Systems, Project tool, Define Projection.

## Gap note
HEV displays WGS 84 only and has no reprojection tool. Students learn the
concepts here and reproject in QGIS or ArcGIS Pro (optional extension).
