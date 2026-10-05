/**
 * Walking and Drone views: the cockpit with a camera the user drives instead
 * of a tracked aircraft. Zoom, look-around, the LAYERS slider, clickable pins,
 * the Data Layers menu and snapshot/clip all carry over from the cockpit.
 *
 * Walking keeps the eye a set height above the photoreal surface under it and
 * refuses steps up taller than a curb, so building walls stop you. The drone
 * holds its own altitude and never drops below a minimum clearance.
 */
import * as Cesium from 'cesium';
import { normalizeHeading } from '../cockpitMath.js';

export const GROUND_VIEW_MODES = Object.freeze(['walk', 'drone']);

/** Mode settings. Heights are meters above the surface under the camera. */
export const GROUND_VIEW_SETTINGS = Object.freeze({
  walk: Object.freeze({
    label: 'WALKING VIEW',
    startHeightM: 1.7,
    minHeightM: 1.7,
    maxHeightM: 30,
    speedMps: 1.6,
    fastSpeedMps: 6,
    climbMps: 3,
    basePitchDeg: 0,
  }),
  drone: Object.freeze({
    label: 'DRONE VIEW',
    startHeightM: 60,
    minHeightM: 10,
    // 400 ft, the US recreational drone ceiling.
    maxHeightM: 122,
    speedMps: 10,
    fastSpeedMps: 30,
    climbMps: 4,
    basePitchDeg: -15,
  }),
});

/** Area-layer fill opacity (percent) a ground view starts with. */
export const GROUND_LAYER_OPACITY = 30;
/** Degrees per second for A/D turns. */
const TURN_DPS = 60;
/** Tallest rise a walker steps onto; anything taller is a wall. */
export const WALK_STEP_UP_M = 0.7;
/** Seconds spent above the start point so close-range tiles load first. */
const SETTLE_MS = 1500;
const SETTLE_LOOKOUT_M = 150;
/** How often the surface ahead is re-sampled while moving. */
const SURFACE_SAMPLE_MS = 50;
const HUD_UPDATE_MS = 200;
/** Street search around a walking start point: grid half-size and spacing. */
const STREET_SEARCH_RADIUS_M = 15;
const STREET_SEARCH_STEP_M = 5;
const EARTH_RADIUS_M = 6378137;

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'shift']);

/** Movement intent from the held keys: forward/back, turn, climb, fast. */
export function groundIntent(keys) {
  const has = (key) => keys.has(key);
  return {
    forward: (has('w') ? 1 : 0) - (has('s') ? 1 : 0),
    turn: (has('d') ? 1 : 0) - (has('a') ? 1 : 0),
    climb: (has('e') ? 1 : 0) - (has('q') ? 1 : 0),
    fast: has('shift'),
  };
}

/** Latitude/longitude (radians) moved `distanceM` along `headingRad`. */
export function offsetPosition(latitude, longitude, headingRad, distanceM) {
  const dLat = (distanceM * Math.cos(headingRad)) / EARTH_RADIUS_M;
  const dLon =
    (distanceM * Math.sin(headingRad)) /
    (EARTH_RADIUS_M * Math.max(1e-6, Math.cos(latitude)));
  return { latitude: latitude + dLat, longitude: longitude + dLon };
}

/**
 * Whether a walker may move onto a new surface height: down any drop, up at
 * most a curb. An unknown surface (tiles still loading) does not block.
 */
export function walkStepAllowed(currentSurfaceM, nextSurfaceM) {
  if (!Number.isFinite(currentSurfaceM) || !Number.isFinite(nextSurfaceM))
    return true;
  return nextSurfaceM - currentSurfaceM <= WALK_STEP_UP_M;
}

/** How far ahead a walker's step is checked, in meters. */
export const WALK_PROBE_M = 1.5;
/** Directions within this angle of a found wall stay blocked. */
const WALL_CONE_RAD = Math.PI / 3;

/** Whether moving along `direction` heads into the wall found at `blocked`. */
export function headingBlocked(blocked, direction) {
  if (blocked === null || blocked === undefined) return false;
  const delta = Math.atan2(
    Math.sin(direction - blocked),
    Math.cos(direction - blocked),
  );
  return Math.abs(delta) < WALL_CONE_RAD;
}

/** Clamp a height above the surface into the mode's range. */
export function clampGroundHeight(mode, heightM) {
  const settings = GROUND_VIEW_SETTINGS[mode];
  return Math.min(settings.maxHeightM, Math.max(settings.minHeightM, heightM));
}

export function isGroundViewMode(mode) {
  return GROUND_VIEW_MODES.includes(mode);
}

