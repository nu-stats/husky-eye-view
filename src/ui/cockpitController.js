/** Coordinate Cockpit lifecycle through supplied aircraft, terrain, rendering and briefing operations. */
import {
  readAircraftInfo,
  dispatchCockpitModeChanged,
  toggleTrackedTr3b,
  syncTr3bToggle,
  syncEntry,
  navigateContext,
  _adoptTrackedEntity,
  enter,
  exit,
} from './cockpitTrackingController.js';
import { update } from './cockpitCamera.js';
import {
  updateHud,
  updateRoute,
  syncWeatherToggle,
  setVisionMode,
  cycleVisionMode,
  clearPredictiveRoute,
} from './cockpitInstruments.js';
import { updateContext } from './cockpitContext.js';
import {
  showBriefPage,
  setBriefAutoRotate,
  startBriefRotation,
  stopBriefRotation,
  updateLocalPosition,
  maybeRefreshRegionalBrief,
  renderRegionalBriefStatus,
  renderRegionalBrief,
} from './cockpitBriefing.js';
import {
  handleSignalClick,
  renderCockpitSignals,
  pushCockpitSignal,
  updateCockpitSignals,
} from './cockpitSignals.js';
import {
  scheduleContextLayout,
  setContextCollapsed,
  setSignalCollapsed,
  syncContextLayout,
  syncSignalLayout,
} from './cockpitLayout.js';
import { onKeyDown } from './cockpitInput.js';
import {
  captureZoomBase,
  restoreZoomBase,
  setZoom,
  stepZoom,
  onZoomWheel,
} from './cockpitZoom.js';
import {
  COCKPIT_LOOK_STEP_PITCH_DEG,
  COCKPIT_LOOK_STEP_YAW_DEG,
  resetLook,
  look,
  easeLook,
  onLookPointerDown,
  onLookPointerMove,
  onLookPointerUp,
} from './cockpitLook.js';
import {
  applyLayerOpacity,
  releaseLayerOpacity,
  setLayerOpacity,
} from './cockpitLayerOpacity.js';
import {
  beginGroundPick,
  cancelGroundPick,
  enterGround,
  enterGroundAtCenter,
  leaveGround,
  onGroundKey,
  updateGround,
} from './cockpitGroundView.js';
import {
  captureController,
  describeCapture,
  takeSnapshot,
  toggleClip,
  stopCapture,
  renderCaptureState,
  toggleSnapshotFormat,
  syncSnapshotFormat,
} from './cockpitCapture.js';
import * as Cesium from 'cesium';

