import { z } from 'zod';

import { parseContentId, type ContentId } from '@oath-and-coin/simulation';

import type { ContentFileSource } from '../file-source.ts';
import { requireSourcePath } from '../paths.ts';
import { readFile } from '../strict-json.ts';

/**
 * A contrast: two runs differing in exactly one declared input, on the same seed and the
 * same ordinal, and a declared expectation about how the answer flips (`HERO_DECISION_SPEC`
 * §7.3, `MVP_PLAN` §5.5). This file states the same rules `'contrast.schema.json'`
 * (`schemas/`) does — `loadContrastDefinition` is the loader that document exists to
 * describe, the way `contract.schema.json` describes `content-set.ts`'s `contractFileSchema`.
 *
 * `ContrastDefinition`, its loader and its runner (`contrast-runner.ts`) did not exist
 * before this task: `schemas/contrast.schema.json` and `scenarios/contrasts/*.json` were
 * orphans — data with no consumer — since the .NET stack that read them (`ContrastRunner.cs`)
 * was deleted at cutover. `MVP_PLAN` §5.5's exit criterion ("изменение одного понятного
 * условия предсказуемо меняет решение") was checked by nothing until this file existed.
 */

/** The contrast file format this build reads. */
export const SUPPORTED_CONTRAST_SCHEMA_VERSION = 1;

/**
 * The only conditions a player can perceive changing, and therefore the only inputs a
 * contrast may vary (`HERO_DECISION_SPEC` §7.3). Closed rather than open: `DecisionContext`
 * and the state it is built from carry other fields (a hero's `id`, a contract's
 * `requiredCrew`, …) that are real inputs to `decide` but are not things a player at the
 * table perceives as "one condition changing" — those stay out on purpose.
 *
 * Five of these are new since the .NET stack's own `ContrastDefinition.AllowedInputs`
 * (`contract.payment`, `contract.risk`, `contract.tags`, `contract.accepted_by`):
 * `DEC-008`'s negotiation slice replaced a flat `contract.payment` with a composed
 * `offer` (`NEGOTIATION_SPEC` §2.1, §4) carrying `advance`, `method_tag` and
 * `promised_bonus`, and added a hero's `grievance` and belief in the guild's word.
 * `contract.payment` is renamed to `contract.patron_fee`, following Task 3's rename of
 * the field everywhere else — the four shipped contrast files were the one place Task 3
 * deliberately left alone, because nothing read them then.
 *
 * `contract.accepted_by` — a pre-state difference in who has already accepted, not a
 * content field — is carried over unchanged, not renamed. `HERO_DECISION_SPEC` §7.3
 * states exactly why it belongs in a hand-enumerated list rather than being derived by
 * diffing two content trees: *"Последнее — различие предсостояния, а не файлов
 * контента; именно поэтому вход перечислен, а не выведен сравнением двух наборов
 * JSON."* That is the argument *for* keeping it, not against — an earlier version of
 * this comment read the same sentence backwards and dropped the input on the strength of
 * its own quote. The `bondSum` term `decide` computes from `contract.offer.acceptedBy`
 * (`contract-decision-rule.ts`) is live code, reachable from any state with a non-empty
 * `acceptedBy`/`crew` — `contrast-runner.ts` builds exactly that state, deriving both
 * from this input's value, the same way a `contract.patron_fee` contrast derives
 * `offer.advance` from its own value. Excluding it would leave `bondSum` the one term of
 * `decide`'s formula no shipped contrast ever moves, silently narrowing what `MVP_PLAN`
 * §5.5's exit criterion is actually checked against.
 */
export const ALLOWED_CONTRAST_INPUTS = Object.freeze([
  'contract.patron_fee',
  'contract.risk',
  'contract.tags',
  'contract.accepted_by',
  'offer.advance',
  'offer.method_tag',
  'offer.promised_bonus',
  'hero.grievance',
  'hero.believes_guild_promises'
] as const);

export type ContrastInput = (typeof ALLOWED_CONTRAST_INPUTS)[number];

/** The direction a contrast declares its answer flips in. */
export const ContrastExpectation = Object.freeze({
  DeclineToAccept: 'decline_to_accept',
  AcceptToDecline: 'accept_to_decline'
});

export type ContrastExpectation =
  (typeof ContrastExpectation)[keyof typeof ContrastExpectation];

/**
 * The one input a contrast varies, and its two values — typed per input rather than as one
 * loose union, so a caller that has already switched on {@link ContrastVary.input} gets the
 * right shape for `from`/`to` back without a cast. `contract.tags` and `contract.accepted_by`
 * are the array-valued inputs — the former names tag ids, the latter names the content ids
 * of heroes already treated as having accepted; `offer.method_tag` is the only one that may
 * be `null` (no method chosen); `hero.believes_guild_promises` is the only boolean; every
 * other input is an integer.
 */
