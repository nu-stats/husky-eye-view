/**
 * MergeCraft's map: a light 2D map of the United States on a canvas (Web
 * Mercator), with the states — and county lines once zoomed in — as the base
 * and your file on top: its areas shaded by a column in Husky Eye View's gold
 * ramp, or a dot per area or point. No map tiles are fetched; the outlines
 * are the app's own Census files, so nothing about your file leaves the
 * computer.
 *
 * Drag to pan, scroll or pinch to zoom, hover for an area's value; arrow
 * keys, + / − and 0 (fit) work when the map has focus.
 */
import {
  USER_POINT_COLOR,
  USER_RAMP,
  classOf,
  quantileBreaks,
} from '../curated/userData.js';

/** Continental United States, for the first view and FIT with no file. */
export const US_BOX = Object.freeze([-125, 24, -66.5, 49.5]);
const MAX_LAT = 85;
const NO_VALUE = '#5B6170';
const SURFACE = '#0A0A0F';
const LAND = '#171A22';
// Counties are drawn once the view is narrower than this (world units, ~1/20
// of the world: a few states across).
const COUNTY_WIDTH = 0.05;

/** Longitude/latitude to world units: x 0–1 west to east, y 0–1 from the top. */
export function project([lon, lat]) {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2,
  ];
}

/** World units back to longitude/latitude. */
export function unproject([x, y]) {
  return [
    x * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  ];
}

/** A polygon geometry's rings in world units (flat [x0, y0, x1, y1, …]) and bbox. */
export function worldShape(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const rings = [];
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons)
    for (const ring of polygon) {
      const flat = new Float64Array(ring.length * 2);
      ring.forEach((p, i) => {
        const [x, y] = project(p);
        flat[i * 2] = x;
        flat[i * 2 + 1] = y;
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      });
      rings.push(flat);
    }
  return rings.length ? { rings, box } : null;
}

/** Whether world point (x, y) is inside a shape (even–odd over its rings). */
export function insideShape(shape, x, y) {
  if (
    x < shape.box[0] ||
    x > shape.box[2] ||
    y < shape.box[1] ||
    y > shape.box[3]
  )
    return false;
  let inside = false;
  for (const ring of shape.rings)
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i];
      const yi = ring[i + 1];
      const xj = ring[j];
      const yj = ring[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  return inside;
}

/** The view `{cx, cy, k}` (center in world units, pixels per world unit) fitting a lon/lat box. */
export function fitView(box, width, height, pad = 28) {
  const [x0, y1] = project([box[0], box[1]]);
  const [x1, y0] = project([box[2], box[3]]);
  const k = Math.min(
    (width - 2 * pad) / Math.max(x1 - x0, 1e-7),
    (height - 2 * pad) / Math.max(y1 - y0, 1e-7),
  );
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    k: clampZoom(k, width),
  };
}

const clampZoom = (k, width) => Math.max(width * 0.9, Math.min(k, 2 ** 24));

const formatValue = (v) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? 'no value'
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Legend rows for quantile classes: `[{color, text}]`. */
export function legendRows(breaks, colors) {
  if (!breaks.length) return [{ color: colors[0], text: 'All values' }];
  return colors.slice(0, breaks.length + 1).map((color, i) => ({
    color,
    text:
      i === 0
        ? `under ${formatValue(breaks[0])}`
        : i === breaks.length
          ? `${formatValue(breaks[i - 1])} and over`
          : `${formatValue(breaks[i - 1])} – under ${formatValue(breaks[i])}`,
  }));
}

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children))
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  return node;
}

export class FlatMap {
  /** `readContext(path)` → the text of an app file (states, counties). */
  constructor({ host, readContext }) {
    this.host = host;
    this.readContext = readContext;
    this.states = [];
    this.counties = new Map(); // state GEOID → shapes, or a promise
    this.layer = null;
    this.hover = null;
    this.view = null;
    this.fitted = null; // the last box fitted (lon/lat)
    this.moved = false; // panned or zoomed since
    this.pending = false;
    this.pointers = new Map();
    this.build();
    this.ready = this.loadStates();
  }

