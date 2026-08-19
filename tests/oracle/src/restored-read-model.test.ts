import { restoreDecidedSteps } from '@oath-and-coin/application';
import { decodeSnapshot, encodeSnapshot } from '@oath-and-coin/content';
import { contractOfferScreenModel, readModelHash } from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import { allCorpusRecords, focusedContractOf, runCorpusRecord } from './corpus.ts';

/**
 * The screen a reloaded campaign draws, measured against the screen the C# original drew
 * — on every corpus entry that reached a state.
 *
 * `save-round-trip.test.ts` (Task 16.2) already shows that a state survives the codec:
 * the artifact hash of a run whose final state went through it is the frozen one. This
 * file asks the other question, the one a player actually sees: after a reload there is no
 * step list any more, only history and traces, and the screen has to be rebuilt out of
 * them. The two are not the same claim — the artifact carries `selectedScore` verbatim,
 * while `restoreDecidedSteps` has to recover it from the trace's factors, and the read
 * model is where that recovered number becomes a visible sentence ("wavered", and which
 * reasons rank above which).
 *
 * Not a circular check: `read_model.sha256` was computed by the original from its own
 * `selectedScore`, years before anything summed a factor list.
 */

describe('the screen a reloaded campaign draws', () => {
  it('восстановленный экран даёт записанный корпусом хеш read model', () => {
    // 50, а не 54: у `screen_error` и `screen_loading` `final_state` и
    // `canonical_sha256` равны null — прогон до состояния там не доходит. Число названо,
    // чтобы молчаливое сжатие набора не выглядело успехом.
    const records = allCorpusRecords().filter((record) => record.final_state !== null);
    expect(records).toHaveLength(50);

    let blockedSeen = 0;
    let scoredSeen = 0;

    for (const record of records) {
      const outcome = runCorpusRecord(record);
      const reloaded = decodeSnapshot(
        JSON.parse(JSON.stringify(encodeSnapshot(outcome.finalState)))
      );

      const steps = restoreDecidedSteps(reloaded);

      for (const step of steps) {
        const decision = step.decision;

        if (decision === null) {
          throw new Error(
            `a step restored from '${record.scenario}'/seed-${record.seed} carries no decision, ` +
              'but every event in the history of a campaign was produced by one'
          );
        }

        // Счёт есть ровно тогда, когда красной линии не было — на решениях, которые
        // корпус действительно записал, а не только на рукотворных. Без этой строки
        // единственным сторожем правила оставался юнит-тест на выдуманной фикстуре:
        // экран блокированного ответа счёта не показывает вовсе, поэтому хеш ниже нуль
        // вместо `null` не видит.
        const blocked = decision.trace.blockedBy.length > 0;
        expect(decision.selectedScore === null).toBe(blocked);

        if (blocked) {
          blockedSeen += 1;
        } else {
          scoredSeen += 1;
        }
      }

      // Поля `focused_contract` в корпусе нет и появиться не может — он заморожен.
      // Ожидаемый фокус берётся из самой read model: это то, что экран показывал.
      const model = contractOfferScreenModel(reloaded, steps, focusedContractOf(record));

      expect(readModelHash(model)).toBe(record.read_model.sha256);
    }

    // Обе стороны правила названы числами: набор, в котором блокированных решений не
    // осталось бы, прошёл бы цикл выше целиком и молча — а именно блокированные решения
    // эта проверка и стережёт.
    expect(blockedSeen).toBe(10);
    expect(scoredSeen).toBe(88);
  });

  it('согласуется с экраном живого прогона на тех же 50 записях', () => {
    // Отдельная проверка, а не следствие: хеш выше сравнивает восстановленный экран с
    // замороженным числом, и если бы обе стороны разошлись с текущим прогоном
    // одинаково, он бы этого не показал. Здесь сравниваются два экрана этой сборки —
    // собранный из шагов прогона и собранный из истории с следами.
    const records = allCorpusRecords().filter((record) => record.final_state !== null);

    for (const record of records) {
      const outcome = runCorpusRecord(record);
      const live = contractOfferScreenModel(outcome.finalState, outcome.steps);
      const reloaded = decodeSnapshot(
        JSON.parse(JSON.stringify(encodeSnapshot(outcome.finalState)))
      );

      expect(
        contractOfferScreenModel(reloaded, restoreDecidedSteps(reloaded), focusedContractOf(record))
      ).toEqual(live);
    }
  });
});
