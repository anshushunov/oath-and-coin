# Спайк: список решений и кадр на сценарии вне корпуса

Дата прогона: 2026-08-23. Ветка `feature/dec-008-negotiation-slice`, база `cfe6b0a`.
Спайк обязателен по `AGENTS.md` §4 и закрывает оба стыка из `NEGOTIATION_SPEC` §8.

**Весь код спайка выброшен.** Под git попадает только эта записка. Единственное, что от
спайка остаётся, — числа ниже и команды, которыми они сняты (`AGENTS.md` §11).

Затраченное время: **15 мин 24 с** от `git status --porcelain > /tmp/spike-before.txt` до
последнего замера (`stat -c '%y' /tmp/spike-before.txt` против `date`). Это время
исполнителя на уже прочитанном коде, а не оценка задач.

---

## Что именно было построено

Временный `pollCrew(state, { commandId, contractId, heroCount, expectedStateVersion })` в
`packages/simulation/src/engine.ts`: опрашивает первых `heroCount` героев ростера по одному
контракту и возвращает **один** `CommandResult` с шестью событиями и шестью решениями.
`CommandResult.decision: DecisionResult | null` заменён на
`decisions: readonly CommandDecision[]`, где `CommandDecision = { heroId, decision }`.

Временный сценарий `scenarios/spike_two.{manifest,commands}.json` — одна команда
`kind: "poll_crew"`, `hero_count: 6`, checkpoint `crew_polled` объявлен **собственным
манифестом сценария**, а не манифестом корпуса.

---

## Замер 1 — форма списка вместо поля

### Сколько мест пришлось тронуть: 17 файлов

Команда, которой список получен (после того как `pnpm typecheck` стал зелёным):

```bash
git status --porcelain
git diff --numstat
```

**Не-тестовые (10 изменённых + 1 новый = 11):**

| Файл | +/− |
|---|---|
| `packages/simulation/src/commands/command-result.ts` | 28/6 |
| `packages/simulation/src/commands/poll-crew.ts` | новый |
| `packages/simulation/src/engine.ts` | 45/2 |
| `packages/simulation/src/index.ts` | 4/1 |
| `packages/content/src/scenarios/scenario-commands.ts` | 11/2 |
| `packages/content/src/scenarios/scenario-runner.ts` | 35/14 |
| `packages/content/src/scenarios/determinism-artifact.ts` | 6/2 |
| `packages/presentation/src/contract-offer-screen-model.ts` | 6/0 |
| `packages/presentation/src/contract-offer-screen-model-factory.ts` | 10/3 |
| `packages/presentation/src/testing/fixtures.ts` | 1/2 |
| `packages/application/src/save/restore-steps.ts` | 3/2 |

**Тестовые (6):** `packages/simulation/src/engine.test.ts`,
`packages/content/src/scenarios/determinism-artifact.test.ts`,
`packages/content/src/scenarios/load-sequence.test.ts`,
`packages/presentation/src/contract-offer-screen-model-factory.test.ts`,
`packages/application/src/save/restore-steps.test.ts`,
`tests/oracle/src/restored-read-model.test.ts`.

Список тестовых получен компилятором, а не глазами:

```bash
pnpm typecheck 2>&1 | rg -o "^[^ ].*?\(\d+,\d+\): error TS\d+" | sed 's/(.*//' | sort -u
```

После правки одних только не-тестовых файлов компилятор назвал ровно эти 7 файлов
(`packages/presentation/src/testing/fixtures.ts` попал в не-тестовые: это исходник, а не
тест). Второй волны ошибок за первой не оказалось: после починки `pnpm typecheck` зелёный
(10.3 с, `time pnpm typecheck`).

### Чего трогать НЕ пришлось

- `packages/application/src/session.ts` — **0 правок**;
- `packages/application/src/session-controller.ts` — **0 правок**;
- весь `apps/web/**` — **0 правок**, включая
  `screens/contract-offer/contract-offer-screen.tsx`, `world/scene-model.ts`,
  `content-source.ts`, `run-request.ts`.

Причина в том, что и сессия, и React-экран читают уже готовую `ContractOfferScreenModel`,
а `ResponseLine` формы не меняет. Список схлопывается в `responses` внутри фабрики
(`contract-offer-screen-model-factory.ts`: `filter` по шагам стал `flatMap` по
`step.decisions`), и выше фабрики о нём никто не знает.

### Что список действительно доходит до модели — доказано, а не заявлено

