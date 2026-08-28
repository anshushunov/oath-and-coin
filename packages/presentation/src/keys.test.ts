import { describe, expect, it } from 'vitest';

import { ACTIONS, OfferPhase, parseContentId } from '@oath-and-coin/simulation';

import {
  ACTION_KEYS,
  FIELD_KEYS,
  FieldKeys,
  OFFER_FIELD_KEYS,
  OFFER_PHASE_KEYS,
  OfferFieldKeys,
  REASON_DIRECTION_KEYS,
  SCREEN_STATE_KEYS,
  SETTLEMENT_ACTION_KEYS,
  SETTLEMENT_CONSEQUENCE_KEYS,
  SETTLEMENT_FIELD_KEYS,
  TREASURY_FIELD_KEYS,
  actionKey,
  contractDisplayNameKey,
  errorKey,
  offerPhaseKey,
  reasonDirectionKey,
  screenStateKey,
  tagKey,
  traitDisplayNameKey,
  waveredKey,
  WAVERED_KEYS
} from './keys.ts';
import { REASON_DIRECTIONS, SCREEN_STATES } from './screen-state.ts';

describe('the keys built from a content id', () => {
  it('splits the id and never shows the colon a player would not read', () => {
    expect(tagKey(parseContentId('target:cult'))).toBe('tag.target.cult');
    expect(contractDisplayNameKey(parseContentId('core:escort_the_caravan'))).toBe(
      'contract.core.escort_the_caravan.name'
    );
    expect(traitDisplayNameKey(parseContentId('core:refuses_deception'))).toBe(
      'trait.core.refuses_deception.name'
    );
  });

  it('keeps the three conventions distinct, so one entity cannot answer for another', () => {
    // A tag and a trait can share a name; the shipped tree has `target:undead` beside
    // `core:fears_undeath`. A single convention for both would let one authored string
    // stand in for the other.
    const id = parseContentId('core:loyal');

    expect(new Set([tagKey(id), contractDisplayNameKey(id), traitDisplayNameKey(id)]).size).toBe(3);
  });
});

describe('the keys built from a closed vocabulary', () => {
  it('names every action the engine can select', () => {
    expect(ACTION_KEYS).toEqual(['action.accept', 'action.decline']);
    expect(ACTION_KEYS).toHaveLength(ACTIONS.length);
  });

  it('names every one of the five screen states', () => {
    expect(SCREEN_STATE_KEYS).toEqual([
      'screen.contract_offer.state.loading',
      'screen.contract_offer.state.empty',
      'screen.contract_offer.state.error',
      'screen.contract_offer.state.incomplete',
      'screen.contract_offer.state.normal'
    ]);
    expect(SCREEN_STATES.map(screenStateKey)).toEqual(SCREEN_STATE_KEYS);
  });

  it('names both reason directions and both wavered values', () => {
    expect(REASON_DIRECTION_KEYS).toEqual([
      'reason.direction.supported',
      'reason.direction.opposed'
    ]);
    expect(REASON_DIRECTIONS.map(reasonDirectionKey)).toEqual(REASON_DIRECTION_KEYS);
    expect(WAVERED_KEYS).toEqual([waveredKey(true), waveredKey(false)]);
  });

  it('turns a stable error code into a key rather than showing the code itself', () => {
    // A stable code is as much a raw identifier as a content id, and TDD §11.1 makes no
    // exception for it.
    expect(errorKey('CONTENT_ROOT_NOT_FOUND')).toBe('error.content_root_not_found');
  });

  it('turns an action id into a key by its one separator', () => {
    expect(actionKey('action:accept')).toBe('action.accept');
  });
});

describe('the field captions', () => {
  it('lists every caption exactly once', () => {
    expect(FIELD_KEYS).toHaveLength(Object.keys(FieldKeys).length);
    expect(new Set(FIELD_KEYS).size).toBe(FIELD_KEYS.length);
  });

  it('names a caption for every value the screen shows bare', () => {
    // The finding this list exists for: `40`, `4`, `3` and three qualitative words
    // stood one under another with nothing saying which was which, and both hashes
    // were green because every text was the right text for its field.
    expect(FIELD_KEYS).toEqual(
      expect.arrayContaining([
        FieldKeys.ContractPatronFee,
        FieldKeys.ContractRequiredCrew,
        FieldKeys.ContractAcceptedCount,
        FieldKeys.HeroGreed,
        FieldKeys.HeroCaution,
        FieldKeys.HeroPride,
        FieldKeys.ReasonStrength
      ])
    );
  });
});

describe('the negotiation captions and phase keys', () => {
  it("names all three offer phases, from the engine's own closed set", () => {
    expect(OFFER_PHASE_KEYS).toEqual([
      'offer.phase.draft',
      'offer.phase.locked',
      'offer.phase.settled'
    ]);
    expect(Object.values(OfferPhase).map(offerPhaseKey)).toEqual(OFFER_PHASE_KEYS);
  });

  it('lists every offer, treasury and settlement caption exactly once', () => {
    for (const group of [OFFER_FIELD_KEYS, TREASURY_FIELD_KEYS, SETTLEMENT_FIELD_KEYS]) {
      expect(new Set(group).size).toBe(group.length);
    }

    // The two facts a settlement shares with the offer rather than repeating: the
    // caption is the same key at both points in the negotiation's lifecycle.
    expect(OFFER_FIELD_KEYS).toContain(OfferFieldKeys.PromisedBonus);
    expect(OFFER_FIELD_KEYS).toContain(OfferFieldKeys.KeyHero);
  });

  it('names every settlement button, including the one for a package that promised nothing', () => {
    expect(SETTLEMENT_ACTION_KEYS).toHaveLength(3);
    expect(new Set(SETTLEMENT_ACTION_KEYS).size).toBe(3);
  });

  it('names what each answer to the promise costs, once each', () => {
    expect(SETTLEMENT_CONSEQUENCE_KEYS).toHaveLength(3);
    expect(new Set(SETTLEMENT_CONSEQUENCE_KEYS).size).toBe(3);
    // The two vocabularies are disjoint: a button says what a player does, a consequence
    // says what it costs, and one key doing both would leave one of the two unsayable.
    expect(
      SETTLEMENT_CONSEQUENCE_KEYS.filter((key) => SETTLEMENT_ACTION_KEYS.includes(key))
    ).toEqual([]);
  });
});

describe('every key this package can produce', () => {
  it('is a dotted lowercase path, never a raw identifier', () => {
    const everyKey = [
      ...ACTION_KEYS,
      ...SCREEN_STATE_KEYS,
      ...REASON_DIRECTION_KEYS,
      ...WAVERED_KEYS,
      ...FIELD_KEYS,
      ...OFFER_PHASE_KEYS,
      ...OFFER_FIELD_KEYS,
      ...TREASURY_FIELD_KEYS,
      ...SETTLEMENT_FIELD_KEYS,
      ...SETTLEMENT_ACTION_KEYS,
      ...SETTLEMENT_CONSEQUENCE_KEYS,
      errorKey('CHECKPOINT_UNKNOWN'),
      tagKey(parseContentId('target:cult')),
      contractDisplayNameKey(parseContentId('core:escort_the_caravan')),
      traitDisplayNameKey(parseContentId('core:refuses_deception'))
    ];

    for (const key of everyKey) {
      // A colon or an uppercase letter here means an identifier reached a catalogue
      // lookup unconverted, which the catalogue then fails to answer at runtime.
      expect(key, key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/u);
    }
  });
});
