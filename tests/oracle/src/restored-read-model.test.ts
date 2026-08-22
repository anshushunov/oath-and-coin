import { restoreDecidedSteps } from '@oath-and-coin/application';
import { decodeSnapshot, encodeSnapshot } from '@oath-and-coin/content';
import { contractOfferScreenModel } from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import { allCorpusRecords, focusedContractOf, runCorpusRecord } from './corpus.ts';

/**
 * The screen a reloaded campaign draws, measured against the screen a continuous run of
 * the same commands draws — on every corpus entry that reached a state.
 *
 * `save-round-trip.test.ts` (Task 16.2) already shows that a state survives the codec.
 * This file asks the other question, the one a player actually sees: after a reload there
 * is no step list any more, only history and traces, and the screen has to be rebuilt out
 * of them. The two are not the same claim — the artifact carries `selectedScore` verbatim,
 * while `restoreDecidedSteps` has to recover it from the trace's factors, and the read
 * model is where that recovered number becomes a visible sentence ("wavered", and which
 * reasons rank above which).
 *
 * **The comparison below is against a live, freshly computed screen, not against the
 * corpus's own frozen `read_model.sha256`.** It was against that frozen hash once;
 * `DEC-008` Task 3 renamed the contract's fee field in the read-model projection
 * (`describeContract` in `contract-offer-screen-model-factory.ts`), which moved every
 * byte that hash was taken over, and the corpus that recorded it is frozen and cannot be
 * rewritten. That frozen comparison was already a remnant of the byte-for-byte parity
 * `ADR-013` retired — it compared this build with itself, not with an independent
 * implementation — so what is checked here now is the same claim stated the other way:
 * a reloaded screen agrees with a screen that never stopped. Task 20 restores an external
 * comparison, once `scenarios/*.canonical.json` is rebuilt under the new field name and
 * can again supply an expected value this build did not itself compute.
 *
 * **One test, not two.** This file used to carry a second `it`, comparing the same two
 * screens a second time over the same 50 records — a distinct claim while the first test
 * compared against the frozen hash, and a duplicate of the first the moment that hash
 * comparison came out: both loops ended up asserting the identical equality over the
 * identical records. Merged into the one loop below rather than left as two, so the file
 * still makes exactly the claims it can back and not one repeated for no reason. The
 * asymmetry the second test carried is kept: `live` omits `focusedContract` where `model`
 * states it outright, so the comparison still holds the fallback resolution (the first
 * applied contract, or the lexicographically-first with nothing applied yet) to the same
 * answer as the explicit one — `contractOfferScreenModel`'s own comment names this as
 * degenerate on the corpus, and this is what continues to measure that.
 */

describe('the screen a reloaded campaign draws', () => {
  it('восстановленный экран совпадает с экраном непрерывного прогона на тех же записях', () => {
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
        // экран блокированного ответа счёта не показывает вовсе, поэтому сравнение
        // экранов ниже нуль вместо `null` не видит.
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
      // `live` не называет его вовсе — так сравнение заодно проверяет, что запасной
      // выбор (первый применённый контракт, а до этого лексикографически первый)
      // на этом корпусе совпадает с явным.
      const model = contractOfferScreenModel(reloaded, steps, focusedContractOf(record));
      const live = contractOfferScreenModel(outcome.finalState, outcome.steps);

      expect(model).toEqual(live);
    }

    // Обе стороны правила названы числами: набор, в котором блокированных решений не
    // осталось бы, прошёл бы цикл выше целиком и молча — а именно блокированные решения
    // эта проверка и стережёт.
    expect(blockedSeen).toBe(10);
    expect(scoredSeen).toBe(88);
  });
});
