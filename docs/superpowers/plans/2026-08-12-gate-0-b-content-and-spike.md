# Gate 0 / B — Контент и двухгеройный спайк

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simulation spike из `TDD` §23 — два героя, один контракт, **два разных автономных решения** с causal trace, воспроизводимых по seed одной headless-командой.

**Architecture:** Отдельная сборка `OathAndCoin.Content` держит чтение файлов, валидацию и сборку начального состояния; `OathAndCoin.Simulation` остаётся чистой. Движок stateless: случайность выводится из `GameState.Metadata.NextDecisionOrdinal`, поэтому одно и то же состояние с одной и той же командой всегда даёт один и тот же результат.

**Tech Stack:** .NET 8.0.424, C# 12, xUnit, `System.Text.Json`, `JsonSchema.Net` (версия пинуется точно).

## Global Constraints

Наследуются из плана A целиком. Дополнительно:

- **`OathAndCoin.Simulation` по-прежнему не касается файловой системы.** Всё чтение — в `OathAndCoin.Content`. Обратной ссылки нет.
- **Границы диапазонов заданы один раз.** JSON Schema и загрузчик проверяют одно и то же, и это утверждается тестом.
- **`ContentVersion` вычисляется** как digest содержимого, а не объявляется константой (спека §8.7).

**Спека:** `docs/superpowers/specs/2026-08-12-technical-rules-design.md`
**Зависит от:** плана A.
**Вне scope:** CI, записи `ADR`, Godot-проект, harness — план C и отдельный план перед M1.

---

### Task B1: Сборка контента, схемы и вычисляемая версия

**Files:**
- Create: `schemas/hero.schema.json`, `schemas/contract.schema.json`
- Create: `content/heroes/bram.json`, `content/heroes/zara.json`, `content/contracts/escort_the_caravan.json`
- Create: `adapters/OathAndCoin.Content/` — `OathAndCoin.Content.csproj`, `ContentModel.cs`, `ContentSet.cs`, `ContentDigest.cs`, `ContentBounds.cs`
- Create: `tests/OathAndCoin.Content.Tests/` — `ContentSetTests.cs`, `SchemaAgreementTests.cs`
- Test: обе группы

**Interfaces:**
- Consumes: `ContentId`, `HeroId`, `GameState`, `HeroState`, `ContractState` из плана A.
- Produces:
  - `sealed record HeroDefinition(ContentId Id, string DisplayNameKey, int Greed, int Caution, int TrustInGuild)`
  - `sealed record ContractDefinition(ContentId Id, string DisplayNameKey, int Payment, int Risk)`
  - `static ContentSet ContentSet.Load(string contentRoot)` — свойства `Heroes`, `Contracts`, `ContentVersion`
  - `GameState ContentSet.CreateInitialState(ulong campaignSeed, string rulesetVersion)`
  - `static class ContentBounds` — `TraitMin = 0`, `TraitMax = 100`, `PaymentMin = 0`, `PaymentMax = 100`, `RiskMin = 0`, `RiskMax = 100`
  - `static string ContentDigest.Compute(string contentRoot)`

**Значения контента подобраны так, чтобы решения расходились с запасом.** При `payment=40, risk=50`: Брам (`greed=60, caution=30, trust=50`) даёт `24 − 15 + 5 = 14`; Зара (`greed=20, caution=80, trust=40`) даёт `8 − 40 + 4 = −28`. Запас в обе стороны больше амплитуды настроения `[−5, +5]`, поэтому спайк не зависит от seed в своём главном утверждении.

- [ ] **Step 1: Создать схемы и контент**

Схемы — JSON Schema draft 2020-12, `additionalProperties: false`, диапазоны из `ContentBounds`, паттерн `id` совпадает с форматом `ContentId`.

Контент — три файла с указанными значениями и ключами локализации вида `hero.core.bram.name`.

- [ ] **Step 2: Написать падающие тесты**

`ContentSetTests`:

| Тест | Что утверждает |
|---|---|
| `Load_ReadsHeroesAndContracts` | два героя, один контракт |
| `CreateInitialState_AssignsHeroIdsInContentIdOrder` | `HeroId(0)` → `core:bram`, `HeroId(1)` → `core:zara`, независимо от порядка файлов в каталоге |
| `CreateInitialState_IsRepeatable` | два вызова с одним seed дают равные состояния |
| `Load_FailsOnDuplicateId` | `InvalidDataException` с указанием id и обоих файлов |
| `Load_FailsOnOutOfRangeValue` | `greed = 500` отвергается загрузчиком, а не только схемой |
| `Load_FailsOnUnknownProperty` | лишнее поле отвергается загрузчиком |
| `ContentVersion_ChangesWhenContentChanges` | digest на изменённой копии контента отличается |
| `ContentVersion_IsStableAcrossRuns` | два вызова на одном каталоге дают одно значение |

