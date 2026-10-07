/**
 * The uploaded data on the map: areas tinted by value (five quantile
 * classes, light to dark) with outlines on the upload's own stop; beside
 * another layer, a dot of the same color at each area's center instead, so
 * that layer's colors stay readable. Points are dots in both views.
 * Drawn the way the area layers are (ClassificationPrimitives over tall
 * volumes), so it drapes over terrain and buildings alike.
 */
import * as Cesium from 'cesium';
// The same tall volumes the area layers classify with
// (chunkedAreaLayer.js AREA_VOLUME_*), kept here so this panel module does
// not pull the data layers into the UI package.
const AREA_VOLUME_BOTTOM_M = -120_000;
const AREA_VOLUME_TOP_M = 8_000;
import {
  classOf,
  geometryPoint,
  quantileBreaks,
  toNumber,
} from './userData.js';

/** One hue, light to dark (gold, so it reads over the red/blue research layers). */
export const USER_RAMP = Object.freeze([
  '#FFF3C4',
  '#FFD966',
  '#F4B400',
  '#C77C02',
  '#7A4A00',
]);
const POINT_COLOR = '#FFC72C';
const FILL_ALPHA = 0.5;

const polygonsOf = (geometry) =>
  geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];

function ring(positions) {
  const degrees = [];
  for (const [lon, lat] of positions || [])
    if (Number.isFinite(lon) && Number.isFinite(lat)) degrees.push(lon, lat);
  const n = degrees.length;
  if (n >= 4 && degrees[0] === degrees[n - 2] && degrees[1] === degrees[n - 1])
    degrees.length = n - 2;
  return Cesium.Cartesian3.fromDegreesArray(degrees);
}

function dotImage(css) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 20;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(10, 10, 7, 0, Math.PI * 2);
  ctx.fillStyle = css;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(10, 10, 10, 0.85)';
  ctx.stroke();
  return canvas;
}

export class UserDataOverlay {
  constructor({ viewer, requestRender = () => {} }) {
    this.viewer = viewer;
    this.requestRender = requestRender;
    this.primitives = [];
    this.billboards = null;
    // Areas as dots at their centers: the view used beside another layer, so
    // that layer's own colors stay readable underneath.
    this.dots = null;
    this.mode = 'fill';
    this.legend = null;
    this.visible = false;
  }

