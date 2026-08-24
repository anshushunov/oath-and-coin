import { deepEqual } from '../collections/deep-equal.ts';
import type { SortedMap } from '../collections/sorted-map.ts';
import type { SortedSet } from '../collections/sorted-set.ts';
import type { CausalTrace } from '../decisions/causal-trace.ts';
import type { HeldTrait } from '../decisions/held-trait.ts';
import type { DomainEvent } from '../events/domain-event.ts';
import { freezeDeep } from '../freeze.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';
import { requireUint64 } from '../uint64.ts';

import type { ContractState } from './contract-state.ts';
import type { HeroState } from './hero-state.ts';

/**
 * The reproducibility contract carried alongside the campaign (`TDD` §7.1, §7.4): the
 * (ruleset, content, seed) tuple a replay or bug report must pin down, plus the
 * counters that make the campaign log and the RNG stateless.
 */
export interface GameMetadata {
  readonly saveSchemaVersion: number;
  readonly rulesetVersion: string;
  readonly contentVersion: string;
  readonly campaignSeed: bigint;
  /**
   * Increases on every {@link withEvent} transition, so a stale in-flight command can
   * be detected against a newer state. {@link withEvent} is the only place this may
   * change.
   */
  readonly stateVersion: number;
  /**
   * The campaign's current logical time (`TDD` §10). Moved forward only by
   * {@link withEvent}, to the logical time of the event being appended, and an event
   * dated earlier is refused — so history is monotone in logical time and this field
   * always answers "when is the campaign now" consistently with the log.
   */
  readonly logicalTime: number;
  readonly nextEventId: number;
  /**
   * The id to use for the next stored trace. Advances only when {@link withEvent}
   * actually stores a new one, so two decisions in a row get two distinct, addressable
   * explanations instead of the second silently overwriting the first at id 0.
   *
   * "Next free" is enforced, not merely intended: a trace accepted out of sequence
   * would make this counter point at an occupied id later on — store id 7 while the
   * counter reads 0, then store 0..6, and it reads 7 again, over an existing key.
   */
  readonly nextTraceId: number;
  /**
   * The ordinal to feed the counter-based RNG for the next draw. Living in state rather
   * than beside it is what keeps the engine stateless: randomness is derived from
   * `(campaignSeed, stream, nextDecisionOrdinal)`, never kept in a generator's memory.
   *
   * `bigint`, matching the RNG's own ordinal parameter. The C# original made the same
   * choice for a sharper reason — declaring it signed forced a cast at every call site,
   * and that cast is exactly where a negative ordinal, which the RNG would accept as a
   * huge unsigned one, would slip in.
   */
  readonly nextDecisionOrdinal: bigint;
}

/**
 * Campaign state (`ADR-007`). Every collection here is a sorted, persistent structure
 * rather than a `Map` or an array used as one, because enumeration order reaches the
 * canonical artifact — see `SortedMap`.
 *
 * {@link withEvent} is the only sanctioned campaign-transition entrypoint: it is the
 * only place `stateVersion`, `logicalTime`, `nextEventId`, `nextTraceId` or
 * `nextDecisionOrdinal` may advance. Nothing stops a caller writing
 * `{ ...state, metadata: { ...state.metadata, stateVersion: 99 } }` — the same hole
 * the C# original had with a bare `with` expression, and it is held shut the same way:
 * by this note and by a test asserting that an ordinary spread does not advance the
 * state version. A command applies an event's *effects* with a spread and the
 * *transition* with this function, both, in that order, never one instead of the other.
 */
export interface GameState {
  readonly metadata: GameMetadata;
  readonly heroes: SortedMap<HeroId, HeroState>;
  readonly contracts: SortedMap<ContentId, ContractState>;
  /**
   * Ids of the commands already applied, so replaying one is refused instead of quietly
   * happening twice. A command id nothing ever checks is worse than no command id at
   * all: it looks like idempotency and provides none.
   */
  readonly appliedCommandIds: SortedSet<number>;
  /**
   * The rulebook's own trait table, filled once by the content loader's initial-state
   * builder and carried in state from then on, never re-derived.
   *
   * The engine needs a hero's traits resolved into kind, tag and weight to build a
   * decision context, but it cannot reference the content package that defines them
   * (`ADR-002`) — so the resolution happens exactly once, at content-load time, on the
   * other side of that boundary, and only the result crosses into state.
   */
  readonly traitRules: SortedMap<ContentId, HeldTrait>;
  /**
   * Explanations for past decisions, addressable by the `causalTraceId` carried on the
   * event that produced them. Stored here — not only returned alongside a command's
   * result — so a trace survives save/load and a decision can still be explained
   * afterwards.
   */
  readonly traces: SortedMap<number, CausalTrace>;
  readonly history: readonly DomainEvent[];
  /**
   * The guild's money (`NEGOTIATION_SPEC` §2.3) — an integer, never negative.
   * `STARTING_TREASURY` (`negotiation/commitments.ts`) at campaign start.
   * `settleContract` (Task 14, `engine.ts`) is the only command that moves it, paying
   * the patron fee in and the advance (and, if kept, the promised bonus) out on every
   * settlement — `lockOffer` never touches this field; it only checks the treasury can
   * cover a commitment, through `reservedCommitments` below. The reserve a `locked`
   * offer already holds against it is deliberately **not** a field here:
   * `reservedCommitments` (`negotiation/commitments.ts`) derives it from `contracts` on
   * every call, so it cannot become a second, driftable source of the same fact.
   */
  readonly treasury: number;
}

