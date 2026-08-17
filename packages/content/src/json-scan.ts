import { MAX_JSON_DEPTH } from './limits.ts';

/**
 * A structural pass over JSON text that answers the two questions
 * `JSON.parse` cannot be asked.
 *
 * The C# reader got both for free and this port has to earn them:
 *
 * - **Depth.** `JsonDocumentOptions.MaxDepth` refused an over-nested document
 *   during parsing. `JSON.parse` takes no options at all, and by the time it has
 *   returned, the recursion the ceiling exists to guard has already happened.
 * - **Repeated keys.** `JsonDocument` kept every property exactly as written, so
 *   the locale loader could walk them and refuse a duplicate. `JSON.parse`
 *   collapses `{"a":1,"a":2}` to the last value with no way to observe it — not
 *   even through a reviver, which is handed the surviving value once.
 *
 * So the limits are enforced here, over the text, before any value is built —
 * which is also the order the C# reader enforced them in. Deliberately not a
 * validator: `JSON.parse` is the authority on whether the text is JSON at all,
 * and duplicating that judgement would create a second, disagreeing one.
 *
 * Escapes in names are decoded before comparison. `{"a":1,"a":2}` is one key
 * written two ways, and a check that compared raw spellings would call it two.
 */

interface ObjectFrame {
  readonly kind: 'object';
  readonly names: Set<string>;
  expectName: boolean;
}

interface ArrayFrame {
  readonly kind: 'array';
}

type Frame = ObjectFrame | ArrayFrame;

/**
 * Walks `text`, enforcing {@link MAX_JSON_DEPTH} and rejecting a repeated object
 * key.
 *
 * @throws with `displayPath` in the message — a repository-relative path where
 * there is one, so a diagnostic does not leak an absolute path from the machine
 * that produced it (`TDD` §18).
 */
export function scanJson(displayPath: string, text: string): void {
  const stack: Frame[] = [];
  let at = 0;

  while (at < text.length) {
    const character = text[at]!;

    switch (character) {
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        at++;
        break;

      case '"': {
        const { value, next } = readString(displayPath, text, at);
        const frame = stack[stack.length - 1];
        if (frame?.kind === 'object' && frame.expectName) {
          if (frame.names.has(value)) {
            throw new Error(`File '${displayPath}' repeats the object key '${value}'.`);
          }
          frame.names.add(value);
          frame.expectName = false;
        }
        at = next;
        break;
      }

      case '{':
        stack.push({ kind: 'object', names: new Set<string>(), expectName: true });
        requireDepth(displayPath, stack.length);
        at++;
        break;

      case '[':
        stack.push({ kind: 'array' });
        requireDepth(displayPath, stack.length);
        at++;
        break;

      case '}':
      case ']':
        stack.pop();
        at++;
        break;

      case ',': {
        const frame = stack[stack.length - 1];
        if (frame?.kind === 'object') {
          frame.expectName = true;
        }
        at++;
        break;
      }

      default:
        // Numbers, `true`, `false`, `null` and `:` need no interpretation here:
        // this pass only has to know where strings and containers begin and end.
        at++;
        break;
    }
  }
}

function requireDepth(displayPath: string, depth: number): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(
      `File '${displayPath}' nests deeper than ${MAX_JSON_DEPTH} levels, the limit every ` +
        'reader of external data is held to.'
    );
  }
}

const SHORT_ESCAPES = new Map<string, string>([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t']
]);

/** Reads the string starting at the quote `at`, decoding escapes. */
function readString(
  displayPath: string,
  text: string,
  at: number
): { readonly value: string; readonly next: number } {
  let value = '';
  let index = at + 1;

  while (index < text.length) {
    const character = text[index]!;

    if (character === '"') {
      return { value, next: index + 1 };
    }

    if (character !== '\\') {
      value += character;
      index++;
      continue;
    }

    const escape = text[index + 1];
    if (escape === undefined) {
      break;
    }

    if (escape === 'u') {
      const digits = text.slice(index + 2, index + 6);
      const code = Number.parseInt(digits, 16);
      if (digits.length < 4 || Number.isNaN(code)) {
        throw new Error(`File '${displayPath}' has a malformed \\u escape at offset ${index}.`);
      }
      value += String.fromCharCode(code);
      index += 6;
      continue;
    }

    const decoded = SHORT_ESCAPES.get(escape);
    if (decoded === undefined) {
      throw new Error(`File '${displayPath}' has an unknown escape '\\${escape}' at offset ${index}.`);
    }
    value += decoded;
    index += 2;
  }

  throw new Error(`File '${displayPath}' has an unterminated string starting at offset ${at}.`);
}
