import {
  ContractStatus,
  type CausalTrace,
  type ContractState,
  type ContentId,
  type DomainEvent,
  type GameState,
  type HeroId,
  type TraceFactor
} from '@oath-and-coin/simulation';

import { SaveErrorCodes, SaveReadError } from '@oath-and-coin/content';

/**
 * Everything a `GameState` has to be true of before this build will write it to a file
 * or accept one, beyond the shape `snapshot-codec.ts` already checks.
 *
 * **Why one function and not two.** It began as `checkReferentialIntegrity` inside
 * `envelope.ts`, called on the read path only, and external review of Task 16 measured
 * what that left open: identifiers existed, and nothing said the *domain relations
 * between them* held. A re-signed file whose history carried `hero_accepted_contract`
 * while the contract's `respondedBy`/`acceptedBy` were emptied and its status put back
 * to `offered` read back successfully; the same hero then answered the same contract a
 * second time and the campaign ended with two identical history records. Reproduced on
 * real code before this function existed. So the checks below are one function, applied
 * on both sides — `readSave` refuses such a file, `buildSave` refuses to produce one —
 * because a producer that can write what a reader refuses (or a reader that accepts
 * what a producer can never make) is exactly the asymmetry that hole was.
 *
 * **What each group is justified by.** Every rule here is a property the engine
 * establishes and is stated with the line that establishes it, not with an intuition:
 * `proposeContractToHero` for the response bookkeeping, `withEvent` for the counters. A
 * rule that merely *happens* to hold on today's content is not in this list — that is
 * what `snapshot-codec.ts`'s ceilings are for, and they are checked against content
 * separately.
 *
 * **Everything refuses as `SAVE_INCONSISTENT`**, and reuses the code rather than
 * minting new ones: the file disagrees with itself, which is precisely what that code
 * already names for a dangling map reference.
 */
export function validateGameState(state: GameState): void {
  checkReferentialIntegrity(state);
  checkDecisionTraces(state);
  checkResponseBookkeeping(state);
  checkCounters(state);
}

/**
 * References *between* two of `snapshot-codec.ts`'s independently-built maps — an
 * event's `heroId` or `contractId`, a contract's `respondedBy` or `acceptedBy` naming a
 * hero, a hero's `traits` naming a rule. The codec checks a map's own key against its
 * value's identity and stops there, because a reference across that seam spans two maps
 * neither of which is being built when the other is read.
 *
 * An event's `causalTraceId` is the one reference of that shape *not* checked here: it
 * belongs to {@link checkDecisionTraces}, which has to look the trace up anyway to say
 * anything about what it explains, and one lookup with one refusal is better than a
 * dangling-reference check here and a semantic one there disagreeing about which fires
 * first.
 */
function checkReferentialIntegrity(state: GameState): void {
  for (const event of state.history) {
    if (!state.heroes.has(event.heroId)) {
      throw inconsistent(
        `history event ${String(event.eventId)} names hero#${String(event.heroId)}, but the ` +
          'save carries no such hero.'
      );
    }

    if (!state.contracts.has(event.contractId)) {
      throw inconsistent(
        `history event ${String(event.eventId)} names contract '${event.contractId}', but the ` +
          'save carries no such contract.'
      );
    }
  }

  // A hero's traits against the rule table, which is the seam a screen walks through
  // first. Every hero card names every trait its hero holds
  // (`contract-offer-screen-model-factory.ts`'s `resolveTrait`), so a save whose roster
  // holds a trait its own rule table does not carry is a save no screen can be built
  // from — and without this it reached the factory, which threw a plain `Error` from
  // three layers up rather than reporting a refusal a player can read.
  for (const [heroId, hero] of state.heroes.entries()) {
    for (const traitId of hero.traits) {
      if (!state.traitRules.has(traitId)) {
        throw inconsistent(
          `hero#${String(heroId)} holds trait '${traitId}', but the save carries no rule for it.`
        );
      }
    }
  }

  for (const [contractId, contract] of state.contracts.entries()) {
    for (const heroId of contract.offer.respondedBy.values()) {
      if (!state.heroes.has(heroId)) {
        throw inconsistent(
          `contract '${contractId}' lists hero#${String(heroId)} in respondedBy, but the save ` +
            'carries no such hero.'
        );
      }
    }

    for (const heroId of contract.offer.acceptedBy.values()) {
      if (!state.heroes.has(heroId)) {
        throw inconsistent(
          `contract '${contractId}' lists hero#${String(heroId)} in acceptedBy, but the save ` +
            'carries no such hero.'
        );
      }
    }
  }
}

