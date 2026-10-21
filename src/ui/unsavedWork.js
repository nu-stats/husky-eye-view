/**
 * Work a reload would lose: My files live for the page only, so while any are
 * on the map the browser asks before the page goes away.
 */
const providers = new Set();
let listening = false;

function onBeforeUnload(event) {
  if (!describeUnsavedWork().length) return;
  event.preventDefault();
  // Older browsers show the prompt only when returnValue is set.
  event.returnValue = '';
}

/**
 * Register a check that names unsaved work (or returns null when none).
 * @param {() => string|null} describe
 * @returns {() => void} Unregister.
 */
export function registerUnsavedWork(describe) {
  providers.add(describe);
  if (!listening && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('beforeunload', onBeforeUnload);
    listening = true;
  }
  return () => providers.delete(describe);
}

/** What a reload would lose right now, one phrase per kind of work. */
export function describeUnsavedWork() {
  const found = [];
  for (const describe of providers) {
    try {
      const text = describe();
      if (text) found.push(text);
    } catch {
      /* a broken check never blocks a reload */
    }
  }
  return found;
}
