import type { SortedMap } from '../collections/sorted-map.ts';
import type { HeroId } from '../ids/hero-id.ts';

import type { BattleRecord } from './battle-record.ts';
import type { CommitmentState } from './commitment.ts';
import type { NeedId } from './need-id.ts';
import type { OutcomeReasonCode } from './outcome-reason-codes.ts';

/**
 * What a resolved contract *is* — the vocabulary and the shapes, with no arithmetic
 * (`RESOLUTION_SPEC` §2.1). The formulas that fill these in arrive in
 * `packages/simulation/src/resolution/`; the reason they live one directory over is
 * `RESOLUTION_SPEC` §2.7: `ContractState` carries a `ContractResolution`, so anything
 * `ContractState` needs has to sit below state, and nothing here may import state or the
 * rules.
 *
 * Two declarations of that same section are deliberately **not** here — `ResolutionInput`
 * and `ContractResolver`. Both name `ContractState` and `HeroState`, so putting them in
 * this directory would close exactly the cycle the split exists to prevent
 * (`domain/outcome.ts → state/contract-state.ts → domain/outcome.ts`). They belong with
 * the resolver itself, above state, which is also where they are first callable.
 */

/**
 * The four steps an outcome can land on (`RESOLUTION_SPEC` §4.6).
 *
 * Read *from the intents*, never chosen first and decorated afterwards: if the step were
 * picked before the events, the heroes' own actions could not causally produce it and the
 * trace would be explaining scenery (`ADR-014`).
 */
export const OutcomeGrade = Object.freeze({
  Clean: 'clean',
  Costly: 'costly',
  Failed: 'failed',
  Disaster: 'disaster'
});

export type OutcomeGrade = (typeof OutcomeGrade)[keyof typeof OutcomeGrade];

/**
 * How well one need came out (`RESOLUTION_SPEC` §4.3). Three verdicts and not a
 * percentage: coverage is shown to the player qualitatively, because it is an assessment
 * of preparation rather than a fact that happened (`DEC-006`, `GDD` §16.3).
 */
export const CoverageVerdict = Object.freeze({
  Closed: 'closed',
  Weak: 'weak',
  Uncovered: 'uncovered'
});

export type CoverageVerdict = (typeof CoverageVerdict)[keyof typeof CoverageVerdict];

/**
 * What the resolver says happened, in the order it happened (`RESOLUTION_SPEC` §4.4).
 *
 * Each kind becomes one `DomainEvent` and one line on the debrief screen. `contract_resolved`
 * is always the last one, and its effect is what writes the resolution onto the contract —
 * inside the transition rather than after it (`RESOLUTION_SPEC` §3.3).
 */
export const OutcomeIntentKind = Object.freeze({
  NeedCovered: 'need_covered',
  NeedShort: 'need_short',
  FalteredEarly: 'faltered_early',
  ObjectiveTaken: 'objective_taken',
  ObjectiveLost: 'objective_lost',
  ConsequenceSuffered: 'consequence_suffered',
  ContractResolved: 'contract_resolved'
});

export type OutcomeIntentKind = (typeof OutcomeIntentKind)[keyof typeof OutcomeIntentKind];

/**
 * The three ways a crew can come up short (`RESOLUTION_SPEC` §4.7), and they are not
 * mutually exclusive: a weak hero both fails to close a need and goes unwillingly. Which
 * of them dominates is a comparison of counterfactual magnitudes, and it is allowed to
 * answer "none" — a model obliged to name the main cause starts inventing one.
 */
export const DeficitKind = Object.freeze({
  /** The right people were there; the skill was not (`grade = 100` would have covered it). */
  Capability: 'capability_gap',

  /** Nobody answerable for that need was in the crew at all. */
  Coverage: 'coverage_gap',

  /** The crew went, but not willingly enough to carry the margin. */
  Commitment: 'commitment_drag'
});

export type DeficitKind = (typeof DeficitKind)[keyof typeof DeficitKind];

/**
 * What an outcome can cost a person (`RESOLUTION_SPEC` §2.6, §5.1).
 *
 * `Retreat` is the one of the four a battle adds (`COMBAT_SPEC` §6.4 п.1, `ADR-016` §4).
 * It is a fourth kind rather than a reason on one of the three because pulling out has to
 * cost **everybody who moved**, and none of the other three is that: a wound goes to the
 * one man on the point, a grudge to the one who gave way, a lost trust to the key hero.
 * Reusing any of them would put a personal accusation on a group decision.
 */
export const ConsequenceKind = Object.freeze({
  Wound: 'wound',
  Grudge: 'grudge',
  TrustLost: 'trust_lost',
  Retreat: 'retreat'
});

export type ConsequenceKind = (typeof ConsequenceKind)[keyof typeof ConsequenceKind];

/** One need, from what the contract asked to what the crew brought (`RESOLUTION_SPEC` §4.3). */
export interface NeedCoverage {
  readonly need: NeedId;

  /** The weight the contract's author wrote. */
  readonly weight: number;

