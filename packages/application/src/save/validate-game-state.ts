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
    // `offer_revised`, `offer_locked` and the three `settleContract` events name no
    // hero — composing, locking or settling an offer is the player's own choice,
    // not a decision a hero made (`domain-event.ts`). Only the two hero-response
    // kinds do.
    if (
      event.kind !== 'offer_revised' &&
      event.kind !== 'offer_locked' &&
      event.kind !== 'contract_settled' &&
      event.kind !== 'contract_settled_promise_kept' &&
      event.kind !== 'contract_settled_promise_broken' &&
      !state.heroes.has(event.heroId)
    ) {
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

    // **Dead code as of `DEC-008` Task 14, and left in place on purpose — the
    // guard-over-guards case ("принимает кампанию, которую движок действительно
    // произвёл") still needs a live function to call, and a check that cannot
    // fire is not the same claim as no check at all.** `decodeSnapshot`'s own
    // contract builder now routes through `createContractState`
    // (`requireConsistentContract`, `snapshot-codec.ts`), which requires
    // `acceptedBy ⊆ respondedBy` structurally — so by the time a `GameState`
    // reaches this function, every hero in `acceptedBy` is already in
    // `respondedBy` too, and the `respondedBy` loop just above (which runs
    // first) has already checked every one of them for existence. An unknown
    // hero reaching `acceptedBy` alone, without also reaching `respondedBy`, is
    // refused earlier now, at the decode door, under that door's own message —
    // `envelope.test.ts`'s referential-integrity table names this explicitly.
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
 * **Why every event, with the exceptions non-decision events now need.**
 * `DomainEvent` is a closed union of seven members (`domain-event.ts`); two are
 * hero decisions, and the other five — `offer_revised`, `offer_locked` and the
 * three `settleContract` events — are the player's own choice and carry no trace
 * by construction. The loop below writes that exception explicitly — refusing one
 * of the five that *does* carry a `causalTraceId`, rather than silently admitting
 * an unexplained decision — and treats every other kind as a decision that must
 * carry one. The nullability on `DomainEventBase.causalTraceId` exists for exactly
 * this shape of event.
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
    // The non-decision events this build produces today: composing, locking or
    // settling an offer is the player's own choice, so each explains itself and
    // carries no trace (`domain-event.ts`'s `OfferRevised`, `OfferLocked`,
    // `ContractSettled` and its two promise-outcome siblings). This is the
    // exception `DomainEventBase.causalTraceId`'s own doc anticipated the day a
    // non-decision event arrived — refusing the first tick or player-choice event
    // that carries an explanation it should not, rather than silently admitting an
    // unexplained decision.
    if (
      event.kind === 'offer_revised' ||
      event.kind === 'offer_locked' ||
      event.kind === 'contract_settled' ||
      event.kind === 'contract_settled_promise_kept' ||
      event.kind === 'contract_settled_promise_broken'
    ) {
      if (event.causalTraceId !== null) {
        throw inconsistent(
          `history event ${String(event.eventId)} ('${event.kind}') carries causalTraceId ` +
            `${String(event.causalTraceId)}; composing, locking or settling an offer is the ` +
            "player's own choice, not a decision, and explains itself."
        );
      }
      continue;
    }

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
 *    it *since the offer's last revision*, one event each,** and the kind of that event
 *    says which of the two sets the hero is in. `respondedBy.has` is what refuses a hero
 *    a second decision on the *current version*, so the log since the last `offer_revised`
 *    and the set are two spellings of the same fact — and a file where they disagree,
 *    over that window, is a file that reopens a decision the campaign already made.
 *
 *    **"Since the last revision", not "ever" — and that qualifier is load-bearing, not
 *    decorative.** This invariant predates offer versions: it was written when a
 *    contract's `respondedBy` was the whole history's answer set, because there was
 *    only ever one version to answer. `composeOffer` (`DEC-008` Task 10) empties
 *    `respondedBy`/`acceptedBy` on every revision while leaving the *history* alone —
 *    the log is what happened, not what the current package can still be answered
 *    about — so a hero who answered version 1 and sees version 2 revised is, correctly,
 *    no longer in `respondedBy`, while their `hero_accepted_contract` event from version
 *    1 is still sitting in `state.history`. Counting the whole history against the
 *    current `respondedBy` therefore refuses every save `composeOffer` can produce after
 *    a single answered, then revised, offer — measured directly: `buildSave` on exactly
 *    that campaign threw `SAVE_INCONSISTENT` before this fix.
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
    if (event.kind === 'offer_revised') {
      // A revision clears the contract's `respondedBy`/`acceptedBy` (`engine.ts`'s
      // `composeOffer`), so every response bookkeeping fact above this point in the
      // log is about a package that no longer exists. Reset this contract's window
      // here, at the point the campaign itself reset it, rather than counting across
      // it.
      respondedInHistory.set(event.contractId, new Map<HeroId, boolean>());
      continue;
    }

    if (event.kind === 'offer_locked') {
      // Locking names no hero and changes neither `respondedBy` nor `acceptedBy`
      // (`engine.ts`'s `lockOffer`) — unlike a revision, there is no window to reset
      // here, only nothing to add.
      continue;
    }

    if (
      event.kind === 'contract_settled' ||
      event.kind === 'contract_settled_promise_kept' ||
      event.kind === 'contract_settled_promise_broken'
    ) {
      // Settling names no hero either and changes neither `respondedBy` nor
      // `acceptedBy` (`engine.ts`'s `settleContract` only moves `offer.phase` to
      // `settled`) — the same reason `offer_locked` above needs no window reset,
      // only nothing to add.
      continue;
    }

    let perContract = respondedInHistory.get(event.contractId);
    if (perContract === undefined) {
      perContract = new Map<HeroId, boolean>();
      respondedInHistory.set(event.contractId, perContract);
    }

    if (perContract.has(event.heroId)) {
      throw inconsistent(
        `history records hero#${String(event.heroId)} answering contract '${event.contractId}' ` +
          'more than once since its last revision, but a hero may answer a given offer version ' +
          'exactly once.'
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
  // **Dead code as of `DEC-008` Task 14, left in place for the same reason
  // `checkReferentialIntegrity`'s own `acceptedBy` loop is (that function's own
  // comment names it first).** `decodeSnapshot`'s contract builder now routes
  // through `createContractState` (`requireConsistentContract`), which requires
  // `acceptedBy ⊆ respondedBy` on every `ContractState` it accepts — so a save
  // reaching this function can no longer carry a hero in `acceptedBy` without
  // also carrying them in `respondedBy`. `envelope.test.ts`'s "герой в
  // acceptedBy, но не в respondedBy" case is refused at the decode door now,
  // under `createContractState`'s own message, not this one's.
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

    const inAcceptedBy = contract.offer.acceptedBy.has(heroId);

    // Declining and being listed in `acceptedBy` is a contradiction in every case —
    // a hero joins the crew only by saying yes.
    if (!accepted && inAcceptedBy) {
      throw inconsistent(
        `contract '${contractId}' and the history disagree about hero#${String(heroId)}: the ` +
          'history says the hero declined, but the contract lists them in acceptedBy.'
      );
    }

    // Accepting without a seat is a contradiction too, *except* the one shape
    // `pollCrew` legitimately produces (`NEGOTIATION_SPEC` §2.1, §3.3): the poll does
    // not stop once the crew is full, so a hero who accepts after every seat is taken
    // still gets a full decision and a trace, and stays in `respondedBy` without ever
    // entering `acceptedBy`. That shape is only reachable once the contract's own
    // seats are exhausted, so an accepted-but-unseated hero found with room still
    // open is still a genuine contradiction.
    //
    // **What this no longer catches, named rather than left implicit.** `pollCrew`
    // seats the *lowest* `HeroId` acceptors first, but only among the heroes it
    // itself polls — the key hero's own seat comes from `proposeContractToHero`,
    // in the draft phase, before `pollCrew` ever runs, and carries no such ordering
    // relative to the rest of the roster (`keyHero` can be any id). So this check
    // states only "an accepted, unseated hero exists only once the seats are
    // full" — a real fact, and the one this file can check without re-deriving
    // `pollCrew`'s whole per-poll ordering from a snapshot that does not record
    // poll order at all. It does **not** say *which* accepted heroes hold the
    // seats: a file where two heroes both accepted, the seats are full, and the
    // "wrong" one by `HeroId` order was recorded as seated passes this check.
    // Catching that would need the campaign's own command log, not the state a
    // save carries.
    if (accepted && !inAcceptedBy && contract.offer.acceptedBy.size < contract.requiredCrew) {
      throw inconsistent(
        `contract '${contractId}' and the history disagree about hero#${String(heroId)}: the ` +
          'history says the hero accepted while the contract still had an open seat, but they ' +
          'are not in acceptedBy.'
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

  // **Dead code as of `DEC-008` Task 14, same reason and same door as the two
  // checks above.** `createContractState` already enforces the two-directional
  // `status = 'crewed' ⇔ acceptedBy.size = requiredCrew` on every `ContractState`
  // `decodeSnapshot` accepts, *and* `acceptedBy.size ≤ requiredCrew` separately —
  // so by the time a save reaches this function, `acceptedBy.size >= requiredCrew`
  // below can only ever agree with `acceptedBy.size === requiredCrew`, and
  // `crewed`/`enough` can no longer disagree. `envelope.test.ts`'s "состав
  // набран, а контракт всё ещё предлагается" and "контракт закрыт составом,
  // которого не хватает" cases are both refused at the decode door now, under
  // `createContractState`'s own message.
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
 * **`appliedCommandIds.size === history.length` no longer holds — it is
 * `appliedCommandIds.size <= history.length` now.** The equality held while every
 * command that could apply appended exactly one event in the same transition it
 * recorded its id under (`composeOffer`, `lockOffer`, `proposeContractToHero`).
 * `pollCrew` (`DEC-008` Task 13) is the one command that breaks it: one `commandId`
 * can leave *several* events behind — one per hero the poll actually asked — so a
 * command id can now correspond to more than one history event. It can never
 * correspond to *zero*, though: `pollCrew` itself refuses to apply against a locked
 * package every hero has already answered (`RejectionCodes.NobodyLeftToPoll`,
 * `engine.ts`) — a rejection records no command id at all, so the one shape that
 * would have driven `appliedCommandIds.size` *above* `history.length` (a command
 * applying with nothing to show for it) is not reachable through this build's own
 * engine. `<=` is therefore still a real invariant, not merely a weaker one settled
 * for: every applied command id accounts for at least one history event, and this
 * still refuses the same tampered file external review priced this against — an
 * `appliedCommandIds` list padded with an id nothing in `history` explains.
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

  if (state.appliedCommandIds.size > history.length) {
    throw inconsistent(
      `the save records ${String(state.appliedCommandIds.size)} applied commands, more than the ` +
        `${String(history.length)} history events it holds; every applied command appends at ` +
        'least one event.'
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
