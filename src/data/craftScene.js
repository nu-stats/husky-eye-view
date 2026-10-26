/**
 * MapCraft ▸ Show in 3D: a layer as MapCraft draws it, with heights (MapCraft
 * plan/3d.md). The scene is a GeoJSON FeatureCollection with a `mapcraft3d`
 * member; each feature carries only a short `name` and `mc3d`, how to draw
 * it: `fill` and `stroke` (#rrggbb), `opacity` (0–1), `height` (meters above
 * the ground) and, for points, `radius` (meters). Every value is checked and
 * clamped here; nothing else in the file is read.
 *
 * Polygons with a height stand on the terrain as blocks, points with a height
 * as columns; the rest lie on the ground like My files' other shapes.
 */
import * as Cesium from 'cesium';
import { importFeatureName } from './geoFileImport.js';

export const MAX_SCENE_HEIGHT = 100_000;
export const MAX_SCENE_RADIUS = 50_000;
const HEX = /^#[0-9a-f]{6}$/i;

/** Whether parsed GeoJSON is a MapCraft scene this version draws. */
export function isCraftScene(geojson) {
  return (
    geojson?.type === 'FeatureCollection' &&
    geojson.mapcraft3d?.version === 1 &&
    Array.isArray(geojson.features)
  );
}

/** The scene's title, as plain text (empty when none). */
export function craftSceneTitle(geojson) {
  const title = geojson?.mapcraft3d?.title;
  return typeof title === 'string'
    ? title
        .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
        .trim()
        .slice(0, 80)
    : '';
}

const finite = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

/**
 * How to draw one feature, checked: bad colors fall back to `color`, numbers
 * are clamped, a height of 0 or less means flat.
 * @param {unknown} style The feature's `mc3d`.
 * @param {string} color CSS fallback color (#rrggbb).
 */
export function readSceneStyle(style, color = '#39d0ff') {
  const s = style && typeof style === 'object' ? style : {};
  const fill = typeof s.fill === 'string' && HEX.test(s.fill) ? s.fill : color;
  const stroke =
    typeof s.stroke === 'string' && HEX.test(s.stroke) ? s.stroke : fill;
  const height = finite(s.height, 0, MAX_SCENE_HEIGHT) || 0;
  const radius = finite(s.radius, 1, MAX_SCENE_RADIUS) ?? 25;
  return {
    fill,
    stroke,
    opacity: finite(s.opacity, 0, 1) ?? 0.9,
    height,
    radius,
  };
}

const ring = (coordinates) => {
  const list = coordinates.filter(
    (p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]),
  );
  const last = list.length - 1;
  if (last > 0 && list[0][0] === list[last][0] && list[0][1] === list[last][1])
    list.pop();
  return list.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
};

const point = (p) =>
  Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]) ? p : null;

/**
 * The entities' graphics for one geometry, split into its parts.
 * @returns {object[]} Entity options without `name`.
 */
export function sceneGraphics(geometry, style) {
  const fill = Cesium.Color.fromCssColorString(style.fill).withAlpha(
    style.opacity,
  );
  const stroke = Cesium.Color.fromCssColorString(style.stroke);
  const out = [];
  const polygon = (rings) => {
    const [outer, ...holes] = rings.map(ring);
    if (!outer || outer.length < 3) return;
    const hierarchy = new Cesium.PolygonHierarchy(
      outer,
      holes
        .filter((h) => h.length >= 3)
        .map((h) => new Cesium.PolygonHierarchy(h)),
    );
    out.push({
      polygon: style.height
        ? {
            hierarchy,
            material: fill,
            height: 0,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            extrudedHeight: style.height,
            extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            outline: false,
          }
        : {
            hierarchy,
            material: fill,
            classificationType: Cesium.ClassificationType.BOTH,
          },
    });
  };
  const line = (coordinates) => {
    const positions = coordinates
      .filter(point)
      .map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
    if (positions.length >= 2)
      out.push({
        polyline: {
          positions,
          clampToGround: true,
          width: 3,
          material: stroke,
        },
      });
  };
  const dot = (p) => {
    if (!point(p)) return;
    if (style.height)
      out.push({
        position: Cesium.Cartesian3.fromDegrees(p[0], p[1], style.height / 2),
        cylinder: {
          length: style.height,
          topRadius: style.radius,
          bottomRadius: style.radius,
          material: fill,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          outline: false,
        },
      });
    else
      out.push({
        position: Cesium.Cartesian3.fromDegrees(p[0], p[1]),
        point: {
          pixelSize: 10,
          color: fill,
          outlineColor: stroke,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
  };
  switch (geometry?.type) {
    case 'Polygon':
      polygon(geometry.coordinates);
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach(polygon);
      break;
    case 'LineString':
      line(geometry.coordinates);
      break;
    case 'MultiLineString':
      geometry.coordinates.forEach(line);
      break;
    case 'Point':
      dot(geometry.coordinates);
      break;
    case 'MultiPoint':
      geometry.coordinates.forEach(dot);
      break;
    default:
  }
  return out;
}

/**
 * Build a data source for a scene (already parsed and counted).
 * @param {object} geojson
 * @param {{name?: string, color?: string}} [options]
 * @returns {Cesium.CustomDataSource}
 */
export function craftSceneDataSource(
  geojson,
  { name = 'MapCraft 3D', color = '#39d0ff' } = {},
) {
  const dataSource = new Cesium.CustomDataSource(name);
  const entities = dataSource.entities;
  entities.suspendEvents();
  try {
    for (const feature of geojson.features) {
      if (feature?.type !== 'Feature') continue;
      const style = readSceneStyle(feature.properties?.mc3d, color);
      // Fly to it at an angle (src/ui/flyToDataSource.js) when anything stands up.
      if (style.height) dataSource.craftScene3d = true;
      const label = importFeatureName(feature.properties?.name);
      for (const graphics of sceneGraphics(feature.geometry, style))
        entities.add({ ...graphics, ...(label ? { name: label } : {}) });
    }
  } finally {
    entities.resumeEvents();
  }
  return dataSource;
}
