import { SCENE_APPEND_RECIPES } from '../recipes.js';
import { createScenePackRegistry } from './registry.js';

/** Compose the installed scene recipes and their trusted presentation rules.
 * The Nepal flood pack (./nepal.js) is off for now, with its layers. */
export function createDefaultScenePacks() {
  return createScenePackRegistry({
    recipes: SCENE_APPEND_RECIPES,
    adapters: [],
  });
}