/**
 * Appends `domainEvent` to history and advances the campaign counters — the only place
 * any of them does.
 *
 * @param drawsConsumed How many RNG ordinals producing this event consumed on the hero
 * decision stream; `0n` for a transition that made no draw at all.
 *
 * There is no default for `drawsConsumed`, on purpose. The RNG is counter-based, so if
 * the ordinal does not move the *same* value comes back: two heroes deciding in a row
 * would draw identically and the second explanation would be a copy of the first, with
 * nothing anywhere to indicate it. A defaulted parameter would make that the failure
 * you get by forgetting to type anything; a required one makes every transition state,
 * in the call, how much randomness it spent. `0n` at a non-decision call site is not
 * noise, it is the claim "this transition consumed no randomness".
 *
 * @throws if the event is out of order, dated before the campaign's current logical
 * time, or if the trace/event pairing is one of the four broken shapes described below.
 */
export function withEvent(
  state: GameState,
  domainEvent: DomainEvent,
  trace: CausalTrace | null,
  drawsConsumed: bigint
): GameState {
  const { metadata } = state;

  // Two bounds, and both are load-bearing — a mutant proved it. The sum check alone
  // misses a negative `drawsConsumed` that leaves the total in range: ordinal 5 plus
  // −5n is 0, perfectly valid-looking, and the campaign's randomness has just rewound
  // five draws it already spent. The `drawsConsumed` check alone misses an overflow.
  // C# needed neither: `ulong` had no negatives and its addition was `checked`.
  requireUint64('drawsConsumed', drawsConsumed);
  requireUint64('nextDecisionOrdinal', metadata.nextDecisionOrdinal + drawsConsumed);

  if (domainEvent.eventId !== metadata.nextEventId) {
    throw new Error(
      `Event id ${domainEvent.eventId} is out of order; expected ${metadata.nextEventId}.`
    );
  }

  if (domainEvent.logicalTime < metadata.logicalTime) {
    throw new Error(
      `Event logical time ${domainEvent.logicalTime} is before the campaign's current logical ` +
        `time (${metadata.logicalTime}); history must be monotone in logical time.`
    );
  }

  let storesNewTrace = false;

  if (domainEvent.causalTraceId !== null) {
    const causalTraceId = domainEvent.causalTraceId;

    if (trace !== null) {
      if (trace.traceId !== causalTraceId) {
        throw new Error(
          `Trace id ${trace.traceId} does not match the event's causalTraceId (${causalTraceId}).`
        );
      }

      const existing = state.traces.get(trace.traceId);
      if (existing !== undefined) {
        // A second event may legitimately reference an explanation already stored, so
        // an equivalent trace is a no-op. A *different* one is refused rather than
        // overwriting it: a second decision must never erase what the first explained.
        if (!deepEqual(existing, trace)) {
          throw new Error(
            `Trace id ${trace.traceId} is already stored with different content; a stored ` +
              'explanation cannot be overwritten.'
          );
        }
      } else {
        if (trace.traceId !== metadata.nextTraceId) {
          throw new Error(
            `Trace id ${trace.traceId} is not the campaign's next free trace id ` +
              `(${metadata.nextTraceId}); a new explanation must be stored under it, because ` +
              'that counter only ever advances by one per stored trace and would otherwise ' +
              'stop meaning "next free" — a later decision would then be handed an id that ' +
              'is already occupied.'
          );
        }

        storesNewTrace = true;
      }
    } else if (!state.traces.has(causalTraceId)) {
      throw new Error(
        `Event references causalTraceId ${causalTraceId}, but no trace with that id has been ` +
          'stored yet and none was provided; the reference would dangle.'
      );
    }
  } else if (trace !== null) {
    throw new Error(
      'A trace was provided, but the event references no causalTraceId; it would be stored ' +
        'unreachably.'
    );
  }

  // The one freeze, and it covers everything: the event and the trace are reachable from
  // the state being returned, so deep-freezing it freezes them too. There used to be a
  // second pair of freezes at the top of this function, on the arguments; a mutant
  // removing them stayed green, which is the signal that they were buying nothing this
  // freeze does not already buy. Their only remaining effect would have been to freeze a
  // caller's object on a call that then threw.
  //
  // Why any of this is here: external review reproduced a state edited *behind* the
  // checks above — `history[0].logicalTime` set to 99 while the clock read 0, a factor
  // pushed into a stored explanation, a trace reporting an id other than the key it sits
  // under. `readonly` is erased at runtime, so this is what C#'s immutable records gave
  // for free.
  return freezeDeep({
    ...state,
    metadata: {
      ...metadata,
      nextEventId: metadata.nextEventId + 1,
      stateVersion: metadata.stateVersion + 1,
      logicalTime: domainEvent.logicalTime,
      nextTraceId: storesNewTrace ? metadata.nextTraceId + 1 : metadata.nextTraceId,
      nextDecisionOrdinal: metadata.nextDecisionOrdinal + drawsConsumed
    },
    history: [...state.history, domainEvent],
    traces: storesNewTrace && trace !== null ? state.traces.set(trace.traceId, trace) : state.traces
  });
}

/** The hero with `id`. @throws if no such hero exists. */
export function heroOf(state: GameState, id: HeroId): HeroState {
  const hero = state.heroes.get(id);
  if (hero === undefined) {
    throw new Error(`Unknown hero 'hero#${id}'.`);
  }

  return hero;
}

/** The contract with `id`. @throws if no such contract exists. */
export function contractOf(state: GameState, id: ContentId): ContractState {
  const contract = state.contracts.get(id);
  if (contract === undefined) {
    throw new Error(`Unknown contract '${id}'.`);
  }

  return contract;
}
