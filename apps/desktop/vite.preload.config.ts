import { defineConfig } from 'vite';

import { nodeBuildOptions } from './vite.shared';

export default defineConfig(nodeBuildOptions('src/preload.ts', false));
