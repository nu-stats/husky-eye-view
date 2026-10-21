import * as Cesium from 'cesium';
import { arcPositions, logScale } from './geo.js';

/**
 * Arcs and endpoint nodes sit this far above the ellipsoid so terrain at a
 * country's label point cannot bury them (the Andes and Tibet reach 4 km).
 */
export const ANCHOR_HEIGHT_M = 4500;

/**
 * One batched Primitive of vertex-coloured polylines plus one point
 * collection for the countries at either end. Rebuilt only when the drawn
 * set changes (view or cap), never per frame.
 *
 * Adapted from uxhimanshuk/ground-view (MIT), src/layers/arcs/render.js:
 * arcs here take their size-class colour, and fade in from the sending end
 * so the bright head shows the direction of the flow.
 */
export function createFlowRenderer() {
  let viewer = null;
  let primitive = null;
  let nodes = null;
  let midpoints = new Map();
  let nodePositions = new Map();

  function remove(item) {
    if (!viewer || !item) return;
    try {
      viewer.scene.primitives.remove(item);
    } catch {
      /* already gone with the scene */
    }
  }

  function clear() {
    remove(primitive);
    remove(nodes);
    primitive = null;
    nodes = null;
    midpoints = new Map();
    nodePositions = new Map();
  }

  function arcColors(count, color, alpha) {
    const colors = [];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 1;
      colors.push(color.withAlpha(alpha * (0.25 + 0.75 * t)));
    }
    return colors;
  }

  return {
    attach(nextViewer) {
      viewer = nextViewer;
    },

    /**
     * Replace the drawn set.
     * @param {Array<object>} arcs Arcs from buildViewArcs, already capped.
     * @param {{bins: Array<{color:string}>, usPoint: {lon:number,lat:number},
     *   selectedIso3?: string|null, show?: boolean}} options
     */
    draw(arcs, { bins, usPoint, selectedIso3 = null, show = true }) {
      clear();
      if (!viewer || arcs.length === 0) {
        viewer?.scene?.requestRender?.();
        return;
      }
      let min = Infinity;
      let max = 0;
      for (const arc of arcs) {
        if (arc.value < min) min = arc.value;
        if (arc.value > max) max = arc.value;
      }
      const palette = bins.map((bin) =>
        Cesium.Color.fromCssColorString(bin.color),
      );
      const instances = [];
      for (const arc of arcs) {
        const { positions } = arcPositions(arc.from, arc.to, {
          baseM: ANCHOR_HEIGHT_M,
        });
        const cartesians = Cesium.Cartesian3.fromDegreesArrayHeights(positions);
        midpoints.set(arc.iso3, cartesians[Math.floor(cartesians.length / 2)]);
        const selected = arc.iso3 === selectedIso3;
        const width =
          logScale(arc.value, min, max, 1.5, 8) + (selected ? 2 : 0);
        const alpha = selected ? 1 : logScale(arc.value, min, max, 0.5, 0.95);
        instances.push(
          new Cesium.GeometryInstance({
            id: arc.iso3,
            geometry: new Cesium.PolylineGeometry({
              positions: cartesians,
              width,
              colors: arcColors(
                cartesians.length,
                selected ? Cesium.Color.WHITE : palette[arc.bin] || palette[0],
                alpha,
              ),
              colorsPerVertex: true,
              arcType: Cesium.ArcType.NONE,
              vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
            }),
          }),
        );
      }
      primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
        releaseGeometryInstances: true,
        allowPicking: true,
      });
      primitive.show = show;
      viewer.scene.primitives.add(primitive);

      nodes = new Cesium.PointPrimitiveCollection();
      const addNode = (iso3, point, size, color) => {
        const position = Cesium.Cartesian3.fromDegrees(
          point.lon,
          point.lat,
          ANCHOR_HEIGHT_M,
        );
        nodePositions.set(iso3, position);
        nodes.add({
          id: `node:${iso3}`,
          position,
          pixelSize: size,
          color,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
        });
      };
      addNode('USA', usPoint, 11, Cesium.Color.WHITE.withAlpha(0.95));
      for (const arc of arcs) {
        const point = arc.to === usPoint ? arc.from : arc.to;
        const selected = arc.iso3 === selectedIso3;
        addNode(
          arc.iso3,
          point,
          selected ? 10 : 6,
          (selected
            ? Cesium.Color.WHITE
            : palette[arc.bin] || palette[0]
          ).withAlpha(0.95),
        );
      }
      nodes.show = show;
      viewer.scene.primitives.add(nodes);
      viewer.scene.requestRender?.();
    },

    setVisible(show) {
      if (primitive) primitive.show = show;
      if (nodes) nodes.show = show;
      viewer?.scene?.requestRender?.();
    },

    /** The ISO3 of a picked arc, or null. */
    pickedArc(picked) {
      return picked &&
        picked.primitive === primitive &&
        typeof picked.id === 'string'
        ? picked.id
        : null;
    },

    /**
     * The visible node closest to a screen position, within `radiusPx`.
     * Arcs converge on the US node, so a pick alone can be crowded out.
     */
    nearestNode(screenPosition, radiusPx = 14) {
      if (!viewer || !nodePositions.size) return null;
      const occluder = new Cesium.EllipsoidalOccluder(
        Cesium.Ellipsoid.WGS84,
        viewer.camera.positionWC,
      );
      let best = null;
      let bestPx = radiusPx;
      const scratch = new Cesium.Cartesian2();
      for (const [iso3, position] of nodePositions) {
        if (!occluder.isPointVisible(position)) continue;
        const win = viewer.scene.cartesianToCanvasCoordinates(
          position,
          scratch,
        );
        if (!win) continue;
        const d = Cesium.Cartesian2.distance(win, screenPosition);
        if (d < bestPx) {
          bestPx = d;
          best = iso3;
        }
      }
      return best;
    },

    /** Where a country's card sits: its arc's midpoint, else its node. */
    anchor(iso3) {
      return midpoints.get(iso3) || nodePositions.get(iso3) || null;
    },

    nodePosition(iso3) {
      return nodePositions.get(iso3) || null;
    },

    counts() {
      return { arcs: midpoints.size, nodes: nodePositions.size };
    },

    destroy() {
      clear();
      viewer = null;
    },
  };
}