/** Key handling while a ground view is active. Returns true when consumed. */
export function onGroundKey(event, down) {
  if (!this.active || !this.groundMode) return false;
  const key = event.key === 'Shift' ? 'shift' : event.key?.toLowerCase();
  if (!MOVE_KEYS.has(key)) return false;
  if (down && (event.metaKey || event.ctrlKey || event.altKey)) return false;
  if (down) this.groundKeys.add(key);
  else this.groundKeys.delete(key);
  if (key !== 'shift') {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  return key !== 'shift';
}

/** Ask the user to click the map where the view should start. */
export function beginGroundPick(mode) {
  if (this.destroyed || !isGroundViewMode(mode)) return false;
  if (this.active) this.exit({ restoreTracking: false });
  this.cancelGroundPick();
  const canvas = this.viewer.scene.canvas;
  const onClick = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    const picked = this.viewer.scene.pickPositionSupported
      ? this.viewer.scene.pickPosition(position)
      : undefined;
    const point =
      picked ||
      this.viewer.camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84);
    this.cancelGroundPick();
    if (!point) {
      notify('Could not find the ground there. Try another spot.');
      return;
    }
    this.enterGround(mode, Cesium.Cartographic.fromCartesian(point));
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancelGroundPick();
  };
  canvas.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('ground-view-picking');
  this.groundPick = () => {
    canvas.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('ground-view-picking');
  };
  notify(
    mode === 'walk'
      ? 'Click the map where you want to start walking (Esc cancels)'
      : 'Click the map where you want to launch the drone (Esc cancels)',
  );
  return true;
}

/** Enter a ground view at the center of the current view (voice). */
export function enterGroundAtCenter(mode) {
  if (this.destroyed || !isGroundViewMode(mode)) return false;
  const canvas = this.viewer.scene.canvas;
  const center = new Cesium.Cartesian2(
    canvas.clientWidth / 2,
    canvas.clientHeight / 2,
  );
  const point =
    (this.viewer.scene.pickPositionSupported &&
      this.viewer.scene.pickPosition(center)) ||
    this.viewer.camera.pickEllipsoid(center, Cesium.Ellipsoid.WGS84);
  if (!point) return false;
  this.cancelGroundPick();
  return this.enterGround(mode, Cesium.Cartographic.fromCartesian(point));
}

export function cancelGroundPick() {
  this.groundPick?.();
  this.groundPick = null;
}

/** Enter a ground view at a surface point (Cartographic, radians). */
export function enterGround(mode, cartographic) {
  if (this.destroyed || !isGroundViewMode(mode) || !cartographic) return false;
  if (this.active) this.exit({ restoreTracking: false });
  const settings = GROUND_VIEW_SETTINGS[mode];
  this.onCameraTakeover?.();
  this.viewer.camera.cancelFlight();
  this.viewer.trackedEntity = undefined;
  const heading = this.viewer.camera.heading;
  this.groundMode = mode;
  this.groundKeys = new Set();
  this.groundPose = {
    latitude: cartographic.latitude,
    longitude: cartographic.longitude,
    headingRad: Number.isFinite(heading) ? heading : 0,
    surfaceM: Number.isFinite(cartographic.height) ? cartographic.height : 0,
    heightAboveM: settings.startHeightM,
    altitudeM: NaN,
    speedMps: 0,
    blockedHeadingRad: null,
  };
  this.groundSettleUntilMs = performance.now() + SETTLE_MS;
  this.groundLastSampleMs = 0;
  this.lastFrameMs = performance.now();
  this.lastHudUpdateMs = 0;
  this.active = true;
  this.services.holdContinuousRender('cockpit');
  this.viewer.scene.screenSpaceCameraController.enableInputs = false;
  this.captureZoomBase();
  this.resetLook({ immediate: true });
  this.applyLayerOpacity();
  // Close to the buildings a dense fill paints over them, so area layers start
  // translucent here (the LAYERS slider still raises them; nothing is stored).
  if (this.layerOpacityPercent > GROUND_LAYER_OPACITY) {
    this.services.setAreaFillAlpha?.(GROUND_LAYER_OPACITY / 100);
    if (this.layerOpacityInput)
      this.layerOpacityInput.value = String(GROUND_LAYER_OPACITY);
    if (this.layerOpacityValue)
      this.layerOpacityValue.textContent = `${GROUND_LAYER_OPACITY}%`;
  }
  document.body.classList.add(
    'cockpit-mode',
    'ground-view-mode',
    `ground-view-${mode}`,
  );
  this._entryAvailable = undefined;
  if (this.entry) this.entry.hidden = true;
  if (this.tr3bToggle) this.tr3bToggle.hidden = true;
  if (this.mapViewButton) this.mapViewButton.hidden = false;
  if (this.resetGlobeButton) this.resetGlobeButton.hidden = false;
  if (this.hud) this.hud.hidden = false;
  if (this.context) this.context.hidden = true;
  if (this.signalStream) this.signalStream.hidden = true;
  if (this.route) this.route.hidden = true;
  setGroundLabels.call(this, true);
  this.setVisionMode(this.visionMode);
  this.mapViewButton?.focus({ preventScroll: true });
  this.onEntered?.();
  this.updateHud(groundInfo.call(this), performance.now(), true);
  this.dispatchCockpitModeChanged(true, null);
  return true;
}