/**
 * Every decision against the explanation stored for it — the contract `ADR-007` and `TDD`
 * §8 state, checked on a file rather than assumed of one.
 *
 * **What was open before this.** External review of segment 5 re-signed two files, each
 * with one independent substitution, and both read back clean: one put `causalTraceId:
 * null` on a decision event, the other added a `blockedBy` entry to the trace of an
 * *accepted* contract while leaving its factors in place. Nothing checked either.
 * `checkReferentialIntegrity` asked only whether a non-null reference resolved, and the
 * counters asked only how many traces there were. So the first file lost the explanation
 * of a decision the campaign had made — after loading it, the screen has a step with no
 * "why" and `restoreDecidedSteps` answers `null` — and the second let the interface show a
 * hero *accepting* a contract that its own trace says a red line closed.
 *
 * **Why every event, with no exception for a future tick.** `DomainEvent` is a closed
 * union of two members and both are decisions (`domain-event.ts`), so today "an event
 * with no trace" is exactly "a decision with no explanation". The nullability on
 * `DomainEventBase.causalTraceId` is there for a tick event that does not exist yet; the
 * day one is added, this loop is where the exception has to be written, and it will say
 * so by refusing the first tick anybody produces rather than by silently admitting an
 * unexplained decision in the meantime.
 *
 * **Coverage is a bijection, in both directions.** An event names exactly one trace, and
 * a trace explains exactly one event. The counters next door already force
 * `traces.size === nextTraceId` and dense ids, which is a statement about numbering and
 * not about coverage: two events sharing one trace, with a second trace nothing points
 * at, satisfies every count.
 *
 * **The score is not stored, and does not need to be.** `CausalTrace` carries the terms
 * rather than their sum, and the sum *is* the score — the same identity
 * `restoreDecidedSteps` already computes the number it shows a player from
 * (`restore-steps.ts`), and the same one `contract-decision-rule.ts` produces (its own
 * suite pins `Σpositive − Σnegative === selectedScore`). So "the action agrees with the
 * score" is checkable from the file alone. It cannot silently overflow the way the
 * engine's own `toInt32` can: `snapshot-codec.ts` bounds a factor's magnitude at
 * `PATRON_FEE_MAX` and bounds how many factors a side may hold, which is that comment's
 * stated reason for existing.
 */
function checkDecisionTraces(state: GameState): void {
  const explains = new Map<number, number>();

  for (const event of state.history) {
    if (event.causalTraceId === null) {
      throw inconsistent(
        `history event ${String(event.eventId)} records a decision ('${event.kind}') carrying no ` +
          'causalTraceId; every decision this build records is stored with the explanation it ' +
          'was taken on.'
      );
    }

    const alreadyExplained = explains.get(event.causalTraceId);
    if (alreadyExplained !== undefined) {
      throw inconsistent(
        `history events ${String(alreadyExplained)} and ${String(event.eventId)} both reference ` +
          `trace ${String(event.causalTraceId)}; a trace explains exactly one decision.`
      );
    }
    explains.set(event.causalTraceId, event.eventId);

    const trace = state.traces.get(event.causalTraceId);
    if (trace === undefined) {
      throw inconsistent(
        `history event ${String(event.eventId)} references causalTraceId ` +
          `${String(event.causalTraceId)}, but the save stores no trace under that id.`
      );
    }

    checkOneTrace(event, trace);
  }

  for (const traceId of state.traces.keys()) {
    if (!explains.has(traceId)) {
      throw inconsistent(
        `the save stores a trace under id ${String(traceId)} that no history event references; a ` +
          'trace is the explanation of a decision, and every decision is an event.'
      );
    }
  }
}

/**
 * One decision against its own trace.
 *
 * The blocked case and the scored case are disjoint by construction — `createDecisionResult`
 * refuses a result that is both or neither — and they are refused separately here because
 * they fail differently: a blocked trace that carries factors is claiming a magnitude for
 * something the rule states has none, while a scored trace whose sum contradicts the
 * action is claiming an outcome the rule cannot reach from those terms.
 */
function checkOneTrace(event: DomainEvent, trace: CausalTrace): void {
  const accepted = event.kind === 'hero_accepted_contract';

  if (trace.blockedBy.length > 0) {
    if (accepted) {
      throw inconsistent(
        `history event ${String(event.eventId)} records an acceptance explained by a trace that ` +
          'names a hard constraint; a red line closes the decision before any score exists, so ' +
          'it can only be declined.'
      );
    }

    if (trace.positiveFactors.length > 0 || trace.negativeFactors.length > 0) {
      throw inconsistent(
        `trace ${String(trace.traceId)} names a hard constraint and weighs factors as well; a ` +
          'blocked decision is closed before any factor is weighed.'
      );
    }

    if (trace.tieBreak !== null) {
      throw inconsistent(
        `trace ${String(trace.traceId)} names a hard constraint and a tie-break; a blocked ` +
          'decision settles no dead heat, because it never reaches one.'
      );
    }

    return;
  }

  const score = total(trace.positiveFactors) - total(trace.negativeFactors);

  if (accepted !== score >= 0) {
    throw inconsistent(
      `history event ${String(event.eventId)} records ${accepted ? 'an acceptance' : 'a refusal'} ` +
        `explained by a trace summing to ${String(score)}; a hero takes a contract exactly when ` +
        'its motives sum to zero or better.'
    );
  }

  if ((trace.tieBreak !== null) !== (score === 0)) {
    throw inconsistent(
      `trace ${String(trace.traceId)} sums to ${String(score)} and ` +
        `${trace.tieBreak === null ? 'breaks no tie' : `breaks a tie ('${trace.tieBreak}')`}; a ` +
        'tie is exactly a sum of zero, where accepting and refusing scored the same.'
    );
  }
}

