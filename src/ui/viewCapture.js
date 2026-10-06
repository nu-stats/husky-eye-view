/**
 * Snapshots (PNG or JPG) and short clips (MP4, or WebM where MP4 is missing) of the
 * 3D view, with a caption strip burned in: what the view is, where, when,
 * which layers are on, and the map credits the providers require on images.
 *
 * Only the 3D canvas and the label/card overlay canvas are captured; the
 * cockpit HUD, panels and title stay out so the picture reads cleanly.
 */
import { captionLines, captureFileName } from './captureCaption.js';

/** Longest clip, in seconds; recording stops and saves on its own here. */
export const CLIP_MAX_SECONDS = 60;
const CLIP_FPS = 30;
const CLIP_BITS_PER_SECOND = 12_000_000;
/** Wider clips are scaled down to this width (keeps files and encoders sane). */
const CLIP_MAX_WIDTH = 1920;
const RENDER_HOLD_ID = 'view-capture';
const SNAPSHOT_HOLD_ID = 'view-snapshot';
/** How often the caption text is re-read while recording. */
const CAPTION_REFRESH_MS = 1000;
const FRESH_FRAME_TIMEOUT_MS = 600;

const CLIP_TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

/** First clip format this browser can record, or null. */
export function pickClipType(
  isSupported = (type) => globalThis.MediaRecorder?.isTypeSupported?.(type),
) {
  return CLIP_TYPES.find((type) => isSupported(type)) || null;
}

/** File extension for a recorder MIME type. */
export function clipExtension(mimeType) {
  return /mp4/i.test(String(mimeType)) ? 'mp4' : 'webm';
}

/** Snapshot formats offered; HEIC and other formats are never written. */
export const SNAPSHOT_FORMATS = Object.freeze({
  png: Object.freeze({ type: 'image/png', extension: 'png', label: 'PNG' }),
  jpg: Object.freeze({
    type: 'image/jpeg',
    extension: 'jpg',
    label: 'JPG',
    quality: 0.92,
  }),
});
/** Snapshots render at least this many pixels wide (up to 2.5× the screen). */
export const SNAPSHOT_TARGET_WIDTH = 3000;
const SNAPSHOT_MAX_SCALE = 2.5;
/** Time for sharper tiles to arrive after the render resolution goes up. */
const SNAPSHOT_SETTLE_MS = 700;

/** A supported snapshot format key ('png' unless 'jpg' is asked for). */
export function normalizeSnapshotFormat(format) {
  const key = String(format || '').toLowerCase();
  return key === 'jpg' || key === 'jpeg' ? 'jpg' : 'png';
}

/** Render-resolution multiplier that brings a frame up to the target width. */
export function snapshotScale(width) {
  if (!(width > 0)) return 1;
  return Math.min(
    SNAPSHOT_MAX_SCALE,
    Math.max(1, SNAPSHOT_TARGET_WIDTH / width),
  );
}

/** Caption strip height for a frame height (readable at 720p and at 4K). */
export function captionStripHeight(frameHeight) {
  return Math.max(40, Math.round(frameHeight * 0.06));
}

/** "0:07 / 1:00" */
export function formatClipTime(seconds, maxSeconds = CLIP_MAX_SECONDS) {
  const clock = (value) => {
    const whole = Math.max(0, Math.floor(value));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  };
  return `${clock(seconds)} / ${clock(maxSeconds)}`;
}

export class ViewCapture {
  /**
   * @param {object} options
   * @param {import('cesium').Viewer} options.viewer
   * @param {() => {view?: string, place?: string, layers?: string[]}} options.describe
   * @param {(id: string) => void} [options.holdRender]
   * @param {(id: string) => void} [options.releaseRender]
   * @param {(state: object) => void} [options.onState]
   */
  constructor({
    viewer,
    describe,
    holdRender = () => {},
    releaseRender = () => {},
    onState = () => {},
    doc = document,
    now = () => new Date(),
    format = 'png',
    // Longest clip in seconds (a curated flight records longer than 60 s).
    maxSeconds = CLIP_MAX_SECONDS,
    // Draws extra content (e.g. a tour's highlight card) into every frame.
    paintOverlay = null,
  }) {
    Object.assign(this, {
      viewer,
      describe,
      holdRender,
      releaseRender,
      onState,
      doc,
      now,
      maxSeconds,
      paintOverlay,
    });
    this.format = normalizeSnapshotFormat(format);
    this.logos = new Map();
    this.clip = null;
    this.starting = false;
    this.busy = false;
    this.destroyed = false;
  }

