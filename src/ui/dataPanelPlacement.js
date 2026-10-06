/**
 * Layout trial (opt-in, nothing changes by default): with `?panel=top` in the
 * address, the Data Layers menu moves from the bottom row to just under the
 * Husky Eye View title plate and drops down instead of opening upward.
 *
 * The panel element itself moves into a fixed top-left anchor, so the bottom
 * row's layout engine no longer places it; every panel control keeps working.
 */
export const DATA_PANEL_TOP_PARAM = 'panel';
export const DATA_PANEL_TOP_VALUE = 'top';
export const DATA_PANEL_TOP_CLASS = 'data-panel-top';

/** Whether this page asked for the trial layout. */
export function wantsDataPanelTop(search = globalThis.location?.search || '') {
  try {
    return (
      new URLSearchParams(search).get(DATA_PANEL_TOP_PARAM) ===
      DATA_PANEL_TOP_VALUE
    );
  } catch {
    return false;
  }
}

/**
 * Move #data-panel under the title plate when the page asked for it.
 * @returns {boolean} True when the trial layout is in force.
 */
export function applyDataPanelPlacement(
  doc = globalThis.document,
  search = globalThis.location?.search || '',
) {
  if (!doc || !wantsDataPanelTop(search)) return false;
  const panel = doc.getElementById('data-panel');
  if (!panel) return false;
  let anchor = doc.getElementById('data-panel-top-anchor');
  if (!anchor) {
    anchor = doc.createElement('div');
    anchor.id = 'data-panel-top-anchor';
    doc.body.appendChild(anchor);
  }
  anchor.appendChild(panel);
  doc.body.classList.add(DATA_PANEL_TOP_CLASS);
  return true;
}
