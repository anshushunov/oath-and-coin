# Gate 0 / A — Контракты ядра

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Компилируемый контрактный пакет из `MVP_PLAN` §4.3 — идентификаторы, детерминированная случайность, события, causal trace и состояние кампании, с механической проверкой границы core.

**Architecture:** Одна чистая сборка `OathAndCoin.Simulation`: переходы состояния и правила, без файловой системы, часов, глобальной случайности и Godot. Случайность counter-based — состояние генератора не хранится и не мутируется, значение выводится из seed, потока и порядкового номера. Все коллекции состояния неизменяемы физически, а не только по типу.

**Tech Stack:** .NET 8.0.424, C# 12, xUnit, `System.Collections.Immutable`.

## Global Constraints

- **Никаких ссылок на Godot** в `simulation/`.
- **Запрещённые API в `simulation/`:** `System.Random`, `DateTime.Now`, `DateTime.UtcNow`, `DateTimeOffset.Now`, `Guid.NewGuid`, `Environment.TickCount`, `System.IO`, `CultureInfo.CurrentCulture`, `float`, `double`. Основание: `TDD` §7.3, §7.4.
- **Только целочисленная арифметика** в игровых расчётах.
- **Порядок итерации не влияет на результат.** Где нужен порядок — явная сортировка по `ContentId`.
- **SDK пинуется** в `global.json`: `8.0.424`, `rollForward: disable`.
- `TreatWarningsAsErrors`, `Nullable enable`, `LangVersion 12.0`, `Deterministic true`.
- **Conventional Commits**, без указания авторства LLM.
- **Мутант обязателен** для детерминизма, доменных инвариантов и новых CI-проверок; для остального достаточно red/green (спека §8.2).
- **Каждое число в PR — с командой, которой снято** (спека §8.1).

**Спека:** `docs/superpowers/specs/2026-08-12-technical-rules-design.md`
**Вне scope:** контент, команды, решения героев, CI, записи `ADR` — планы B и C.

---

### Task A1: Скелет решения и трёхчастный guard границы

**Files:**
- Create: `global.json`, `Directory.Build.props`, `.gitignore`, `OathAndCoin.sln`
- Create: `simulation/OathAndCoin.Simulation/OathAndCoin.Simulation.csproj`, `AssemblyMarker.cs`
- Create: `tests/OathAndCoin.Simulation.Tests/OathAndCoin.Simulation.Tests.csproj`
- Test: `tests/OathAndCoin.Simulation.Tests/CoreBoundaryTests.cs`

**Interfaces:**
- Consumes: ничего.
- Produces: сборка `OathAndCoin.Simulation` и тестовый проект, на которые опираются все дальнейшие задачи. `MSBuild`-свойство `SimulationSourceRoot`, передаваемое в тесты через `AssemblyMetadata`, — так тесты находят исходники, **не** отыскивая корень репозитория по `.git`.

Механизирует `ADR-002`. Проверок три, потому что одной мало: ссылка, не использованная в коде, может не попасть в метаданные сборки, и проверка метаданных окажется зелёной при нарушенной границе (спека §5).

- [ ] **Step 1: Написать падающий тест из трёх проверок**

`CoreBoundaryTests` должен содержать:

1. `SimulationProjects_DeclareNoEngineReference` — читает все `.csproj` под `simulation/` и утверждает, что ни один `PackageReference`/`ProjectReference` не содержит `Godot` (сравнение `OrdinalIgnoreCase`).
2. `SimulationSources_UseNoBannedApi` — читает все `.cs` под `simulation/` и утверждает отсутствие подстрок из списка глобальных ограничений. Исключение: строки, начинающиеся с `//` или `///`, не проверяются — иначе нельзя написать комментарий о запрете.
3. `SimulationAssembly_ReferencesNoEngineAssembly` — как раньше, через `Assembly.GetReferencedAssemblies()`.

