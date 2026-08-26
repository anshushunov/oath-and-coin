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
 * **One row of §2.5 is deliberately not here yet: `phase === Settled ⇒ resolution !==
 * null`.** `settleContract` settles a locked, crewed contract today without any
 * resolution existing to require, and fourteen shipped scenarios do exactly that. The
 * rule lands with `resolveContract` — the command that can satisfy it — together with
 * the scenario rewrites that give every settlement a resolution to be settled against.
 * Enforcing it now would make a green tree impossible until then, which is a worse
 * trade than a rule arriving one task late with its absence written down.
 */
export function requireStoredResolutionConsistency(contract: ContractState): void {
  const { resolution, offer } = contract;

  if (resolution === null) {
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
