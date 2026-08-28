import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildSave,
  readSave,
  restoreDecidedSteps,
  saveChecksum,
  type SaveDescriptor
} from '@oath-and-coin/application';
import {
  RULESET_VERSION,
  createInitialState,
  decodeUtf8OrThrow,
  encodeUtf8
} from '@oath-and-coin/content';
import {
  loadContentSet,
  loadLocaleCatalogue,
  loadUiTextCatalogue
} from '@oath-and-coin/content/node';
import { contractOfferScreenModel, expectedSnapshot } from '@oath-and-coin/presentation';
import {
  ReasonCodes,
  SortedSet,
  compareHeroIds,
  parseContentId,
  proposeContractToHero,
  type CausalTrace,
  type ContentId,
  type GameState
} from '@oath-and-coin/simulation';

/**
 * A reason code off a save file, all the way to the catalogue that has to answer it.
 *
 * This member exists because it is the only one allowed to see both sides of a boundary
 * (see `catalogue.test.ts`), and the hole external review of segment 5 found needs exactly
 * that: the file format is `packages/content`'s, the reader is `packages/application`'s,
 * the screen model is `packages/presentation`'s, and the catalogue is a file on disk none
 * of them may open. The defect lived in the gap between them and was invisible to every
 * one of their own suites.
 *
 * **What was measured.** A legitimate save with one factor's `reasonCode` replaced by
 * `hero.decision.unknown_but_well_shaped` — right namespace, right character class, right
 * length, in no dictionary at all — and honestly re-signed, passed `readSave`, passed step
 * restoration, passed the screen-model factory, and then threw in the strict text
 * catalogue, which has no entry for it. A tampered file that satisfies every format check
 * and turns into a build defect three layers later is a file the format did not validate.
 *
 * `snapshot-codec.test.ts` holds the codec to the closed vocabulary directly, case by
 * case. This one is the claim that matters to a player, made against the real shipped
 * catalogue rather than a fixture: the refusal happens at the file, and the thing that
 * would otherwise have happened downstream really does happen.
 */

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const content = loadContentSet(join(repositoryRoot, 'content'));

/**
 * The two shipped catalogues as the one map a screen resolves against.
 *
 * Merging them is safe to do here and only here: `catalogue.test.ts` next door holds them
 * to declaring no key twice, over the whole of both files, so no entry can be shadowed by
 * the merge order.
 */
const catalogue: ReadonlyMap<string, string> = new Map([
  ...loadLocaleCatalogue(join(repositoryRoot, 'content', 'locale', 'ru.json')).entries(),
  ...loadUiTextCatalogue(join(repositoryRoot, 'ui-text', 'ru.json')).entries()
]);

const CREATED_AT = '2026-08-19T00:00:00.000Z';

/** The shipped campaign with one real decision recorded — so `traces` is not empty and
 * the focused contract carries a response with reasons on it. */
function aDecidedCampaign(): { readonly state: GameState; readonly focused: ContentId } {
  const base = createInitialState(content, 7n, RULESET_VERSION);
  const [heroKey] = base.heroes.keys();
  // Named rather than "the first contract on the board", and the difference has already
  // cost once: this fixture needs a *scored* decision, so it needs a contract the hero it
  // asks is not gated out of. The crypt is that contract for `core:bram`; the second
  // counterbalanced pair (contract-loop UI plan's task 9) put
  // `core:burn_the_plague_barrow` ahead of it in content-id order, and that one carries
  // `target:temple` — which `core:bram` refuses on principle — so a blocked trace has no
  // `positiveFactors[0]` for the tamper below to reach into.
  const contractKey = parseContentId('core:cleanse_the_crypt');
  // `proposeContractToHero` (`DEC-008` Task 11) only lets the offer's key hero answer
  // while the package is a draft — this fixture keys the offer to the one hero it
  // proposes to directly, by hand, rather than through a real `composeOffer` command,
  // so the recorded decision this file's tamper cases need still exists.
  const contract = base.contracts.get(contractKey)!;
  const keyed: GameState = {
    ...base,
    contracts: base.contracts.set(contractKey, {
      ...contract,
      // One seat, so the key hero is the whole crew: this fixture is about reason codes
      // reaching a save, not about staffing the shipped crypt.
      requiredCrew: 1,
      // `invited` moves with `keyHero` (`RESOLUTION_SPEC` §2.5); every contract in
      // these fixtures has one seat, so the key hero is the whole crew.
      offer: {
        ...contract.offer,
        keyHero: heroKey!,
        invited: SortedSet.from(compareHeroIds, [heroKey!])
      }
    })
  };

  const { state } = proposeContractToHero(keyed, {
    commandId: 1,
    heroId: heroKey!,
    contractId: contractKey,
    expectedStateVersion: keyed.metadata.stateVersion
  });

  return { state, focused: contractKey };
}

