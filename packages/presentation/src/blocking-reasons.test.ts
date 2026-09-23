import { Actions, REASON_CODES, ReasonCodes } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { BlockerKeys } from './keys.ts';
import { LEVER_OF_REASON, blockingReasons } from './blocking-reasons.ts';
import { QualitativeGrade } from './qualitative-scale.ts';
import { OfferLeverId } from './refused-lever.ts';
import { ReasonDirection } from './screen-state.ts';
import { aHeroCard, aResponseLine } from './testing/fixtures.ts';
import type { ReasonLine } from './contract-offer-screen-model.ts';

const hero = (definition: string) =>
  aHeroCard({ definition, displayNameKey: `hero.${definition.replace(':', '_')}.name` });

const reason = (
  reasonCode: string,
  direction: ReasonDirection = ReasonDirection.Supported
): ReasonLine => ({
  reasonCode,
  sourceEntity: 'core:escort_the_caravan',
  strength: QualitativeGrade.Moderate,
  sourceDisplayNameKey: null,
  direction
});

const refusedBecause = (heroDefinition: string, reasons: readonly ReasonLine[]) =>
  aResponseLine({
    heroDefinition,
    heroDisplayNameKey: `hero.${heroDefinition.replace(':', '_')}.name`,
    action: Actions.Decline,
    reasons
  });

const acceptedBecause = (heroDefinition: string, reasons: readonly ReasonLine[]) =>
  aResponseLine({
    heroDefinition,
    heroDisplayNameKey: `hero.${heroDefinition.replace(':', '_')}.name`,
    action: Actions.Accept,
    reasons
  });

const blockedByPrinciple = (heroDefinition: string) =>
  aResponseLine({
    heroDefinition,
    heroDisplayNameKey: `hero.${heroDefinition.replace(':', '_')}.name`,
    action: Actions.Decline,
    blockedByEntity: 'core:refuses_deception',
    blockedByDisplayNameKey: 'trait.core.refuses_deception.name'
  });

describe('LEVER_OF_REASON', () => {
  // Главный тест задачи: он краснеет, когда в движке появится четырнадцатый код, а
  // таблица о нём не узнает. Перебор по словарю движка целиком (`REASON_CODES`, 13), а не
  // по `FACTOR_REASON_CODES` (11): принцип и tie-break — тоже коды, которые несёт ответ.
  it('каждый код причины назван в таблице рычагов', () => {
    for (const code of REASON_CODES) {
      expect(Object.hasOwn(LEVER_OF_REASON, code), code).toBe(true);
    }
  });

  // Без него таблица может нести мёртвую строку после того, как код из движка убрали.
  it('таблица не называет кодов, которых нет в движке', () => {
    expect(Object.keys(LEVER_OF_REASON).sort()).toEqual([...REASON_CODES].sort());
  });

  // Решение владельца от 2026-09-20 (DEC-019): риск не «не лечится», а перевешивается.
  it('риск перевешивается авансом и стоит у рычага условий', () => {
    expect(LEVER_OF_REASON[ReasonCodes.RiskTooHigh]).toEqual({
      leverId: OfferLeverId.Terms,
      remedyKey: BlockerKeys.OutweighedByAdvance
    });
  });

  it('tie-break в свод не попадает', () => {
    expect(LEVER_OF_REASON[ReasonCodes.NoReasonToRefuse]).toBeNull();
  });
});