`SchemaAgreementTests` — тест, ради которого схема и загрузчик не разойдутся молча:

| Тест | Что утверждает |
|---|---|
| `HeroSchemaBounds_MatchContentBounds` | `minimum`/`maximum` в `hero.schema.json` равны `ContentBounds.TraitMin`/`TraitMax` |
| `ContractSchemaBounds_MatchContentBounds` | то же для `payment` и `risk` |
| `AllContentFiles_SatisfyTheirSchema` | каждый файл в `content/` валиден по своей схеме — это и есть стадия валидации данных из `TDD` §19, реализованная тестом, а не отдельным CLI |

Фикстуры находятся через `AssemblyMetadataAttribute` (`ContentRoot`, `SchemaRoot`), проброшенный из `.csproj`. Поиск корня по `.git` запрещён: в worktree это файл, а не каталог (спека §10).

- [ ] **Step 3: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Content.Tests`
Expected: FAIL — сборки `OathAndCoin.Content` нет.

- [ ] **Step 4: Реализовать**

```bash
dotnet new classlib -o adapters/OathAndCoin.Content -f net8.0
dotnet new xunit    -o tests/OathAndCoin.Content.Tests -f net8.0
dotnet sln add adapters/OathAndCoin.Content tests/OathAndCoin.Content.Tests
dotnet add adapters/OathAndCoin.Content reference simulation/OathAndCoin.Simulation
dotnet add tests/OathAndCoin.Content.Tests reference adapters/OathAndCoin.Content
dotnet add adapters/OathAndCoin.Content package JsonSchema.Net --version <точная версия>
```

Точную версию пакета зафиксировать в `.csproj` без диапазона и указать в PR вместе с командой `dotnet list package`.

Требования к реализации:

- `JsonSerializerOptions`: `AllowTrailingCommas = false`, `ReadCommentHandling = Disallow`, `PropertyNameCaseInsensitive = false`, `UnmappedMemberHandling = Disallow` — лишнее поле должно ломать загрузку, а не игнорироваться;
- перечисление файлов сортируется `StringComparer.Ordinal`, чтобы порядок файловой системы не влиял на результат;
- проверка диапазонов — через константы `ContentBounds`, те же, что утверждает `SchemaAgreementTests`;
- диагностика ошибки называет файл и JSON path;
- лимиты на размер файла и глубину структуры выставлены явно (`TDD` §18);
- `ContentDigest.Compute` — SHA-256 по конкатенации относительных путей и содержимого файлов в ordinal-порядке; результат в нижнем регистре hex, первые 16 символов идут в `ContentVersion`.

- [ ] **Step 5: Запустить тесты и закоммитить**

Run: `dotnet test tests/OathAndCoin.Content.Tests`
Expected: PASS, 11 тестов.

```bash
git add schemas content adapters tests OathAndCoin.sln
git commit -m "feat: add content assembly with computed version and schema agreement"
```

Мутант обязателен (доменный инвариант): поменять `maximum` в `hero.schema.json` со `100` на `200` — ожидать FAIL в `HeroSchemaBounds_MatchContentBounds`. Откатить и прогнать.

---

### Task B2: Команда, ответ героя и правило решения

**Files:**
- Create: `simulation/OathAndCoin.Simulation/Commands/ProposeContractToHero.cs`, `CommandResult.cs`
- Create: `simulation/OathAndCoin.Simulation/Decisions/ContractDecisionRule.cs`
- Create: `simulation/OathAndCoin.Simulation/SimulationEngine.cs`
- Test: `tests/OathAndCoin.Simulation.Tests/ProposeContractTests.cs`

**Interfaces:**
- Consumes: план A целиком.
- Produces:
  - `sealed record ProposeContractToHero(long CommandId, HeroId HeroId, ContentId ContractId, long ExpectedStateVersion)`
  - `sealed record CommandResult` — `Applied`, `RejectionCode`, `State`, `Events`, `Decision`; фабрика `Rejected(GameState, string)`
  - `static DecisionResult ContractDecisionRule.Decide(HeroState, ContractState, ulong campaignSeed, ulong decisionOrdinal, long traceId)`
  - `static class ContractDecisionRule` — `Accept = "accept"`, `Decline = "decline"`
  - `sealed class SimulationEngine` — **без полей состояния**; `CommandResult Apply(GameState state, ProposeContractToHero command)`

**Три решения этой задачи:**

1. **Движок не хранит ничего.** `Decide` получает `campaignSeed` и `decisionOrdinal` из состояния и вызывает `DeterministicRng.Draw`. Никакого объекта генератора ни в движке, ни в состоянии — воспроизводимость следует из чистоты функции, а не из аккуратности вызывающего.
2. **`ExpectedStateVersion` проверяется**, иначе поле было бы декорацией. Несовпадение → `rejected.stale_state`.
3. **`CommandId` записывается в состояние** и повторное применение того же `CommandId` отвергается как `rejected.duplicate_command`. Идентификатор команды, который никто не проверяет, хуже его отсутствия.

Правило решения намеренно минимально и не предрешает `BQ-004`: `score = payment*greed/100 − risk*caution/100 + trust/10 + mood`, где `mood` — целое из `[−5, +5]`. Принятие при `score >= 0`. Вся арифметика целочисленная.

- [ ] **Step 1: Написать падающие тесты**

| Тест | Что утверждает |
|---|---|
| `CautiousHero_DeclinesAndTraceNamesRisk` | Зара отказывается, в отрицательных факторах есть `reason.risk_too_high` |
| `GreedyHero_AcceptsAndTraceNamesPayment` | Брам соглашается, в положительных есть `reason.payment_attractive` |
| `Decline_DoesNotCloseContractForOtherHeroes` | после отказа Зары контракт всё ещё `Offered`, Брам может ответить |
| `SecondResponseFromSameHero_IsRejected` | повторное предложение тому же герою → `rejected.already_responded` |
| `StaleExpectedStateVersion_IsRejected` | несовпадение → `rejected.stale_state`, состояние не изменено |
| `DuplicateCommandId_IsRejected` | повторный `CommandId` → `rejected.duplicate_command` |
| `UnknownContract_IsRejectedWithoutMutatingState` | `rejected.unknown_contract`, `Assert.Same(state, result.State)` |
| `SameStateAndCommand_ProduceIdenticalResult` | два независимых вызова на одном состоянии дают равные `Decision` и `State` |
| `EngineHasNoMutableState` | рефлексией: у `SimulationEngine` нет ни одного нестатического поля |
| `EveryDecision_ProducesStoredTrace` | `result.State.Traces` содержит trace, на который ссылается событие |
| `DifferentSeeds_ChangeTheMoodFactor` | восемь разных `campaignSeed` дают более одного значения `SelectedScore` |

`EngineHasNoMutableState` — прямая защита от возврата скрытого состояния: тест, который сломается, если кто-то снова положит генератор в поле движка.

`DifferentSeeds_ChangeTheMoodFactor` существует потому, что без него проверка воспроизводимости остаётся зелёной, даже если seed вообще не доходит до решения. Это ровно случай «индикатор, выданный за вердикт» (спека §8.3).

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~ProposeContractTests`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

