import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewCapture } from './viewCapture.js';

/** Just enough DOM, canvas and MediaRecorder for the recording lifecycle. */
function harness() {
  const holds = [];
  const downloads = [];
  const states = [];
  const listeners = new Set();
  const context2d = new Proxy(
    { measureText: (text) => ({ width: String(text).length * 6 }) },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const doc = {
    createElement: (tag) =>
      tag === 'canvas'
        ? {
            width: 0,
            height: 0,
            getContext: () => context2d,
            captureStream: () => ({ getTracks: () => [track] }),
          }
        : { style: {}, click() {}, remove() {} },
    getElementById: () => null,
    body: { appendChild() {} },
  };
  class FakeRecorder {
    static isTypeSupported = (type) => type === 'video/mp4';
    constructor(stream, { mimeType }) {
      this.mimeType = mimeType;
      this.state = 'inactive';
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: { size: 10 } });
      this.onstop();
    }
  }
  globalThis.MediaRecorder = FakeRecorder;
  globalThis.Blob = class {
    constructor(parts, { type }) {
      this.size = parts.length;
      this.type = type;
    }
  };
  const viewer = {
    scene: {
      canvas: { width: 1258, height: 977 },
      postRender: {
        addEventListener(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      requestRender() {},
    },
  };
  const capture = new ViewCapture({
    viewer,
    describe: () => ({ view: 'DRONE · 60 M', place: 'Boston', layers: [] }),
    holdRender: (id) => holds.push(`+${id}`),
    releaseRender: (id) => holds.push(`-${id}`),
    onState: (state) => states.push(state),
    doc,
    now: () => new Date(2026, 9, 4, 14, 32, 7),
  });
  capture._download = (blob, name) => downloads.push({ blob, name });
  return { capture, holds, downloads, states, listeners, track };
}

test('a clip holds rendering while it runs and saves when stopped', async () => {
  const h = harness();
  assert.equal(await h.capture.startClip(), true);
  assert.equal(h.capture.recording, true);
  assert.deepEqual(h.holds, ['+view-capture']);
  assert.equal(h.listeners.size, 1, 'frames are copied after each render');

  assert.equal(h.capture.stopClip(), true);
  assert.equal(h.capture.recording, false);
  assert.deepEqual(h.holds, ['+view-capture', '-view-capture']);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.track.stopped, true);
  assert.equal(h.downloads.length, 1);
  assert.equal(
    h.downloads[0].name,
    'husky-eye-view_boston_2026-10-04_143207.mp4',
  );
  assert.ok(h.states.some((state) => state.saved === h.downloads[0].name));
});

test('a second press while starting does not start a second clip', async () => {
  const h = harness();
  const [first, second] = await Promise.all([
    h.capture.startClip(),
    h.capture.startClip(),
  ]);
  assert.deepEqual([first, second], [true, false]);
  assert.deepEqual(h.holds, ['+view-capture']);
  h.capture.destroy();
  assert.equal(h.downloads.length, 1, 'destroy saves the running clip');
  assert.equal(await h.capture.startClip(), false, 'no clips after destroy');
});

test('a browser without a recorder reports it instead of throwing', async () => {
  const h = harness();
  globalThis.MediaRecorder = { isTypeSupported: () => false };
  assert.equal(await h.capture.startClip(), false);
  assert.match(h.states.at(-1).error, /cannot record/);
  assert.deepEqual(h.holds, []);
});
