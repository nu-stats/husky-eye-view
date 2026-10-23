import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CALM_KEY,
  FADE_AFTER_MS,
  NEAR_BOTTOM_PX,
  NEAR_TOP_PX,
  nearChromeEdge,
  readCalm,
  shouldFade,
  writeCalm,
} from './calmChrome.js';

const base = {
  enabled: true,
  moving: false,
  idleMs: 0,
  panelOpen: false,
  nearChrome: false,
  focusInChrome: false,
};

test('the menus fade while the map moves or after a quiet spell', () => {
  assert.equal(shouldFade(base), false, 'just used: up');
  assert.equal(shouldFade({ ...base, moving: true }), true);
  assert.equal(shouldFade({ ...base, idleMs: FADE_AFTER_MS - 1 }), false);
  assert.equal(shouldFade({ ...base, idleMs: FADE_AFTER_MS }), true);
});

test('nothing fades before the map is first used, so a new visitor sees every menu', () => {
  assert.equal(
    shouldFade({
      ...base,
      armed: false,
      moving: true,
      idleMs: FADE_AFTER_MS * 10,
    }),
    false,
  );
});

test('an open menu, the pointer at an edge, the keyboard or the switch keep them up', () => {
  const faded = { ...base, moving: true, idleMs: FADE_AFTER_MS * 10 };
  assert.equal(shouldFade({ ...faded, panelOpen: true }), false);
  assert.equal(shouldFade({ ...faded, nearChrome: true }), false);
  assert.equal(shouldFade({ ...faded, focusInChrome: true }), false);
  assert.equal(shouldFade({ ...faded, enabled: false }), false);
});

test('the edge bands are the top and bottom of the window', () => {
  const height = 900;
  assert.equal(nearChromeEdge(NEAR_TOP_PX, height), true);
  assert.equal(nearChromeEdge(NEAR_TOP_PX + 1, height), false);
  assert.equal(nearChromeEdge(height - NEAR_BOTTOM_PX, height), true);
  assert.equal(nearChromeEdge(450, height), false);
  assert.equal(
    nearChromeEdge(NaN, height),
    false,
    'pointer outside the window',
  );
});

test('the calm screen is on unless switched off, and survives broken storage', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  assert.equal(readCalm(storage), true);
  assert.equal(writeCalm(false, storage), true);
  assert.equal(data.get(CALM_KEY), 'off');
  assert.equal(readCalm(storage), false);
  writeCalm(true, storage);
  assert.equal(readCalm(storage), true);
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readCalm(broken), true);
  assert.equal(writeCalm(false, null), false);
});

test('the styles fade the menus, shrink the title and move POWER UP', () => {
  const css = fs.readFileSync(
    new URL('./styles/status.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /body\.hev-chrome-faded #left-panel-stack/);
  assert.match(css, /body\.hev-chrome-faded #top-center-actions/);
  assert.match(css, /body\.hev-calm #key-setup-chip/);
  assert.match(css, /body\.hev-title-compact #title-bar:hover/);
  // Reduced motion is honoured in calmChrome.js (no media rule on the dock,
  // which the credit layout model reads).
  assert.match(css, /body.hev-calm-animate #command-dock/);
  assert.doesNotMatch(css, /prefers-reduced-motion[^{]*{[^}]*#command-dock/);
});
