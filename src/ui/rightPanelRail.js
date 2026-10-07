/**
 * Menus that live in a row along the bottom of the screen and open upward, so
 * they stay out of the view: Display, CCTV and Context on the right of the
 * command dock, Data Layers and Scenes on its left. Each launcher keeps a
 * fixed slot in its row, and an open panel pops up above its own slot, so
 * opening one never moves the others. The row sits beside the dock,
 * bottom-aligned with it; when the window is too narrow for that it moves to
 * its bottom corner, clear of anything beneath it (the Power Up chip, the
 * map credits, or the dock itself). Each pass also decides how tall an open
 * panel may grow above the row.
 */

/** Lowest the row sits: level with the Power Up chip's own 0.9rem inset. */
const BOTTOM_ROW_MIN_OFFSET_PX = 14;
/** Room kept free above an open panel, as a fraction of the window height. */
const BOTTOM_ROW_TOP_RESERVE = 0.14;
/** Narrowest launcher slot (a collapsed menu). */
const BOTTOM_ROW_SLOT_WIDTH_PX = 128;
/** Each launcher's measured collapsed width, kept while its panel is open. */
const COLLAPSED_WIDTHS = new WeakMap();
/** Space between launcher slots. */
const BOTTOM_ROW_SLOT_GAP_PX = 8;

function hiddenByAncestor(element, getComputedStyle) {
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    )
      return true;
  }
  return false;
}

function setIfChanged(element, name, value) {
  if (element.style.getPropertyValue(name) !== value)
    element.style.setProperty(name, value);
}

function removeIfSet(element, name) {
  if (element.style.getPropertyValue(name)) element.style.removeProperty(name);
}

const ROW_PROPERTIES = [
  '--bottom-rail-offset',
  '--bottom-rail-left',
  '--bottom-rail-right',
  '--bottom-rail-width',
];

/**
 * Measure and place one bottom menu row for one synchronous layout pass.
 * The caller owns scheduling, obstacle selection and persistence.
 * @param {object} options Live DOM and caller policy.
 * @param {HTMLElement} options.stack Row element.
 * @param {'left'|'right'} [options.side] Which side of the dock the row sits on.
 * @param {HTMLElement} [options.dock] Command dock the row sits beside.
 * @param {Iterable<HTMLElement>} options.obstacles Caller-selected obstacle nodes.
 * @param {Window} options.windowRef Viewport and style reader.
 * @param {Function} options.onCollapse Update a panel's disclosure chrome.
 * @param {HTMLElement} [options.displayPanel] Panel whose scroll is restored.
 * @param {Function} [options.readDisplayScrollTop] Read the caller's scroll restoration value.
 * @param {Function} [options.getComputedStyle] Optional DOM style reader override.
 */
