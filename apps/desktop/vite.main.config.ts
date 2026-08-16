import { defineConfig } from 'vite';

import { nodeBuildOptions } from './vite.shared';

// Built first, and the only build that clears dist — the preload build that
// follows must land beside this output, not replace it.
export default defineConfig(nodeBuildOptions('src/main.ts', true));
