import { SceneDirector } from '../scenes/director.js';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { initGeoFileImport } from '../ui/geoFileImport.js';
import {
  MY_FILES_ACCEPT,
  analyzeMyFile,
  loadMyFile,
} from '../ui/myFileTables.js';
import { initGevVoiceCommands } from '../voice/gevRealtime.js';
import { installScopeMask, destroyScopeMask } from '../scopeMask.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

/** Attach scene tools, rendering listeners and the application debug handle. */
export function createApplicationTools({
  scene,
  controls,
  data,
  loadingScreen,
  placeSearch,
  voice = {},
  startChrome,
  onSceneDirector,
  sceneDataPacks,
  signal,
  defer,
}) {
  const { viewer, tileset, mapStackController, operations } = scene;
  const { styleManager, weatherEffects, cockpitCloudEffects } = controls;
  const { dataManager } = data;
  const sceneDirector = new SceneDirector(viewer, styleManager, dataManager, {
    dataPacks: sceneDataPacks,
    isMapStackAvailable: (id) =>
      mapStackController?.isStackAvailable(id) === true,
  });
  defer(() => sceneDirector.destroy());
  onSceneDirector?.(sceneDirector);
  const annotations = initAnnotations({
    viewer,
    tileset,
    placeSearch,
    resolver: operations.annotationResolver,
  });
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
  // DISPLAY ▸ Draw: the same whiteboard, drawn by hand. It claims the pointer
  // while a session is open, so its teardown belongs to the application
  // lifetime rather than to whoever last pressed the button.
  const drawTool = initDrawTool({ viewer, annotations });
  defer(() => drawTool?.destroy());
  // DATA LAYERS ▸ My files: the person's own map files, each its own data
  // source. They live for the page session, so the application lifetime
  // removes them and the drop listeners on the viewer container.
  const geoFileImport = initGeoFileImport({
    viewer,
    navigation: styleManager,
    ground: operations.surface?.groundFloor,
    subscribeMapSource: (listener) => mapStackController?.subscribe?.(listener),
    load: loadMyFile,
    accept: MY_FILES_ACCEPT,
    onAnalyze: analyzeMyFile,
  });
  defer(() => geoFileImport?.destroy());
  // Layers handed over by another Craft app (MapCraft ▸ Show in Husky Eye
  // View) wait in a queue until My files is ready, then load like a chosen file.
  const takeQueuedFiles = () => {
    const queue = window.__gevMyFilesQueue;
    if (!geoFileImport || !queue?.length) return;
    void geoFileImport.importFiles(queue.splice(0));
  };
  window.addEventListener('gev:my-files-add', takeQueuedFiles);
  defer(() => window.removeEventListener('gev:my-files-add', takeQueuedFiles));
  takeQueuedFiles();
  // DATA ▸ Recent Imagery: the box tool claims the pointer like Draw and the
  // panel lives on the right rail, so both belong to the application
  // lifetime. The tileset lets the layer drape while the globe is hidden.
  const recentImagery = dataManager.layers.get('recent-imagery')?.module;
  if (recentImagery) {
    recentImagery.attachTileset(tileset);
    // The live gate's handle (scripts/qa-recent-imagery.mjs); `tool` fills in
    // when the readout loads.
    const recentImageryHandle = { layer: recentImagery, tool: null };
    window.__gevRecentImagery = recentImageryHandle;
    // The readout (~140 KB with its box tool and styles' code) loads the
    // first time the layer is on, which is when its rail panel first shows
    // — including a share link (`ri`) that turns it on at load.
    let imageryBoxTool = null;
    let released = false;
    let stopWaiting = null;
    const loadReadout = () => {
      stopWaiting?.();
      stopWaiting = null;
      Promise.all([
        import('../ui/imageryBoxTool.js'),
        import('../ui/recentImagery.js'),
      ])
        .then(([{ initImageryBoxTool }, { createRecentImageryPanel }]) => {
          if (released) return;
          imageryBoxTool = initImageryBoxTool({
            viewer,
            onBox: (box) => recentImagery.setBox(box),
            onCancel: (reason, message, box) => {
              if (message) recentImagery.reportBoxRefusal(message, box);
            },
            onActive: (active) => recentImagery.setToolActive(active),
            // The tool takes Escape in a capture listener, so the panel's
            // order (clear a preview before cancelling the tool) is applied
            // here.
            onEscape: () => recentImagery.clearPreview(),
          });
          recentImageryHandle.tool = imageryBoxTool;
          // The readout mounts in its rail body through the layer panel, like
          // the weather readout.
          data.presentation.attachRecentImagery((container) =>
            createRecentImageryPanel({
              container,
              viewer,
              layer: recentImagery,
              tool: imageryBoxTool,
            }),
          );
        })
        .catch((error) =>
          console.warn('[Data:RecentImagery] readout failed to load:', error),
        );
    };
    if (recentImagery.getSnapshot?.().enabled) loadReadout();
    else {
      const off = recentImagery.subscribe((snapshot) => {
        if (snapshot?.enabled) loadReadout();
      });
      stopWaiting = typeof off === 'function' ? off : null;
    }
    defer(() => {
      released = true;
      stopWaiting?.();
      stopWaiting = null;
      if (window.__gevRecentImagery === recentImageryHandle)
        delete window.__gevRecentImagery;
      data.presentation.attachRecentImagery(null);
      imageryBoxTool?.destroy();
    });
  }
  if (startChrome)
    defer(startChrome({ loadingScreen, styleManager, dataManager, signal }));
  // Idle render governor: flips the scene into requestRenderMode whenever
  // nothing animates per frame. Installed AFTER every module above has had
  // its chance to register pre-install holds. (perf wave 2)
  installRenderGovernor(viewer);

  // Install the explicit scope mask used by the DISPLAY controls.
  installScopeMask(viewer);
  defer(() => destroyScopeMask());

  // The follow camera recomputes the tracked target's dead-reckon position
  // every frame — tracking anything is a per-frame animation. (perf wave 2)
  const removeTrackingListener = viewer.trackedEntityChanged.addEventListener(
    () => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    },
  );

  // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
  // stop the default render loop outright — a hidden canvas repaints for
  // nobody, and browser rAF throttling still lets throttled frames burn
  // GPU. Holder/data state is untouched, so return is seamless: restore
  // the loop, refresh the one DOM surface we gated, render a frame.
  const syncVisibilitySuspension = () => {
    const hidden = document.hidden;
    viewer.useDefaultRenderLoop = !hidden;
    cockpitCloudEffects?.setSuspended?.(hidden);
    if (!hidden) {
      data.presentation.flushVisible();
      governorRequestRender('visibility-restore');
    }
  };
  document.addEventListener('visibilitychange', syncVisibilitySuspension);
  defer(() =>
    document.removeEventListener('visibilitychange', syncVisibilitySuspension),
  );
  defer(() => {
    removeTrackingListener();
    releaseContinuousRender('tracked-entity');
  });
  // Apply the CURRENT state too — bootstrap can complete while the tab is
  // already hidden, and waiting for the next transition would leave the
  // loop burning behind a hidden tab. (perf wave 2 fix)
  syncVisibilitySuspension();

  window.__godsEyeView = {
    viewer,
    styleManager,
    tileset,
    dataManager,
    sceneDirector,
    mapStackController,
    annotations,
    weatherEffects,
    cockpitCloudEffects,
    getRenderGovernorDiagnostics,
    surfaceServices: operations.surface,
    requestRender: governorRequestRender,
  };
  const debug = window.__godsEyeView;
  defer(() => {
    if (window.__godsEyeView === debug) delete window.__godsEyeView;
  });
  const voiceCommands = initGevVoiceCommands({
    ...voice,
    floorServices: operations.surface.groundFloor,
    annotationResolver: operations.annotationResolver,
    searchNavigation: operations.searchAndFlyTo,
    signal,
    placeSearch,
    viewer,
    styleManager,
    dataManager,
    sceneDirector,
    annotations,
  });
  defer(() => {
    voiceCommands.stop({ removeUi: true });
    if (window.__gevVoiceCommands === voiceCommands)
      delete window.__gevVoiceCommands;
  });
  debug.voiceCommands = voiceCommands;
  return { sceneDirector, annotations, voiceCommands };
}