Порядок проверок в `Apply` — от дешёвых к дорогим, каждая возвращает исходный экземпляр состояния:

1. `ExpectedStateVersion` совпадает с `state.Metadata.StateVersion`;
2. `CommandId` не встречался ранее;
3. герой существует;
4. контракт существует;
5. контракт в статусе `Offered`;
6. герой ещё не отвечал (`RespondedBy`).

Только после этого вычисляется решение. Событие, trace и обновление контракта применяются одной операцией через `WithEvent`.

При принятии контракт переходит в `Accepted`; при отказе остаётся `Offered`, а герой добавляется в `RespondedBy`.

- [ ] **Step 4: Запустить тесты**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~ProposeContractTests`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит, затем мутанты (детерминизм и инварианты)**

```bash
git add simulation tests
git commit -m "feat: add contract proposal command with stored causal trace"
```

| Мутант | Ожидание |
|---|---|
| инвертировать порог `score >= 0` | FAIL в обоих тестах про героев |
| закрывать контракт при отказе | FAIL в `Decline_DoesNotCloseContractForOtherHeroes` |
| убрать проверку `ExpectedStateVersion` | FAIL в `StaleExpectedStateVersion_IsRejected` |
| положить `RngStreams` в поле движка и брать значения оттуда | FAIL в `EngineHasNoMutableState` |
| передавать в `Decide` константный `decisionOrdinal` вместо значения из состояния | FAIL в `SameStateAndCommand_ProduceIdenticalResult`? **Нет — этот мутант останется зелёным.** Он и есть проверка §8.3: добавьте тест, утверждающий, что два последовательных решения в одном прогоне используют разные ordinal и потому могут дать разное настроение |

Последняя строка не опечатка: зелёный мутант здесь ожидаем и обязателен к обработке. Недостающий тест дописывается, мутант прогоняется повторно и должен покраснеть.

Откатить и прогнать.

---

### Task B3: Двухгеройный сценарий и канонический артефакт детерминизма

**Files:**
- Create: `scenarios/gate0.commands.json`
- Create: `adapters/OathAndCoin.Content/Scenarios/ScenarioRunner.cs`, `DeterminismArtifact.cs`, `SpikeReport.cs`
- Test: `tests/OathAndCoin.Content.Tests/ReplayDeterminismTests.cs`

**Interfaces:**
- Consumes: планы A и B1, B2.
- Produces:
  - `sealed record ScenarioOutcome(GameState FinalState, ImmutableArray<StepOutcome> Steps)`
  - `static ScenarioOutcome ScenarioRunner.Run(ContentSet content, IReadOnlyList<ScenarioCommand> commands, ulong seed)`
  - `static string DeterminismArtifact.Serialize(ScenarioOutcome)` — канонический JSON
  - `static string DeterminismArtifact.Hash(ScenarioOutcome)` — SHA-256 канонического JSON
  - `static string SpikeReport.Render(ScenarioOutcome)` — короткий человекочитаемый отчёт

**Сценарий строится в порядке, который действительно доказывает два решения:**

```json
{
  "commands": [
    { "command_id": 1, "hero_index": 1, "contract": "core:escort_the_caravan", "expected_state_version": 0 },
    { "command_id": 2, "hero_index": 0, "contract": "core:escort_the_caravan", "expected_state_version": 1 }
  ]
}
```

Сначала осторожная Зара получает осмысленный **отказ** со своим trace, затем жадный Брам — **принятие** со своим. Оба шага — автономные решения, ни один не является техническим отклонением. Предыдущая версия сценария предлагала контракт сначала Браму, из-за чего Зара получала `contract_already_resolved` и вообще не принимала решения — спайк доказывал одно решение, а утверждал два.

**Два артефакта, а не один** (спека §8.6):

- **канонический** — команды, версии, seed, финальное `GameState` целиком, все события, все traces. Сравнивается он или его хеш;
- **человекочитаемый** — решения, счёт, коды причин; для владельца продукта.

Канонический сериализуется с сортировкой ключей и фиксированной культурой, иначе «канонический» — только название.

- [ ] **Step 1: Написать падающие тесты**

| Тест | Что утверждает |
|---|---|
| `SameSeed_ProducesIdenticalCanonicalArtifact` | два прогона дают равные канонические строки |
| `SameSeed_ProducesIdenticalHash` | и равные хеши |
| `DifferentSeed_ProducesDifferentArtifact` | seed доходит до результата |
| `Scenario_ShowsTwoAutonomousDecisions` | шаг 1 — `decline` от `core:zara`, шаг 2 — `accept` от `core:bram`; ни один не является отклонением команды |
| `Scenario_ProducesTwoDistinctTraces` | `FinalState.Traces.Count == 2`, наборы кодов причин различаются |
| `CanonicalArtifact_ContainsFinalStateAndTraces` | в строке присутствуют `StateVersion`, оба `TraceId` и оба события |
| `CanonicalArtifact_IsCultureInvariant` | прогон под `CultureInfo` с запятой как десятичным разделителем даёт ту же строку |

`CanonicalArtifact_IsCultureInvariant` нужен потому, что локаль машины — запрещённый источник по `TDD` §7.3, а сериализация — самое вероятное место, где она просочится.

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Content.Tests --filter FullyQualifiedName~ReplayDeterminismTests`
Expected: FAIL.