/** Undo what enterGround added (exit() handles the shared cockpit state). */
export function leaveGround() {
  if (!this.groundMode) return;
  document.body.classList.remove(
    'ground-view-mode',
    'ground-view-walk',
    'ground-view-drone',
  );
  setGroundLabels.call(this, false);
  this.groundMode = null;
  this.groundPose = null;
  this.groundKeys?.clear();
}

/** One camera step for the active ground view (runs on scene preUpdate). */
export function updateGround() {
  const pose = this.groundPose;
  const mode = this.groundMode;
  if (!pose || !mode) return;
  const settings = GROUND_VIEW_SETTINGS[mode];
  const scene = this.viewer.scene;
  const nowMs = performance.now();
  const dtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastFrameMs) / 1000));
  this.lastFrameMs = nowMs;

  if (nowMs < this.groundSettleUntilMs) {
    // Hover above the start so the surface there loads at close range.
    placeCamera.call(this, pose, pose.surfaceM + SETTLE_LOOKOUT_M, -90, 0);
    return;
  }
  if (this.groundSettleUntilMs) {
    this.groundSettleUntilMs = 0;
    const start = startSurface(scene, pose, mode);
    if (start) {
      pose.latitude = start.latitude;
      pose.longitude = start.longitude;
      pose.surfaceM = start.surfaceM;
    }
  }

  const intent = groundIntent(this.groundKeys);
  pose.headingRad = Cesium.Math.toRadians(
    normalizeHeading(
      Cesium.Math.toDegrees(pose.headingRad) + intent.turn * TURN_DPS * dtSec,
    ),
  );
  if (mode === 'walk') {
    pose.heightAboveM = clampGroundHeight(
      mode,
      pose.heightAboveM + intent.climb * settings.climbMps * dtSec,
    );
  }
  const look = this.easeLook(dtSec);
  const speed = intent.fast ? settings.fastSpeedMps : settings.speedMps;
  const distanceM = intent.forward * speed * dtSec;
  pose.speedMps = Math.abs(intent.forward * speed);
  if (distanceM) {
    // You move the way you are looking (A/D turn the body, drag turns the
    // head); S walks backwards along the same line.
    const direction =
      pose.headingRad +
      Cesium.Math.toRadians(look.yawDeg) +
      (distanceM < 0 ? Math.PI : 0);
    // Sampling renders a pick pass, so it runs on a cadence, not every frame.
    // Each sample probes a little ahead; a wall found there stays "ahead" for
    // that direction until a later probe finds the way clear, so the frames
    // between samples cannot slip through it.
    if (nowMs - this.groundLastSampleMs >= SURFACE_SAMPLE_MS) {
      this.groundLastSampleMs = nowMs;
      const probe = offsetPosition(
        pose.latitude,
        pose.longitude,
        direction,
        mode === 'walk' ? WALK_PROBE_M : 0,
      );
      const probeSurface = sampleSurface(
        scene,
        probe.latitude,
        probe.longitude,
      );
      if (mode === 'walk' && !walkStepAllowed(pose.surfaceM, probeSurface)) {
        pose.blockedHeadingRad = direction;
      } else {
        pose.blockedHeadingRad = null;
        if (Number.isFinite(probeSurface)) pose.surfaceM = probeSurface;
      }
    }
    if (headingBlocked(pose.blockedHeadingRad, direction)) {
      pose.speedMps = 0;
    } else {
      const next = offsetPosition(
        pose.latitude,
        pose.longitude,
        direction,
        Math.abs(distanceM),
      );
      pose.latitude = next.latitude;
      pose.longitude = next.longitude;
    }
  } else if (nowMs - this.groundLastSampleMs > SURFACE_SAMPLE_MS * 6) {
    // Standing still: refresh the surface as finer tiles arrive.
    this.groundLastSampleMs = nowMs;
    const surface = sampleSurface(scene, pose.latitude, pose.longitude);
    if (
      Number.isFinite(surface) &&
      (mode === 'drone' || walkStepAllowed(pose.surfaceM, surface))
    )
      pose.surfaceM = surface;
  }

  let cameraHeightM = pose.surfaceM + pose.heightAboveM;
  if (mode === 'drone') {
    // A drone holds its altitude over rooftops instead of bobbing with them;
    // it only climbs when the clearance would fall below the minimum.
    if (!Number.isFinite(pose.altitudeM)) pose.altitudeM = cameraHeightM;
    pose.altitudeM += intent.climb * settings.climbMps * dtSec;
    pose.altitudeM =
      pose.surfaceM + clampGroundHeight(mode, pose.altitudeM - pose.surfaceM);
    pose.heightAboveM = pose.altitudeM - pose.surfaceM;
    cameraHeightM = pose.altitudeM;
  }
  placeCamera.call(
    this,
    pose,
    cameraHeightM,
    settings.basePitchDeg + look.pitchDeg,
    look.yawDeg,
  );
  if (nowMs - this.lastHudUpdateMs >= HUD_UPDATE_MS) {
    this.lastHudUpdateMs = nowMs;
    this.updateHud(groundInfo.call(this), nowMs);
  }
}