  /**
   * Draw a dataset. `outlines` (GEOID -> geometry) gives shapes to records
   * that came without one; `options.column` colors areas by value.
   */
  draw(dataset, options, outlines = new Map()) {
    this.clear();
    if (!dataset || !this.viewer) return { areas: 0, points: 0 };
    const scene = this.viewer.scene;
    // Areas: one shape per drawn key; block groups fold into their tract.
    const areas = new Map();
    const points = [];
    for (const record of dataset.records) {
      const value = options.column
        ? toNumber(record.props[options.column])
        : null;
      const geometry =
        record.geometry ||
        (record.geoid
          ? outlines.get(record.geoid) ||
            (record.level === 'block group'
              ? outlines.get(record.geoid.slice(0, 11))
              : null)
          : null);
      if (!geometry) continue;
      if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
        const coords =
          geometry.type === 'Point'
            ? [geometry.coordinates]
            : geometry.coordinates;
        for (const c of coords) points.push({ point: c, value });
        continue;
      }
      if (!polygonsOf(geometry).length) continue;
      const drawKey =
        record.level === 'block group' && !record.geometry
          ? record.geoid.slice(0, 11)
          : record.geoid || `#${areas.size}`;
      const entry = areas.get(drawKey) || { geometry, values: [] };
      if (value !== null) entry.values.push(value);
      areas.set(drawKey, entry);
    }
    const areaValue = (entry) =>
      entry.values.length
        ? entry.values.reduce((a, b) => a + b, 0) / entry.values.length
        : null;
    const valued = options.column;
    // options.ramp / options.breaks: another palette or class breaks (the
    // analysis map's diverging residuals); quantiles of the gold ramp otherwise.
    const ramp = options.ramp || USER_RAMP;
    const breaks = valued
      ? options.breaks ||
        quantileBreaks(
          [...areas.values()].map(areaValue).concat(points.map((p) => p.value)),
        )
      : [];
    const cssFor = (value) =>
      valued && Number.isFinite(value)
        ? ramp[Math.min(ramp.length - 1, classOf(value, breaks))]
        : null;
    // One ClassificationPrimitive per color, as the area layers batch them.
    const byColor = new Map();
    const outlineInstances = [];
    for (const entry of areas.values()) {
      const css = cssFor(areaValue(entry)) || USER_RAMP[2];
      for (const rings of polygonsOf(entry.geometry)) {
        const [outer, ...holes] = rings.map(ring);
        if (!outer || outer.length < 3) continue;
        const hierarchy = new Cesium.PolygonHierarchy(
          outer,
          holes
            .filter((hole) => hole.length >= 3)
            .map((hole) => new Cesium.PolygonHierarchy(hole)),
        );
        if (!byColor.has(css)) byColor.set(css, []);
        byColor.get(css).push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: hierarchy,
              height: AREA_VOLUME_BOTTOM_M,
              extrudedHeight: AREA_VOLUME_TOP_M,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(css).withAlpha(FILL_ALPHA),
              ),
            },
          }),
        );
        outlineInstances.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({
              positions: [...outer, outer[0]],
              width: 2,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString('#1A1A1A').withAlpha(0.8),
              ),
            },
          }),
        );
      }
    }
    for (const instances of byColor.values()) {
      const primitive = new Cesium.ClassificationPrimitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        classificationType: Cesium.ClassificationType.BOTH,
        asynchronous: true,
      });
      this.primitives.push(scene.primitives.add(primitive));
    }
    if (outlineInstances.length && Cesium.GroundPolylinePrimitive) {
      const outlines = new Cesium.GroundPolylinePrimitive({
        geometryInstances: outlineInstances,
        appearance: new Cesium.PolylineColorAppearance(),
        classificationType: Cesium.ClassificationType.BOTH,
        asynchronous: true,
      });
      this.primitives.push(scene.primitives.add(outlines));
    }
    if (points.length) {
      this.billboards = scene.primitives.add(
        new Cesium.BillboardCollection({ scene }),
      );
      const images = new Map();
      for (const { point, value } of points) {
        const css = cssFor(value) || POINT_COLOR;
        if (!images.has(css)) images.set(css, dotImage(css));
        this.billboards.add({
          position: Cesium.Cartesian3.fromDegrees(point[0], point[1]),
          image: images.get(css),
          width: 14,
          height: 14,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
    if (areas.size) {
      this.dots = scene.primitives.add(
        new Cesium.BillboardCollection({ scene }),
      );
      const images = new Map();
      for (const entry of areas.values()) {
        const center = geometryPoint(entry.geometry);
        if (!center) continue;
        const css = cssFor(areaValue(entry)) || USER_RAMP[2];
        if (!images.has(css)) images.set(css, dotImage(css));
        this.dots.add({
          position: Cesium.Cartesian3.fromDegrees(center[0], center[1]),
          image: images.get(css),
          width: 12,
          height: 12,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
    this.legend = valued
      ? {
          label: options.label,
          breaks,
          colors: ramp.slice(0, breaks.length + 1),
        }
      : {
          label: options.label,
          colors: [points.length ? POINT_COLOR : USER_RAMP[2]],
        };
    this.mode = 'fill';
    this.setVisible(true);
    return { areas: areas.size, points: points.length };
  }

  /** 'fill' (areas tinted) or 'dots' (a dot at each area's center). */
  setMode(mode) {
    this.mode = mode === 'dots' ? 'dots' : 'fill';
    this.setVisible(this.visible);
  }

  setVisible(on) {
    this.visible = Boolean(on);
    const fill = this.visible && this.mode === 'fill';
    for (const primitive of this.primitives) primitive.show = fill;
    if (this.dots) this.dots.show = this.visible && this.mode === 'dots';
    if (this.billboards) this.billboards.show = this.visible;
    this.requestRender();
  }

  clear() {
    const primitives = this.viewer?.scene?.primitives;
    for (const primitive of this.primitives) primitives?.remove(primitive);
    if (this.billboards) primitives?.remove(this.billboards);
    if (this.dots) primitives?.remove(this.dots);
    this.primitives = [];
    this.billboards = null;
    this.dots = null;
    this.legend = null;
    this.visible = false;
    this.requestRender();
  }

  get drawn() {
    return (
      this.primitives.length > 0 ||
      Boolean(this.billboards) ||
      Boolean(this.dots)
    );
  }
}