export type ContrastVary =
  | {
      readonly input: Extract<
        ContrastInput,
        'contract.patron_fee' | 'contract.risk' | 'offer.advance' | 'offer.promised_bonus' | 'hero.grievance'
      >;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly input: Extract<ContrastInput, 'contract.tags' | 'contract.accepted_by'>;
      readonly from: readonly ContentId[];
      readonly to: readonly ContentId[];
    }
  | {
      readonly input: Extract<ContrastInput, 'offer.method_tag'>;
      readonly from: ContentId | null;
      readonly to: ContentId | null;
    }
  | {
      readonly input: Extract<ContrastInput, 'hero.believes_guild_promises'>;
      readonly from: boolean;
      readonly to: boolean;
    };

/** A contrast, read and validated (`HERO_DECISION_SPEC` §7.3). */
export interface ContrastDefinition {
  readonly schemaVersion: number;
  /** Stable name; equal to the stem of the file this was read from. */
  readonly contrast: string;
  /** Repository-relative directory both branches load their content from. */
  readonly contentRoot: string;
  /** The one campaign seed both branches are built with. */
  readonly seed: bigint;
  readonly hero: ContentId;
  readonly contract: ContentId;
  readonly vary: ContrastVary;
  readonly expect: ContrastExpectation;
}

const varyFileSchema = z.strictObject({
  input: z.string(),
  from: z.unknown(),
  to: z.unknown()
});

const contrastFileSchema = z.strictObject({
  schema_version: z.int(),
  contrast: z.string().min(1),
  content_root: z.string().min(1),
  seed: z.int().min(0),
  hero: z.string(),
  contract: z.string(),
  vary: varyFileSchema,
  expect: z.string()
});

/**
 * Reads and validates one contrast.
 *
 * @throws if the file is missing, malformed, has an unknown property, declares an
 * unsupported schema version, names a contrast other than the one its own file name names,
 * varies an input outside {@link ALLOWED_CONTRAST_INPUTS}, carries a `from`/`to` of the
 * wrong shape for that input, declares `from` equal to `to` (a contrast with nothing to
 * compare proves nothing), names a hero or contract that is not a valid content id, states
 * a `content_root` that is not a valid repository-relative path, or declares an `expect`
 * this build has no meaning for.
 */
export function loadContrastDefinition(
  source: ContentFileSource,
  path: string
): ContrastDefinition {
  const displayPath = source.describe(path);

  if (!source.exists(path)) {
    throw new Error(`Contrast '${displayPath}' does not exist.`);
  }

  const file = readFile(source, path, contrastFileSchema);

  if (file.schema_version !== SUPPORTED_CONTRAST_SCHEMA_VERSION) {
    throw new Error(
      `Contrast '${displayPath}' declares schema_version ${String(file.schema_version)}, but this ` +
        `build reads version ${String(SUPPORTED_CONTRAST_SCHEMA_VERSION)}. Migrate the file, or run ` +
        'a build that understands its version — reading it under the wrong version would be a guess.'
    );
  }

  const namedContrast = contrastIdIn(displayPath);
  if (file.contrast !== namedContrast) {
    throw new Error(
      `Contrast '${displayPath}' declares contrast '${file.contrast}', but its file name names ` +
        `'${namedContrast}'. The field is this contrast's stable id and callers reach it by file ` +
        'name — two spellings mean one of them is never read.'
    );
  }

  const contentRoot = requireContentRoot(file.content_root, displayPath);
  const hero = parseContentId(file.hero);
  const contract = parseContentId(file.contract);
  const vary = parseVary(file.vary, displayPath);
  const expect = parseExpectation(file.expect, displayPath);

  return {
    schemaVersion: file.schema_version,
    contrast: file.contrast,
    contentRoot,
    seed: BigInt(file.seed),
    hero,
    contract,
    vary,
    expect
  };
}

/** The contrast a file name names: everything before its first dot. */
function contrastIdIn(fileName: string): string {
  const dot = fileName.indexOf('.');
  return dot < 0 ? fileName : fileName.slice(0, dot);
}

function requireContentRoot(raw: string, displayPath: string): string {
  try {
    return requireSourcePath(raw);
  } catch (cause) {
    throw new Error(
      `Contrast '${displayPath}' declares content_root '${raw}', which is not a valid ` +
        `repository-relative path: ${messageOf(cause)}`,
      { cause }
    );
  }
}

function parseExpectation(raw: string, displayPath: string): ContrastExpectation {
  switch (raw) {
    case ContrastExpectation.DeclineToAccept:
    case ContrastExpectation.AcceptToDecline:
      return raw;
    default:
      throw new Error(
        `Contrast '${displayPath}' has expect '${raw}'; expected ` +
          `'${ContrastExpectation.DeclineToAccept}' or '${ContrastExpectation.AcceptToDecline}'.`
      );
  }
}