function total(factors: readonly TraceFactor[]): number {
  return factors.reduce((sum, factor) => sum + factor.magnitude, 0);
}

/**
 * The three facts `proposeContractToHero` establishes about a response, checked against
 * each other.
 *
 * 1. **`acceptedBy` is a subset of `respondedBy`.** The command adds to `acceptedBy`
 *    only in the same expression that adds to `respondedBy` (`engine.ts`), so a hero in
 *    one and not the other is a state no command produced.
 * 2. **A contract's `respondedBy` is exactly the set of heroes with a history event on
 *    it, one event each,** and the kind of that event says which of the two sets the
 *    hero is in. `respondedBy.has` is what refuses a hero a second decision on the same
 *    contract, ever, so the log and the set are two spellings of the same fact — and a
 *    file where they disagree is a file that reopens a decision the campaign already
 *    made.
 * 3. **`Crewed` means exactly "enough heroes accepted".** The status moves to `Crewed`
 *    in the same expression, from `acceptedBy.size >= requiredCrew`, and no further
 *    response is admitted once it has (`ContractAlreadyResolved`), so the biconditional
 *    holds in both directions rather than only forward. `REQUIRED_CREW_MIN` is 1
 *    (`bounds.ts`), which is what rules out the degenerate case of a contract needing
 *    nobody and therefore being crewed before anyone answered.
 */
function checkResponseBookkeeping(state: GameState): void {
  const respondedInHistory = new Map<ContentId, Map<HeroId, boolean>>();

  for (const event of state.history) {
    let perContract = respondedInHistory.get(event.contractId);
    if (perContract === undefined) {
      perContract = new Map<HeroId, boolean>();
      respondedInHistory.set(event.contractId, perContract);
    }

    if (perContract.has(event.heroId)) {
      throw inconsistent(
        `history records hero#${String(event.heroId)} answering contract '${event.contractId}' ` +
          'more than once, but a hero may answer an offer exactly once.'
      );
    }

    perContract.set(event.heroId, event.kind === 'hero_accepted_contract');
  }

  // Walking contracts rather than events covers both directions, and it covers them
  // completely: an event naming a contract absent from `state.contracts` cannot reach
  // here at all — `checkReferentialIntegrity` refuses it first — so every contract that
  // appears in `respondedInHistory` is a contract this loop visits. A second loop over
  // `respondedInHistory.keys()` asserting the same thing was written and then removed:
  // no mutant could redden it, which is the definition of a check that is not one.
  for (const [contractId, contract] of state.contracts.entries()) {
    checkOneContract(contractId, contract, respondedInHistory.get(contractId) ?? new Map());
  }
}