- [ ] **Step 3: Реализовать и прогнать**

Run: `dotnet test tests/OathAndCoin.Content.Tests --filter FullyQualifiedName~ReplayDeterminismTests`
Expected: PASS, 7 тестов.

- [ ] **Step 4: Коммит, затем мутанты (детерминизм — обязательная область)**

```bash
git add scenarios adapters tests
git commit -m "feat: add two-hero scenario with canonical determinism artifact"
```

| Мутант | Ожидание |
|---|---|
| исключить `Traces` из канонической сериализации | FAIL в `CanonicalArtifact_ContainsFinalStateAndTraces` |
| сериализовать без сортировки ключей | FAIL в тестах на идентичность (нестабильно — если тест остаётся зелёным, он мерит не то) |
| убрать `CultureInfo.InvariantCulture` | FAIL в `CanonicalArtifact_IsCultureInvariant` |
| поменять порядок команд в сценарии на прежний | FAIL в `Scenario_ShowsTwoAutonomousDecisions` |

Откатить и прогнать.

---

### Task B4: CLI-раннер со строгим разбором аргументов

**Files:**
- Create: `tools/OathAndCoin.SimulationRunner/` — `OathAndCoin.SimulationRunner.csproj`, `Program.cs`, `CommandLine.cs`
- Test: `tests/OathAndCoin.Content.Tests/CommandLineTests.cs`

