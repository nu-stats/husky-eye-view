/**
 * Analysis menu → Surprise: a random photo of one of the project's dogs
 * (public/dogs/, listed in index.json). "Another" picks a different one;
 * Esc, the × or a click outside closes it.
 */

const base = () => {
  try {
    return new URL('dogs/', globalThis.document?.baseURI).href;
  } catch {
    return '/dogs/';
  }
};

let photos = null;
let last = -1;
let overlay = null;

async function photoList(fetchImpl) {
  if (!photos)
    photos = fetchImpl(`${base()}index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  return photos;
}

/** A random index other than the last one shown. */
export function pickAnother(count, previous, random = Math.random) {
  if (count <= 1) return 0;
  const next = Math.floor(random() * (count - 1));
  return next >= previous && previous >= 0 ? next + 1 : next;
}

function close() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(event) {
  if (event.key === 'Escape') close();
}

/** Show a random dog. */
export async function showDogSurprise(fetchImpl = (...a) => fetch(...a)) {
  const list = await photoList(fetchImpl);
  if (!list.length) return;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'dog-surprise';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Surprise');
    const card = document.createElement('figure');
    card.className = 'dog-surprise-card';
    const img = document.createElement('img');
    img.alt = 'One of the Husky Eye View dogs';
    const bar = document.createElement('figcaption');
    const another = document.createElement('button');
    another.type = 'button';
    another.className = 'curated-button';
    another.textContent = 'ANOTHER';
    another.addEventListener('click', () => void showDogSurprise(fetchImpl));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'curated-close';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.addEventListener('click', close);
    bar.append(another, x);
    card.append(img, bar);
    overlay.append(card);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
  }
  last = pickAnother(list.length, last);
  overlay.querySelector('img').src = `${base()}${list[last]}`;
}
