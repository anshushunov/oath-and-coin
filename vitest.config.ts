import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One pattern over the whole tree rather than a list of projects that has
    // to be extended by hand. A package added in Tasks 6-12 is inside the
    // gate the moment it has a test file; a list would have let it be added
    // with tests that never run, and a suite that never runs is green.
    include: ['{apps,packages,tests,tools}/**/*.test.ts'],

    // Node is the honest default: the simulation, content and application
    // packages must not touch the DOM at all (ADR-010), so a global jsdom
    // would hand them a `document` the real runtime never gives them. Tests
    // that need a DOM ask for it per file with `@vitest-environment jsdom`.
    environment: 'node',

    // The default reporter prints nothing about a run that collected no test
    // files, and "0 tests passed" is not a passing gate.
    passWithNoTests: false
  }
});
