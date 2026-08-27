import {
  CONTENT_ID_PATTERN,
  HERO_ID_MAX,
  HERO_ID_MIN,
  parseContentId,
  type ContentId
} from '@oath-and-coin/simulation';
import { z } from 'zod';

import { PATRON_FEE_MAX, REQUIRED_CREW_MAX } from '../bounds.ts';
import type { ContentFileSource } from '../file-source.ts';
import { readFile } from '../strict-json.ts';

/**
 * Which engine command one scenario step issues.
 *
 * Spelled the way the file spells it (`"compose_offer"`, not `"ComposeOffer"`), so the
 * discriminant a reader sees in the JSON and the one the compiler switches on are the
 * same string.
 *
 * All six the protocol has (`RESOLUTION_SPEC` §3.1): `resolve_contract` sits between the
 * poll and the settlement, and it is not optional there — since `phase === Settled ⇒
 * resolution !== null` (§2.5), a scenario that settles without resolving first is a
 * scenario the engine refuses.
 */
export const ScenarioCommandKind = Object.freeze({
  ComposeOffer: 'compose_offer',
  ProposeContractToHero: 'propose_contract_to_hero',
  LockOffer: 'lock_offer',
  PollCrew: 'poll_crew',
  ResolveContract: 'resolve_contract',
  SettleContract: 'settle_contract'
});

export type ScenarioCommandKind = (typeof ScenarioCommandKind)[keyof typeof ScenarioCommandKind];

/** What every scenario step carries, whichever command it issues. */
interface ScenarioCommandBase {
  readonly commandId: number;
  /**
   * The contract this step negotiates over. On every one of the four commands, which is
   * why it lives here: `pollCrew` and `lockOffer` name no hero at all, but there is no
   * command in this protocol that does not name a contract.
   */
  readonly contract: ContentId;
  readonly expectedStateVersion: number;
}

/**
 * Revise the package (`NEGOTIATION_SPEC` §3.1): name the key hero and the terms.
 *
 * Every term is stated, none defaulted. A scenario whose advance is implied is a
 * scenario whose arithmetic a reader has to reconstruct from a schema default written
 * somewhere else — and the advance is the one input `DEC-008` Task 8 moved the whole
 * benefit motive onto, so it is exactly the number a shipped scenario must say out loud.
 */
export interface ComposeOfferScenarioCommand extends ScenarioCommandBase {
  readonly kind: typeof ScenarioCommandKind.ComposeOffer;
  /** Who the package is negotiated with, by roster position — see {@link ScenarioCommand}. */
  readonly keyHeroIndex: number;
  /**
   * Who the package asks, by roster position (`RESOLUTION_SPEC` §2.5) — exactly
   * `required_crew` of them, {@link keyHeroIndex} among them.
   *
   * Indexes, like `key_hero_index` beside it and for the same reason: a scenario file
   * names roster positions, not `HeroId`s, so a file stays readable against a content
   * tree whose ids it does not have to know.
   */
  readonly invitedIndexes: readonly number[];
  readonly advance: number;
  readonly methodTag: ContentId | null;
  readonly promisedBonus: number;
}

/** The key hero answers the current draft (`NEGOTIATION_SPEC` §3.1). */
export interface ProposeContractScenarioCommand extends ScenarioCommandBase {
  readonly kind: typeof ScenarioCommandKind.ProposeContractToHero;
  readonly heroIndex: number;
}

/** Freeze the package the key hero accepted (`NEGOTIATION_SPEC` §3.1). */
export interface LockOfferScenarioCommand extends ScenarioCommandBase {
  readonly kind: typeof ScenarioCommandKind.LockOffer;
}

/**
 * Sends the crew out and asks what came back (`RESOLUTION_SPEC` §3.1).
 *
 * Nothing of its own beyond the shared base: everything the outcome is computed from is
 * already on the package this resolves. A scenario author who wants a different outcome
 * changes the crew or the terms, which is exactly the choice the loop is about.
 */
export interface ResolveContractScenarioCommand extends ScenarioCommandBase {
  readonly kind: typeof ScenarioCommandKind.ResolveContract;
}

/** The rest of the roster answers the locked package, once each (`NEGOTIATION_SPEC` §3.1). */
export interface PollCrewScenarioCommand extends ScenarioCommandBase {
  readonly kind: typeof ScenarioCommandKind.PollCrew;
}

