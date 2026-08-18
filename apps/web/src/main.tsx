import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// The stylesheet is imported here rather than linked from `index.html` so that the
// bundler owns it: it is hashed, emitted beside the scripts and loaded by the same
// relative `base` the packaged Electron host needs. A `<link>` in the document would be
// a second asset path to keep correct under `file://`.
import './styles.css';

// `index.html` ships an empty `#root`. Everything below the root element is
// produced by this script, which is what makes the end-to-end check meaningful:
// a bundle that failed to load leaves the document with an empty div rather
// than with markup that looks like a working page.
const container = document.querySelector('#root');
if (container === null) {
  throw new Error('index.html must contain #root; the renderer has nothing to mount into.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
