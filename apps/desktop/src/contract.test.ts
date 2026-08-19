import { describe, expect, it } from 'vitest';

import {
  ALLOWED_CHANNELS,
  DESKTOP_SAVE_SLOTS,
  SAVE_LIST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  mayOpenExternally,
  saveListRequest,
  saveReadRequest,
  saveWriteRequest
} from './contract';

describe('DESKTOP_SAVE_SLOTS', () => {
  it('names exactly the three slots the spec fixed, in that order', () => {
    expect(DESKTOP_SAVE_SLOTS).toEqual(['slot-a', 'slot-b', 'slot-c']);
  });
});

describe('the save channels', () => {
  it('are all in the allowlist', () => {
    expect(ALLOWED_CHANNELS).toEqual(
      expect.arrayContaining([SAVE_READ_CHANNEL, SAVE_WRITE_CHANNEL, SAVE_LIST_CHANNEL])
    );
  });

  it('checks a read request slot against the closed set, not merely its type', () => {
    // The design intent brief step 6 states directly: the main process checks
    // membership in `DESKTOP_SAVE_SLOTS` itself, because there is no type at
    // the boundary between two processes — only whatever a renderer sends.
    expect(() => saveReadRequest.parse(['slot-a'])).not.toThrow();
    expect(() => saveReadRequest.parse(['not-a-real-slot'])).toThrow();
  });

  it('checks a write request slot the same way, alongside its bytes', () => {
    expect(() => saveWriteRequest.parse(['slot-b', Uint8Array.of(1, 2, 3)])).not.toThrow();
    expect(() => saveWriteRequest.parse(['not-a-real-slot', Uint8Array.of(1)])).toThrow();
    expect(() => saveWriteRequest.parse(['slot-b', 'not bytes'])).toThrow();
  });

  it('a list request takes no arguments', () => {
    expect(() => saveListRequest.parse([])).not.toThrow();
    expect(() => saveListRequest.parse(['slot-a'])).toThrow();
  });
});

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