/**
 * Pays out a locked, crewed package — and, if it promised a bonus, decides whether the
 * guild keeps its word (`NEGOTIATION_SPEC` §3.1, §3.3).
 *
 * `pay` is stated, not defaulted: a scenario author choosing to keep or break a
 * promise is the one input this command exists to carry, and a silent default would
 * make the choice invisible in the file that made it.
 */
export interface SettleContractScenarioCommand extends ScenarioCommandBase {
  readonly kind: typeof ScenarioCommandKind.SettleContract;
  readonly pay: boolean;
}

/**
 * One step of a scenario, as a discriminated union over the engine command it issues.
 *
 * A scenario names a hero by position rather than by content id because it is written
 * against a campaign's roster, not against the content tree — and the mapping from
 * position to definition is deterministic (the loader assigns ids in content-id order),
 * so this stays reproducible.
 *
 * **Why a union with an explicit, mandatory `command` field**, rather than the two
 * alternatives `DEC-008` Task 11a weighed:
 *
 * - *not* an optional `command` defaulting to `propose_contract_to_hero`. Its only
 *   argument was leaving the shipped files untouched, and it pays for that with a
 *   format whose most important field is the one most files do not state. The frozen
 *   migration corpus is the only reader that genuinely cannot be re-authored, and
 *   `ADR-013`'s second retirement stops it being a replayable input at all — so the
 *   compatibility this would buy has no beneficiary left;
 * - *not* a nullable `key_hero_index` on the single old shape, meaning "compose first,
 *   then propose". One line of JSON would stand for two commands, and `StepOutcome`
 *   would then owe two results under one `command_id`.
 *
 * The discriminant is `kind` in TypeScript and `command` in the file. `command.command`
 * reads as a stutter at every call site, and `kind` is already this workspace's
 * discriminant (`ScenarioRunResult`, `DomainEvent`); the file keeps `command` because
 * that is what an author writing a step calls the thing they are choosing.
 */
export type ScenarioCommand =
  | ComposeOfferScenarioCommand
  | ProposeContractScenarioCommand
  | LockOfferScenarioCommand
  | PollCrewScenarioCommand
  | ResolveContractScenarioCommand
  | SettleContractScenarioCommand;

// Stated from the parser's own pattern rather than as `z.string()` plus a hopeful
// `parseContentId` afterwards: a malformed id is then a contract violation naming the
// file and the JSON path, which is what an author needs, instead of a bare parse error.
const contentIdString = z.string().regex(new RegExp(CONTENT_ID_PATTERN));

// A hero index is bounded to the id's own domain — signed 32-bit, exactly what the C#
// `int` field could hold. Unbounded, a scenario could name an index this port accepts
// and the original could not have deserialized at all, and the difference would surface
// as a thrown `Invalid HeroId` rather than as the `UNKNOWN_HERO` rejection C# records.
// Found by external review; the corpus cannot see it, because no shipped scenario names
// an index outside the roster.
const heroIndexNumber = z.int().min(HERO_ID_MIN).max(HERO_ID_MAX);

// Money is bounded here the way `hero_index` is bounded above, and for the same reason
// stated the other way round. The engine's own rule is `0 ≤ advance ≤ patronFee`
// (`NEGOTIATION_SPEC` §3.3) and it is content-dependent, so this contract cannot state
// it — `patronFee` is a property of the contract the command names, which the parser has
// not loaded. What it *can* state is the domain money lives in at all: `PATRON_FEE_MAX`
// is the ceiling every authored `patron_fee` is already held to (`bounds.ts`), so no
// legal advance can exceed it whatever contract is named.
//
// The lower bound is the part that matters. `hero_index` deliberately admits `-1`,
// because the engine records `UNKNOWN_HERO` for it and a scenario reproducing that
// rejection is a scenario doing its job. A negative advance has no such twin: it is
// refused by `composeOffer` for being outside `0..patronFee`, and the *same* rejection
// is reachable from above — an advance of 100 against a contract paying 40 — so nothing
// a scenario can legitimately demonstrate is lost by refusing it here, while "an offer
// of minus forty coins" stops being expressible at all.
const offerMoneyNumber = z.int().min(0).max(PATRON_FEE_MAX);

const commandBaseFields = {
  command_id: z.int(),
  contract: contentIdString,
  expected_state_version: z.int()
};