Временный пробник прогнал два сценария через `loadAndRunScenario` → `screenFor` →
`readModelHash`:

```
screen_normal | steps: 6 | decisions in step 0: 1 | screen state: Normal | responses: 6
              | read_model_hash: 4695c6e2b54307fa2ed32af29861059223953c019b4a54234b26044cf01662cd
spike_two     | steps: 1 | decisions in step 0: 6 | screen state: Normal | responses: 6
              | read_model_hash: 4695c6e2b54307fa2ed32af29861059223953c019b4a54234b26044cf01662cd
```

Шесть решений из **одной** команды дают тот же read-model хеш, что шесть команд по одному
решению. То есть форма списка не сдвигает ни проекцию экрана, ни её хеш — утверждение
«это просто список вместо поля» на этом стыке подтверждается.

### Три вещи, которые сломались — и одна из них не чинится данными

**(а) Имя `HeroDecision` занято.** `packages/simulation/src/decisions/contract-decision-rule.ts:30`
уже экспортирует `HeroDecision = { result, ordinalsConsumed }`. Пара «герой + решение»
внутри `CommandResult` вынуждена называться иначе (в спайке — `CommandDecision`).

**(б) `exactOptionalPropertyTypes: true`.** Необязательные поля новой команды в
`ScenarioCommand` требуют явного `?: T | undefined`; `?: T` не компилируется.

**(в) Канонический артефакт поехал, и корпус этого пережить не может.**
`determinism-artifact.ts:describeStep` писал `hero_definition` и `decision` плоскими
полями шага; список превращает их в `decisions: [...]`. Проверено напрямую:

```bash
node --experimental-strip-types tools/scenario-runner/src/cli.ts run --scenario gate0 --output artifacts/gate0-fresh.json
# fresh step keys : applied,command,decisions,events,rejection_code
# commit step keys: applied,command,decision,events,hero_definition,rejection_code
# identical: false
```

Значит `ARTIFACT_VERSION` обязан шагнуть с 3 на 4, а все 24 `scenarios/*.canonical.json`
— пересобраться. Это Task 20 и это ожидаемо.

**Не ожидаемо другое.** `pnpm test` (1167 тестов, 8.75 с) и `pnpm test:scenario` дают
**ровно 2 падения**, оба в `tests/oracle/src/save-round-trip.test.ts:62` и `:81`:

```
Expected: "28952ae6fa4d510c28f7532229e7f32c2359344e8ec44f0abbb346f96ba7ef51"
Received: "7f30bccb374f8bae9019d6a1f090eb4d8c4633c9e32d4effbcfdbc575f6862b4"
```

Этот тест сравнивает `artifactHash(...)` с `record.canonical_sha256` **замороженного
корпуса** (`tests/oracle/src/corpus.ts:34` → `migration/oracle/v1`). Размер корпуса:

```bash
fd -e json --glob 'seed-*.json' migration/oracle/v1/scenarios | wc -l   # 54 записи
```

27 сценариев в его манифесте. Корпус пересобрать нельзя по определению. Значит после Task 5 эти два теста
зелёными данными не станут никогда — их придётся либо снять, либо переписать на
«артефакт версии 4 сравнивается с записью версии 3 только по полям, которые не двигались».
**Task 5 этого решения не содержит, а без него его сборка красная.**

Отдельная находка, прямо отвечающая на Step 1 Task 20: **`scenarios/*.canonical.json`
сегодня не сравнивает с прогоном никто.** 1165 из 1167 тестов зелёные, при том что все 24
слепка устарели по форме. Единственные, кто поймал сдвиг артефакта, — два теста
`save-round-trip` и e2e-утверждение `canonical_hash` (см. Замер 2).

---

## Замер 2 — кадр на сценарии, которого нет в корпусе

### Наивная попытка: харнесс отказывает сразу

Добавление `spike_two` в список `SCENARIOS` теста `tests/e2e/contract-offer.spec.ts`
без прочих правок:

```bash
pnpm build && pnpm test:e2e tests/e2e/contract-offer.spec.ts
```

```
Error: The corpus manifest must record 'spike_two' with exactly one checkpoint;
a screen scenario stops at the state it is named after.
  at checkpointOf (tests/e2e/contract-offer.spec.ts:370)
```

