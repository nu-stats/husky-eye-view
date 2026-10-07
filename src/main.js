import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';

// The release beside the title (package.json version, defined at build).
const version = import.meta.env.HEV_VERSION;
if (version)
  for (const node of document.querySelectorAll('[data-app-version]'))
    node.textContent = `v${version}`;

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error('Husky Eye View initialization failed:', error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