/** The instrument feed for a ground view, shaped like aircraft info. */
function groundInfo() {
  const pose = this.groundPose;
  const settings = GROUND_VIEW_SETTINGS[this.groundMode];
  return {
    layerId: this.groundMode,
    callsign: settings.label,
    latitude: Cesium.Math.toDegrees(pose.latitude),
    longitude: Cesium.Math.toDegrees(pose.longitude),
    altitudeM: pose.heightAboveM,
    velocityMps: pose.speedMps,
    track: normalizeHeading(Cesium.Math.toDegrees(pose.headingRad)),
  };
}

function placeCamera(pose, heightM, pitchDeg, yawDeg) {
  this.heading = normalizeHeading(Cesium.Math.toDegrees(pose.headingRad));
  this.viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      pose.longitude,
      pose.latitude,
      heightM,
    ),
    orientation: {
      heading: pose.headingRad + Cesium.Math.toRadians(yawDeg),
      pitch: Cesium.Math.toRadians(Math.max(-90, Math.min(89, pitchDeg))),
      roll: 0,
    },
  });
}

/** Height of the photoreal surface (or globe) at a point, or NaN. */
function sampleSurface(scene, latitude, longitude) {
  const cartographic = new Cesium.Cartographic(longitude, latitude);
  let height;
  try {
    height = scene.sampleHeightSupported
      ? scene.sampleHeight(cartographic)
      : undefined;
  } catch {
    height = undefined;
  }
  if (!Number.isFinite(height) && scene.globe?.show)
    height = scene.globe.getHeight(cartographic);
  return Number.isFinite(height) ? height : NaN;
}

/**
 * Where a view starts. A walker starts on the lowest surface near the clicked
 * point (the street, not a roof or tree); a drone starts over the point.
 */
function startSurface(scene, pose, mode) {
  if (mode === 'drone') {
    const surfaceM = sampleSurface(scene, pose.latitude, pose.longitude);
    return Number.isFinite(surfaceM) ? { ...pose, surfaceM } : null;
  }
  let best = null;
  for (
    let north = -STREET_SEARCH_RADIUS_M;
    north <= STREET_SEARCH_RADIUS_M;
    north += STREET_SEARCH_STEP_M
  ) {
    for (
      let east = -STREET_SEARCH_RADIUS_M;
      east <= STREET_SEARCH_RADIUS_M;
      east += STREET_SEARCH_STEP_M
    ) {
      const step = offsetPosition(pose.latitude, pose.longitude, 0, north);
      const point = offsetPosition(
        step.latitude,
        step.longitude,
        Math.PI / 2,
        east,
      );
      const surfaceM = sampleSurface(scene, point.latitude, point.longitude);
      if (Number.isFinite(surfaceM) && (!best || surfaceM < best.surfaceM))
        best = { ...point, surfaceM };
    }
  }
  return best;
}

/** Instrument labels read for a walker or drone, then back for aircraft. */
function setGroundLabels(ground) {
  const speedUnit = document.querySelector(
    '.cockpit-speed .cockpit-readout-unit',
  );
  const altitudeLabel = document.querySelector(
    '.cockpit-altitude .cockpit-readout-label',
  );
  if (speedUnit) speedUnit.textContent = ground ? 'MPH' : 'KTS';
  if (altitudeLabel)
    altitudeLabel.textContent = ground ? 'ABOVE GROUND' : 'ALTITUDE';
}

function notify(message) {
  window.dispatchEvent(new CustomEvent('gev:notice', { detail: { message } }));
}
