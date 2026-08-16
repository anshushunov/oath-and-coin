import { describe, expect, it } from 'vitest';

import { mayOpenExternally } from './contract';

/**
 * The predicate behind `setWindowOpenHandler`. Tested here rather than only
 * through the packaged gate because the interesting inputs are strings, and a
 * packaged run can only demonstrate a handful of them.
 */
describe('mayOpenExternally', () => {
  it('allows the two web schemes and nothing else', () => {
    expect(mayOpenExternally('https://example.com/docs')).toBe(true);
    expect(mayOpenExternally('http://example.com/docs')).toBe(true);
  });

  it('refuses schemes that hand a path or a command to the operating system', () => {
    // Each of these has a registered handler on a normal Windows install, and
    // `shell.openExternal` would run it. `file:` opens whatever the path
    // points at; `ms-msdt:` is the scheme behind CVE-2022-30190.
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'ms-msdt:/id PCWDiagnostic',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vscode://file/etc/passwd'
    ]) {
      expect(mayOpenExternally(url), url).toBe(false);
    }
  });

  it('refuses strings that are not URLs at all', () => {
    // `new URL` throws on these, and the naive handler would still have passed
    // them to the shell.
    for (const value of ['', '   ', 'C:\\Windows\\System32\\calc.exe', 'not a url']) {
      expect(mayOpenExternally(value), JSON.stringify(value)).toBe(false);
    }
  });
});
