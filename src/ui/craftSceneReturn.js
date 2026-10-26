/**
 * MapCraft ▸ Show in 3D, the way back: while the MapCraft window that sent a
 * scene is open, a small bar offers "Send this view to MapCraft". It takes a
 * picture of the 3D view (with the credit strip every HEV snapshot carries)
 * and replies `hev:picture` to the origin the scene came from; MapCraft puts
 * it on a layout. MapCraft plan/3d.md.
 */
import { ViewCapture } from './viewCapture.js';

/** Largest picture sent back, as a data: URL (MapCraft takes up to 40 MB). */
const MAX_PICTURE_CHARS = 30 * 1024 * 1024;

/** Read a Blob as a data: URL. */
function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The `hev:picture` message for a captured shot.
 * @param {{dataUrl: string, width: number, height: number, name: string}} shot
 * @param {string} title What the view shows (the scene's name).
 * @param {string} credits The map credits on the picture, as text.
 */
export function pictureMessage(shot, title, credits) {
  return {
    type: 'hev:picture',
    version: 1,
    fileName: shot.name,
    image: shot.dataUrl,
    width: shot.width,
    height: shot.height,
    title: String(title || '').slice(0, 120),
    credits: String(credits || '').slice(0, 600),
  };
}

/**
 * The map credits on screen (#cesium-credits, as ViewCapture reads them), as
 * one line of text for the layout: logos by their names, text as it is.
 */
export function creditText(doc = document) {
  const container = doc.getElementById('cesium-credits');
  if (!container) return '';
  const parts = [];
  for (const wrapper of container.querySelectorAll('.cesium-credit-wrapper')) {
    const image = wrapper.querySelector('img');
    const text = image
      ? image.alt || image.title
      : wrapper.textContent.replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  return [...new Set(parts)].join(' · ').slice(0, 600);
}

/**
 * Show the bar once a scene has arrived. Calling it again (another scene)
 * keeps one bar and updates its title.
 * @param {object} options
 * @param {import('cesium').Viewer} options.viewer
 * @param {(message: object) => boolean} options.reply Posts to MapCraft; false when it is gone.
 * @param {(text: string) => void} options.showToast
 * @param {Document} [options.doc]
 */
export function createCraftSceneReturn({
  viewer,
  reply,
  showToast,
  doc = document,
}) {
  let title = '';
  let busy = false;
  const bar = doc.createElement('div');
  bar.className = 'craft-scene-return';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'MapCraft 3D');
  const label = doc.createElement('span');
  label.textContent = 'MapCraft 3D';
  const send = doc.createElement('button');
  send.type = 'button';
  send.textContent = 'Send this view to MapCraft';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'craft-scene-return-close';
  close.textContent = '×';
  close.title = 'Hide';
  close.setAttribute('aria-label', 'Hide the MapCraft bar');
  bar.append(label, send, close);
  doc.body.append(bar);
  const capture = new ViewCapture({
    viewer,
    doc,
    format: 'jpg',
    describe: () => ({ view: 'MapCraft 3D', place: title, layers: [] }),
  });

  send.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    send.disabled = true;
    send.textContent = 'Taking the picture…';
    try {
      const shot = await capture.captureImage({ format: 'jpg', boost: false });
      const url = await dataUrl(shot.blob);
      if (url.length > MAX_PICTURE_CHARS)
        throw new Error('The picture is too large to send.');
      const sent = reply(
        pictureMessage(
          {
            dataUrl: url,
            width: shot.width,
            height: shot.height,
            name: shot.name,
          },
          title ? `${title} in 3D` : 'Husky Eye View 3D view',
          creditText(doc),
        ),
      );
      showToast(
        sent
          ? 'Sent to MapCraft: add it to a layout from the banner there.'
          : 'MapCraft is no longer open.',
      );
      if (!sent) destroy();
    } catch (error) {
      showToast(error?.message || 'The picture could not be taken.');
    } finally {
      busy = false;
      send.disabled = false;
      send.textContent = 'Send this view to MapCraft';
    }
  });
  const destroy = () => {
    capture.destroy();
    bar.remove();
    handle.destroyed = true;
  };
  close.addEventListener('click', destroy);
  const handle = {
    destroyed: false,
    setTitle(text) {
      title = String(text || '').slice(0, 80);
      label.textContent = title ? `MapCraft 3D · ${title}` : 'MapCraft 3D';
    },
    destroy,
  };
  return handle;
}