Это Замер 2 в его первой форме: **checkpoint — не единственная привязка**. Даже получив
имя checkpoint'а, тест идёт за записью
`migration/oracle/v1/scenarios/<сценарий>/<checkpoint>/seed-424242.json` и берёт оттуда
четыре разных утверждения.

### Что именно пришлось поменять

**Один файл — `tests/e2e/contract-offer.spec.ts`, 88 вставок / 38 удалений, 17 ханков
(`git diff --numstat`, `git diff -U0 … | rg -c "^@@"`), шесть смысловых правок:**

1. `checkpointOf` — читает `scenarios/<сценарий>.manifest.json` вместо манифеста корпуса;
2. `expectedScreenStateOf` — оттуда же;
3. новый локальный интерфейс `ScenarioManifestFile` (`expected_screen_state`,
   `checkpoints[].name` — в собственном манифесте поле называется `name`, в корпусном
   `checkpoint`);
4. `entry` (запись корпуса) стал `OracleEntry | null`, и **каждое** его использование
   обросло ветвлением;
5. `expectedReadModelHash` — из корпуса, когда он есть, иначе
   `readModelHash(expectedModel)` в этом же процессе;
6. `content_version` и `canonical_hash` — из корпуса, когда он есть, иначе
   `result.outcome.finalState.metadata.contentVersion` и `artifactHash(result.outcome)`
   в этом же процессе.

Плюс два новых файла сценария (`scenarios/spike_two.manifest.json`,
`scenarios/spike_two.commands.json`). **Больше ничего не потребовалось:**
`playwright.config.ts`, `tests/e2e/layout.ts` и бандл `apps/web` — 0 правок. Последнее не
случайность: `apps/web/src/content-source.ts:72` уже глобит `scenarios/**/*` целиком, так
что новый сценарий попадает в браузер сам.

### Кадр снялся

```bash
pnpm build && pnpm test:e2e tests/e2e/contract-offer.spec.ts
# 4 passed, 2 failed  — spike_two в числе прошедших
```

`ls -la artifacts/browser-evidence/spike_two/` показал три файла: `screenshot.png`
(57 804 Б), `events.jsonl` (0 Б — ни одной ошибки), `report.json` (769 Б). Каталог удалён
вместе с остальным кодом спайка — его никакой прогон больше не пересоздаёт. Содержимое
`report.json` целиком:

```json
{ "scenario": "spike_two", "checkpoint": "crew_polled", "screen_state": "Normal",
  "read_model_hash": "4695c6e2b54307fa2ed32af29861059223953c019b4a54234b26044cf01662cd",
  "rendered_ui_hash": "b648ed360214fbccaff5bad181d8245a2e2afe56a7cee3a5736ace79bf9c6745",
  "canonical_hash": "9b6d9c007644e2cd51e1db822d365af4b3c51ed8f141ac6060d47f5d3c8a8852",
  "texts": 175, "frame": { "shapes": 7, "distinctColors": 4 }, "events": 0 }
```

`canonical_hash` совпадает с тем, что печатает CLI на том же сценарии, а
`read_model_hash` — с `screen_normal`. Кадр не пустой: 7 фигур, 4 различимых цвета.

Два оставшихся падения — **не** про spike_two, а `screen_incomplete` и `screen_normal` на
строке `expect(reported.canonical_hash).toBe(entry.canonical_sha256)`. Их уронил Замер 1
(сдвиг формы артефакта), а не отвязка харнесса.

### Чего отвязка стоит по существу, а не по строкам

Для сценария вне корпуса три утверждения перестают быть оракулом и становятся
самопроверкой одного процесса: `read_model_hash`, `content_version`, `canonical_hash` —
все три теперь считаются тем же кодом, который исполняет страница. Это ослабление
надо назвать вслух, потому что вся преамбула этого файла построена на обратном.

Что остаётся **по-настоящему двусторонним** и на сценарии вне корпуса:

- `renderedTexts` против `expectedSnapshot(expectedModel, catalogue)` — DOM обходится в
  браузере, ожидание строится в Node, ни одна половина не видит другую;
- `screen_state` против собственного манифеста сценария — документ, написанный до прогона;
- достижимость (`layout`) и кадр (`frame.shapes`, `distinctColors`) — измерения, а не
  сравнения с записью.

То есть кадр на новом сценарии остаётся доказательством того, что модель дошла до дерева
контролов и что-то нарисовала. Он перестаёт быть доказательством того, что арифметика
совпала с записанной раньше. Для фазовых сценариев `DEC-008` второго и не существует.