describe('blockingReasons', () => {
  it('довод «за» не попадает в свод, даже будучи сильнейшим', () => {
    const reasons = blockingReasons({
      roster: [hero('core:ilza')],
      responses: [
        refusedBecause('core:ilza', [
          reason(ReasonCodes.RiskTooHigh),
          reason(ReasonCodes.PaymentAttractive, ReasonDirection.Opposed)
        ])
      ]
    });

    expect(reasons.map((line) => line.reasonCode)).toEqual([ReasonCodes.RiskTooHigh]);
  });

  it('причины согласившегося в свод не попадают вовсе', () => {
    const reasons = blockingReasons({
      roster: [hero('core:bram')],
      responses: [
        acceptedBecause('core:bram', [
          reason(ReasonCodes.PaymentAttractive),
          reason(ReasonCodes.RiskTooHigh, ReasonDirection.Opposed)
        ])
      ]
    });

    expect(reasons).toEqual([]);
  });

  it('одна причина у двоих — одна строка с двумя именами', () => {
    const reasons = blockingReasons({
      roster: [hero('core:bram'), hero('core:ilza')],
      responses: [
        refusedBecause('core:ilza', [reason(ReasonCodes.RiskTooHigh)]),
        refusedBecause('core:bram', [
          reason(ReasonCodes.RiskTooHigh),
          reason(ReasonCodes.PersonalAversion)
        ])
      ]
    });

    expect(reasons).toEqual([
      {
        reasonCode: ReasonCodes.RiskTooHigh,
        leverId: OfferLeverId.Terms,
        remedyKey: BlockerKeys.OutweighedByAdvance,
        // Ростерный порядок, а не порядок ответов: Брам в ростере первым.
        heroDisplayNameKeys: ['hero.core_bram.name', 'hero.core_ilza.name']
      },
      {
        reasonCode: ReasonCodes.PersonalAversion,
        leverId: OfferLeverId.Terms,
        remedyKey: BlockerKeys.Method,
        heroDisplayNameKeys: ['hero.core_bram.name']
      }
    ]);
  });

  // Две неприязни одного героя (к двум тегам) — одна причина, и имя в строке одно.
  it('один герой называется в строке один раз', () => {
    const reasons = blockingReasons({
      roster: [hero('core:vela')],
      responses: [
        refusedBecause('core:vela', [
          reason(ReasonCodes.PersonalAversion),
          reason(ReasonCodes.PersonalAversion)
        ])
      ]
    });

    expect(reasons[0]?.heroDisplayNameKeys).toEqual(['hero.core_vela.name']);
  });

  it('принципы — отдельной строкой в конце, без рычага', () => {
    const reasons = blockingReasons({
      roster: [hero('core:mira'), hero('core:vela'), hero('core:ilza')],
      responses: [
        blockedByPrinciple('core:mira'),
        refusedBecause('core:ilza', [reason(ReasonCodes.WillNotWorkWith)]),
        blockedByPrinciple('core:vela')
      ]
    });

    expect(reasons).toEqual([
      {
        reasonCode: ReasonCodes.WillNotWorkWith,
        leverId: OfferLeverId.Crew,
        remedyKey: BlockerKeys.Crew,
        heroDisplayNameKeys: ['hero.core_ilza.name']
      },
      {
        reasonCode: ReasonCodes.PrincipleForbids,
        leverId: null,
        remedyKey: BlockerKeys.Principle,
        heroDisplayNameKeys: ['hero.core_mira.name', 'hero.core_vela.name']
      }
    ]);
  });

  it('репутация и настроение этим пакетом не меняются', () => {
    const reasons = blockingReasons({
      roster: [hero('core:ilza')],
      responses: [
        refusedBecause('core:ilza', [
          reason(ReasonCodes.GuildBrokeItsWord),
          reason(ReasonCodes.UnpredictableMood)
        ])
      ]
    });

    expect(reasons.map(({ leverId, remedyKey }) => ({ leverId, remedyKey }))).toEqual([
      { leverId: null, remedyKey: BlockerKeys.Reputation },
      { leverId: null, remedyKey: BlockerKeys.NotThisPackage }
    ]);
  });

  it('никто не ответил — мешать нечему', () => {
    expect(blockingReasons({ roster: [hero('core:bram')], responses: [] })).toEqual([]);
  });

  // Словарь закрыт, и сохранение проверяет коды на входе (`vocabulary.test.ts`). Код, которого
  // таблица не знает, — дефект выше по течению, и свод не выбирает ему рычаг молча.
  it('отказывается от кода, которого нет в словаре', () => {
    expect(() =>
      blockingReasons({
        roster: [hero('core:ilza')],
        responses: [refusedBecause('core:ilza', [reason('hero.decision.made_up')])]
      })
    ).toThrow(/hero\.decision\.made_up/u);
  });
});