export function layoutBottomPanelRow({
  stack,
  side = 'right',
  dock = null,
  obstacles = [],
  windowRef,
  onCollapse = () => {},
  displayPanel = null,
  readDisplayScrollTop = () => 0,
  getComputedStyle = (element) => windowRef.getComputedStyle(element),
  partner = null,
}) {
  if (!stack) return;
  const heightVar = `--${side}-stack-max-height`;

  const panels = [...stack.children].filter((panel) =>
    panel.matches('[data-panel-id]'),
  );
  // Side by side, panels never compete for height, so none is collapsed to
  // make room and every launcher stays in reach. Release anything an older
  // stacked layout collapsed or hid.
  for (const panel of panels) {
    if (panel.classList.contains('layout-auto-collapsed')) {
      panel.classList.remove('collapsed', 'layout-auto-collapsed');
      onCollapse(panel);
    }
    panel.removeAttribute('aria-hidden');
    removeIfSet(panel, `--${side}-panel-allocated-height`);
  }
  stack.classList.remove('layout-exclusive', 'layout-focus', 'layout-tail');
  removeIfSet(stack, `--${side}-stack-safe-top`);
  removeIfSet(stack, `--${side}-stack-safe-bottom`);

  const isMobile = windowRef.matchMedia('(max-width: 720px)').matches;
  if (isMobile) {
    stack.classList.remove('bottom-row');
    removeIfSet(stack, heightVar);
    for (const name of ROW_PROPERTIES) removeIfSet(stack, name);
    for (const panel of panels) {
      removeIfSet(panel, '--slot-left');
      removeIfSet(panel, '--popup-shift');
    }
    stack.dataset.layoutMode = 'mobile';
    return;
  }
  stack.classList.add('bottom-row');

  // Fixed launcher slots, in document order, for every panel on screen. Each
  // slot is as wide as its collapsed launcher, remembered while the panel is
  // open so opening it never moves its neighbours.
  const shown = panels.filter(
    (panel) => getComputedStyle(panel).display !== 'none',
  );
  const slotLefts = [];
  let rowWidth = 0;
  for (const panel of shown) {
    let width = COLLAPSED_WIDTHS.get(panel) ?? BOTTOM_ROW_SLOT_WIDTH_PX;
    if (panel.classList.contains('collapsed')) {
      width = Math.max(
        BOTTOM_ROW_SLOT_WIDTH_PX,
        Math.ceil(panel.getBoundingClientRect().width),
      );
      COLLAPSED_WIDTHS.set(panel, width);
    }
    if (slotLefts.length) rowWidth += BOTTOM_ROW_SLOT_GAP_PX;
    slotLefts.push(rowWidth);
    setIfChanged(panel, '--slot-left', `${rowWidth}px`);
    rowWidth += width;
  }
  rowWidth = Math.max(BOTTOM_ROW_SLOT_WIDTH_PX, rowWidth);

  const viewportHeight = Math.max(1, windowRef.innerHeight);
  const viewportWidth = Math.max(1, windowRef.innerWidth || 0);
  const gap = Math.max(8, viewportHeight * 0.012);
  const rects = [];
  for (const obstacle of obstacles) {
    if (obstacle === dock || stack.contains(obstacle)) continue;
    const rect = obstacle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (hiddenByAncestor(obstacle, getComputedStyle)) continue;
    rects.push(rect);
  }
  // Lowest offset that clears every lower-half obstacle under [left, right].
  const clearOffset = (left, right, floor, extra = []) => {
    let offset = floor;
    for (const rect of [...rects, ...extra]) {
      if (rect.right <= left || rect.left >= right) continue;
      if (rect.top < viewportHeight * 0.5) continue;
      offset = Math.max(offset, viewportHeight - rect.top + gap);
    }
    return offset;
  };

  // Beside the dock whenever the row fits between it and the window edge,
  // bottom-aligned with it; anything low beneath the row there (the Power Up
  // chip, the map credits) lifts the row just enough to clear it.
  let placement = null;
  const dockRect =
    dock && !hiddenByAncestor(dock, getComputedStyle)
      ? dock.getBoundingClientRect()
      : null;
  if (dockRect && dockRect.width > 0 && dockRect.height > 0) {
    const left =
      side === 'left' ? dockRect.left - gap - rowWidth : dockRect.right + gap;
    const right = left + rowWidth;
    if (
      left >= BOTTOM_ROW_MIN_OFFSET_PX &&
      right <= viewportWidth - BOTTOM_ROW_MIN_OFFSET_PX
    ) {
      const floor = Math.max(0, viewportHeight - dockRect.bottom);
      placement = {
        mode: 'docked',
        left,
        offset: clearOffset(left, right, floor),
      };
    }
  }
  if (!placement) {
    // The row's own bottom corner, above anything beneath it there.
    const left =
      side === 'left'
        ? BOTTOM_ROW_MIN_OFFSET_PX
        : viewportWidth - BOTTOM_ROW_MIN_OFFSET_PX - rowWidth;
    placement = {
      mode: 'corner',
      left,
      offset: clearOffset(
        left,
        left + rowWidth,
        BOTTOM_ROW_MIN_OFFSET_PX,
        dockRect ? [dockRect] : [],
      ),
    };
  }
  // The rows either side of the dock stay level: when one must rise (the
  // Power Up chip under the right-hand row on a narrower window), the other
  // rises with it.
  const ownOffset = placement.offset;
  stack.dataset.ownOffset = ownOffset.toFixed(1);
  const partnerDocked =
    partner?.dataset?.layoutMode === 'bottom' &&
    partner.dataset.placement === 'docked' &&
    placement.mode === 'docked';
  const partnerOwn = partnerDocked ? Number(partner.dataset.ownOffset) || 0 : 0;
  const offset = Math.max(ownOffset, partnerOwn);
  if (
    partnerDocked &&
    ownOffset > (Number(partner.dataset.bottomOffset) || 0)
  ) {
    setIfChanged(partner, '--bottom-rail-offset', `${ownOffset.toFixed(1)}px`);
    partner.dataset.bottomOffset = ownOffset.toFixed(1);
  }
  const topReserve = Math.max(96, viewportHeight * BOTTOM_ROW_TOP_RESERVE);
  const maxHeight = Math.max(160, viewportHeight - offset - topReserve);
  const cornerRight = placement.mode === 'corner' && side === 'right';
  setIfChanged(stack, '--bottom-rail-offset', `${offset.toFixed(1)}px`);
  setIfChanged(
    stack,
    '--bottom-rail-left',
    cornerRight ? 'auto' : `${placement.left.toFixed(1)}px`,
  );
  setIfChanged(
    stack,
    '--bottom-rail-right',
    cornerRight ? `${BOTTOM_ROW_MIN_OFFSET_PX}px` : 'auto',
  );
  setIfChanged(stack, '--bottom-rail-width', `${rowWidth}px`);
  setIfChanged(stack, heightVar, `${maxHeight.toFixed(1)}px`);
  stack.dataset.layoutMode = 'bottom';
  stack.dataset.placement = placement.mode;
  stack.dataset.bottomOffset = offset.toFixed(1);
  stack.dataset.availableHeight = maxHeight.toFixed(1);

  // An open panel pops up over its own slot, nudged sideways only as far as
  // it takes to stay on screen and off the command dock.
  const [minLeft, maxRight] =
    side === 'left'
      ? [BOTTOM_ROW_MIN_OFFSET_PX, placement.left + rowWidth]
      : [placement.left, viewportWidth - BOTTOM_ROW_MIN_OFFSET_PX];
  shown.forEach((panel, index) => {
    if (panel.classList.contains('collapsed')) {
      removeIfSet(panel, '--popup-shift');
      return;
    }
    const slotLeft = placement.left + slotLefts[index];
    const width = panel.getBoundingClientRect().width;
    const popupLeft = Math.max(minLeft, Math.min(slotLeft, maxRight - width));
    const shift = popupLeft - slotLeft;
    if (Math.abs(shift) < 0.5) removeIfSet(panel, '--popup-shift');
    else setIfChanged(panel, '--popup-shift', `${shift.toFixed(1)}px`);
  });

  if (displayPanel && !displayPanel.classList.contains('collapsed')) {
    const displayScrollTop = readDisplayScrollTop();
    const maxScrollTop = Math.max(
      0,
      displayPanel.scrollHeight - displayPanel.clientHeight,
    );
    displayPanel.scrollTop = Math.min(displayScrollTop, maxScrollTop);
  }
}

/**
 * The Display, CCTV and Context row, right of the command dock.
 * @param {object} options See layoutBottomPanelRow.
 */
export function layoutRightPanelRail(options) {
  return layoutBottomPanelRow({ ...options, side: 'right' });
}