**Interfaces:**
- Consumes: B1–B3.
- Produces: CLI

```
simulation-runner run-scenario --content <dir> --schemas <dir> --commands <file> --seed <n> [--artifact <path>] [--report <path>]
```

- `static ParsedArguments CommandLine.Parse(string[] args)` — бросает `ArgumentException` на неизвестный, повторённый или отсутствующий обязательный аргумент.

Один headless-вызов этой команды и есть подтверждение воспроизводимости, требуемое `MVP_PLAN` §4.3.

- [ ] **Step 1: Написать падающие тесты разбора**

| Тест | Что утверждает |
|---|---|
| `Parse_AcceptsCompleteArgumentList` | все поля разобраны |
| `Parse_RejectsUnknownArgument` | `--colour red` → `ArgumentException` с именем аргумента |
| `Parse_RejectsDuplicateArgument` | `--seed 1 --seed 2` → ошибка |
| `Parse_RejectsMissingRequiredArgument` | без `--seed` → ошибка с перечнем недостающих |
| `Parse_RejectsValueWithoutArgument` | висящее значение в конце → ошибка |
| `Parse_RejectsNonNumericSeed` | `--seed abc` → ошибка |
| `Parse_TreatsSeedAsInvariant` | `--seed 1000` разбирается одинаково при любой `CultureInfo` |

Прежняя версия CLI молча принимала неизвестные параметры, допускала отсутствие `--seed` и не пропускала индекс после прочитанного значения — то есть `--seed 5 --artifact x` разбирался неверно. Разбор аргументов — код, который ошибается тихо, поэтому он покрывается тестами наравне с доменом.

- [ ] **Step 2: Запустить, убедиться, что падает; затем реализовать и прогнать**

Run: `dotnet test tests/OathAndCoin.Content.Tests --filter FullyQualifiedName~CommandLineTests`
Expected: сначала FAIL, после реализации PASS, 7 тестов.

Коды возврата: `0` — успех, `1` — расхождение или ошибка данных, `2` — ошибка аргументов.

- [ ] **Step 3: Проверить воспроизводимость руками**

```bash
dotnet run --project tools/OathAndCoin.SimulationRunner -- run-scenario \
  --content content --schemas schemas --commands scenarios/gate0.commands.json \
  --seed 424242 --artifact artifacts/gate0-canonical.json --report artifacts/gate0-report.txt
```

Прогнать дважды в разные файлы и сравнить. Ожидание: канонические артефакты совпадают побайтово; отчёт показывает отказ Зары и принятие Брама с их причинами.

- [ ] **Step 4: Коммит**

`artifacts/` в `.gitignore` — выход прогона публикует CI, а не git (спека §8.1).

```bash
git add tools tests OathAndCoin.sln
git commit -m "feat: add headless scenario runner with strict argument parsing"
```

---

## Definition of Done плана B

- один headless-вызов воспроизводит спайк по seed;
- сценарий показывает **два автономных решения** с двумя различными traces, ни одно из которых не является техническим отклонением;
- канонический артефакт содержит финальное состояние, события и traces; его хеш стабилен между прогонами;
- `ContentVersion` меняется при изменении контента;
- границы схемы и загрузчика утверждены тестом;
- `SimulationEngine` не имеет полей состояния, и это проверяется тестом.

Ревью проводит агент, не писавший этот код. Далее — план C.
