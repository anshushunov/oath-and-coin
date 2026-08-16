import { builtinModules } from 'node:module';

import type { UserConfig } from 'vite';

/**
 * Build options shared by the host's two entries.
 *
 * They are built by two separate Vite invocations rather than as two inputs of
 * one build, and that is not tidiness — it is a hard constraint. Rollup emits
 * a shared chunk for any module two entries both import, `contract.ts` here,
 * and a preload script running under `sandbox: true` cannot require a file:
 * its module system is a small polyfill that resolves `electron` and a handful
 * of built-ins and nothing else. The window then comes up with no
 * `window.desktop` on it, no error in the page and no error in the main
 * process — the preload simply failed on its first line.
 *
 * Two builds means each entry is self-contained, at the cost of the contract
 * being present in both files.
 */
export function nodeBuildOptions(entry: string, emptyOutDir: boolean): UserConfig {
  return {
    // Vite's SSR build externalises every bare import from node_modules, which
    // suits a server with its node_modules beside it and not an application
    // packaged into an asar. Left at the default the packaged host dies on
    // launch with "Cannot find module 'zod'" before a window exists.
    ssr: { noExternal: true },

    build: {
      outDir: 'dist',
      emptyOutDir,
      ssr: true,
      target: 'node22',
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: entry,
        // Electron is resolved by the runtime; everything else is bundled,
        // which is why the packaged app needs no node_modules beside it.
        external: [
          'electron',
          ...builtinModules,
          ...builtinModules.map((moduleName) => `node:${moduleName}`)
        ],
        output: {
          format: 'cjs',
          // `.cjs`, not `.js`: the extension is what tells Node to read these
          // as CommonJS whatever a future "type": "module" says.
          entryFileNames: '[name].cjs'
        }
      }
    }
  };
}