  get recording() {
    return !!this.clip;
  }

  setFormat(format) {
    this.format = normalizeSnapshotFormat(format);
    this._emit();
    return this.format;
  }

  /**
   * Save one high-resolution picture (PNG or JPG) of the current view. The
   * scene renders at a higher resolution for the shot, then drops back.
   */
  async snapshot() {
    if (this.destroyed || this.busy) return false;
    this.busy = true;
    this._emit();
    try {
      const shot = await this.captureImage({ format: this.format });
      this._download(shot.blob, shot.name);
      this._emit({ saved: shot.name });
      return true;
    } catch (error) {
      this._emit({ error: error?.message || 'Snapshot failed.' });
      return false;
    } finally {
      this.busy = false;
      this._emit();
    }
  }

  /**
   * Render one high-resolution picture without saving it: resolves to
   * `{blob, name, width, height}`. Used by snapshot() and by tours that put
   * pictures into a report.
   */
  async captureImage({ format = this.format, boost: allowBoost = true } = {}) {
    const viewer = this.viewer;
    const baseScale = Number.isFinite(viewer.resolutionScale)
      ? viewer.resolutionScale
      : 1;
    // A running clip keeps its frame size; only a still is rendered larger.
    const boost =
      this.recording || !allowBoost
        ? 1
        : snapshotScale(viewer.scene.canvas.width);
    try {
      await this._loadCreditLogos();
      if (boost > 1) {
        this.holdRender(SNAPSHOT_HOLD_ID);
        viewer.resolutionScale = baseScale * boost;
        await this._freshFrame();
        await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_SETTLE_MS));
      }
      await this._freshFrame();
      const source = viewer.scene.canvas;
      const canvas = this.doc.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const date = this.now();
      const description = this._describe();
      this._compose(canvas.getContext('2d'), canvas, description, date);
      const kind = SNAPSHOT_FORMATS[normalizeSnapshotFormat(format)];
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, kind.type, kind.quality),
      );
      if (!blob) throw new Error('The browser could not encode the snapshot.');
      return {
        blob,
        width: canvas.width,
        height: canvas.height,
        name: captureFileName({
          place: description.place,
          date,
          extension: kind.extension,
        }),
      };
    } finally {
      if (boost > 1) {
        viewer.resolutionScale = baseScale;
        this.releaseRender(SNAPSHOT_HOLD_ID);
        viewer.scene.requestRender();
      }
    }
  }

  /** Start a clip, or stop and save the one running. */
  toggleClip() {
    return this.recording ? this.stopClip() : this.startClip();
  }

  async startClip() {
    if (this.destroyed || this.clip || this.starting) return false;
    const type = pickClipType();
    const source = this.viewer.scene.canvas;
    if (
      !type ||
      typeof this.doc.createElement('canvas').captureStream !== 'function'
    ) {
      this._emit({ error: 'This browser cannot record video.' });
      return false;
    }
    // A second press while the credit logos load must not start a second clip.
    this.starting = true;
    try {
      await this._loadCreditLogos();
      if (this.destroyed) return false;
      return this._beginClip(type, source);
    } catch (error) {
      this._emit({ error: error?.message || 'Recording failed to start.' });
      return false;
    } finally {
      this.starting = false;
    }
  }

  _beginClip(type, source) {
    const scale = Math.min(1, CLIP_MAX_WIDTH / source.width);
    const canvas = this.doc.createElement('canvas');
    // Encoders want even dimensions.
    canvas.width = Math.round((source.width * scale) / 2) * 2;
    canvas.height = Math.round((source.height * scale) / 2) * 2;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(CLIP_FPS);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: type,
        videoBitsPerSecond: CLIP_BITS_PER_SECOND,
      });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const startedAt = this.now();
    const clip = {
      canvas,
      context,
      stream,
      recorder,
      type,
      startedAt,
      startedMs: performance.now(),
      chunks: [],
      description: this._describe(),
      describedMs: performance.now(),
      timer: null,
      removePostRender: null,
    };
    recorder.ondataavailable = (event) => {
      if (event.data?.size) clip.chunks.push(event.data);
    };
    recorder.onstop = () => this._saveClip(clip);
    this._drawClipFrame(clip);
    try {
      recorder.start(1000);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    // Each rendered frame is copied into the clip canvas right after Cesium
    // draws it, so the clip runs at the scene's own frame rate.
    clip.removePostRender = this.viewer.scene.postRender.addEventListener(() =>
      this._drawClipFrame(clip),
    );
    this.holdRender(RENDER_HOLD_ID);
    clip.timer = setInterval(() => {
      const elapsed = (performance.now() - clip.startedMs) / 1000;
      if (elapsed >= this.maxSeconds) this.stopClip();
      else this._emit();
    }, 250);
    this.clip = clip;
    this._emit();
    return true;
  }

  stopClip() {
    const clip = this.clip;
    if (!clip) return false;
    this.clip = null;
    clearInterval(clip.timer);
    clip.removePostRender?.();
    this.releaseRender(RENDER_HOLD_ID);
    if (clip.recorder.state !== 'inactive') clip.recorder.stop();
    else this._saveClip(clip);
    this._emit();
    return true;
  }

  /** Stop (saving any running clip) and release everything. */
  destroy() {
    if (this.destroyed) return;
    this.stopClip();
    this.destroyed = true;
  }

  state() {
    const elapsed = this.clip
      ? Math.min(
          this.maxSeconds,
          (performance.now() - this.clip.startedMs) / 1000,
        )
      : 0;
    return {
      recording: this.recording,
      busy: this.busy,
      format: this.format,
      elapsedSeconds: elapsed,
      maxSeconds: this.maxSeconds,
    };
  }

  _emit(extra = {}) {
    try {
      this.onState({ ...this.state(), ...extra });
    } catch (error) {
      console.warn('[capture] state listener failed:', error);
    }
  }

  _describe() {
    try {
      return this.describe() || {};
    } catch {
      return {};
    }
  }

  _drawClipFrame(clip) {
    const nowMs = performance.now();
    if (nowMs - clip.describedMs > CAPTION_REFRESH_MS) {
      clip.description = this._describe();
      clip.describedMs = nowMs;
    }
    this._compose(clip.context, clip.canvas, clip.description, this.now());
  }

  _saveClip(clip) {
    clip.stream.getTracks().forEach((track) => track.stop());
    if (!clip.chunks.length) {
      this._emit({ error: 'The clip came out empty.' });
      return;
    }
    const blob = new Blob(clip.chunks, { type: clip.recorder.mimeType });
    const name = captureFileName({
      place: clip.description.place,
      date: clip.startedAt,
      extension: clipExtension(clip.recorder.mimeType),
    });
    this._download(blob, name);
    this._emit({ saved: name });
  }

  /** Wait for Cesium to draw a frame (the scene idles under the render governor). */
  _freshFrame() {
    const scene = this.viewer.scene;
    return new Promise((resolve) => {
      let remove = null;
      const timer = setTimeout(() => {
        remove?.();
        resolve(false);
      }, FRESH_FRAME_TIMEOUT_MS);
      remove = scene.postRender.addEventListener(() => {
        clearTimeout(timer);
        remove?.();
        resolve(true);
      });
      scene.requestRender();
    });
  }

  /** The 3D frame, the label overlay, then the caption strip. */
  _compose(context, canvas, description, date) {
    const { width, height } = canvas;
    const source = this.viewer.scene.canvas;
    context.drawImage(source, 0, 0, width, height);
    const overlay = this.doc.getElementById('world-overlay-canvas');
    if (overlay?.width && overlay?.height) {
      context.drawImage(overlay, 0, 0, width, height);
    }
    this.paintOverlay?.(context, width, height);
    this._drawStrip(context, width, height, description, date);
  }

  _drawStrip(context, width, height, description, date) {
    const strip = captionStripHeight(height);
    const top = height - strip;
    const pad = Math.round(strip * 0.3);
    context.save();
    context.fillStyle = 'rgba(8, 10, 14, 0.78)';
    context.fillRect(0, top, width, strip);
    context.fillStyle = '#C8102E';
    context.fillRect(0, top, Math.max(3, Math.round(strip * 0.08)), strip);

    // Credits sit on the right; the caption gets whatever width is left.
    const creditsWidth = this._drawCredits(context, width - pad, top, strip);
    const textWidth = Math.max(0, width - creditsWidth - pad * 3);
    const [first, second] = captionLines({ ...description, date });
    context.textBaseline = 'middle';
    context.fillStyle = '#FFFFFF';
    context.font = `600 ${Math.round(strip * 0.32)}px "Real Head Pro", "ff-real-headline-pro", "Lato", "Segoe UI", sans-serif`;
    context.fillText(fit(context, first, textWidth), pad, top + strip * 0.33);
    context.fillStyle = 'rgba(255, 255, 255, 0.78)';
    context.font = `400 ${Math.round(strip * 0.26)}px "Real Head Pro", "ff-real-headline-pro", "Lato", "Segoe UI", sans-serif`;
    context.fillText(fit(context, second, textWidth), pad, top + strip * 0.72);
    context.restore();
  }

  /** Draw the on-screen map credits right-aligned at `right`; returns the width used. */
  _drawCredits(context, right, top, strip) {
    const logos = this._creditLogoImages();
    const logoHeight = Math.round(strip * 0.36);
    const gap = Math.round(strip * 0.25);
    let x = right;
    for (const image of [...logos].reverse()) {
      const w = Math.round(
        (image.naturalWidth / image.naturalHeight) * logoHeight,
      );
      x -= w;
      context.drawImage(
        image,
        x,
        top + (strip - logoHeight) / 2,
        w,
        logoHeight,
      );
      x -= gap;
    }
    const text = this._creditText(logos.length);
    if (text) {
      context.font = `400 ${Math.round(strip * 0.24)}px "Real Head Pro", "ff-real-headline-pro", "Lato", "Segoe UI", sans-serif`;
      context.fillStyle = 'rgba(255, 255, 255, 0.85)';
      context.textBaseline = 'middle';
      const w = context.measureText(text).width;
      x -= w;
      context.fillText(text, x, top + strip / 2);
      x -= gap;
    }
    return right - x;
  }

  _creditImagesInDom() {
    return [
      ...(this.doc.getElementById('cesium-credits')?.querySelectorAll('img') ||
        []),
    ];
  }

  _creditLogoImages() {
    return this._creditImagesInDom()
      .map((element) => this.logos.get(element.src))
      .filter((image) => image?.complete && image.naturalWidth > 0);
  }

  /** Text credits shown on screen, plus a fallback for logos that would not load. */
  _creditText(loadedLogos) {
    const container = this.doc.getElementById('cesium-credits');
    if (!container) return '';
    const parts = [];
    for (const element of this._creditImagesInDom()) {
      const loaded = this.logos.get(element.src);
      if (!(loaded?.complete && loaded.naturalWidth > 0)) {
        const label = element.alt || element.title;
        if (label) parts.push(label);
      }
    }
    for (const wrapper of container.querySelectorAll(
      '.cesium-credit-wrapper',
    )) {
      if (wrapper.querySelector('img')) continue;
      const text = wrapper.textContent.trim();
      if (text) parts.push(text);
    }
    if (!parts.length && !loadedLogos) return '';
    return parts.join(' · ');
  }

  /**
   * Load each on-screen credit logo as a CORS image so drawing it keeps the
   * canvas exportable. A logo that refuses CORS is named in text instead.
   */
  async _loadCreditLogos() {
    const pending = [];
    for (const element of this._creditImagesInDom()) {
      if (this.logos.has(element.src)) continue;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      this.logos.set(element.src, image);
      pending.push(
        new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
          image.src = element.src;
        }),
      );
    }
    await Promise.all(pending);
  }

  _download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = this.doc.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    this.doc.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** Trim text with an ellipsis to fit `maxWidth` in the current font. */
function fit(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (
    end > 0 &&
    context.measureText(`${text.slice(0, end)}…`).width > maxWidth
  )
    end -= 1;
  return end > 0 ? `${text.slice(0, end)}…` : '';
}