function parseVary(
  raw: { readonly input: string; readonly from: unknown; readonly to: unknown },
  displayPath: string
): ContrastVary {
  if (!isAllowedInput(raw.input)) {
    throw new Error(
      `Contrast '${displayPath}' varies input '${raw.input}', which is not one of the allowed ` +
        `inputs: ${ALLOWED_CONTRAST_INPUTS.join(', ')}.`
    );
  }

  const vary = buildVary(raw.input, raw.from, raw.to, displayPath);

  if (valuesEqual(vary)) {
    throw new Error(
      `Contrast '${displayPath}' varies '${raw.input}' from ${JSON.stringify(raw.from)} to the ` +
        'same value — a contrast with nothing to compare proves nothing.'
    );
  }

  return vary;
}

function isAllowedInput(input: string): input is ContrastInput {
  return (ALLOWED_CONTRAST_INPUTS as readonly string[]).includes(input);
}

function buildVary(
  input: ContrastInput,
  from: unknown,
  to: unknown,
  displayPath: string
): ContrastVary {
  switch (input) {
    case 'contract.patron_fee':
    case 'contract.risk':
    case 'offer.advance':
    case 'offer.promised_bonus':
    case 'hero.grievance':
      return {
        input,
        from: requireInteger(from, input, 'from', displayPath),
        to: requireInteger(to, input, 'to', displayPath)
      };
    case 'contract.tags':
    case 'contract.accepted_by':
      return {
        input,
        from: requireContentIdArray(from, input, 'from', displayPath),
        to: requireContentIdArray(to, input, 'to', displayPath)
      };
    case 'offer.method_tag':
      return {
        input,
        from: requireContentIdOrNull(from, input, 'from', displayPath),
        to: requireContentIdOrNull(to, input, 'to', displayPath)
      };
    case 'hero.believes_guild_promises':
      return {
        input,
        from: requireBoolean(from, input, 'from', displayPath),
        to: requireBoolean(to, input, 'to', displayPath)
      };
  }
}

function requireInteger(
  raw: unknown,
  input: ContrastInput,
  side: 'from' | 'to',
  displayPath: string
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new Error(
      `Contrast '${displayPath}' vary.${side} is ${JSON.stringify(raw)}, but input '${input}' ` +
        'takes an integer.'
    );
  }

  return raw;
}

function requireBoolean(
  raw: unknown,
  input: ContrastInput,
  side: 'from' | 'to',
  displayPath: string
): boolean {
  if (typeof raw !== 'boolean') {
    throw new Error(
      `Contrast '${displayPath}' vary.${side} is ${JSON.stringify(raw)}, but input '${input}' ` +
        'takes a boolean.'
    );
  }

  return raw;
}

function requireContentIdOrNull(
  raw: unknown,
  input: ContrastInput,
  side: 'from' | 'to',
  displayPath: string
): ContentId | null {
  if (raw === null) {
    return null;
  }

  if (typeof raw !== 'string') {
    throw new Error(
      `Contrast '${displayPath}' vary.${side} is ${JSON.stringify(raw)}, but input '${input}' ` +
        'takes a content id or null.'
    );
  }

  try {
    return parseContentId(raw);
  } catch (cause) {
    throw new Error(
      `Contrast '${displayPath}' vary.${side} names '${raw}' for input '${input}': ${messageOf(cause)}`,
      { cause }
    );
  }
}

function requireContentIdArray(
  raw: unknown,
  input: ContrastInput,
  side: 'from' | 'to',
  displayPath: string
): readonly ContentId[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `Contrast '${displayPath}' vary.${side} is ${JSON.stringify(raw)}, but input '${input}' ` +
        'takes an array of content ids.'
    );
  }

  return raw.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(
        `Contrast '${displayPath}' vary.${side}[${String(index)}] is ${JSON.stringify(item)}, but ` +
          `input '${input}' takes an array of content ids.`
      );
    }

    try {
      return parseContentId(item);
    } catch (cause) {
      throw new Error(
        `Contrast '${displayPath}' vary.${side}[${String(index)}]: ${messageOf(cause)}`,
        { cause }
      );
    }
  });
}

/**
 * Whether a fully-built {@link ContrastVary}'s two sides are the same value — a set
 * comparison for `contract.tags`/`contract.accepted_by`, since two differently-ordered
 * spellings of the same set still vary nothing a hero's decision reads (`ContractState.tags`
 * and `OfferState.acceptedBy` are both a `SortedSet`), and a plain `===` everywhere else,
 * which already covers every other value this type carries (`number`, `boolean`,
 * `ContentId | null`, all primitives).
 */
function valuesEqual(vary: ContrastVary): boolean {
  if (vary.input === 'contract.tags' || vary.input === 'contract.accepted_by') {
    const from = new Set<ContentId>(vary.from);
    const to = new Set<ContentId>(vary.to);
    return from.size === to.size && [...from].every((id) => to.has(id));
  }

  return vary.from === vary.to;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