Проверено попутно и снимает ложный риск: пять состояний экрана остаются пятью
(`NEGOTIATION_SPEC` §5.1 — «фаза — поле модели, а не состояние экрана»), поэтому
`KNOWN_SCREEN_STATES` в `packages/content/src/scenarios/scenario-manifest.ts:43` трогать
не придётся. Обратная сторона: все четыре фазовых сценария Task 21 объявят одно и то же
`expected_screen_state`, и различать фазы будет только сравнение текстов.

---

## Что это значит для границ Tasks 5, 16, 17, 21

**Task 5 — перекроить.** Список файлов в плане неверен в обе стороны.

- Лишние: `packages/application/src/session.ts` и `session-controller.ts` — 0 правок.
- Недостающие: `packages/simulation/src/index.ts` (бочка экспортов),
  `packages/presentation/src/testing/fixtures.ts` (исходник, строящий `DecidedStep`),
  `tests/oracle/src/restored-read-model.test.ts`.
- Недостающее решение, а не файл: `tests/oracle/src/save-round-trip.test.ts` падает и
  чинится не данными. Task 5 обязан назвать, что с ним делают, иначе задача завершается
  красной сборкой, а Task 20 её не спасёт — корпус заморожен.
- `packages/content/src/scenarios/scenario-commands.ts` в списке Task 5 отсутствует
  обоснованно (схема команд — Task 20), но тогда Task 5 не может прогнать список решений
  через сценарий и обязана доказывать его юнит-тестом на `pollCrew`.

**Task 16 — подтверждается, и дешевле, чем в плане.** Контроллер не меняет формы из-за
списка вообще; правка там — это только новые команды, а не новая форма результата.
Утверждение плана `it('returns every decision a crew poll produced')` проверяемо на
контроллере как есть.

**Task 17 — подтверждается, и границу можно сузить.** `apps/web/**` не заметил списка
решений: 0 правок. Всё, что там остаётся, — новые поля модели из §5.1
(`offer`, `treasury`, `promiseTerms`, `settlement`), и это ровно то, что Task 17 и
описывает. Списка решений в её объёме нет.

**Task 21 — перекроить, но не потому, что дорого.** Отвязка checkpoint'а — это Step 2
плана, и она действительно маленькая. Но Step 2 говорит только про checkpoint, а корпус
держит тест ещё в трёх местах, и одно из них (`canonical_hash` для пяти существующих
сценариев) краснеет сразу после Task 5 и к отвязке отношения не имеет. Task 21 обязана
включать:

- решение по `canonical_hash` на корпусных сценариях после сдвига `ARTIFACT_VERSION`
  — то же решение, что и в Task 5 для `save-round-trip`, и лучше принять его один раз;
- явную запись, что для фазовых сценариев read-model-хеш перестаёт быть оракулом.

**Чего этот спайк НЕ измерил — и это ограничение, а не придирка.** Временный `pollCrew`
собран из шести вызовов `proposeContractToHero` и тратит **шесть** идентификаторов команд
(`commandId + index`) на один опрос. Настоящая команда среза, скорее всего, обязана быть
одной командой с одним `commandId` — иначе `appliedCommandIds` и защита от повтора
считают опрос шестью разными действиями. Спайк отвечает на вопрос «доходит ли список до
модели» и **не** отвечает на вопрос «как опрос ведёт себя при повторе и при отказе
посередине». Это остаётся ценой Task 5 и должно быть в её падающих тестах.

**Task 20 — попутная находка.** Его Step 1 спрашивает, сравнивает ли кто-нибудь
`*.canonical.json` с прогоном. Ответ измерен: **нет, никто.** Пересборка слепков без
этого теста — запись мёртвых байтов, ровно как Step 1 и предупреждает.

---

## Гейт решения (Step 7) — вынесено владельцу

**Отвязка харнесса от корпуса НЕ дороже одной задачи.** Один файл, 88/38, шесть смысловых
правок, кадр снялся с первого зелёного прогона. Task 21 в её нынешних границах справляется.

Дороже одной задачи оказалось **не то**, чего опасался §8. Дорого стоит сдвиг
канонического артефакта: он ломает два теста, которые сравниваются с замороженным
корпусом, и чинится только решением о том, чем заменить это сравнение. Это решение
принадлежит владельцу и не должно раствориться ни в Task 5, ни в Task 20, ни в Task 21 —
сейчас оно не записано ни в одной из трёх.
