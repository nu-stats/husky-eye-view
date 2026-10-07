import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layoutBottomPanelRow,
  layoutLeftPanelRail,
  layoutRightPanelRail,
  measurePanelNaturalHeight,
} from './panelRails.js';

function element(
  id,
  { height = 42, top = 234, left = 20, width = 272, collapsed = false } = {},
) {
  const classes = new Set(collapsed ? ['collapsed'] : []);
  const properties = new Map();
  const attributes = new Map();
  const writes = [];
  const node = {
    id,
    children: [],
    dataset: {},
    parentElement: null,
    scrollHeight: height,
    clientHeight: height,
    scrollTop: 0,
    computed: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      rowGap: '12px',
    },
    rect: {
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
    },
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, value) {
        if (value) classes.add(name);
        else classes.delete(name);
      },
    },
    style: {
      setProperty(name, value) {
        writes.push(['set', name, value]);
        properties.set(name, value);
      },
      getPropertyValue: (name) => properties.get(name) || '',
      removeProperty(name) {
        writes.push(['remove', name]);
        properties.delete(name);
      },
    },
    getBoundingClientRect() {
      return this.rect;
    },
    matches: (selector) => selector === '[data-panel-id]',
    contains(target) {
      return (
        target === this || this.children.some((child) => child.contains(target))
      );
    },
    querySelectorAll() {
      return this.children;
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name),
    writes,
  };
  return node;
}
function fixture(
  side,
  { mobile = false, hud = { visible: true, variant: 'tactical' } } = {},
) {
  const first = element('first', { height: 42, collapsed: true });
  const second = element('second', { height: 42, collapsed: true });
  const stack = element('rail', {
    height: 96,
    left: side === 'left' ? 20 : 1100,
  });
  stack.children = [first, second];
  first.parentElement = second.parentElement = stack;
  const documentRef = { activeElement: null };
  stack.ownerDocument = documentRef;
  const collapsed = [];
  let retries = 0,
    aligned = 0;
  const options = {
    stack,
    hud,
    documentRef,
    obstacles: [],
    collapsedHeights: new Map(),
    windowRef: {
      innerHeight: 900,
      matchMedia: () => ({ matches: mobile }),
      getComputedStyle: (node) => node.computed,
    },
    onCollapse: (panel) => collapsed.push(panel.id),
    onRetry: () => {
      retries += 1;
    },
    onAligned: () => {
      aligned += 1;
    },
    displayPanel: null,
    readDisplayScrollTop: () => 0,
    leftStack: element('left'),
  };
  const run = () =>
    (side === 'left' ? layoutLeftPanelRail : layoutRightPanelRail)(options);
  const expand = (panel, height) => {
    panel.classList.remove('collapsed');
    panel.scrollHeight = height;
    panel.rect.height = height;
    panel.rect.bottom = panel.rect.top + height;
  };
  return {
    options,
    first,
    second,
    stack,
    run,
    expand,
    collapsed,
    retries: () => retries,
    aligned: () => aligned,
  };
}

test('missing rails are inert without browser globals', () => {
  layoutLeftPanelRail({});
  layoutRightPanelRail({});
});

test('left layout records collapsed heights and aligns the right rail without changing disclosure', () => {
  const f = fixture('left');
  f.run();
  assert.equal(f.options.collapsedHeights.get('first'), 42);
  assert.equal(f.first.classList.contains('collapsed'), true);
  assert.equal(f.aligned(), 1);
  assert.equal(f.retries(), 0);
  assert.equal(f.stack.dataset.layoutMode, 'normal');
});

test('left corridor respects a lower obstacle but ignores an obstacle hidden by its parent', () => {
  const f = fixture('left');
  const blocker = element('blocker', { top: 600, height: 80 });
  const hidden = element('hidden', { top: 300, height: 80 });
  hidden.parentElement = element('hidden-parent');
  hidden.parentElement.computed.opacity = '0';
  f.options.obstacles = [blocker, hidden];
  f.run();
  assert.equal(Number(f.stack.dataset.safeBottomPct), 65.47);
});

for (const side of ['left', 'right']) {
  test(`${side} mobile layout releases desktop height/position styles and labels`, () => {
    const f = fixture(side, { mobile: true });
    f.stack.classList.add('layout-focus');
    f.stack.style.setProperty(`--${side}-stack-safe-top`, '300px');
    f.first.style.setProperty(`--${side}-panel-allocated-height`, '99px');
    f.first.setAttribute('aria-hidden', 'true');
    f.run();
    assert.equal(f.stack.dataset.layoutMode, 'mobile');
    assert.equal(
      f.stack.style.getPropertyValue(`--${side}-stack-safe-top`),
      '',
    );
    assert.equal(
      f.first.style.getPropertyValue(`--${side}-panel-allocated-height`),
      '',
    );
    assert.equal(f.first.getAttribute('aria-hidden'), undefined);
  });
  test(`${side} hidden HUD restores automatic collapse without altering manual collapse`, () => {
    const f = fixture(side, { hud: { visible: false, variant: 'tactical' } });
    f.first.classList.add('layout-auto-collapsed');
    f.run();
    assert.equal(f.first.classList.contains('collapsed'), false);
    assert.equal(f.second.classList.contains('collapsed'), true);
    assert.deepEqual(f.collapsed, ['first']);
  });
}