Путь к исходникам берётся из `AssemblyMetadataAttribute` с ключом `SimulationSourceRoot`, а не поиском `.git`: в git worktree `.git` — файл, а не каталог, и поиск по `Directory.Exists` там сломается (спека §10).

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~CoreBoundaryTests`
Expected: FAIL — проектов нет.

- [ ] **Step 3: Создать конфигурацию сборки**

`global.json` — SDK `8.0.424`, `rollForward: disable`, `allowPrerelease: false`.

`Directory.Build.props` — свойства из глобальных ограничений (по образцу `Directory.Build.props` в Dungeon Fortress).

`.gitignore` — `bin/`, `obj/`, `artifacts/`, `.vs/`, `*.user`. Каталог `artifacts/` игнорируется намеренно: выход прогонов публикуется CI, а не коммитится (спека §8.1).

- [ ] **Step 4: Создать проекты**

```bash
dotnet new classlib -o simulation/OathAndCoin.Simulation -f net8.0
dotnet new xunit    -o tests/OathAndCoin.Simulation.Tests -f net8.0
dotnet new sln -n OathAndCoin
dotnet sln add simulation/OathAndCoin.Simulation tests/OathAndCoin.Simulation.Tests
dotnet add tests/OathAndCoin.Simulation.Tests reference simulation/OathAndCoin.Simulation
```

Удалить шаблонные `Class1.cs` и `UnitTest1.cs`. Добавить `AssemblyMarker` — пустой публичный статический класс для привязки рефлексии.

В `OathAndCoin.Simulation.Tests.csproj` пробросить путь к исходникам:

```xml
<ItemGroup>
  <AssemblyAttribute Include="System.Reflection.AssemblyMetadataAttribute">
    <_Parameter1>SimulationSourceRoot</_Parameter1>
    <_Parameter2>$(MSBuildThisFileDirectory)../../simulation</_Parameter2>
  </AssemblyAttribute>
</ItemGroup>
```

- [ ] **Step 5: Запустить тесты**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~CoreBoundaryTests`
Expected: PASS, 3 теста.

- [ ] **Step 6: Мутант с реальным использованием типа Godot**

Ссылка без использования — недостаточное доказательство. Мутант должен именно **использовать** тип:

