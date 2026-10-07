/** Caption text and file names for view snapshots and clips. */
import { cockpitAltitudeDisplayFt } from '../cockpitMath.js';

const pad = (value) => String(value).padStart(2, '0');

/** Layers named on the strip before it says "+N more". */
export const CAPTION_MAX_LAYERS = 4;

/** "2026-10-04 14:32" in the viewer's local time. */
export function captureTimestamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** File-name slug of a place: "Roxbury, Boston, MA" → "roxbury-boston-ma". */
export function placeSlug(place) {
  return String(place || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

/** husky-eye-view_roxbury-boston-ma_2026-10-04_1432.png */
export function captureFileName({ place, date = new Date(), extension }) {
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const slug = placeSlug(place);
  return (
    ['husky-eye-view', slug, stamp].filter(Boolean).join('_') +
    `.${String(extension || 'png').replace(/^\./, '')}`
  );
}

/** "Life Expectancy, HOLC Redlining +2 more" (empty when nothing is on). */
export function captionLayerText(layers = []) {
  const names = layers.filter(Boolean);
  if (!names.length) return '';
  const shown = names.slice(0, CAPTION_MAX_LAYERS).join(', ');
  const extra = names.length - CAPTION_MAX_LAYERS;
  return `Layers: ${shown}${extra > 0 ? ` +${extra} more` : ''}`;
}

/** The two strip lines: what the view is, then where, when and which layers. */
export function captionLines({ view, place, date = new Date(), layers = [] }) {
  return [
    ['HUSKY EYE VIEW', view].filter(Boolean).join(' · '),
    [place, captureTimestamp(date), captionLayerText(layers)]
      .filter(Boolean)
      .join(' · '),
  ];
}

/** Panel groups that are live feeds or tools rather than map data. */
const NON_DATA_GROUPS = new Set(['Live Feeds', 'Fly & Drone', 'Utilities']);

/** Names of the map-data layers that are on, from `{name, group}` panel rows. */
export function captionLayerNames(rows = []) {
  return rows
    .filter((row) => row?.name && row.group && !NON_DATA_GROUPS.has(row.group))
    .map((row) => row.name.trim());
}

/** "HELICOPTER N835DH · 650 FT" for the aircraft the cockpit rides. */
export function cockpitViewLabel(info) {
  if (!info) return 'COCKPIT';
  if (info.layerId === 'walk' || info.layerId === 'drone') {
    const feet = Number.isFinite(info.altitudeM)
      ? `${Math.round(info.altitudeM * 3.28084).toLocaleString('en-US')} FT ABOVE GROUND`
      : '';
    return [info.layerId === 'walk' ? 'WALKING VIEW' : 'DRONE VIEW', feet]
      .filter(Boolean)
      .join(' · ');
  }
  const family =
    info.layerId === 'military'
      ? 'MILITARY AIRCRAFT'
      : info.layerId === 'lowflyers'
        ? info.klass === 'helicopter' || info.aircraftClass === 'helicopter'
          ? 'HELICOPTER'
          : 'LOW FLYER'
        : 'AIRCRAFT';
  const id = info.callsign || info.registration || info.icao24 || '';
  const feet = cockpitAltitudeDisplayFt(info.altitudeM, info.onGround);
  const altitude = Number.isFinite(feet)
    ? `${Math.round(feet).toLocaleString('en-US')} FT`
    : '';
  return [[family, id].filter(Boolean).join(' '), altitude]
    .filter(Boolean)
    .join(' · ');
}
