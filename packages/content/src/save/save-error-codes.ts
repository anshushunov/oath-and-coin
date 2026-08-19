/**
 * Отказы чтения сохранения. Отдельный словарь, а не расширение `ErrorCodes`: тот
 * по собственному определению перечисляет отказы загрузки контента, и ни один из
 * его пяти кодов не производится чтением файла сохранения.
 *
 * Этот кодек (`snapshot-codec.ts`) производит только три из них —
 * `Malformed` (байты разбираются, но не проходят Zod), `Inconsistent` (ключ карты
 * не равен `id` значения) и `OutOfBounds` (значение или список вне `bounds.ts` /
 * `limits.ts` / собственных пределов кодека). Остальные шесть принадлежат
 * будущим задачам сегмента — конверту (`FormatUnsupported`, `SchemaUnsupported`,
 * `RulesetMismatch`, `ContentMismatch`, `ChecksumMismatch`) и хранилищу
 * (`StorageUnavailable`). Словарь заводится здесь целиком, потому что
 * `SaveErrorCode` — один закрытый тип, который каждый из этих потребителей
 * расширяет своим отказом, а не переопределяет собственным.
 */
export const SaveErrorCodes = Object.freeze({
  Malformed: 'SAVE_MALFORMED',
  FormatUnsupported: 'SAVE_FORMAT_UNSUPPORTED',
  SchemaUnsupported: 'SAVE_SCHEMA_UNSUPPORTED',
  RulesetMismatch: 'SAVE_RULESET_MISMATCH',
  ContentMismatch: 'SAVE_CONTENT_MISMATCH',
  ChecksumMismatch: 'SAVE_CHECKSUM_MISMATCH',
  Inconsistent: 'SAVE_INCONSISTENT',
  OutOfBounds: 'SAVE_OUT_OF_BOUNDS',
  StorageUnavailable: 'SAVE_STORAGE_UNAVAILABLE'
});

export type SaveErrorCode = (typeof SaveErrorCodes)[keyof typeof SaveErrorCodes];

/** Каждый код выше, выведенный, а не набранный второй раз. */
export const SAVE_ERROR_CODES: readonly SaveErrorCode[] = Object.freeze(
  Object.values(SaveErrorCodes)
);

/**
 * Thrown by {@link import('./snapshot-codec.ts').decodeSnapshot} — and, by later
 * tasks, by the envelope and the store — when a save cannot be read back.
 *
 * `code` is a plain field rather than a subclass per code: a caller (the save
 * slots screen model) branches on the code to choose a locale key, and a
 * `switch` over a closed field is what `switch-exhaustiveness-check` can hold
 * exhaustive; a hierarchy of exception classes gives it nothing to check.
 */
export class SaveReadError extends Error {
  readonly code: SaveErrorCode;

  constructor(code: SaveErrorCode, message: string) {
    // The code travels inside the message too, not only on the field: a test
    // asserting `toThrow(/SAVE_INCONSISTENT/)` reads naturally, and a console log
    // that only prints `error.message` — the common case — still names the code.
    super(`${code}: ${message}`);
    this.name = 'SaveReadError';
    this.code = code;
  }
}
