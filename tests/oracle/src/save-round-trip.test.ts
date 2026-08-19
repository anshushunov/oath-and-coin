import {
  RULESET_VERSION,
  applyScenarioCommands,
  artifactHash,
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
  it('продолжение с загруженного состояния даёт замороженное финальное состояние', () => {
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

    // Шаги префикса и продолжения склеены в список, который дал бы целый прогон,
    // и сверены с замороженным числом корпуса — не с текущей сборкой самой
    // собой (как было раньше), и не только с финальным состоянием: непроверенным
    // не остаётся ничего из того, что решил, скольким событиям привёл к и как
    // объяснил продолженный прогон.
    expect(
      artifactHash({
        steps: [...prefix.steps, ...continued.steps],
        finalState: continued.finalState
      })
    ).toBe(record.canonical_sha256);
  });

  it('круг через сохранение сохраняет хеш артефакта на записях, у которых есть состояние', () => {
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

      // Если кодек потерял поле, которое несёт артефакт, замороженное число
      // разойдётся. Это страж от расхождения двух проекций — вместо обещания,
      // что они не разойдутся.
      expect(artifactHash({ ...outcome, finalState: reloaded })).toBe(record.canonical_sha256);
      expect(reloaded).toEqual(outcome.finalState);
    }
  });
});
