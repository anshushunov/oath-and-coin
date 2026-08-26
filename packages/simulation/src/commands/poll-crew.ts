import type { ContentId } from '../ids/content-id.ts';

/**
 * Lets the rest of the roster answer a contract's locked package, once each, in one
 * command (`NEGOTIATION_SPEC` §3.1, §3.3). The offer's key hero already answered this
 * exact version before it was locked (`lockOffer`) and is not asked again — a package
 * `lockOffer` froze is the same package the key hero's acceptance was given against,
 * because `lockOffer` never raises the version.
 *
 * This is the command `CommandResult.decisions` being a list, not a single field,
 * exists for (Task 5): every hero not yet in `offer.respondedBy` answers, in `HeroId`
 * order, and each gets its own decision and its own event — six heroes can answer in
 * the one command a player issued.
 *
 * No `heroId` of its own, unlike `ProposeContractToHero`: this command asks *many* heroes,
 * not one.
 *
 * **Which many is a rule that has moved, and this shape survived the move.**
 * `m1-negotiation/1` asked the entire remaining roster; the amendment of 2026-08-25
 * (`DEC-012`, `NEGOTIATION_SPEC` §3.1, §3.3) narrowed it to the crew the package invited,
 * minus whoever already answered, and that is what this build does. Either way the command
 * names no hero, which is why the move cost this file nothing.
 */
export interface PollCrew {
  /** Identifies this command for the campaign's lifetime; see `ProposeContractToHero`. */
  readonly commandId: number;
  readonly contractId: ContentId;
  /** The state version this command was composed against; see `ProposeContractToHero`. */
  readonly expectedStateVersion: number;
}
