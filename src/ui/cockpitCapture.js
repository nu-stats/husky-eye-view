/** Cockpit snapshot and clip buttons over a lazily built ViewCapture. */
import {
  SNAPSHOT_FORMATS,
  ViewCapture,
  formatClipTime,
  normalizeSnapshotFormat,
} from './viewCapture.js';
import { captionLayerNames, cockpitViewLabel } from './captureCaption.js';

/**
 * Photos and clips are offered only during Curated Flights for now; the cockpit,
 * drone and walking controls stay hidden (cockpit.html) and P / Shift+P do nothing.
 */
export const COCKPIT_CAPTURE_ENABLED = false;

const UNRESOLVED_PLACE = /^(RESOLVING|UNKNOWN|--)/i;
const FORMAT_STORAGE_KEY = 'hev.snapshotFormat';

function readSnapshotFormat() {
  try {
    return normalizeSnapshotFormat(localStorage.getItem(FORMAT_STORAGE_KEY));
  } catch {
    return 'png';
  }
}

export function captureController() {
  if (!this.viewCapture) {
    this.viewCapture = new ViewCapture({
      viewer: this.viewer,
      describe: () => this.describeCapture(),
      holdRender: (id) => this.services.holdContinuousRender?.(id),
      releaseRender: (id) => this.services.releaseContinuousRender?.(id),
      onState: (state) => this.renderCaptureState(state),
      format: readSnapshotFormat(),
    });
  }
  return this.viewCapture;
}

/** Flip snapshots between PNG and JPG (remembered in this browser). */
export function toggleSnapshotFormat() {
  const capture = this.captureController();
  const next = capture.setFormat(capture.format === 'png' ? 'jpg' : 'png');
  try {
    localStorage.setItem(FORMAT_STORAGE_KEY, next);
  } catch {
    // Private windows may refuse storage; the choice still holds this visit.
  }
  return next;
}

export function syncSnapshotFormat() {
  renderFormat.call(this, this.viewCapture?.format ?? readSnapshotFormat());
}

function renderFormat(format) {
  if (!this.snapshotFormatButton) return;
  const current = SNAPSHOT_FORMATS[format];
  const other = SNAPSHOT_FORMATS[format === 'png' ? 'jpg' : 'png'];
  this.snapshotFormatButton.textContent = current.label;
  this.snapshotFormatButton.title = `Snapshot format: ${current.label} (click for ${other.label})`;
  this.snapshotFormatButton.setAttribute(
    'aria-label',
    `Snapshot format ${current.label}. Activate for ${other.label}.`,
  );
}

/** What the caption strip says about this cockpit view. */
export function describeCapture() {
  const placeText = this.localPlace?.textContent?.trim() || '';
  const place = UNRESOLVED_PLACE.test(placeText)
    ? this.position?.textContent?.trim() || ''
    : placeText;
  const rows = Array.from(
    document.querySelectorAll('.data-toggle-row.is-on'),
    (row) => ({
      name: row.querySelector('.data-name')?.textContent || '',
      group: row.dataset.group || '',
    }),
  );
  return {
    view: cockpitViewLabel(this.lastAircraftInfo),
    place,
    layers: captionLayerNames(rows),
  };
}

export function takeSnapshot() {
  if (!COCKPIT_CAPTURE_ENABLED || !this.active) return false;
  return this.captureController().snapshot();
}

export function toggleClip() {
  if (!COCKPIT_CAPTURE_ENABLED) return false;
  const capture = this.captureController();
  if (!this.active && !capture.recording) return false;
  return capture.toggleClip();
}

/** Leaving the cockpit ends (and saves) a clip in progress. */
export function stopCapture() {
  this.viewCapture?.stopClip();
}

export function renderCaptureState(state) {
  if (this.snapshotButton) this.snapshotButton.disabled = !!state.busy;
  if (state.format) renderFormat.call(this, state.format);
  if (this.recordButton) {
    this.recordButton.classList.toggle('recording', state.recording);
    this.recordButton.setAttribute('aria-pressed', String(state.recording));
    this.recordButton.title = state.recording
      ? 'Stop and save the clip (Shift+P)'
      : `Record a clip, up to ${state.maxSeconds} s (Shift+P)`;
  }
  if (this.recordIcon) {
    this.recordIcon.textContent = state.recording
      ? 'stop'
      : 'fiber_manual_record';
  }
  if (this.recordTime) {
    this.recordTime.textContent = state.recording
      ? formatClipTime(state.elapsedSeconds, state.maxSeconds)
      : 'REC';
  }
  if (state.saved || state.error) {
    window.dispatchEvent(
      new CustomEvent('gev:view-capture', {
        detail: { saved: state.saved || null, error: state.error || null },
      }),
    );
    if (state.error) console.warn('[capture]', state.error);
  }
}
