import {
  ContractStatus,
  type ContractState,
  type ContentId,
  type GameState,
  type HeroId
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
  checkResponseBookkeeping(state);
  checkCounters(state);
}

/**
 * References *between* two of `snapshot-codec.ts`'s independently-built maps — an
 * event's `heroId` or `contractId`, an event's `causalTraceId` pointing at a trace, a
 * contract's `respondedBy` or `acceptedBy` naming a hero, a hero's `traits` naming a
 * rule. The codec checks a map's own key against its value's identity and stops there,
 * because a reference across that seam spans two maps neither of which is being built
 * when the other is read.
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

    if (event.causalTraceId !== null && !state.traces.has(event.causalTraceId)) {
      throw inconsistent(
        `history event ${String(event.eventId)} references causalTraceId ` +
          `${String(event.causalTraceId)}, but the save stores no trace under that id.`
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
    for (const heroId of contract.respondedBy.values()) {
      if (!state.heroes.has(heroId)) {
        throw inconsistent(
          `contract '${contractId}' lists hero#${String(heroId)} in respondedBy, but the save ` +
            'carries no such hero.'
        );
      }
    }

    for (const heroId of contract.acceptedBy.values()) {
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

  for (const [contractId, contract] of state.contracts.entries()) {
    checkOneContract(contractId, contract, respondedInHistory.get(contractId) ?? new Map());
  }

  // A history event naming a contract that carries no responses at all would slip past
  // the loop above, which walks contracts rather than events. It cannot dangle — that is
  // `checkReferentialIntegrity`'s first check — so every contract named in history is in
  // `state.contracts` and was therefore visited; this assertion is what says so out loud
  // rather than leaving it to be re-derived.
  for (const contractId of respondedInHistory.keys()) {
    if (!state.contracts.has(contractId)) {
      throw inconsistent(
        `history names contract '${contractId}', but the save carries no such contract.`
      );
    }
  }
}

function checkOneContract(
  contractId: ContentId,
  contract: ContractState,
  answeredInHistory: ReadonlyMap<HeroId, boolean>
): void {
  for (const heroId of contract.acceptedBy.values()) {
    if (!contract.respondedBy.has(heroId)) {
      throw inconsistent(
        `contract '${contractId}' lists hero#${String(heroId)} in acceptedBy but not in ` +
          'respondedBy; a hero accepts an offer only by answering it.'
      );
    }
  }

  for (const heroId of contract.respondedBy.values()) {
    const accepted = answeredInHistory.get(heroId);

    if (accepted === undefined) {
      throw inconsistent(
        `contract '${contractId}' lists hero#${String(heroId)} in respondedBy, but the history ` +
          'carries no event of that hero answering it.'
      );
    }

    if (accepted !== contract.acceptedBy.has(heroId)) {
      throw inconsistent(
        `contract '${contractId}' and the history disagree about hero#${String(heroId)}: the ` +
          `history says the hero ${accepted ? 'accepted' : 'declined'}, the contract says the ` +
          `hero is ${contract.acceptedBy.has(heroId) ? '' : 'not '}in acceptedBy.`
      );
    }
  }

  for (const heroId of answeredInHistory.keys()) {
    if (!contract.respondedBy.has(heroId)) {
      throw inconsistent(
        `history records hero#${String(heroId)} answering contract '${contractId}', but the ` +
          "contract's respondedBy does not carry that hero."
      );
    }
  }

  const crewed = contract.status === ContractStatus.Crewed;
  const enough = contract.acceptedBy.size >= contract.requiredCrew;

  if (crewed !== enough) {
    throw inconsistent(
      `contract '${contractId}' is ${crewed ? 'crewed' : 'offered'} with ` +
        `${String(contract.acceptedBy.size)} of ${String(contract.requiredCrew)} seats filled; ` +
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