1. Добавить в `OathAndCoin.Simulation.csproj` `<Sdk Name="Godot.NET.Sdk" Version="4.7.1" />` либо `PackageReference` на `GodotSharp` 4.7.1.
2. Добавить в любой файл `simulation/` строку `public static Godot.Vector2 Probe() => Godot.Vector2.Zero;`.
3. Прогнать: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~CoreBoundaryTests`.

Expected: FAIL во **всех трёх** проверках. Если хотя бы одна остаётся зелёной — она мерит не то, и её надо переписать до отката мутанта (спека §8.3).

Мутант на запрещённые API: добавить `var now = System.DateTime.UtcNow;` — ожидать FAIL в `SimulationSources_UseNoBannedApi`.

Откатить: `git checkout -- simulation` и прогнать снова, ожидать PASS.

- [ ] **Step 7: Коммит**

```bash
git add global.json Directory.Build.props .gitignore OathAndCoin.sln simulation tests
git commit -m "feat: add solution skeleton with three-part core boundary guard"
```

---

### Task A2: Counter-based детерминированная случайность (`ADR-003`)

**Files:**
- Create: `simulation/OathAndCoin.Simulation/Random/RngStream.cs`, `DeterministicRng.cs`
- Create: `tests/OathAndCoin.Simulation.Tests/DeterministicRngTests.cs`
- Create: `tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json`

**Interfaces:**
- Consumes: Task A1.
- Produces:
  - `enum RngStream { WorldGeneration = 0, WorldTick = 1, ContractGeneration = 2, HeroDecision = 3, ExpeditionEvent = 4, Combat = 5, CosmeticPresentation = 6 }` — по `TDD` §7.2
  - `static ulong DeterministicRng.Draw(ulong campaignSeed, RngStream stream, ulong ordinal)`
  - `static int DeterministicRng.DrawInt32(ulong campaignSeed, RngStream stream, ulong ordinal, int minInclusive, int maxExclusive)`
  - `const string DeterministicRng.AlgorithmVersion = "splitmix64-composed/1"`

**Почему counter-based, а не объект с состоянием.** Генератор, хранящий изменяемое состояние внутри движка, делает результат зависимым от того, сколько вызовов было сделано раньше через этот экземпляр. Тогда состояние и команда перестают определять исход, а сохранить и продолжить ту же последовательность нельзя — прямое расхождение с контрактом `seed/stream states` в `TDD` §7.1. Counter-based функция снимает проблему целиком: хранить нечего, порядковый номер берётся из `GameState`.

- [ ] **Step 1: Написать падающие тесты**

Обязательные утверждения:

| Тест | Что утверждает |
|---|---|
| `Draw_IsPureFunctionOfItsArguments` | одинаковые `(seed, stream, ordinal)` дают одинаковый результат при любом порядке вызовов |
| `Draw_DiffersAcrossStreams` | при одном `seed` и `ordinal` семь потоков дают семь разных значений |
| `Draw_DiffersAcrossOrdinals` | 1000 последовательных `ordinal` дают не менее 999 различных значений |
| `Draw_DiffersAcrossSeeds` | 1000 разных `seed` при одном `(stream, ordinal)` дают не менее 999 различных значений |
| `DrawInt32_StaysWithinRange` | 100 000 выборок в `[-5, 6)` лежат в диапазоне |
| `DrawInt32_HandlesFullIntRange` | `DrawInt32(..., int.MinValue, int.MaxValue)` не бросает и не переполняется |
| `DrawInt32_RejectsEmptyRange` | `maxExclusive <= minInclusive` бросает `ArgumentOutOfRangeException` |
| `Draw_MatchesCommittedGoldenVector` | первые 16 значений для `seed=424242, stream=HeroDecision` совпадают с `Fixtures/rng-golden.json` |

`DrawInt32_HandlesFullIntRange` существует потому, что вычитание границ в `int` переполняется на широких диапазонах: `int.MaxValue - int.MinValue` не помещается в `int`. Ширина диапазона считается в `ulong`.

Golden-вектор — **наш собственный**, а не чужой эталон: он фиксирует выбранный алгоритм против случайного изменения, потому что алгоритм входит в контракт воспроизводимости (`TDD` §7.1). Файл создаётся на шаге 3 командой, которая записывается в PR.

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~DeterministicRngTests`
Expected: FAIL — `DeterministicRng` не определён.

- [ ] **Step 3: Реализовать**

Алгоритм — композиция двух применений финализатора SplitMix64:

```csharp
private const ulong GoldenGamma = 0x9E3779B97F4A7C15UL;

private static ulong Mix(ulong z)
{
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
    return z ^ (z >> 31);
}

public static ulong Draw(ulong campaignSeed, RngStream stream, ulong ordinal)
{
    ulong key = Mix(unchecked(campaignSeed + ((ulong)stream + 1UL) * GoldenGamma));
    return Mix(unchecked(key + ordinal * GoldenGamma));
}
```

Вся арифметика в `unchecked`, потому что переполнение здесь — часть алгоритма, а не ошибка.

`DrawInt32` считает ширину диапазона как `ulong span = (ulong)((long)maxExclusive - minInclusive)` и приводит результат обратно через `long`. Отбраковка по порогу для равномерности: `ulong threshold = ulong.MaxValue - (ulong.MaxValue % span)`; при попадании выше порога `ordinal` увеличивается на единицу и выборка повторяется. Число повторов возвращать наружу не нужно — функция остаётся чистой от `(seed, stream, ordinal)`.

Golden-вектор генерируется один раз и коммитится. Раннера из плана B на этом этапе ещё нет, поэтому используется одноразовая консольная программа, **которая не попадает в репозиторий**:

```bash
dotnet new console -o /tmp/rng-golden -f net8.0
dotnet add /tmp/rng-golden reference simulation/OathAndCoin.Simulation
# Program.cs печатает JSON-массив из 16 значений Draw(424242, HeroDecision, i)
dotnet run --project /tmp/rng-golden > tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json
rm -rf /tmp/rng-golden
```

Команда, которой файл создан, указывается в PR (глобальное ограничение «каждое число — с командой»).

**Тест-генератор писать запрещено.** Тест с `[Fact(Skip = ...)]`, который ничего не утверждает, а печатает значения, — это не тест: он не может покраснеть и живёт в наборе вечно. Генерация вектора одноразова, поэтому и инструмент одноразов.

- [ ] **Step 4: Запустить тесты**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~DeterministicRngTests`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит, затем мутанты (детерминизм — обязательная область)**

```bash
git add simulation tests
git commit -m "feat: add counter-based deterministic rng with stream separation"
```

| Мутант | Ожидание |
|---|---|
| убрать `* ((ulong)stream + 1UL)` из вычисления `key` | FAIL в `Draw_DiffersAcrossStreams` |
| заменить `ordinal * GoldenGamma` на `ordinal` | FAIL в `Draw_MatchesCommittedGoldenVector` |
| заменить `(ulong)((long)maxExclusive - minInclusive)` на `(ulong)(maxExclusive - minInclusive)` | FAIL в `DrawInt32_HandlesFullIntRange` |
| убрать второй `Mix` | FAIL в `Draw_MatchesCommittedGoldenVector` |

Откатить: `git checkout -- simulation`, прогнать, ожидать PASS.

---

### Task A3: Стабильные идентификаторы (`ADR-005`)

**Files:**
- Create: `simulation/OathAndCoin.Simulation/Ids/ContentId.cs`, `HeroId.cs`
- Test: `tests/OathAndCoin.Simulation.Tests/ContentIdTests.cs`

**Interfaces:**
- Consumes: Task A1.
- Produces:
  - `readonly struct ContentId : IEquatable<ContentId>, IComparable<ContentId>` — приватный конструктор, публичные `Parse`/`TryParse`, свойства `Namespace`, `Name`, `Value`
  - `readonly record struct HeroId(int Value) : IComparable<HeroId>`

Формат: `namespace:name`, оба сегмента по `^[a-z][a-z0-9_]*$`. Конструирование только через `Parse`/`TryParse`, поэтому невалидного значения в системе не существует.

- [ ] **Step 1: Написать падающие тесты**

| Тест | Что утверждает |
|---|---|
| `Parse_AcceptsValidNamespacedId` | `core:bram`, `core:escort_the_caravan`, `mod_north:hero_2` принимаются |
| `TryParse_RejectsMalformedId` | отвергаются `""`, `bram`, `core:`, `:bram`, `Core:bram`, `core:Bram`, `core:bram:extra`, `core: bram`, `1core:bram`, `null` |
| `Parse_ThrowsWithDiagnosticMessage` | сообщение содержит исходное значение и ожидаемый формат |
| `Sorting_IsOrdinal` | `["core:zara", "core:bram", "alt:bram"]` сортируется в `["alt:bram", "core:bram", "core:zara"]` |
| `Equality_IsByValue` | равенство и неравенство по значению |
| `Default_ThrowsOnAccess` | `default(ContentId).Value` бросает `InvalidOperationException` с внятным текстом |

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~ContentIdTests`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`CompareTo` — через `string.CompareOrdinal`, не `string.Compare`: порядок не должен зависеть от локали машины (`TDD` §7.3). `Regex` создавать с `RegexOptions.Compiled | RegexOptions.CultureInvariant`.