test('left constrained layout preserves the preferred panel and requests another pass', () => {
  const f = fixture('left');
  f.expand(f.first, 900);
  f.expand(f.second, 900);
  f.options.preferredPanelId = 'second';
  f.run();
  assert.equal(f.second.classList.contains('collapsed'), false);
  assert.equal(f.first.classList.contains('layout-auto-collapsed'), true);
  assert.deepEqual(f.collapsed, ['first']);
  assert.equal(f.retries(), 1);
});

/** The bottom row (Display, CCTV, Context) in a 1600x900 window. */
function bottomRow({ dockRight = 1040, railWidth = 400 } = {}) {
  const f = fixture('right');
  f.options.windowRef.innerWidth = 1600;
  f.stack.rect = {
    top: 800,
    bottom: 850,
    height: 50,
    left: 1100,
    right: 1100 + railWidth,
    width: railWidth,
  };
  // Collapsed launchers at the narrowest slot width.
  for (const panel of [f.first, f.second]) {
    panel.rect.width = 128;
    panel.rect.right = panel.rect.left + 128;
  }
  f.options.dock = element('dock', {
    left: 560,
    width: dockRight - 560,
    top: 790,
    height: 92,
  });
  return f;
}

test('the bottom row sits beside the command dock, bottom-aligned with it', () => {
  const f = bottomRow();
  f.run();
  assert.equal(f.stack.dataset.layoutMode, 'bottom');
  assert.equal(f.stack.dataset.placement, 'docked');
  // Dock right edge 1040 + the 10.8px gap; its bottom is 18px above the edge.
  assert.equal(
    f.stack.style.getPropertyValue('--bottom-rail-left'),
    '1050.8px',
  );
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-right'), 'auto');
  assert.equal(
    f.stack.style.getPropertyValue('--bottom-rail-offset'),
    '18.0px',
  );
  assert.equal(
    f.stack.style.getPropertyValue('--right-stack-max-height'),
    '756.0px',
  );
});

test('beside the dock, the row lifts just enough to clear a low obstacle beneath it', () => {
  const f = bottomRow();
  // The Power Up chip at the bottom-right sits under the row's right end
  // (two 128px slots and an 8px gap: 1050.8 to 1314.8).
  const chip = element('key-setup-chip', {
    left: 1300,
    width: 226,
    top: 850,
    height: 36,
  });
  f.options.obstacles = [chip];
  f.run();
  assert.equal(f.stack.dataset.placement, 'docked');
  assert.equal(
    f.stack.style.getPropertyValue('--bottom-rail-left'),
    '1050.8px',
  );
  assert.equal(
    f.stack.style.getPropertyValue('--bottom-rail-offset'),
    '60.8px',
  );
});

test('the rows either side of the dock stay level when one must rise', () => {
  const right = bottomRow();
  const left = bottomRow();
  // The Power Up chip lifts the right-hand row (as above); nothing is under
  // the left-hand row.
  right.options.obstacles = [
    element('key-setup-chip', { left: 1300, width: 226, top: 850, height: 36 }),
  ];
  left.options.partner = right.stack;
  right.options.partner = left.stack;
  layoutBottomPanelRow({ ...left.options, side: 'left' });
  assert.equal(
    left.stack.style.getPropertyValue('--bottom-rail-offset'),
    '18.0px',
  );
  right.run();
  // The right row rises, and the left one with it.
  assert.equal(
    right.stack.style.getPropertyValue('--bottom-rail-offset'),
    '60.8px',
  );
  assert.equal(
    left.stack.style.getPropertyValue('--bottom-rail-offset'),
    '60.8px',
  );
  // A later left pass keeps the shared height.
  layoutBottomPanelRow({ ...left.options, side: 'left' });
  assert.equal(
    left.stack.style.getPropertyValue('--bottom-rail-offset'),
    '60.8px',
  );
});

test('with no room beside the dock the row moves to the corner, above what is beneath it', () => {
  const f = bottomRow({ dockRight: 1400 });
  const chip = element('key-setup-chip', {
    left: 1360,
    width: 226,
    top: 850,
    height: 36,
  });
  f.options.obstacles = [chip];
  f.run();
  assert.equal(f.stack.dataset.placement, 'corner');
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-left'), 'auto');
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-right'), '14px');
  // The wide dock now reaches under the row too, so the row clears its top.
  assert.equal(
    f.stack.style.getPropertyValue('--bottom-rail-offset'),
    '120.8px',
  );
});

test('hidden, upper-half and off-to-the-side obstacles do not move the row', () => {
  const f = bottomRow();
  const hidden = element('hidden', { left: 1200, top: 850, height: 30 });
  hidden.computed.display = 'none';
  const high = element('high', { left: 1200, top: 100, height: 200 });
  const left = element('left', { left: 0, width: 300, top: 850, height: 30 });
  f.options.obstacles = [hidden, high, left];
  f.run();
  assert.equal(f.stack.dataset.placement, 'docked');
});

