import { Actions } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { HeroStance, heroOfferRows } from './hero-offer-row.ts';
import { aHeroCard, aResponseLine } from './testing/fixtures.ts';

const card = (definition: string) => aHeroCard({ definition });
const accepted = (heroDefinition: string) =>
  aResponseLine({ heroDefinition, action: Actions.Accept });
const refused = (heroDefinition: string) =>
  aResponseLine({ heroDefinition, action: Actions.Decline });
const blocked = (heroDefinition: string) =>
  aResponseLine({
    heroDefinition,
    action: Actions.Decline,
    blockedByEntity: 'trait:no_hand_on_a_temple',
    blockedByDisplayNameKey: 'trait.no_hand_on_a_temple.name'
  });

describe('heroOfferRows', () => {
  it('сшивает героя с его ответом по определению', () => {
    const rows = heroOfferRows({
      roster: [card('core:bram'), card('core:ilza')],
      responses: [refused('core:ilza'), accepted('core:bram')]
    });

    expect(rows.map((row) => row.hero.definition)).toEqual(['core:ilza', 'core:bram']);
    expect(rows[1]?.response?.action).toBe(Actions.Accept);
  });

  // Опрашиваются только приглашённые (DEC-012, поправка 2026-08-25), так что
  // герой без ответа — обычное состояние экрана, а не дефект данных.
  it('герой без ответа получает строку с пустым ответом, а не исчезает', () => {
    const rows = heroOfferRows({ roster: [card('core:vela')], responses: [] });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.response).toBeNull();
  });

  it('порядок: отказавшиеся, заблокированные, согласившиеся, не ответившие', () => {
    const rows = heroOfferRows({
      roster: [card('core:bram'), card('core:vela'), card('core:ilza'), card('core:mira')],
      responses: [accepted('core:bram'), blocked('core:vela'), refused('core:ilza')]
    });

    expect(rows.map((row) => row.hero.definition)).toEqual([
      'core:ilza',
      'core:vela',
      'core:bram',
      'core:mira'
    ]);
    // The group travels with the row, so the screen colours it without deciding it again.
    expect(rows.map((row) => row.stance)).toEqual([
      HeroStance.Refused,
      HeroStance.Blocked,
      HeroStance.Accepted,
      HeroStance.Unanswered
    ]);
  });

  // Перестановка строк между двумя опросами читается как «кто-то передумал».
  // Внутри группы порядок обязан остаться ростерным, а не зависеть от порядка ответов.
  it('внутри группы держит порядок ростера', () => {
    const rows = heroOfferRows({
      roster: [card('core:bram'), card('core:ilza')],
      responses: [accepted('core:ilza'), accepted('core:bram')]
    });

    expect(rows.map((row) => row.hero.definition)).toEqual(['core:bram', 'core:ilza']);
  });

  // Спека §4.1 называет пустой ростер отдельно: экран без контракта (loading, empty,
  // error) несёт ровно такой, и строк у него быть не должно — не одна пустая.
  // Строка говорит, чей это ответ; два ответа одного героя на одну версию пакета движок
  // не принимает, и проекция не выбирает молча, какой из них показать.
  it('отказывается от двух ответов одного героя', () => {
    expect(() =>
      heroOfferRows({
        roster: [card('core:bram')],
        responses: [accepted('core:bram'), refused('core:bram')]
      })
    ).toThrow(/answers this package twice/u);
  });

  it('пустой ростер даёт пустой список строк', () => {
    expect(heroOfferRows({ roster: [], responses: [] })).toEqual([]);
  });
});
