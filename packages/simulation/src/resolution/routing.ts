import type { ContractState } from '../state/contract-state.ts';

import { battleResolver } from './battle-resolver.ts';
import { draftResolution, type ContractResolver } from './contract-resolver.ts';

/**
 * Which resolver settles this contract (`ADR-014` §1, `ADR-016` §5).
 *
 * **One resolver per contract, chosen before the crew is sent, and the choice is data**:
 * a contract whose author wrote a battle plan goes to the battle, and one without goes to
 * the abstract resolver — a delegated job the player never watches. There is no third
 * answer and no moment at which both are authoritative, which is what `ADR-014` §1 means
 * by "авторитетна ровно одна реализация на контракт".
 *
 * Its own function rather than an `if` inside the command, because the batch runner and the
 * forecast both have to route the same way, and three copies of one rule is three places it
 * can be got wrong.
 */
export function resolverFor(contract: ContractState): ContractResolver {
  return contract.battle === null ? draftResolution : battleResolver;
}

/** Whether this contract is settled by a fight — the same question, read as a predicate. */
export function goesToBattle(contract: ContractState): boolean {
  return contract.battle !== null;
}