  build() {
    this.canvas = element('canvas', {
      className: 'flat-map-canvas',
      tabIndex: 0,
      role: 'img',
      ariaLabel:
        'Map of your file. Drag to pan, scroll to zoom; arrow keys, plus, minus and 0 to fit.',
    });
    this.ctx = this.canvas.getContext('2d');
    const zoomButton = (text, label, fn) => {
      const b = element('button', {
        type: 'button',
        className: 'flat-map-button',
        textContent: text,
        ariaLabel: label,
        title: label,
      });
      b.addEventListener('click', fn);
      return b;
    };
    this.controls = element('div', { className: 'flat-map-controls' }, [
      zoomButton('+', 'Zoom in', () => this.zoomBy(2)),
      zoomButton('−', 'Zoom out', () => this.zoomBy(0.5)),
      zoomButton('FIT', 'Fit your file (or the United States)', () =>
        this.fitData(),
      ),
    ]);
    this.legend = element('div', {
      className: 'flat-map-legend',
      hidden: true,
    });
    this.tooltip = element('div', {
      className: 'flat-map-tooltip',
      role: 'status',
      hidden: true,
    });
    this.credit = element('div', {
      className: 'flat-map-credit',
      textContent: 'Outlines: U.S. Census Bureau TIGER/Line',
    });
    this.host.append(
      this.canvas,
      this.controls,
      this.legend,
      this.tooltip,
      this.credit,
    );
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
  }

  async loadStates() {
    try {
      const text = await this.readContext('context/states/states.geojsonl');
      this.states = text
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
        .map((f) => ({
          geoid: String(f.properties?.geoid ?? ''),
          name: f.properties?.name ?? null,
          shape: worldShape(f.geometry),
        }))
        .filter((s) => s.shape);
    } catch {
      this.states = [];
    }
    this.redraw();
  }

  /** County lines for the states in view (loaded on first need). */
  countiesInView() {
    const out = [];
    const [x0, y0, x1, y1] = this.viewBox();
    for (const s of this.states) {
      const b = s.shape.box;
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      const have = this.counties.get(s.geoid);
      if (Array.isArray(have)) out.push(...have);
      else if (!have)
        this.counties.set(
          s.geoid,
          Promise.resolve(
            this.readContext(
              `context/county-life-expectancy/${s.geoid}.geojsonl`,
            ),
          )
            .then((text) =>
              text
                .split(/\r?\n/)
                .filter((l) => l.trim())
                .map((l) => worldShape(JSON.parse(l).geometry))
                .filter(Boolean),
            )
            .catch(() => [])
            .then((shapes) => {
              this.counties.set(s.geoid, shapes);
              this.redraw();
            }),
        );
    }
    return out;
  }

  // ---------- your file ----------

  /** Draw a map preview from the worker: `{mode, records, total}`. */
  show(map, { column = '', label = '' } = {}) {
    const points = map.mode === 'points' || map.mode === 'dots';
    const values = column
      ? map.records.map((r) => r.value).filter(Number.isFinite)
      : [];
    const breaks = values.length ? quantileBreaks(values) : [];
    const colorOf = (v) =>
      !column
        ? points
          ? USER_POINT_COLOR
          : USER_RAMP[2]
        : Number.isFinite(v)
          ? USER_RAMP[Math.min(USER_RAMP.length - 1, classOf(v, breaks))]
          : NO_VALUE;
    const records = map.records
      .map((r) => {
        const color = colorOf(r.value);
        if (r.geometry && !points) {
          const shape = worldShape(r.geometry);
          return shape && { ...r, shape, color };
        }
        const at = r.point || null;
        return at && { ...r, world: project(at), color };
      })
      .filter(Boolean);
    this.layer = { mode: map.mode, points, records, column, label };
    this.hover = null;
    this.tooltip.hidden = true;
    // The legend: classes when shaded, else what the marks are.
    const rows = column
      ? [
          ...legendRows(breaks, USER_RAMP),
          ...(records.some((r) => !Number.isFinite(r.value))
            ? [{ color: NO_VALUE, text: 'No value' }]
            : []),
        ]
      : [
          {
            color: colorOf(null),
            text:
              map.mode === 'points'
                ? 'Your points'
                : map.mode === 'dots'
                  ? `A dot per area (${(map.total || records.length).toLocaleString('en-US')})`
                  : 'Your areas',
          },
        ];
    this.legend.replaceChildren(
      element('strong', { textContent: column ? label : label || 'Your file' }),
      ...rows.map((row) =>
        element('span', { className: 'flat-map-key' }, [
          element('i', { style: `background:${row.color}` }),
          row.text,
        ]),
      ),
    );
    this.legend.hidden = false;
    this.redraw();
  }