const composeOfferFileSchema = z.strictObject({
  command: z.literal(ScenarioCommandKind.ComposeOffer),
  ...commandBaseFields,
  key_hero_index: heroIndexNumber,
  // Required, not optional: `invited` is required on the command it becomes, and a step
  // that omitted it would be a scenario file that cannot say who went. Bounded by the
  // largest crew a contract may ask for — the file is external data like any other.
  invited_indexes: z.array(heroIndexNumber).max(REQUIRED_CREW_MAX),
  advance: offerMoneyNumber,
  method_tag: contentIdString.nullable(),
  promised_bonus: offerMoneyNumber
});

const proposeFileSchema = z.strictObject({
  command: z.literal(ScenarioCommandKind.ProposeContractToHero),
  ...commandBaseFields,
  hero_index: heroIndexNumber
});

const lockOfferFileSchema = z.strictObject({
  command: z.literal(ScenarioCommandKind.LockOffer),
  ...commandBaseFields
});

const pollCrewFileSchema = z.strictObject({
  command: z.literal(ScenarioCommandKind.PollCrew),
  ...commandBaseFields
});

const resolveContractFileSchema = z.strictObject({
  command: z.literal(ScenarioCommandKind.ResolveContract),
  ...commandBaseFields
});

const settleContractFileSchema = z.strictObject({
  command: z.literal(ScenarioCommandKind.SettleContract),
  ...commandBaseFields,
  pay: z.boolean()
});

// `discriminatedUnion` rather than a plain `union`: a step naming an unknown command,
// or one whose fields belong to a different command than the one it names, is then
// reported against *that* command's contract — `$.commands[3].hero_index` — instead of
// as five simultaneous failures the author has to work out the right one of.
const commandFileSchema = z.discriminatedUnion('command', [
  composeOfferFileSchema,
  proposeFileSchema,
  lockOfferFileSchema,
  pollCrewFileSchema,
  resolveContractFileSchema,
  settleContractFileSchema
]);

const scenarioFileSchema = z.strictObject({
  commands: z.array(commandFileSchema)
});

type CommandFile = z.infer<typeof commandFileSchema>;

function toCommand(command: CommandFile): ScenarioCommand {
  const base = {
    commandId: command.command_id,
    contract: parseContentId(command.contract),
    expectedStateVersion: command.expected_state_version
  };

  switch (command.command) {
    case ScenarioCommandKind.ComposeOffer:
      return {
        kind: ScenarioCommandKind.ComposeOffer,
        ...base,
        keyHeroIndex: command.key_hero_index,
        invitedIndexes: command.invited_indexes,
        advance: command.advance,
        methodTag: command.method_tag === null ? null : parseContentId(command.method_tag),
        promisedBonus: command.promised_bonus
      };
    case ScenarioCommandKind.ProposeContractToHero:
      return {
        kind: ScenarioCommandKind.ProposeContractToHero,
        ...base,
        heroIndex: command.hero_index
      };
    case ScenarioCommandKind.LockOffer:
      return { kind: ScenarioCommandKind.LockOffer, ...base };
    case ScenarioCommandKind.PollCrew:
      return { kind: ScenarioCommandKind.PollCrew, ...base };
    case ScenarioCommandKind.ResolveContract:
      return { kind: ScenarioCommandKind.ResolveContract, ...base };
    case ScenarioCommandKind.SettleContract:
      return { kind: ScenarioCommandKind.SettleContract, ...base, pay: command.pay };
  }
}

/**
 * Reads a scenario file — the ordered command list of a run.
 *
 * @throws if the file is missing, malformed, has an unknown property, names a command
 * this build cannot issue, or declares no commands. An empty scenario would "reproduce"
 * perfectly and demonstrate nothing — the most comfortable way for a determinism check
 * to be green about nothing at all.
 */
export function loadScenarioCommands(
  source: ContentFileSource,
  path: string
): readonly ScenarioCommand[] {
  const displayPath = source.describe(path);
  if (!source.exists(path)) {
    throw new Error(`Scenario file '${displayPath}' does not exist.`);
  }

  const file = readFile(source, path, scenarioFileSchema);

  if (file.commands.length === 0) {
    throw new Error(`Scenario file '${displayPath}' declares no commands.`);
  }

  return file.commands.map(toCommand);
}