const { state: campaign, focused } = aDecidedCampaign();
const expectedVersions = {
  rulesetVersion: campaign.metadata.rulesetVersion,
  contentVersion: campaign.metadata.contentVersion
};

const UNKNOWN_CODE = 'hero.decision.unknown_but_well_shaped';

/** The campaign's own texts, resolved the way a screen resolves them. */
function textsFor(state: GameState): readonly string[] {
  const model = contractOfferScreenModel(state, restoreDecidedSteps(state), focused);

  return expectedSnapshot(model, catalogue);
}

/** `state` with `mutate` applied to its one stored trace. */
function withTamperedTrace(
  state: GameState,
  mutate: (trace: CausalTrace) => CausalTrace
): GameState {
  const [traceId] = state.traces.keys();

  return { ...state, traces: state.traces.set(traceId!, mutate(state.traces.get(traceId!)!)) };
}

function unknownFactorCode(trace: CausalTrace): CausalTrace {
  return {
    ...trace,
    positiveFactors: trace.positiveFactors.map((factor, index) =>
      index === 0 ? { ...factor, reasonCode: UNKNOWN_CODE } : factor
    )
  };
}

/** A save built from `state`, with the same tamper applied to the file and the file
 * honestly re-signed — the shape of an edit nothing else in the envelope can notice. */
function aResignedSaveWithTheUnknownCode(): Uint8Array {
  const bytes = buildSave({ state: campaign, focusedContract: focused, createdAt: CREATED_AT });
  const file = JSON.parse(decodeUtf8OrThrow(bytes)) as Record<string, unknown>;
  const snapshot = file.snapshot as {
    traces: { value: { positiveFactors: { reasonCode: string }[] } }[];
  };

  snapshot.traces[0]!.value.positiveFactors[0]!.reasonCode = UNKNOWN_CODE;

  const { checksum: _checksum, ...withoutChecksum } = file;

  return encodeUtf8(
    JSON.stringify({ ...withoutChecksum, checksum: saveChecksum(withoutChecksum) })
  );
}

describe('a reason code that is well shaped and names nothing', () => {
  it('is refused when the save is read, not when the screen tries to say it', () => {
    expect(() => readSave(aResignedSaveWithTheUnknownCode(), expectedVersions)).toThrow(
      /SAVE_MALFORMED/u
    );
    // Названо поле: отказ обязан прийти именно от кода причины, а не от чего-то ещё,
    // что подмена задела заодно.
    expect(() => readSave(aResignedSaveWithTheUnknownCode(), expectedVersions)).toThrow(
      'positiveFactors.0.reasonCode'
    );
  });

  it('and the catalogue really has no answer for it, which is what it would have cost', () => {
    // The other half of the claim, and the half that stops the test above from being a
    // statement about a fixture: the shipped catalogue — both files of it — has no entry
    // for this key, so the screen had nothing to show and could only throw.
    expect(catalogue.get(UNKNOWN_CODE)).toBeUndefined();
    expect(catalogue.get(ReasonCodes.PaymentAttractive)).toBeDefined();
  });

  it('really does kill the screen when it reaches one, so the refusal is not decorative', () => {
    // Measured rather than asserted, and reached around the file on purpose: this is the
    // campaign the tampered save *would* have produced had `readSave` accepted it. The
    // screen model builds without complaint — the defect is not visible there either —
    // and the catalogue lookup is where it lands.
    const doomed = withTamperedTrace(campaign, unknownFactorCode);

    expect(() => textsFor(doomed)).toThrow(UNKNOWN_CODE);
  });
});

describe('the campaign the engine really produced', () => {
  it('reads back and resolves every one of its reason codes against the shipped catalogue', () => {
    // Страж над стражами: без этого «отвергать всё» прошло бы все три проверки выше.
    const bytes = buildSave({ state: campaign, focusedContract: focused, createdAt: CREATED_AT });
    const { state, descriptor } = readSave(bytes, expectedVersions);
    const readBack: SaveDescriptor = descriptor;

    expect(readBack).toEqual({
      createdAt: CREATED_AT,
      logicalTime: campaign.metadata.logicalTime,
      focusedContract: focused
    });

    const texts = textsFor(state);

    expect(texts.length).toBeGreaterThan(0);
    expect(texts).not.toContain('');
  });
});