  clear() {
    this.layer = null;
    this.hover = null;
    this.legend.hidden = true;
    this.tooltip.hidden = true;
    this.redraw();
  }

  /** Fit a lon/lat box `[west, south, east, north]`. */
  fit(box) {
    const pad = Math.max(
      0.02,
      (box[2] - box[0]) * 0.08,
      (box[3] - box[1]) * 0.08,
    );
    // Kept, so a resize before you move the map fits it again.
    this.fitted = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    this.moved = false;
    this.view = fitView(this.fitted, this.width, this.height);
    this.redraw();
  }

  /** Fit your file, or the continental United States with none. */
  fitData() {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of this.layer?.records || []) {
      const b = r.shape
        ? r.shape.box
        : [r.world[0], r.world[1], r.world[0], r.world[1]];
      box[0] = Math.min(box[0], b[0]);
      box[1] = Math.min(box[1], b[1]);
      box[2] = Math.max(box[2], b[2]);
      box[3] = Math.max(box[3], b[3]);
    }
    if (!Number.isFinite(box[0])) return this.fit(US_BOX);
    const [w, n] = unproject([box[0], box[1]]);
    const [e, s] = unproject([box[2], box[3]]);
    this.fit([w, s, e, n]);
  }

  // ---------- the view ----------

  resize() {
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (!this.view || !this.moved)
      this.view = fitView(this.fitted || US_BOX, this.width, this.height);
    this.draw();
  }

  /** The visible world box [x0, y0, x1, y1]. */
  viewBox() {
    const { cx, cy, k } = this.view;
    return [
      cx - this.width / 2 / k,
      cy - this.height / 2 / k,
      cx + this.width / 2 / k,
      cy + this.height / 2 / k,
    ];
  }

  toScreen(x, y) {
    const { cx, cy, k } = this.view;
    return [(x - cx) * k + this.width / 2, (y - cy) * k + this.height / 2];
  }

  toWorld(sx, sy) {
    const { cx, cy, k } = this.view;
    return [cx + (sx - this.width / 2) / k, cy + (sy - this.height / 2) / k];
  }

  /** Zoom by `factor` keeping the world point under (sx, sy) in place. */
  zoomBy(factor, sx = this.width / 2, sy = this.height / 2) {
    const [wx, wy] = this.toWorld(sx, sy);
    const k = clampZoom(this.view.k * factor, this.width);
    this.moved = true;
    this.view = {
      k,
      cx: wx - (sx - this.width / 2) / k,
      cy: wy - (sy - this.height / 2) / k,
    };
    this.redraw();
  }

  panBy(dx, dy) {
    this.moved = true;
    this.view = {
      ...this.view,
      cx: this.view.cx - dx / this.view.k,
      cy: this.view.cy - dy / this.view.k,
    };
    this.redraw();
  }

  redraw() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  tracePath(shape) {
    const ctx = this.ctx;
    const { cx, cy, k } = this.view;
    const hw = this.width / 2;
    const hh = this.height / 2;
    for (const ring of shape.rings) {
      // Skip vertices closer than ~half a pixel (large outlines when zoomed out).
      let lx = Infinity;
      let ly = Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        const x = (ring[i] - cx) * k + hw;
        const y = (ring[i + 1] - cy) * k + hh;
        if (i === 0) ctx.moveTo(x, y);
        else if (
          Math.abs(x - lx) + Math.abs(y - ly) < 0.6 &&
          i < ring.length - 2
        )
          continue;
        else ctx.lineTo(x, y);
        lx = x;
        ly = y;
      }
      ctx.closePath();
    }
  }

  visible(box, [x0, y0, x1, y1]) {
    return !(box[2] < x0 || box[0] > x1 || box[3] < y0 || box[1] > y1);
  }

  draw() {
    if (!this.view) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, this.width, this.height);
    const vb = this.viewBox();
    // Land and state lines.
    ctx.beginPath();
    for (const s of this.states)
      if (this.visible(s.shape.box, vb)) this.tracePath(s.shape);
    ctx.fillStyle = LAND;
    ctx.fill('evenodd');
    // Your areas.
    const layer = this.layer;
    if (layer && !layer.points)
      for (const r of layer.records) {
        if (!this.visible(r.shape.box, vb)) continue;
        ctx.beginPath();
        this.tracePath(r.shape);
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = r.color;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(10, 10, 15, 0.85)';
        ctx.stroke();
      }
    // County, then state lines above the areas.
    if (vb[2] - vb[0] < COUNTY_WIDTH) {
      ctx.beginPath();
      for (const c of this.countiesInView())
        if (this.visible(c.box, vb)) this.tracePath(c);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.stroke();
    }
    ctx.beginPath();
    for (const s of this.states)
      if (this.visible(s.shape.box, vb)) this.tracePath(s.shape);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.stroke();
    // Dots: an area's center, or your points, ringed in the surface color.
    if (layer?.points) {
      const radius = layer.records.length > 5000 ? 3 : 4.5;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = SURFACE;
      for (const r of layer.records) {
        const [x, y] = this.toScreen(r.world[0], r.world[1]);
        if (x < -8 || y < -8 || x > this.width + 8 || y > this.height + 8)
          continue;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = r.color;
        ctx.fill();
        ctx.stroke();
      }
    }
    // The hovered mark.
    const h = this.hover;
    if (h) {
      ctx.beginPath();
      if (h.shape) this.tracePath(h.shape);
      else {
        const [x, y] = this.toScreen(h.world[0], h.world[1]);
        ctx.arc(x, y, 7, 0, Math.PI * 2);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    }
  }

  // ---------- hover ----------

  /** The mark of your file under screen point (sx, sy), if any. */
  pick(sx, sy) {
    const layer = this.layer;
    if (!layer) return null;
    if (layer.points) {
      let best = null;
      let bestD = 10 * 10; // 10 px: bigger than the dot
      for (const r of layer.records) {
        const [x, y] = this.toScreen(r.world[0], r.world[1]);
        const d = (x - sx) ** 2 + (y - sy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      return best;
    }
    const [wx, wy] = this.toWorld(sx, sy);
    for (let i = layer.records.length - 1; i >= 0; i -= 1)
      if (insideShape(layer.records[i].shape, wx, wy)) return layer.records[i];
    return null;
  }

  showTip(sx, sy) {
    const r = this.pick(sx, sy);
    if (r !== this.hover) {
      this.hover = r;
      this.redraw();
    }
    if (!r) {
      this.tooltip.hidden = true;
      return;
    }
    const title = r.name || (r.geoid ? `GEOID ${r.geoid}` : 'Point');
    this.tooltip.replaceChildren(
      element('strong', { textContent: title }),
      ...(r.name && r.geoid
        ? [element('span', { textContent: `GEOID ${r.geoid}` })]
        : []),
      ...(this.layer.column
        ? [
            element('span', {
              textContent: `${this.layer.column}: ${formatValue(r.value)}`,
            }),
          ]
        : []),
    );
    this.tooltip.hidden = false;
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    const x = Math.max(4, sx + 14 + tw > this.width ? sx - 14 - tw : sx + 14);
    const y = Math.min(Math.max(4, sy - th / 2), this.height - th - 4);
    this.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ---------- input ----------

  bindInput() {
    const c = this.canvas;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, at(e));
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
      this.tooltip.hidden = true;
    });
    c.addEventListener('pointermove', (e) => {
      const p = at(e);
      const last = this.pointers.get(e.pointerId);
      if (!last) {
        this.showTip(p[0], p[1]);
        return;
      }
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2 && pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomBy(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
      } else if (this.pointers.size === 1)
        this.panBy(p[0] - last[0], p[1] - last[1]);
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      if (!this.pointers.size) {
        this.tooltip.hidden = true;
        if (this.hover) {
          this.hover = null;
          this.redraw();
        }
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [x, y] = at(e);
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), x, y);
      },
      { passive: false },
    );
    c.addEventListener('dblclick', (e) => {
      const [x, y] = at(e);
      this.zoomBy(2, x, y);
    });
    c.addEventListener('keydown', (e) => {
      const step = 80;
      const keys = {
        ArrowLeft: () => this.panBy(step, 0),
        ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step),
        ArrowDown: () => this.panBy(0, -step),
        '+': () => this.zoomBy(2),
        '=': () => this.zoomBy(2),
        '-': () => this.zoomBy(0.5),
        0: () => this.fitData(),
      };
      const fn = keys[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    });
  }
}
