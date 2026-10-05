/**
 * The Curated Flight director: visits each city in turn, shows each chosen
 * layer with a highlight card (city vs county vs state), orbits slowly while
 * the card is up, and ends on a comparison card. It can pause, skip and stop,
 * records the whole tour when asked, and keeps one picture per city for the
 * report. The map's own layer choices are put back when the tour ends.
 */
import * as Cesium from 'cesium';
import { compareSentence, formatValue, layerValues } from './curatedModel.js';

export const FLIGHT_TIMING = Object.freeze({
  flyMs: 5500,
  introMs: 3500,
  layerLoadMs: 2200,
  layerHoldMs: 7000,
  summaryMs: 9000,
});
/** Degrees per second the camera circles a city while a card is up. */
const ORBIT_DPS = 2.5;
const ORBIT_PITCH_DEG = -38;

/** Camera range that frames a city's bounding box from a tilted view. */
export function cityViewRange(bbox) {
  const [w, s, e, n] = bbox;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const widthKm = (e - w) * 111.32 * Math.cos(midLat);
  const heightKm = (n - s) * 110.57;
  const spanM = Math.max(widthKm, heightKm) * 1000;
  return Math.min(90_000, Math.max(9_000, spanM * 1.05));
}

/** The comparison card's lines for the end of a tour. */
export function summaryLines(plan, table, research) {
  return plan.layers.map((key) => {
    const layer = table.layers[key];
    const parts = plan.cities.map((city) => {
      const values = layerValues(city, key, research);
      return `${city.name} ${formatValue({ ...layer, unit: layer.unit.startsWith('%') ? '%' : '' }, values.city)}`;
    });
    return `${layer.label}: ${parts.join(' · ')}`;
  });
}

export class CuratedFlight {
  constructor({
    viewer,
    setLayerEnabled,
    isLayerEnabled,
    holdRender = () => {},
    releaseRender = () => {},
    onCard = () => {},
    onState = () => {},
    capture = null,
    timing = FLIGHT_TIMING,
  }) {
    Object.assign(this, {
      viewer,
      setLayerEnabled,
      isLayerEnabled,
      holdRender,
      releaseRender,
      onCard,
      onState,
      capture,
      timing,
    });
    this.running = false;
    this.paused = false;
    this.skipRequested = false;
    this.stopRequested = false;
    this.orbit = null;
  }

  state(extra = {}) {
    return {
      running: this.running,
      paused: this.paused,
      ...extra,
    };
  }

  pause() {
    if (!this.running) return false;
    this.paused = true;
    this.onState(this.state());
    return true;
  }
  resume() {
    if (!this.running) return false;
    this.paused = false;
    this.onState(this.state());
    return true;
  }
  skip() {
    if (!this.running) return false;
    this.skipRequested = true;
    return true;
  }
  stop() {
    if (!this.running) return false;
    this.stopRequested = true;
    return true;
  }

  /**
   * Show one of the tour's layers for the city on screen now and pause, so
   * the user can look at it (and open Data Layers for anything else); RESUME
   * carries on with the tour.
   */
  async showLayer(key) {
    const tour = this.tour;
    if (!this.running || !tour?.city || !tour.plan.layers.includes(key))
      return false;
    this.paused = true;
    const layer = tour.table.layers[key];
    const locked = tour.missing.includes(key);
    for (const id of tour.layerIds)
      if (id !== layer.layerId) await this.setLayer(id, false);
    if (!locked) await this.setLayer(layer.layerId, true);
    this.onCard(this.layerCard(tour.city, key, locked));
    this.onState(
      this.state({
        step: 'layer',
        city: tour.city.name,
        layer: layer.label,
        manual: true,
      }),
    );
    return true;
  }

  layerCard(city, key, locked) {
    const { table, research } = this.tour;
    const layer = table.layers[key];
    return {
      kind: 'layer',
      title: layer.label,
      subtitle: `${city.name} · ${layer.unit} · data ${layer.vintage}`,
      lines: locked
        ? ['Locked: this layer needs the research key (POWER UP).']
        : [compareSentence(layer, city, layerValues(city, key, research))],
      values: locked ? null : layerValues(city, key, research),
      city,
      layer,
      key,
    };
  }