export class CockpitViewController {
  constructor(
    viewer,
    {
      services,
      onVisionChange = null,
      onCameraTakeover = null,
      isEntryAllowed = null,
      onEntered = null,
      onExited = null,
      getInheritedVisionLabel = null,
      restoreTrackingFrame = null,
    } = {},
  ) {
    this.viewer = viewer;
    this.services = services;
    this.destroyed = false;
    this.disposed = false;
    this.active = false;
    this.trackedEntity = null;
    this.trackedEntityWasShown = true;
    this.heading = null;
    this.lastFrameMs = 0;
    this.lastCameraUpdateMs = 0;
    this.lastHudUpdateMs = 0;
    this.lastContextUpdateMs = 0;
    this.lastGroundProbeMs = 0;
    this.contextNavigationDeadlineMs = 0;
    this.surfaceWaitStartedMs = 0;
    this.surfaceAcquiring = false;
    this.surfaceFallback = false;
    this.lastCompassSignature = '';
    this.entry = document.getElementById('cockpit-entry');
    this.tr3bToggle = document.getElementById('tr3b-toggle');
    this._tr3bSignature = null;
    this.mapViewButton = document.getElementById('map-view-switch');
    this.resetGlobeButton = document.getElementById('cockpit-reset-globe');
    this.hud = document.getElementById('cockpit-hud');
    this.entryFocusOrigin = null;
    this.callsign = document.getElementById('cockpit-callsign');
    this.speed = document.getElementById('cockpit-speed-value');
    this.speedRim = document.getElementById('cockpit-speed-rim');
    this.speedRimValue = document.getElementById('cockpit-speed-rim-value');
    this.speedRimTicks = Array.from(
      document.querySelectorAll('[data-speed-rim-tick]'),
    );
    this.altitude = document.getElementById('cockpit-altitude-value');
    this.altitudeRim = document.getElementById('cockpit-altitude-rim');
    this.altitudeRimValue = document.getElementById(
      'cockpit-altitude-rim-value',
    );
    this.altitudeRimTicks = Array.from(
      document.querySelectorAll('[data-altitude-rim-tick]'),
    );
    this.headingValue = document.getElementById('cockpit-heading-value');
    this.compassTape = document.getElementById('cockpit-compass-tape');
    this.clock = document.getElementById('cockpit-clock');
    this.position = document.getElementById('cockpit-position');
    this.aircraftMeta = document.getElementById('cockpit-aircraft-meta');
    this.route = document.getElementById('cockpit-route');
    this.routeFrom = document.getElementById('cockpit-route-from');
    this.routeTo = document.getElementById('cockpit-route-to');
    this.routeStatus = document.getElementById('cockpit-route-status');
    this.routeDirection = document.getElementById('cockpit-route-direction');
    this.routeDirectionLabel = document.getElementById(
      'cockpit-route-direction-label',
    );
    this.visionPrevious = document.getElementById('cockpit-vision-previous');
    this.visionCurrent = document.getElementById('cockpit-vision-current');
    this.visionCurrentLabel = document.getElementById(
      'cockpit-vision-current-label',
    );
    this.visionNext = document.getElementById('cockpit-vision-next');
    this.visionMode = 'optical';
    this.zoomOut = document.getElementById('cockpit-zoom-out');
    this.zoomReset = document.getElementById('cockpit-zoom-reset');
    this.zoomIn = document.getElementById('cockpit-zoom-in');
    this.zoomValue = document.getElementById('cockpit-zoom-value');
    this.zoom = 1;
    this.zoomBaseFov = null;
    this.lastWheelZoomMs = 0;
    this.lookLeft = document.getElementById('cockpit-look-left');
    this.lookRight = document.getElementById('cockpit-look-right');
    this.lookUp = document.getElementById('cockpit-look-up');
    this.lookDown = document.getElementById('cockpit-look-down');
    this.lookCenter = document.getElementById('cockpit-look-center');
    this.lookValue = document.getElementById('cockpit-look-value');
    this.layerOpacityInput = document.getElementById('cockpit-layer-opacity');
    this.layerOpacityValue = document.getElementById(
      'cockpit-layer-opacity-value',
    );
    this.layerOpacityPercent = null;
    this.layerOpacityTimer = null;
    this.snapshotButton = document.getElementById('cockpit-snapshot');
    this.snapshotFormatButton = document.getElementById(
      'cockpit-snapshot-format',
    );
    this.recordButton = document.getElementById('cockpit-record');
    this.recordIcon = document.getElementById('cockpit-record-icon');
    this.recordTime = document.getElementById('cockpit-record-time');
    this.viewCapture = null;
    // Walking / Drone views (cockpitGroundView.js): null while riding an aircraft.
    this.groundMode = null;
    this.groundPose = null;
    this.groundKeys = new Set();
    this.groundPick = null;
    this.groundSettleUntilMs = 0;
    this.groundLastSampleMs = 0;
    this.lookTarget = { yawDeg: 0, pitchDeg: 0 };
    this.lookCurrent = { yawDeg: 0, pitchDeg: 0 };
    this.lookDrag = null;
    this.onVisionChange = onVisionChange;
    this.onCameraTakeover = onCameraTakeover;
    this.onEntered = onEntered;
    this.onExited = onExited;
    this.getInheritedVisionLabel =
      typeof getInheritedVisionLabel === 'function'
        ? getInheritedVisionLabel
        : () => 'NORMAL';
    this.restoreTrackingFrame =
      typeof restoreTrackingFrame === 'function'
        ? restoreTrackingFrame
        : () => false;
    this.isEntryAllowed =
      typeof isEntryAllowed === 'function' ? isEntryAllowed : () => true;
    this.context = document.getElementById('cockpit-context');
    this.contextSubject = document.getElementById('cockpit-context-subject');
    this.contextNearestLabel = document.getElementById(
      'cockpit-context-nearest-label',
    );
    this.contextBearing = document.getElementById('cockpit-context-bearing');
    this.contextDistance = document.getElementById('cockpit-context-distance');
    this.contextDirection = document.getElementById(
      'cockpit-context-direction',
    );
    this.contextUncertainty = document.getElementById(
      'cockpit-context-uncertainty',
    );
    this.contextUpdated = document.getElementById('cockpit-context-updated');
    this.contextCohorts = new Map(
      Array.from(document.querySelectorAll('[data-context-cohort]')).map(
        (element) => [element.dataset.contextCohort, element],
      ),
    );
    this.contextPrevious = document.getElementById('cockpit-context-previous');
    this.contextNext = document.getElementById('cockpit-context-next');
    this.contextToggle = document.getElementById('cockpit-context-toggle');
    this.weatherToggle = document.getElementById('cockpit-weather-toggle');
    this.weatherState = document.getElementById('cockpit-weather-state');
    this.contextCollapsed = false;
    this.signalStream = document.getElementById('cockpit-signal-stream');
    this.signalList = document.getElementById('cockpit-signal-list');
    this.signalToggle = document.getElementById('cockpit-signal-toggle');
    this.briefKicker = document.getElementById('cockpit-brief-kicker');
    this.briefSubtitle = document.getElementById('cockpit-brief-subtitle');
    this.briefPrevious = document.getElementById('cockpit-brief-previous');
    this.briefNext = document.getElementById('cockpit-brief-next');
    this.briefAutoToggle = document.getElementById('cockpit-brief-auto');
    this.briefPosition = document.getElementById('cockpit-brief-position');
    this.briefSource = document.getElementById('cockpit-brief-source');
    this.briefPages = Array.from(
      document.querySelectorAll('[data-cockpit-brief-page]'),
    );
    this.briefTabs = Array.from(
      document.querySelectorAll('[data-cockpit-brief-index]'),
    );
    this.newsStatus = document.getElementById('cockpit-news-status');
    this.newsList = document.getElementById('cockpit-news-list');
    this.localPlace = document.getElementById('cockpit-local-place');
    this.localCoordinates = document.getElementById(
      'cockpit-local-coordinates',
    );
    this.localTemperature = document.getElementById(
      'cockpit-local-temperature',
    );
    this.localWind = document.getElementById('cockpit-local-wind');
    this.localWindDirection = document.getElementById(
      'cockpit-local-wind-direction',
    );
    this.localCondition = document.getElementById('cockpit-local-condition');
    this.localCloud = document.getElementById('cockpit-local-cloud');
    this.localPrecipitation = document.getElementById(
      'cockpit-local-precipitation',
    );
    this.signalCollapsed = false;
    this.signalUserCollapsed = false;
    this.signalItems = [];
    this.signalSignatures = new Map();
    this.briefPageIndex = 0;
    this.briefAutoRotateEnabled = false;
    this.briefTimer = null;
    this.lastAircraftInfo = null;
    this.regionalBrief = null;
    this.regionalBriefAnchor = null;
    this.regionalBriefFetchedAt = 0;
    this.regionalBriefAbort = null;
    this.regionalBriefRequestToken = 0;
    this.regionalBriefSubjectId = null;
    this.contextLayoutFrame = null;
    this.contextLayoutStamp = null;
    this.scratchTarget = new Cesium.Cartesian3();
    this.cockpitAnchor = new Cesium.Cartesian3();
    this.cockpitAnchorValid = false;
    this.scratchCamera = new Cesium.Cartesian3();
    this.scratchAdvance = new Cesium.Cartesian3();
    this.scratchCorrection = new Cesium.Cartesian3();
    this.scratchForward = new Cesium.Cartesian3();
    this.scratchHorizontal = new Cesium.Cartesian3();
    this.scratchUp = new Cesium.Cartesian3();
    this.scratchLocal = new Cesium.Cartesian3();
    this.scratchEnu = new Cesium.Matrix4();
    this.scratchAnchorCartographic = new Cesium.Cartographic();
    this.scratchCameraCartographic = new Cesium.Cartographic();
    this.scratchTargetCartographic = new Cesium.Cartographic();
    this._listenerRemovers = [];

    // Camera mutations belong before scene update/culling. Changing the camera
    // from preRender makes 3D Tiles discover a new view after traversal and can
    // create a self-sustaining refinement loop under a moving cockpit camera.
    this._listenerRemovers.push(
      viewer.scene.preUpdate.addEventListener(() => this.update()),
      viewer.trackedEntityChanged.addEventListener(() => {
        if (this.active) this._adoptTrackedEntity(performance.now());
        else this.syncEntry();
      }),
    );
    this._listen(this.entry, 'click', () => this.enter());
    this._listen(this.tr3bToggle, 'click', () => this.toggleTrackedTr3b());
    this._listen(this.mapViewButton, 'click', () => this.exit());
    this._listen(this.visionPrevious, 'click', () => this.cycleVisionMode(-1));
    this._listen(this.visionCurrent, 'click', () => this.cycleVisionMode(1));
    this._listen(this.visionNext, 'click', () => this.cycleVisionMode(1));
    this._listen(this.zoomOut, 'click', () => this.stepZoom(-1));
    this._listen(this.zoomReset, 'click', () => this.setZoom(1));
    this._listen(this.zoomIn, 'click', () => this.stepZoom(1));
    this._listen(
      viewer.scene?.canvas,
      'wheel',
      (event) => this.onZoomWheel(event),
      { passive: false },
    );
    this._listen(this.lookLeft, 'click', () =>
      this.look(-COCKPIT_LOOK_STEP_YAW_DEG, 0),
    );
    this._listen(this.lookRight, 'click', () =>
      this.look(COCKPIT_LOOK_STEP_YAW_DEG, 0),
    );
    this._listen(this.lookUp, 'click', () =>
      this.look(0, COCKPIT_LOOK_STEP_PITCH_DEG),
    );
    this._listen(this.lookDown, 'click', () =>
      this.look(0, -COCKPIT_LOOK_STEP_PITCH_DEG),
    );
    this._listen(this.lookCenter, 'click', () => this.resetLook());
    this._listen(this.layerOpacityInput, 'input', () =>
      this.setLayerOpacity(this.layerOpacityInput.value),
    );
    this._listen(this.layerOpacityInput, 'change', () =>
      this.setLayerOpacity(this.layerOpacityInput.value, { immediate: true }),
    );
    this._listen(this.snapshotButton, 'click', () => this.takeSnapshot());
    this._listen(this.snapshotFormatButton, 'click', () =>
      this.toggleSnapshotFormat(),
    );
    this.syncSnapshotFormat();
    this._listen(this.recordButton, 'click', () => this.toggleClip());
    this._listen(viewer.scene?.canvas, 'pointerdown', (event) =>
      this.onLookPointerDown(event),
    );
    this._listen(window, 'pointermove', (event) =>
      this.onLookPointerMove(event),
    );
    this._listen(window, 'pointerup', (event) => this.onLookPointerUp(event));
    this._listen(window, 'pointercancel', (event) =>
      this.onLookPointerUp(event),
    );
    this._listen(this.contextPrevious, 'click', () =>
      this.navigateContext(-1, { origin: 'user' }),
    );
    this._listen(this.contextNext, 'click', () =>
      this.navigateContext(1, { origin: 'user' }),
    );
    this._listen(this.contextToggle, 'click', () =>
      this.setContextCollapsed(!this.contextCollapsed),
    );
    this._listen(this.weatherToggle, 'click', () => {
      const enabled =
        this.weatherToggle.getAttribute('aria-pressed') !== 'true';
      this.syncWeatherToggle(enabled);
      window.dispatchEvent(
        new CustomEvent('gev:cockpit-weather-toggle', {
          detail: { enabled },
        }),
      );
    });
    this._listen(window, 'gev:cockpit-weather-state', (event) => {
      this.syncWeatherToggle(event?.detail?.enabled !== false);
    });
    this._listen(this.signalToggle, 'click', () =>
      this.setSignalCollapsed(!this.signalCollapsed, { user: true }),
    );
    this._listen(this.signalList, 'click', (event) =>
      this.handleSignalClick(event),
    );
    this._listen(this.briefPrevious, 'click', () =>
      this.showBriefPage(this.briefPageIndex - 1, { manual: true }),
    );
    this._listen(this.briefNext, 'click', () =>
      this.showBriefPage(this.briefPageIndex + 1, { manual: true }),
    );
    this._listen(this.briefAutoToggle, 'click', () => {
      this.setBriefAutoRotate(!this.briefAutoRotateEnabled);
    });
    this.briefTabs.forEach((button) =>
      this._listen(button, 'click', () => {
        this.showBriefPage(Number(button.dataset.cockpitBriefIndex), {
          manual: true,
        });
      }),
    );
    this._listen(document, 'visibilitychange', () => {
      if (document.hidden) this.stopBriefRotation();
      else if (this.briefAutoRotateEnabled) this.startBriefRotation();
    });
    this._listen(window, 'resize', () => this.scheduleContextLayout());
    this._listen(document, 'keydown', (event) => this.onKeyDown(event), true);
    this._listen(
      document,
      'keyup',
      (event) => this.onGroundKey(event, false),
      true,
    );
    this._listen(window, 'blur', () => this.groundKeys.clear());
    // Data Layers → Walking View / Drone View rows ask for a start point.
    this._listen(window, 'gev:ground-view-request', (event) =>
      this.beginGroundPick(event?.detail?.mode),
    );
  }