test('opening a panel pops it up over its slot without moving the row or its neighbours', () => {
  const f = bottomRow();
  const rowVars = () =>
    ['--bottom-rail-left', '--bottom-rail-offset', '--bottom-rail-width'].map(
      (name) => f.stack.style.getPropertyValue(name),
    );
  f.run();
  const closed = rowVars();
  assert.deepEqual(closed, ['1050.8px', '18.0px', '264px']);
  assert.equal(f.first.style.getPropertyValue('--slot-left'), '0px');
  assert.equal(f.second.style.getPropertyValue('--slot-left'), '136px');
  // A 500px panel opened from the second slot (1186.8) would run past the
  // window's 14px inset, so it is nudged left just enough.
  f.expand(f.second, 700);
  f.second.rect.width = 500;
  f.run();
  assert.deepEqual(rowVars(), closed);
  assert.equal(f.first.style.getPropertyValue('--slot-left'), '0px');
  assert.equal(f.second.style.getPropertyValue('--slot-left'), '136px');
  assert.equal(f.second.style.getPropertyValue('--popup-shift'), '-100.8px');
  assert.equal(f.first.style.getPropertyValue('--popup-shift'), '');
  f.second.classList.add('collapsed');
  f.run();
  assert.equal(f.second.style.getPropertyValue('--popup-shift'), '');
});

test('a wider launcher gets a wider slot and keeps it while its panel is open', () => {
  const f = bottomRow();
  // "DATA LAYERS" and its arrow need 161px collapsed.
  f.first.rect.width = 161;
  f.run();
  assert.equal(f.second.style.getPropertyValue('--slot-left'), '169px');
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-width'), '297px');
  f.expand(f.first, 700);
  f.first.rect.width = 280;
  f.run();
  assert.equal(f.second.style.getPropertyValue('--slot-left'), '169px');
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-width'), '297px');
});

test('the left row sits left of the dock, clears the map credits and keeps pop-ups off the dock', () => {
  const f = bottomRow();
  const runLeft = () => layoutBottomPanelRow({ ...f.options, side: 'left' });
  // A credit line under the row's left end.
  f.options.obstacles = [
    element('credits', { left: 24, width: 380, top: 862, height: 20 }),
  ];
  runLeft();
  assert.equal(f.stack.dataset.placement, 'docked');
  // Dock left edge 560 - the 10.8px gap - the 264px row.
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-left'), '285.2px');
  assert.equal(f.stack.style.getPropertyValue('--bottom-rail-right'), 'auto');
  assert.equal(
    f.stack.style.getPropertyValue('--bottom-rail-offset'),
    '48.8px',
  );
  assert.equal(
    f.stack.style.getPropertyValue('--left-stack-max-height'),
    '725.2px',
  );
  // A 360px panel from the second slot would reach over the dock, so it is
  // nudged left until its right edge meets the row's (549.2).
  f.expand(f.second, 600);
  f.second.rect.width = 360;
  runLeft();
  assert.equal(f.second.style.getPropertyValue('--popup-shift'), '-232.0px');
});

test('the bottom row never collapses or hides panels to make room', () => {
  const f = bottomRow();
  f.expand(f.first, 900);
  f.expand(f.second, 900);
  f.first.setAttribute('aria-hidden', 'true');
  f.second.classList.add('collapsed', 'layout-auto-collapsed');
  f.run();
  assert.equal(f.first.classList.contains('collapsed'), false);
  assert.equal(
    f.second.classList.contains('collapsed'),
    false,
    'an older automatic collapse is released',
  );
  assert.equal(f.first.getAttribute('aria-hidden'), undefined);
  assert.equal(f.retries(), 0);
});

test('an open Display keeps its restored scroll, capped to its content', () => {
  const f = bottomRow();
  f.first.id = 'pp-toggles';
  f.expand(f.first, 900);
  f.first.clientHeight = 400;
  f.options.displayPanel = f.first;
  f.options.readDisplayScrollTop = () => 800;
  f.run();
  assert.equal(f.first.scrollTop, 500);
  f.stack.writes.length = 0;
  f.run();
  assert.equal(
    f.stack.writes.length,
    0,
    'a stable layout must not churn the style attribute',
  );
});

test('natural height includes visible content, margins and wrapper chrome, excluding hidden rows', () => {
  const panel = element('panel');
  const inner = element('inner', { top: 100 });
  inner.computed.paddingTop = '10px';
  inner.computed.paddingBottom = '5px';
  const row = element('row', { top: 110, height: 40 });
  row.scrollHeight = 80;
  row.computed.marginBottom = '3px';
  const hidden = element('hidden', { top: 1000, height: 900 });
  hidden.computed.visibility = 'hidden';
  panel.computed.borderTopWidth = '1px';
  panel.computed.borderBottomWidth = '1px';
  panel.children = [inner];
  inner.children = [row, hidden];
  assert.equal(
    measurePanelNaturalHeight(panel, (node) => node.computed),
    100,
  );
});
