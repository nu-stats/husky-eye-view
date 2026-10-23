import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MENU_HIDDEN_CLASS,
  MENU_ITEMS,
  MENU_VISIBILITY_KEY,
  MENU_WORKSPACES,
  DEFAULT_WORKSPACE,
  applyHiddenMenus,
  matchingWorkspace,
  normalizeHiddenMenus,
  readHiddenMenus,
  workspaceHiddenMenus,
  writeHiddenMenus,
} from './menuVisibility.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

function fakeDocument(ids) {
  const elements = new Map();
  for (const id of ids) {
    const classes = new Set(['collapsed']);
    const clicks = [];
    elements.set(id, {
      id,
      clicks,
      classList: {
        contains: (name) => classes.has(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        remove: (name) => classes.delete(name),
      },
      querySelector: () => ({ click: () => clicks.push(id) }),
      classes,
    });
  }
  return { getElementById: (id) => elements.get(id) || null, elements };
}

test('every listed menu exists in the markup, and Weather and Recent Imagery stay automatic', () => {
  const read = (name) =>
    fs.readFileSync(new URL(`./templates/${name}`, import.meta.url), 'utf8');
  const html = [
    'layer-panels.html',
    'command-dock.html',
    'display-controls.html',
    'context.html',
  ]
    .map(read)
    .join('\n');
  for (const { id } of MENU_ITEMS)
    assert.match(html, new RegExp(`id="${id}"`), id);
  const ids = MENU_ITEMS.map(({ id }) => id);
  assert.equal(ids.includes('weather-panel'), false);
  assert.equal(ids.includes('recent-imagery-panel'), false);
  assert.match(
    read('scene-chrome.html'),
    /id="menu-customize"[^>]*aria-label=/,
  );
});

test('hidden menus are known ids, once each, in menu order', () => {
  assert.deepEqual(
    normalizeHiddenMenus(['cctv-panel', 'nope', 'data-panel', 'cctv-panel']),
    ['data-panel', 'cctv-panel'],
  );
  assert.deepEqual(normalizeHiddenMenus('data-panel'), []);
});

test('workspaces set every menu at once and are recognized back', () => {
  assert.deepEqual(
    MENU_WORKSPACES.map(({ id }) => id),
    ['research', 'teach', 'live', 'all'],
  );
  assert.deepEqual(workspaceHiddenMenus('research'), [
    'scene-panel',
    'control-panel',
    'pp-toggles',
    'cctv-panel',
    'global-context-panel',
  ]);
  assert.deepEqual(workspaceHiddenMenus('all'), []);
  for (const { id } of MENU_WORKSPACES)
    assert.equal(matchingWorkspace(workspaceHiddenMenus(id)), id);
  assert.equal(matchingWorkspace(['cctv-panel']), 'custom');
  // Data Layers is in every workspace: the layers are always one click away.
  for (const { shown } of MENU_WORKSPACES)
    assert.ok(shown.includes('data-panel'));
});

test('the choice round-trips through storage and survives broken storage', () => {
  const storage = memoryStorage();
  // Nothing stored yet: the Research workspace (DEFAULT_WORKSPACE).
  assert.deepEqual(readHiddenMenus(storage), workspaceHiddenMenus('research'));
  assert.equal(DEFAULT_WORKSPACE, 'research');
  assert.equal(writeHiddenMenus(['cctv-panel', 'bogus'], storage), true);
  assert.equal(
    storage.data.get(MENU_VISIBILITY_KEY),
    '{"hidden":["cctv-panel"]}',
  );
  assert.deepEqual(readHiddenMenus(storage), ['cctv-panel']);
  storage.setItem(MENU_VISIBILITY_KEY, '{not json');
  assert.deepEqual(readHiddenMenus(storage), []);
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readHiddenMenus(throwing), []);
  assert.equal(writeHiddenMenus(['cctv-panel'], throwing), false);
  assert.equal(writeHiddenMenus(['cctv-panel'], null), false);
});

test('hiding toggles the class, and an open menu is closed before it hides', () => {
  const doc = fakeDocument(['data-panel', 'cctv-panel', 'analysis-panel']);
  doc.elements.get('cctv-panel').classes.delete('collapsed');
  applyHiddenMenus(['cctv-panel', 'analysis-panel'], doc);
  assert.equal(
    doc.elements.get('cctv-panel').classList.contains(MENU_HIDDEN_CLASS),
    true,
  );
  assert.equal(
    doc.elements.get('analysis-panel').classList.contains(MENU_HIDDEN_CLASS),
    true,
  );
  assert.equal(
    doc.elements.get('data-panel').classList.contains(MENU_HIDDEN_CLASS),
    false,
  );
  // Only the open one was closed; the collapsed one was left alone.
  assert.deepEqual(doc.elements.get('cctv-panel').clicks, ['cctv-panel']);
  assert.deepEqual(doc.elements.get('analysis-panel').clicks, []);
  applyHiddenMenus([], doc);
  assert.equal(
    doc.elements.get('cctv-panel').classList.contains(MENU_HIDDEN_CLASS),
    false,
  );
});
