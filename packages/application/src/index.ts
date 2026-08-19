/**
 * The application package's public surface.
 *
 * The layer `ADR-010` puts between content and the UI: `content ← application ←
 * apps/web`. It is the only place in the workspace where the content layer and the
 * presentation layer are both visible, which is what makes it the only place the
 * three-way `loading | failed | ran` split can be turned into one of the five screens.
 *
 * It opens no file and knows no path. Everything it reads arrives through
 * {@link ContentSourcePort}, so the same code runs behind a browser bundle and behind
 * a directory on disk — and its `tsconfig.json` carries `types: []` so that a
 * `node:fs` here is a compiler error rather than a broken page.
 */

export type { ContentSourcePort, SaveStorePort } from './ports.ts';

export {
  SAVE_FORMAT_VERSION,
  buildSave,
  readSave,
  saveChecksum,
  type SaveDescriptor
} from './save/envelope.ts';
export { restoreDecidedSteps } from './save/restore-steps.ts';
export { SAVE_SLOTS, type SaveSlot } from './save/slots.ts';

export { screenFor, startSession, type SessionRequest, type SessionState } from './session.ts';

export { createStore, type Store } from './store.ts';