  _listen(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    this._listenerRemovers.push(() =>
      target.removeEventListener(type, handler, options),
    );
  }

  readAircraftInfo() {
    return readAircraftInfo.call(this);
  }
  dispatchCockpitModeChanged(active, info) {
    return dispatchCockpitModeChanged.call(this, active, info);
  }
  toggleTrackedTr3b() {
    return toggleTrackedTr3b.call(this);
  }
  syncTr3bToggle(info) {
    return syncTr3bToggle.call(this, info);
  }
  syncEntry() {
    return syncEntry.call(this);
  }
  navigateContext(direction, options) {
    return navigateContext.call(this, direction, options);
  }
  _adoptTrackedEntity(nowMs, suppliedInfo) {
    return _adoptTrackedEntity.call(this, nowMs, suppliedInfo);
  }
  enter() {
    return enter.call(this);
  }
  exit(options) {
    return exit.call(this, options);
  }
  update() {
    return update.call(this);
  }
  updateHud(info, nowMs, forceContext) {
    return updateHud.call(this, info, nowMs, forceContext);
  }
  updateRoute(info) {
    return updateRoute.call(this, info);
  }
  syncWeatherToggle(enabled) {
    return syncWeatherToggle.call(this, enabled);
  }
  setVisionMode(mode, options) {
    return setVisionMode.call(this, mode, options);
  }
  cycleVisionMode(direction) {
    return cycleVisionMode.call(this, direction);
  }
  clearPredictiveRoute() {
    return clearPredictiveRoute.call(this);
  }
  updateContext(info, heading) {
    return updateContext.call(this, info, heading);
  }
  showBriefPage(index, options) {
    return showBriefPage.call(this, index, options);
  }
  setBriefAutoRotate(enabled) {
    return setBriefAutoRotate.call(this, enabled);
  }
  startBriefRotation(options) {
    return startBriefRotation.call(this, options);
  }
  stopBriefRotation() {
    return stopBriefRotation.call(this);
  }
  updateLocalPosition(info) {
    return updateLocalPosition.call(this, info);
  }
  maybeRefreshRegionalBrief(info) {
    return maybeRefreshRegionalBrief.call(this, info);
  }
  renderRegionalBriefStatus(status, info) {
    return renderRegionalBriefStatus.call(this, status, info);
  }
  renderRegionalBrief(payload, info) {
    return renderRegionalBrief.call(this, payload, info);
  }
  renderCockpitSignals() {
    return renderCockpitSignals.call(this);
  }
  pushCockpitSignal(key, tone, title, detail, target) {
    return pushCockpitSignal.call(this, key, tone, title, detail, target);
  }
  updateCockpitSignals(snapshot, unknownCount) {
    return updateCockpitSignals.call(this, snapshot, unknownCount);
  }
  scheduleContextLayout() {
    return scheduleContextLayout.call(this);
  }
  setContextCollapsed(collapsed) {
    return setContextCollapsed.call(this, collapsed);
  }
  setSignalCollapsed(collapsed, options) {
    return setSignalCollapsed.call(this, collapsed, options);
  }
  syncContextLayout() {
    return syncContextLayout.call(this);
  }
  syncSignalLayout() {
    return syncSignalLayout.call(this);
  }
  onKeyDown(event) {
    return onKeyDown.call(this, event);
  }
  captureZoomBase() {
    return captureZoomBase.call(this);
  }
  restoreZoomBase() {
    return restoreZoomBase.call(this);
  }
  setZoom(zoom) {
    return setZoom.call(this, zoom);
  }
  stepZoom(direction) {
    return stepZoom.call(this, direction);
  }
  onZoomWheel(event) {
    return onZoomWheel.call(this, event);
  }
  resetLook(options) {
    return resetLook.call(this, options);
  }
  look(yawDeltaDeg, pitchDeltaDeg) {
    return look.call(this, yawDeltaDeg, pitchDeltaDeg);
  }
  easeLook(dtSec) {
    return easeLook.call(this, dtSec);
  }
  onLookPointerDown(event) {
    return onLookPointerDown.call(this, event);
  }
  onLookPointerMove(event) {
    return onLookPointerMove.call(this, event);
  }
  onLookPointerUp(event) {
    return onLookPointerUp.call(this, event);
  }
  applyLayerOpacity() {
    return applyLayerOpacity.call(this);
  }
  releaseLayerOpacity() {
    return releaseLayerOpacity.call(this);
  }
  setLayerOpacity(percent, options) {
    return setLayerOpacity.call(this, percent, options);
  }
  beginGroundPick(mode) {
    return beginGroundPick.call(this, mode);
  }
  cancelGroundPick() {
    return cancelGroundPick.call(this);
  }
  enterGround(mode, cartographic) {
    return enterGround.call(this, mode, cartographic);
  }
  enterGroundAtCenter(mode) {
    return enterGroundAtCenter.call(this, mode);
  }
  leaveGround() {
    return leaveGround.call(this);
  }
  onGroundKey(event, down) {
    return onGroundKey.call(this, event, down);
  }
  updateGround() {
    return updateGround.call(this);
  }
  captureController() {
    return captureController.call(this);
  }
  describeCapture() {
    return describeCapture.call(this);
  }
  takeSnapshot() {
    return takeSnapshot.call(this);
  }
  toggleClip() {
    return toggleClip.call(this);
  }
  stopCapture() {
    return stopCapture.call(this);
  }
  renderCaptureState(state) {
    return renderCaptureState.call(this, state);
  }
  toggleSnapshotFormat() {
    return toggleSnapshotFormat.call(this);
  }
  syncSnapshotFormat() {
    return syncSnapshotFormat.call(this);
  }

  handleSignalClick(event) {
    return handleSignalClick.call(this, event);
  }

  /** Revoke new work before the shell awaits layer restoration. */
  stop() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.regionalBriefAbort?.abort();
    this.regionalBriefAbort = null;
    this.regionalBriefRequestToken += 1;
    this.stopBriefRotation();
    this.viewCapture?.destroy();
    this.cancelGroundPick();
    if (this.contextLayoutFrame !== null)
      cancelAnimationFrame(this.contextLayoutFrame);
    this.contextLayoutFrame = null;
    for (const removeListener of this._listenerRemovers.splice(0))
      removeListener?.();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.exit({ restoreTracking: false });
  }
}