  /** Wait `ms` of unpaused time; ends early on skip or stop. */
  async wait(ms) {
    let left = ms;
    let last = performance.now();
    while (left > 0 && !this.stopRequested && !this.skipRequested) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, left)));
      const now = performance.now();
      if (!this.paused) left -= now - last;
      last = now;
    }
    const skipped = this.skipRequested;
    this.skipRequested = false;
    return !skipped;
  }

  /**
   * Run a tour. Resolves to `{completed, snapshots}` where snapshots maps a
   * city id to `{bytes, width, height}` (JPEG) for the report.
   */
  async run(plan, table, research = {}, { record = false, missing = [] } = {}) {
    if (this.running) throw new Error('A curated flight is already running.');
    this.running = true;
    this.paused = false;
    this.stopRequested = false;
    this.skipRequested = false;
    const layerIds = plan.layers.map((key) => table.layers[key].layerId);
    const original = new Map(
      layerIds.map((id) => [id, Boolean(this.isLayerEnabled(id))]),
    );
    const snapshots = {};
    this.tour = { plan, table, research, missing, layerIds, city: null };
    this.holdRender('curated-flight');
    this.onState(this.state({ step: 'starting' }));
    if (record) await this.capture?.startClip();
    try {
      for (const [cityIndex, city] of plan.cities.entries()) {
        if (this.stopRequested) break;
        this.tour.city = city;
        this.onState(
          this.state({ step: 'flying', city: city.name, cityIndex }),
        );
        this.onCard({
          kind: 'city',
          title: `${city.name}, ${city.state}`,
          subtitle: `City ${cityIndex + 1} of ${plan.cities.length}`,
          lines: [
            `Population ${city.population.toLocaleString('en-US')} (2024 estimate)`,
            `Principal county: ${city.county?.name || '—'}`,
          ],
        });
        await this.flyToCity(city);
        if (this.stopRequested) break;
        this.startOrbit(city);
        await this.wait(this.timing.introMs);
        if (this.capture?.captureImage && !this.stopRequested) {
          try {
            const shot = await this.capture.captureImage({
              format: 'jpg',
              boost: false,
            });
            snapshots[city.id] = {
              bytes: new Uint8Array(await shot.blob.arrayBuffer()),
              width: shot.width,
              height: shot.height,
            };
          } catch {
            // A missing picture leaves the city page text-only.
          }
        }
        for (const [layerIndex, key] of plan.layers.entries()) {
          if (this.stopRequested) break;
          const layer = table.layers[key];
          this.onState(
            this.state({
              step: 'layer',
              city: city.name,
              layer: layer.label,
              layerIndex,
            }),
          );
          const locked = missing.includes(key);
          for (const id of layerIds)
            if (id !== layer.layerId) await this.setLayer(id, false);
          if (!locked) await this.setLayer(layer.layerId, true);
          await this.wait(this.timing.layerLoadMs);
          this.onCard(this.layerCard(city, key, locked));
          await this.wait(this.timing.layerHoldMs);
        }
        this.stopOrbit();
      }
      if (!this.stopRequested) {
        this.onCard({
          kind: 'summary',
          title: plan.cities.map((city) => city.name).join(' · '),
          subtitle: 'Comparison',
          lines: summaryLines(plan, table, research),
        });
        await this.wait(this.timing.summaryMs);
      }
      return { completed: !this.stopRequested, snapshots };
    } finally {
      this.stopOrbit();
      if (record) this.capture?.stopClip();
      for (const [id, on] of original) await this.setLayer(id, on);
      this.onCard(null);
      this.releaseRender('curated-flight');
      this.tour = null;
      this.running = false;
      this.paused = false;
      this.onState(this.state({ step: 'done' }));
    }
  }

  async setLayer(id, on) {
    try {
      if (Boolean(this.isLayerEnabled(id)) !== on)
        await this.setLayerEnabled(id, on);
    } catch (error) {
      console.warn(`[curated] ${id} toggle failed:`, error);
    }
  }

  /** Fly to a tilted overview of the city; resolves when the flight ends. */
  flyToCity(city) {
    const [lon, lat] = city.center;
    const range = cityViewRange(city.bbox);
    const pitch = Cesium.Math.toRadians(ORBIT_PITCH_DEG);
    const back = range * Math.cos(-pitch);
    const offsetLat = -(back / 110_574);
    const height = range * Math.sin(-pitch);
    return new Promise((resolve) => {
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          lon,
          lat + offsetLat,
          height,
        ),
        orientation: { heading: 0, pitch, roll: 0 },
        duration: this.timing.flyMs / 1000,
        complete: () => resolve(true),
        cancel: () => resolve(false),
      });
    });
  }

  /** Circle the city slowly (paused with the tour). */
  startOrbit(city) {
    this.stopOrbit();
    const [lon, lat] = city.center;
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const range = cityViewRange(city.bbox);
    let heading = 0;
    let last = performance.now();
    const remove = this.viewer.scene.preRender.addEventListener(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this.paused) heading += Cesium.Math.toRadians(ORBIT_DPS) * dt;
      this.viewer.camera.lookAt(
        center,
        new Cesium.HeadingPitchRange(
          heading,
          Cesium.Math.toRadians(ORBIT_PITCH_DEG),
          range,
        ),
      );
    });
    this.orbit = remove;
  }

  stopOrbit() {
    if (!this.orbit) return;
    this.orbit();
    this.orbit = null;
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
}

/** Paint the current card into a captured frame (clips and report pictures). */
export function paintCard(ctx, width, height, card) {
  if (!card) return;
  const scale = height / 1080;
  const pad = 28 * scale;
  const boxWidth = Math.min(width * 0.46, 860 * scale);
  ctx.save();
  ctx.font = `600 ${30 * scale}px "Inter", "Segoe UI", sans-serif`;
  const titleSize = 34 * scale;
  const bodySize = 24 * scale;
  const wrap = (text, size, maxWidth) => {
    ctx.font = `400 ${size}px "Inter", "Segoe UI", sans-serif`;
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const inner = boxWidth - pad * 2;
  const bodyLines = (card.lines || []).flatMap((line) =>
    wrap(line, bodySize, inner),
  );
  const boxHeight =
    pad * 2 +
    titleSize * 1.3 +
    bodySize * 1.4 +
    bodyLines.length * bodySize * 1.4;
  const x = 40 * scale;
  const y = height - boxHeight - 150 * scale;
  ctx.fillStyle = 'rgba(8, 10, 14, 0.82)';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = '#C8102E';
  ctx.fillRect(x, y, 6 * scale, boxHeight);
  let ty = y + pad + titleSize;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${titleSize}px "Inter", "Segoe UI", sans-serif`;
  ctx.fillText(card.title || '', x + pad, ty);
  ty += bodySize * 1.4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = `500 ${bodySize * 0.9}px "Inter", "Segoe UI", sans-serif`;
  ctx.fillText(card.subtitle || '', x + pad, ty);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `400 ${bodySize}px "Inter", "Segoe UI", sans-serif`;
  for (const line of bodyLines) {
    ty += bodySize * 1.4;
    ctx.fillText(line, x + pad, ty);
  }
  ctx.restore();
}