- [ ] **Step 4: Запустить тесты, затем коммит**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter FullyQualifiedName~ContentIdTests`
Expected: PASS.

```bash
git add simulation tests
git commit -m "feat: add stable namespaced content ids"
```

Мутант обязателен (доменный инвариант): заменить паттерн сегмента на `^.+$` — ожидать FAIL в `TryParse_RejectsMalformedId`; заменить `CompareOrdinal` на возврат `0` — ожидать FAIL в `Sorting_IsOrdinal`. Откатить и прогнать.

---

### Task A4: События, causal trace и состояние кампании (`ADR-007`)

**Files:**
- Create: `simulation/OathAndCoin.Simulation/Events/DomainEvent.cs`
- Create: `simulation/OathAndCoin.Simulation/Decisions/CausalTrace.cs`, `ReasonCodes.cs`
- Create: `simulation/OathAndCoin.Simulation/State/GameState.cs`, `HeroState.cs`, `ContractState.cs`
- Test: `tests/OathAndCoin.Simulation.Tests/GameStateTests.cs`, `CausalTraceTests.cs`

**Interfaces:**
- Consumes: Task A2, A3.
- Produces:
  - `abstract record DomainEvent(long EventId, long LogicalTime, long? CausalTraceId)`
  - `sealed record HeroAcceptedContract(long, long, long?, HeroId, ContentId) : DomainEvent`
  - `sealed record HeroDeclinedContract(long, long, long?, HeroId, ContentId) : DomainEvent`
  - `sealed record TraceFactor(string ReasonCode, string SourceEntity, int Magnitude)`
  - `sealed record CausalTrace` — `TraceId`, `PositiveFactors`, `NegativeFactors`, `BlockedBy`, `TieBreak`
  - `sealed record DecisionResult` — `SelectedAction`, `ConsideredActions`, `SelectedScore`, `Trace`
  - `static class ReasonCodes` — `PaymentAttractive`, `RiskTooHigh`, `TrustsTheGuild`, `UnpredictableMood`
  - `sealed record GameMetadata` — `SaveSchemaVersion`, `RulesetVersion`, `ContentVersion`, `CampaignSeed`, `StateVersion`, `LogicalTime`, `NextEventId`, `NextTraceId`, `NextDecisionOrdinal`
  - `sealed record HeroState` — `Id`, `Definition`, `DisplayNameKey`, `Greed`, `Caution`, `TrustInGuild`
  - `sealed record ContractState` — `Id`, `Payment`, `Risk`, `Status`, `RespondedBy` (`ImmutableSortedSet<HeroId>`); `enum ContractStatus { Offered, Accepted }`
  - `sealed record GameState` — `Metadata`, `Heroes`, `Contracts`, `Traces`, `History`; методы `Hero`, `Contract`, `WithEvent(DomainEvent, CausalTrace?)`

**Четыре решения этой задачи, каждое закрывает конкретный дефект:**

1. **Коллекции физически неизменяемы.** `ImmutableSortedDictionary` и `ImmutableArray`, не `IReadOnlyDictionary` поверх обычного `Dictionary`: интерфейс только для чтения не мешает владельцу исходной коллекции изменить уже созданное состояние. Сортированные варианты дают заодно детерминированный порядок перечисления.
2. **Trace хранится в состоянии.** `GameState.Traces` — `ImmutableSortedDictionary<long, CausalTrace>`, адресуемый `CausalTraceId` из события. Иначе после сохранения ссылка в событии становится висячей и объяснить решение уже нельзя.
3. **`StateVersion`** увеличивается на каждом переходе; команды сверяют его с `ExpectedStateVersion` (план B).
4. **`NextDecisionOrdinal`** — порядковый номер для counter-based RNG. Именно он делает движок stateless: случайность выводится из состояния, а не хранится рядом с ним.

Модель героя из трёх черт — намеренный минимум спайка. `MVP_PLAN` §5.2 предусматривает 6–8 черт, а выбор между utility и rule model остаётся `BQ-004` и решается в Milestone 1.

`ContractStatus` содержит только `Offered` и `Accepted`: отказ героя не закрывает контракт, а добавляет героя в `RespondedBy`. Иначе первый же отказ делает контракт недоступным остальным, и сценарий двух автономных решений становится невозможным.

- [ ] **Step 1: Написать падающие тесты**

| Тест | Что утверждает |
|---|---|
| `DecisionResult_SelectedActionMustBeAmongConsidered` | инвариант `TDD` §8: выбор входит в рассмотренное; иначе `ArgumentException` |
| `ReasonCodes_AreStableAndNamespaced` | четыре кода имеют ожидаемые строковые значения |
| `WithEvent_AppendsEventAndAdvancesCounters` | `NextEventId`, `StateVersion` растут; исходное состояние не изменилось |
| `WithEvent_StoresTraceAddressableByEventReference` | `state.Traces[evt.CausalTraceId.Value]` возвращает переданный trace |
| `WithEvent_RejectsOutOfOrderEventId` | `ArgumentException` с номером в сообщении |
| `WithEvent_RejectsTraceIdMismatch` | `CausalTraceId` события и `TraceId` переданного trace обязаны совпадать |
| `MutatingSourceCollection_DoesNotAffectState` | построить состояние из обычного `Dictionary`, затем изменить этот `Dictionary` — состояние не меняется. Проверка поведения, а не типа: `Assert.IsAssignableFrom<ImmutableSortedDictionary<…>>` подтвердил бы объявленный тип, но не то, что владелец исходной коллекции потерял к ней доступ |
| `Hero_ThrowsDiagnosticErrorForUnknownId` | сообщение содержит `hero#42` |
| `Metadata_CarriesReproducibilityContract` | `SaveSchemaVersion`, `RulesetVersion`, `CampaignSeed`, `StateVersion` присутствуют и читаются |

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter "FullyQualifiedName~GameStateTests|FullyQualifiedName~CausalTraceTests"`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

Замечание по `DecisionResult`: инвариант «выбор среди рассмотренного» проверяется из обоих `init`-сеттеров с явными backing fields и молча выходит, пока вторая половина данных не задана — порядок инициализации в object initializer не гарантирован. Ключевое слово `field` на `LangVersion 12.0` недоступно.

`WithEvent` принимает `CausalTrace?`: событие без объяснения допустимо (не всякое событие — решение), но если trace передан, его `TraceId` обязан совпадать с `CausalTraceId` события.

- [ ] **Step 4: Запустить тесты**

Run: `dotnet test tests/OathAndCoin.Simulation.Tests --filter "FullyQualifiedName~GameStateTests|FullyQualifiedName~CausalTraceTests"`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Коммит, затем мутанты (доменные инварианты — обязательная область)**

```bash
git add simulation tests
git commit -m "feat: add events, stored causal traces and immutable campaign state"
```

| Мутант | Ожидание |
|---|---|
| убрать `throw` из проверки «выбор среди рассмотренного» | FAIL в `DecisionResult_SelectedActionMustBeAmongConsidered` |
| не класть trace в `Traces` | FAIL в `WithEvent_StoresTraceAddressableByEventReference` |
| не увеличивать `StateVersion` | FAIL в `WithEvent_AppendsEventAndAdvancesCounters` |
| заменить `ImmutableSortedDictionary` на `Dictionary` за интерфейсом | FAIL в `Collections_AreDeeplyImmutable` |

Откатить и прогнать.

---

## Definition of Done плана A

- `dotnet build OathAndCoin.sln -c Release` проходит без предупреждений;
- `dotnet test OathAndCoin.sln -c Release` зелёный;
- guard границы краснеет на мутанте, реально использующем тип Godot;
- golden-вектор RNG закоммичен вместе с командой, которой снят;
- ни одной ссылки на Godot, ни одного запрещённого API в `simulation/`.

Ревью плана проводит агент, не писавший этот код (спека §8.5). Далее — план B.