  /** The weight raised by the contract's risk (`RESOLUTION_SPEC` §4.2). */
  readonly required: number;

  /** What the crew supplied, after diminishing returns on duplicates. */
  readonly supplied: number;

  /** `supplied` capped by the surplus ceiling — what actually counts toward the margin. */
  readonly effective: number;

  readonly verdict: CoverageVerdict;

  /**
   * Everyone **answerable** for this need (`RESOLUTION_SPEC` §2.2) — including at an
   * expertise of nought — with both numbers the debrief screen shows: what the man
   * brought (§4.1) and how much of it counted once §4.3's halving had been applied.
   *
   * Two numbers rather than one, by the owner's decision of 2026-08-27. `amount` alone
   * makes a crew's names add up to more than the need received; `counted` alone makes two
   * identical heroes read as unequal for a reason that is only their sort order. Kept per
   * `(hero, need)` — where the halving happens — so every rollup is addition rather than
   * a second statement of §4.3.
   */
  readonly contributors: readonly {
    readonly hero: HeroId;
    readonly amount: number;
    readonly counted: number;
  }[];
}

/**
 * One thing that happened, with the number it moved and the reason it names.
 *
 * Carries no campaign identifier: `eventId`, `stateVersion` and `commandId` are the
 * command's business, and keeping them out is what lets the resolver be exercised on a
 * synthetic input and batch-run for balancing (`ADR-014` §3).
 */
export interface OutcomeIntent {
  readonly kind: OutcomeIntentKind;
  readonly hero: HeroId | null;
  readonly need: NeedId | null;

  /** Derived intents carry `0`: an outcome must not feed the margin it was derived from. */
  readonly marginDelta: number;

  readonly reason: OutcomeReasonCode;

  /** Only on `need_short`: which deficit the shortfall belongs to (`RESOLUTION_SPEC` §4.7). */
  readonly gap: DeficitKind | null;

  /** Only on `consequence_suffered`. */
  readonly consequence: ConsequenceKind | null;

  readonly magnitude: number;
}

/** What one hero brought, and why the screen may say so (`RESOLUTION_SPEC` §2.1). */
export interface HeroContribution {
  /**
   * The sum of this hero's own {@link NeedCoverage.contributors} `amount`s across every
   * need he is answerable for — what he brought, before §4.3's halving.
   *
   * The matching "how much counted" rollup is deliberately **not** a second field here:
   * it is the sum of his `counted` shares, which `coverage` already carries, and one
   * number living in two places is one number that can disagree with itself
   * (`RESOLUTION_SPEC` §4.3).
   */
  readonly amount: number;
  readonly commitment: CommitmentState;
  readonly provenance: readonly OutcomeReasonCode[];
}

/**
 * One diagnosis, with its sources.
 *
 * `magnitude` is counterfactual and in units of margin — "how much worse this made it" —
 * because the three kinds are otherwise incommensurable and could not be ranked at all.
 */
export interface Deficit {
  readonly kind: DeficitKind;
  readonly magnitude: number;
  readonly needs: readonly NeedId[];
  readonly heroes: readonly HeroId[];
}

/** What an outcome cost one person, and the reason it names (`RESOLUTION_SPEC` §5.2). */
export interface HeroConsequence {
  readonly hero: HeroId;
  readonly kind: ConsequenceKind;
  readonly reason: OutcomeReasonCode;
  readonly magnitude: number;
}

/**
 * The stored result: everything the debrief screen needs that the event history does not
 * already carry.
 *
 * Not everything it needs, though — the chronology lives in `history`, and one saved
 * result cannot reconstruct it. The screen model takes `GameState` and a `contractId`
 * (`RESOLUTION_SPEC` §6.1).
 */
export interface ContractResolution {
  readonly grade: OutcomeGrade;
  readonly coverage: readonly NeedCoverage[];
  readonly contributions: SortedMap<HeroId, HeroContribution>;
  readonly deficits: readonly Deficit[];

  /** `null` when no deficit dominates the next one clearly enough to be named. */
  readonly dominant: DeficitKind | null;

  readonly consequences: readonly HeroConsequence[];

  /**
   * The battle that produced this, or `null` for a contract the abstract resolver settled
   * (`COMBAT_SPEC` §6.4 п.3, `ADR-016` §4).
   *
   * The third and last of the three things a battle adds to this shape. It is here rather
   * than in the campaign's `history` because a battle raises dozens of events per round,
   * and `history` goes into the save **and** into the canonical artifact — eighty events per
   * contract would make the snapshot a human checks unreadable (`ADR-016` §6). It is the
   * whole record, because that is what a replay needs and what the debrief's feed reads.
   */
  readonly battle: BattleRecord | null;
}

/** What a resolver hands back: the events to raise, and the result to store. */
export interface ResolutionDraft {
  /** In application order (`RESOLUTION_SPEC` §3.3). The last one is always `contract_resolved`. */
  readonly intents: readonly OutcomeIntent[];
  readonly resolution: ContractResolution;
}
