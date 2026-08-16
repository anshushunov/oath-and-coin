import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * A short, hand-picked rule set — not a preset.
 *
 * `TDD` §19.1 asks the pipeline for a formatting/lint stage, and `AGENTS.md`
 * §12.1 warns in the same breath that automation has a maintenance cost and
 * that a check needs a reason. Both are satisfied the same way: every rule
 * below is here because it catches a defect class the TypeScript compiler
 * cannot see, and each one says which. A recommended preset would have brought
 * a few hundred rules whose justification is "the preset includes them", and
 * the first noisy one teaches everyone to add eslint-disable.
 *
 * Formatting is Prettier's job, not this file's. There is no style rule here.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'artifacts/**',
      '.pnpm-store/**',
      // The C# side and the frozen corpus are not this tool's business.
      'migration/oracle/**'
    ]
  },

  // Type-aware linting for everything written in TypeScript. The rules below
  // need types — that is the whole point of choosing them.
  {
    files: ['**/*.ts', '**/*.tsx'],
    // `configs.base` is a single config object, not an array: it registers the
    // TypeScript parser and plugin and turns on nothing. That is exactly what
    // this file wants — the rules are chosen below, one at a time.
    extends: [js.configs.recommended, tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        // Resolves each file against the tsconfig that actually owns it, which
        // in this workspace differs per member (DOM in apps/web, Node in the
        // host and the tests).
        projectService: {
          // The three root-level config files belong to no tsconfig — they
          // configure the tools rather than being built by them — and without
          // this the parser stops on each with "was not found by the project
          // service", which reads like a broken setup rather than like a file
          // outside every project.
          allowDefaultProject: ['*.config.ts']
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // A promise nobody awaits fails silently: the error surfaces as an
      // unhandled rejection with no stack pointing at the call. The Electron
      // host already spells the deliberate cases `void promise`, and this rule
      // is what makes that spelling mean something.
      '@typescript-eslint/no-floating-promises': 'error',

      // An async function handed to something expecting `void` — an event
      // listener, a React prop, an Electron handler — runs detached, and its
      // rejection is lost the same way.
      '@typescript-eslint/no-misused-promises': 'error',

      // `await` on a non-promise is always a mistake in intent: either the
      // function stopped being async or the wrong value is being awaited.
      '@typescript-eslint/await-thenable': 'error',

      // The migration ports rules that switch over domain unions — hero
      // decision outcomes, error codes, screen states. A union that grows a
      // member must break every switch over it, and only the type-aware
      // version of this check knows the union.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // `any` disables the checker locally and silently. In a codebase whose
      // content boundary is Zod schemas, an `any` leaking out of a parse is
      // exactly the hole the schemas exist to close. `unknown` costs one
      // narrowing and keeps the guarantee.
      '@typescript-eslint/no-explicit-any': 'error',

      // Loose equality has three coercion rules worth remembering and none
      // worth relying on.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // `js.configs.recommended` includes this and it duplicates a compiler
      // error under `noUnusedLocals`, with worse wording.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',

      // Same duplication, worse: `no-undef` does not read `lib` from the
      // tsconfig, so it reports `document` and `window` in the one package
      // allowed to have them and in the `page.evaluate` callbacks that run
      // inside the browser. TypeScript already answers this question, and
      // answers it per project.
      'no-undef': 'off'
    }
  },

  // React lives in exactly one package, so its rules apply there and nowhere
  // else. Both catch bugs no type can express: a hook called conditionally
  // corrupts the hook order, and a stale dependency array silently freezes a
  // value the component keeps rendering.
  {
    files: ['apps/web/**/*.tsx', 'apps/web/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  },

  // Build and packaging scripts: plain JavaScript, run by Node, with no
  // tsconfig behind them. Type-aware rules cannot apply, so they do not.
  {
    files: ['scripts/**/*.mjs', '**/*.cjs', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', require: 'readonly', module: 'writable' }
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }]
    }
  }
);
