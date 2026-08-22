import {
  RULESET_VERSION,
  applyScenarioCommands,
  createInitialState,
  decodeSnapshot,
  encodeSnapshot
} from '@oath-and-coin/content';
import { describe, expect, it } from 'vitest';

import { allCorpusRecords, corpusRecord, inputsOf, runCorpusRecord } from './corpus.ts';

/**
 * A run continues from a state that came back from a save — the half of the round trip
 * `snapshot-codec.test.ts` (Task 16.1) does not cover, because that file never runs a
 * scenario's own commands against a decoded state. The frozen corpus has no
 * "save at k, finish at m" pair recorded (§ "Что корпус содержит и чего не содержит" of
 * the brief): every one of its 27 scenarios has exactly one checkpoint. A command prefix
 * stands in for it here — replaying the first half, round-tripping through the codec,
 * then replaying the rest and comparing against a whole, uninterrupted run of the same
 * commands.
 */

describe('continuing a run from a state that came back from a save', () => {
  it('продолжение с загруженного состояния даёт тот же результат, что несломанный прогон', () => {
    const record = corpusRecord('mixed_gate_then_decisions', 7n);
    const { content, commands, seed } = inputsOf(record);

    // Не `commands.length / 2`: у mixed_gate_then_decisions/seed-7 это дало бы
    // k = 1, а там `draws.per_step[0].ordinal_after` в корпусе — "0". Счётчик
    // розыгрышей в точке сохранения уже нулевой и без порчи, так что обнуление
    // `nextDecisionOrdinal` кодеком там ненаблюдаемо — мутант шага 7 такую
    // проверку не красит. `commands.length - 1` останавливается после второй
    // команды, где `draws.per_step[1].ordinal_after` — "1".
    const k = commands.length - 1;
    expect(k).toBeGreaterThan(0);

    const prefix = applyScenarioCommands(
      createInitialState(content, seed, RULESET_VERSION),
      commands.slice(0, k)
    );

    // Страж от слепого k: если фикстура сменится и точка сохранения снова
    // окажется там, где ничего не разыграно, эта проверка укажет на это прямо,
    // а не оставит мутанта на счётчик розыгрышей незамеченным молча.
    expect(prefix.finalState.metadata.nextDecisionOrdinal).toBeGreaterThan(0n);

    const reloaded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(prefix.finalState))));

    const continued = applyScenarioCommands(reloaded, commands.slice(k));

    // Раньше здесь сверялись шаги префикса и продолжения, склеенные в список,
    // который дал бы целый прогон, с замороженным числом корпуса
    // (`record.canonical_sha256`). DEC-008 Task 3 переименовал денежное поле
    // контракта — это подвинуло байты канонического артефакта, и сравнение с
    // числом корпуса покраснело бы навсегда: корпус заморожен, переписывать
    // его нельзя. Сама проверка была уже снятым паритетом с C#-сборкой —
    // `ADR-013` убрал побайтовое сравнение с чужой реализацией и оставил здесь
    // сравнение сборки с собой же. Раз так, сравниваем напрямую и по тем же
    // двум составляющим, что нёс снятый хеш — что продолженный прогон решил
    // (список шагов) и каким состоянием он закончил, — а не только по
    // финальному состоянию: список шагов несёт то, что каждый шаг решил,
    // скольким событиям привёл и как объяснил решение, и ничего из этого
    // сравнение одного финального состояния не видит. Это то самое сравнение,
    // которое describe-комментарий этого файла обещает словами "comparing
    // against a whole, uninterrupted run of the same commands". Task 20
    // вернёт этой проверке силу внешнего эталона: пересобранные
    // `scenarios/*.canonical.json` дадут ожидаемое значение не из этой же
    // сборки, а из отдельно пересчитанного слепка.
    const whole = runCorpusRecord(record);

    expect([...prefix.steps, ...continued.steps]).toEqual(whole.steps);
    expect(continued.finalState).toEqual(whole.finalState);
  });

  it('круг через сохранение сохраняет состояние на записях, у которых оно есть', () => {
    // 50, а не 54: у `screen_error` и `screen_loading` `final_state` и
    // `canonical_sha256` равны null — прогон до состояния там не доходит.
    // Число проверяется, чтобы молчаливое сжатие набора не выглядело успехом.
    const records = allCorpusRecords().filter((r) => r.final_state !== null);
    expect(records).toHaveLength(50);

    for (const record of records) {
      const outcome = runCorpusRecord(record);
      const reloaded = decodeSnapshot(
        JSON.parse(JSON.stringify(encodeSnapshot(outcome.finalState)))
      );

      // Раньше здесь ещё сверялся `artifactHash({ ...outcome, finalState: reloaded })`
      // с замороженным `record.canonical_sha256`. DEC-008 Task 3 переименовал
      // денежное поле контракта, что подвинуло байты канонического артефакта —
      // и это сравнение с частью корпуса, который заморожен и не переписывается,
      // покраснело бы навсегда. Это был остаток паритета с C#-сборкой, который
      // `ADR-013` уже снял: сравнение с `canonical_sha256` здесь сверяло не два
      // независимых источника, а эту сборку с собой же. Круг через сохранение
      // по-прежнему проверяется — ниже, напрямую, без хеша между двумя
      // сторонами одной и той же сборки. Task 20 вернёт внешний эталон:
      // пересобранные `scenarios/*.canonical.json` станут источником ожидаемого
      // значения, которое эта сборка не вычисляет сама.
      expect(reloaded).toEqual(outcome.finalState);
    }
  });
});
