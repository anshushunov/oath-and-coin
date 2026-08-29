import { createRoot } from 'react-dom/client';

import { SpikeApp } from './spike-app.tsx';

// THROWAWAY SPIKE entry. No `StrictMode`: the spike measures one renderer's cost, and the
// effect replay is a question `world-canvas.tsx` has already answered for the real page.
const container = document.querySelector('#root');

if (container === null) {
  throw new Error('spike.html must contain #root.');
}

createRoot(container).render(<SpikeApp />);