function checkOneContract(
  contractId: ContentId,
  contract: ContractState,
  answeredInHistory: ReadonlyMap<HeroId, boolean>
): void {
  for (const heroId of contract.offer.acceptedBy.values()) {
    if (!contract.offer.respondedBy.has(heroId)) {
      throw inconsistent(
        `contract '${contractId}' lists hero#${String(heroId)} in acceptedBy but not in ` +
          'respondedBy; a hero accepts an offer only by answering it.'
      );
    }
  }

  for (const heroId of contract.offer.respondedBy.values()) {
    const accepted = answeredInHistory.get(heroId);

    // **This branch adds no refusing power, and that is deliberate rather than
    // unnoticed.** Delete it and the same file is still refused, one line down:
    // `undefined !== contract.acceptedBy.has(heroId)` is true whichever way the
    // membership goes, so the comparison below already covers "there is no event at
    // all". What is lost by deleting it is the *message* — the reader would be told the
    // history and the contract disagree about what the hero decided, when in fact the
    // history says nothing about this hero at all. Measured in round 2 of the seam
    // review: with the case asserting only the code, removing this stayed green. The
    // message is what is under test now (`envelope.test.ts` asserts this fragment), so
    // this is a check on the diagnosis rather than on the verdict.
    if (accepted === undefined) {
      throw inconsistent(
        `contract '${contractId}' lists hero#${String(heroId)} in respondedBy, but the history ` +
          'carries no event of that hero answering it.'
      );
    }

    if (accepted !== contract.offer.acceptedBy.has(heroId)) {
      throw inconsistent(
        `contract '${contractId}' and the history disagree about hero#${String(heroId)}: the ` +
          `history says the hero ${accepted ? 'accepted' : 'declined'}, the contract says the ` +
          `hero is ${contract.offer.acceptedBy.has(heroId) ? '' : 'not '}in acceptedBy.`
      );
    }
  }

  for (const heroId of answeredInHistory.keys()) {
    if (!contract.offer.respondedBy.has(heroId)) {
      throw inconsistent(
        `history records hero#${String(heroId)} answering contract '${contractId}', but the ` +
          "contract's respondedBy does not carry that hero."
      );
    }
  }

  const crewed = contract.status === ContractStatus.Crewed;
  const enough = contract.offer.acceptedBy.size >= contract.requiredCrew;

  if (crewed !== enough) {
    throw inconsistent(
      `contract '${contractId}' is ${crewed ? 'crewed' : 'offered'} with ` +
        `${String(contract.offer.acceptedBy.size)} of ${String(contract.requiredCrew)} seats filled; ` +
        'a contract is crewed exactly when its required crew has accepted.'
    );
  }
}

/**
 * The counters `withEvent` advances, against the history it advanced them for.
 *
 * `withEvent` is the only place any of these may move (`game-state.ts` says so and a
 * test pins it), and it moves them together: one event appended, `nextEventId` and
 * `stateVersion` each +1, `logicalTime` set to the event's own and refused if it went
 * backwards, `nextTraceId` +1 for each newly stored trace and never for a trace already
 * there. So the equalities below are properties of that one function, not of any
 * particular command.
 *
 * `appliedCommandIds.size === history.length` is the one statement here that belongs to
 * a *command* rather than to `withEvent`: `proposeContractToHero` records a command id
 * and appends exactly one event, in the same transition, and it is the only command
 * there is. The day a command applies without producing an event, this line is the one
 * that has to change, and it will say so by reddening.
 */
function checkCounters(state: GameState): void {
  const { metadata, history } = state;

  if (metadata.nextEventId !== history.length) {
    throw inconsistent(
      `nextEventId is ${String(metadata.nextEventId)} but the history holds ` +
        `${String(history.length)} events; the counter advances by one per appended event.`
    );
  }

  if (metadata.stateVersion !== history.length) {
    throw inconsistent(
      `stateVersion is ${String(metadata.stateVersion)} but the history holds ` +
        `${String(history.length)} events; the version advances by one per campaign transition, ` +
        'and every transition appends exactly one event.'
    );
  }

  if (state.appliedCommandIds.size !== history.length) {
    throw inconsistent(
      `the save records ${String(state.appliedCommandIds.size)} applied commands and ` +
        `${String(history.length)} history events; every applied command appends exactly one.`
    );
  }

  if (metadata.nextTraceId !== state.traces.size) {
    throw inconsistent(
      `nextTraceId is ${String(metadata.nextTraceId)} but the save stores ` +
        `${String(state.traces.size)} traces; the counter is the next free id, so it equals how ` +
        'many have been stored.'
    );
  }

  let expectedTraceId = 0;
  for (const traceId of state.traces.keys()) {
    if (traceId !== expectedTraceId) {
      throw inconsistent(
        `the save stores a trace under id ${String(traceId)} where ${String(expectedTraceId)} ` +
          'was the next free one; trace ids are dense and assigned in order.'
      );
    }
    expectedTraceId += 1;
  }

  let previousLogicalTime = 0;
  for (const [index, event] of history.entries()) {
    if (event.eventId !== index) {
      throw inconsistent(
        `history position ${String(index)} carries eventId ${String(event.eventId)}; event ids ` +
          'are assigned in order and the log is kept in that order.'
      );
    }

    if (event.logicalTime < previousLogicalTime) {
      throw inconsistent(
        `history event ${String(event.eventId)} is dated ${String(event.logicalTime)}, before ` +
          `the event ahead of it (${String(previousLogicalTime)}); history is monotone in ` +
          'logical time.'
      );
    }

    previousLogicalTime = event.logicalTime;
  }

  if (previousLogicalTime > metadata.logicalTime) {
    throw inconsistent(
      `the campaign's clock reads ${String(metadata.logicalTime)} while its last event is dated ` +
        `${String(previousLogicalTime)}; the clock is moved forward to each event as it is ` +
        'appended, so it is never behind the log.'
    );
  }
}

function inconsistent(detail: string): SaveReadError {
  return new SaveReadError(SaveErrorCodes.Inconsistent, detail);
}
