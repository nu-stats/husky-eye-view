/** Route Cockpit keys while preserving the active disclosure and form-control owner. */
import {
  COCKPIT_LOOK_STEP_PITCH_DEG,
  COCKPIT_LOOK_STEP_YAW_DEG,
} from './cockpitLook.js';
import { COCKPIT_CAPTURE_ENABLED } from './cockpitCapture.js';

export function onKeyDown(event) {
  if (this.destroyed) return false;
  if (event.repeat || event.isComposing) return;
  if (event.key === 'Escape' && this.active) {
    // The credit lightbox owns Escape while its Close control or links hold
    // focus. Its target handler closes the overlay and restores attribution
    // focus; Cockpit must stay active behind it.
    if (event.target?.closest?.('.cesium-credit-lightbox')) return;
    if (
      document
        .getElementById('context-radio-dock')
        ?.classList.contains('disclosure-open')
    )
      return;
    if (
      document.querySelector('#cockpit-utility-controls [aria-expanded="true"]')
    )
      return;
    if (this.context?.contains(event.target) && !this.contextCollapsed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setContextCollapsed(true);
      if (
        event.target === this.contextToggle ||
        this.contextToggle?.contains?.(event.target)
      ) {
        this.contextToggle?.blur?.();
      } else {
        this.contextToggle?.focus({ preventScroll: true });
      }
      return;
    }
    if (this.signalStream?.contains(event.target) && !this.signalCollapsed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setSignalCollapsed(true, { user: true });
      if (
        event.target === this.signalToggle ||
        this.signalToggle?.contains?.(event.target)
      ) {
        this.signalToggle?.blur?.();
      } else {
        this.signalToggle?.focus({ preventScroll: true });
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.exit();
    return;
  }
  if (event.target?.closest?.('input, textarea, select, [contenteditable]'))
    return;
  // Walking / Drone views: W/S move, A/D turn, Q/E down/up, Shift faster.
  if (this.groundMode && this.onGroundKey(event, true)) return;
  const key = event.key?.toLowerCase();
  if (this.active && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const zoomStep =
      key === '+' || key === '=' ? 1 : key === '-' || key === '_' ? -1 : 0;
    // P saves a snapshot; Shift+P starts or stops a clip (when capture is on).
    if (key === 'p' && COCKPIT_CAPTURE_ENABLED) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) this.toggleClip();
      else this.takeSnapshot();
      return;
    }
    if (zoomStep || key === '0') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (zoomStep) this.stepZoom(zoomStep);
      else this.setZoom(1);
      return;
    }
    // Arrow keys look around, except where a focused control (tabs, sliders,
    // lists) already uses them.
    const lookStep = {
      arrowleft: [-COCKPIT_LOOK_STEP_YAW_DEG, 0],
      arrowright: [COCKPIT_LOOK_STEP_YAW_DEG, 0],
      arrowup: [0, COCKPIT_LOOK_STEP_PITCH_DEG],
      arrowdown: [0, -COCKPIT_LOOK_STEP_PITCH_DEG],
    }[key];
    if (
      (lookStep || key === 'home') &&
      !event.target?.closest?.(
        '[role="tab"], [role="slider"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [role="radiogroup"]',
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (lookStep) this.look(...lookStep);
      else this.resetLook();
      return;
    }
  }
  if (key === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (!this.active) {
      const cockpitAttempt = !!(
        this.readAircraftInfo() && this.viewer.trackedEntity?.position
      );
      if (!cockpitAttempt) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.active && !this.isEntryAllowed()) return;
    const changed = this.active ? this.exit() : this.enter();
    return;
  }
}
