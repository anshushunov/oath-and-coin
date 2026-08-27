import { ContractStatus, OfferPhase, type ContractState } from './contract-state.ts';

/**
 * The half of `RESOLUTION_SPEC` §2.5 that is about a *stored result* rather than about
 * the package around it.
 *
 * Its own file, and not three more branches inside `createContractState`, because these
 * rules answer a different question. The offer's invariants are about a negotiation
 * being coherent; these are about a saved outcome being *readable* — every one of them
 * exists because some later reader would otherwise find a hole where a number should be.
 *
 * Nothing in this package produces a `ContractResolution` yet (`ContractResolver`
 * arrives with the resolution module). Until it does, what these rules guard is exactly
 * what invariants are for: a state assembled by hand, or read back off a save file
 * somebody edited.
 *
 * **§2.5's last row arrived here with `resolveContract`, exactly as its absence said it
 * would.** `settleContract` used to settle a locked, crewed contract with no resolution
 * to require, and the seven shipped scenarios that settle did precisely that; the rule
 * lands with the command that can satisfy it, together with the scenario rewrites that
 * give every settlement a resolution to be settled against, and together with
 * `settleContract`'s own `NotResolved` refusal — so the state this rule forbids is
 * refused as a value before it can be built and thrown about.
 */
export function requireStoredResolutionConsistency(contract: ContractState): void {
  const { resolution, offer } = contract;

  if (resolution === null) {
    // "Settled" means the money has moved for an outcome, and there is no outcome to have
    // moved it for. The refusal a player meets is `settleContract`'s `NotResolved`; this
    // is the same rule stated where a hand-built state or an edited save would otherwise
    // slip past it (`RESOLUTION_SPEC` §2.5).
    if (offer.phase === OfferPhase.Settled) {
      throw new Error(
        `Contract '${contract.id}' offer is in phase '${OfferPhase.Settled}' but carries no ` +
          'resolution; a contract is settled against an outcome, and there is nothing to settle ' +
          'against until the crew has come back.'
      );
    }

    return;
  }

  // A resolved draft would mean a crew went out on a package the player can still edit
  // underneath them — the offer they answered would not be the offer they were sent on.
  if (offer.phase === OfferPhase.Draft) {
    throw new Error(
      `Contract '${contract.id}' carries a resolution while its offer is still in phase ` +
        `'${offer.phase}'; a resolution belongs to a package that was locked before the crew ` +
        'went out, never to one still being edited.'
    );
  }

  if (contract.status !== ContractStatus.Crewed) {
    throw new Error(
      `Contract '${contract.id}' carries a resolution while its status is ` +
        `'${contract.status}', not '${ContractStatus.Crewed}'; only a filled crew can have gone ` +
        'out and come back.'
    );
  }

  // `contributions.keys() === acceptedBy`, in both directions. The same argument §2.5
  // makes for `commitments`, applied to the sibling field the debrief screen reads:
  // `resolution.contributions.get(hero)` returning `undefined` for a hero who is
  // demonstrably on the crew is not a state any command produces, and a contribution
  // recorded for somebody who never accepted is a number the screen would attribute to
  // a hero who was not there. Amended into §2.5 rather than enforced silently here.
  const contributors = resolution.contributions.keys();
  if (contributors.length !== offer.acceptedBy.size) {
    throw new Error(
      `Contract '${contract.id}' resolution records ${String(contributors.length)} hero ` +
        `contribution(s), but ${String(offer.acceptedBy.size)} hero(es) accepted the offer; a ` +
        'resolution must account for exactly the crew that went out.'
    );
  }

  for (const hero of contributors) {
    if (!offer.acceptedBy.has(hero)) {
      throw new Error(
        `Contract '${contract.id}' resolution records a contribution for ` +
          `hero#${String(hero)}, who did not accept the offer; a resolution must account for ` +
          'exactly the crew that went out.'
      );
    }
  }
}
