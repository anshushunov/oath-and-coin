# ADR-009 — Контракты решения и формат контента 2

> Дата: 2026-08-15
>
> Статус: proposed (принятие — решением владельца продукта)

## Контекст

Модель решения героя ([`DEC-010`](DEC-010-hero-decision-model.md), техническая форма — [`HERO_DECISION_SPEC`](../technical/HERO_DECISION_SPEC.md)) не помещается в контракты, оставшиеся от спайка Gate 0. Спайк осознанно объявлял своё правило минимальным: у героя не было ни черт, ни отношений, у контракта — ни меток, ни размера отряда, а `blocked_by` в следе существовал, но ни одного настоящего ворота в правилах не было, и потому он умел сказать «сработал принцип», не умея сказать какой.

`AGENTS.md` §5 требует запись, когда изменение **меняет архитектурную границу или формат данных**. Здесь выполнены оба основания: меняется форма данных, которые ядро отдаёт наружу и хранит в состоянии, и меняется формат файлов контента с отказом читать прежнюю версию. `AGENTS.md` §5 же делит записи по природе решения — продуктовая половина живёт в `DEC-010`, эта запись держит техническую.

Номер `ADR-009` до этой записи значился как несуществующий: под ним предполагался фиксированный симуляционный тик, отозванный из Gate 0. Он входит в постановку модели времени боя на старте Milestone 2 и получит свой номер там; номер `ADR-009` занят этой записью, `ADR-006` остаётся забронированным под стратегию сохранений (`MVP_PLAN` §4.2).

## Решение

### Запись о блокировке называет сущность

`CausalTrace.BlockedBy` — массив `TraceBlock(string ReasonCode, ContentId SourceEntity)` вместо массива строк.

Причина в требовании к экрану: он обязан назвать **какой именно** принцип закрыл решение. Без источника экрану пришлось бы догадываться по герою — то есть изобретать причину, что `TDD` §8 запрещает прямо, и что весь причинный след существует, чтобы исключить.

**Величины у записи нет намеренно.** `TraceFactor` несёт `Magnitude`, `TraceBlock` — нет: у ворот нет силы, они не «очень большой минус» (`DEC-010`). Добавить величину «для единообразия» значило бы вернуть в данные ровно ту метафору, которую модель отвергает.

Остальным полям следа та же правка не нужна: `PositiveFactors` и `NegativeFactors` уже состояли из `TraceFactor` с кодом причины и источником. Несимметричным `BlockedBy` был именно потому, что при его написании ни одного настоящего ворота не существовало.

### Счёта на пути ворот нет, и это выражено типом

`DecisionResult.SelectedScore` — `int?` вместо `int`, со строго заданной семантикой:

> `SelectedScore` равен `null` тогда и только тогда, когда `Trace.BlockedBy` непуст.

Ноль был бы худшим из возможных заполнителей: он неотличим от честного нуля обычного пути, при правиле «согласие при `score >= 0`» читался бы как согласие и позволил бы проверке «сумма факторов равна итогу» пройти по неверной причине.

Эквивалентность держится не соглашением, а самим типом: `DecisionResult` отвергает и счёт вместе с блокировкой, и отсутствие счёта без блокировки. Проверка живёт на `DecisionResult`, а не на `CausalTrace`: она про обе половины сразу, а следу незачем знать о результате, который его содержит. Проверяется она из `init`-аксессоров обоих участвующих свойств, потому что порядок присваивания в инициализаторе объекта языком не гарантирован.

Совместная проверка «выбранное действие входит в рассмотренные» устроена так же и по той же причине.

### Состояние контракта: `Tags`, `AcceptedBy`, `RequiredCrew`

- **`Tags`** (`ImmutableSortedSet<ContentId>`) — без них правило не видит, чего контракт касается, и ворота проверять не по чему. Метки авторские и неизменные, но живут в состоянии по той же причине, что оплата и риск: правило получает состояние, а не контент. Ядро не имеет права ссылаться на сборку контента (`ADR-002`), поэтому «взять метки из файла» для него не существует как вариант.
- **`AcceptedBy`** (`ImmutableSortedSet<HeroId>`) рядом с `RespondedBy`: вклад связей считается по тем, кто согласился, и вывести это множество из `RespondedBy` нельзя. `DeclinedBy` отдельным полем не заводится — это `RespondedBy \ AcceptedBy`, а третий источник правды об одном факте пришлось бы синхронизировать. Заодно сохраняется свойство, которое разделение на два независимых множества потеряло бы: герой не может числиться одновременно согласившимся и отказавшимся, и повторный ответ проверяется ровно одной проверкой по `RespondedBy`. Инвариант `AcceptedBy ⊆ RespondedBy` держится тестом.
- **`RequiredCrew`** — размер отряда. В решении героя не участвует; нужен статусу контракта и экрану.

`ContractStatus` — два значения, `Offered` и `Crewed`. Прежнее `Accepted` («хоть кто-то согласился») исчезло: при отряде из нескольких героев оно называет неинтересное событие и путается с «укомплектован». Переход в `Crewed` считается по `AcceptedBy.Count >= RequiredCrew`, а не по первому согласию.

Равенство `ContractState` и `HeroState` сравнивает новые коллекции почленно. Это не косметика: `ImmutableSortedSet` не переопределяет `Equals`, поэтому сгенерированное компилятором равенство записи сравнило бы его по ссылке — два одинаково заполненных контракта оказались бы неравны, а два пустых равны только потому, что оба держат общий `Empty`. Ошибка такой формы проходит все тесты на пустых фикстурах и просыпается на первом непустом состоянии.

### Вход правила — `DecisionContext`, а не пара состояний

Правило принимает один неизменяемый вход, который собирает `SimulationEngine`: герой, контракт, разрешённые черты (`HeldTrait`), соответствие `HeroId → ContentId` для уже согласившихся, seed, ординал и `TraceId`.

Пары «герой + контракт» больше не хватает: отношения записаны на `ContentId` других героев, а `AcceptedBy` содержит runtime-`HeroId`, и сопоставить одно с другим правило не может. Отдать правилу `GameState` было бы вторым вариантом и худшим: тогда тест правила обязан строить целый мир, а граница «правило считает ровно то, из чего решение вычислимо» перестаёт существовать. Разрешение ссылок целиком лежит на движке, поэтому «черта не найдена» — не ветка в правиле, а отказ загрузки.

`HeldTrait` несёт `Id`, `Tag`, `IsPrinciple`, `Weight` — и не несёт ни ключа локализации, ни пути файла, ни версии схемы: `ADR-002` запрещает ядру ссылаться на сборку контента, и через границу едет только то, из чего считается решение.

### Версия формата контента 2

`ContentSet.SupportedContentSchemaVersion` поднимается с 1 до 2; все файлы контента объявляют `schema_version: 2`.

Оставить 1 нельзя: загрузчик отвергает файл, чья версия не равна поддерживаемой, а состав обязательных полей у героя и контракта изменился (`pride`, `traits`, `relationships`, `tags`, `required_crew`) и добавился новый тип контента — черта. Файл версии 1 после этой работы не читается, то есть версия 1 перестала означать то, что означала, при том же номере.

Плана миграции нет и он не требуется: сохранений пока не существует (`ADR-005`, известное ограничение), весь контент авторский, файлы правятся вручную. Отказ на версии 1 — громкий, с диагностикой, называющей обе версии.

Каталог локализации (`content/locale/ru.json`, `LocaleCatalogue`) — новый тип файла с собственной `schema_version`, читаемый теми же строгими правилами.

`ScenarioManifest.SupportedManifestSchemaVersion` **не** меняется: форма манифеста прежняя. Контрастные пары — отдельный тип файла в `scenarios/contrasts/` со своей версией: манифест описывает прогон, контраст описывает два прогона и различие между ними, и втискивать второе в первое значило бы иметь манифест, наполовину не относящийся к своему прогону.

### Версия артефакта 2 и новая версия правил

- `DeterminismArtifact.ArtifactVersion` — 2. Форма состояния и следа в каноническом артефакте другая: у контракта появились `tags`, `required_crew`, `accepted_by` и новое значение статуса, `blocked_by` рендерится массивом объектов с `reason_code` и `source_entity`, а `selected_score` **опускается целиком** на воротном пути — не пишется как `null` и не подменяется нулём.
- `ScenarioRunner.RulesetVersion` — `m1-decision/1` вместо версии спайка. Правила изменились, и артефакты прежних правил не должны выглядеть сравнимыми с нынешними: `TDD` §7.1 привязывает воспроизводимость к паре «версия правил + версия контента», и оставить прежнюю строку значило бы утверждать, что расхождение артефактов — регресс, а не смена правил.

Обе версии — независимые заявления: форма артефакта может измениться без смены правил (рефакторинг сериализации) и наоборот.

## Альтернативы

- **Оставить `BlockedBy` массивом строк, а принцип искать по герою на стороне экрана** — отклонено: это ровно «UI изобретает причину», запрещённое `TDD` §8. Экран знает набор черт героя, но не знает, какая из них сработала, если их две.
- **Дать `TraceBlock` величину для единообразия с `TraceFactor`** — отклонено: величина у ворот означала бы, что их можно перевесить, то есть противоречила бы `DEC-010` на уровне данных.
- **Оставить `SelectedScore` обязательным и писать 0 на воротах** — отклонено: ноль неотличим от честного нуля, читается как согласие по правилу `>= 0` и делает проверку «сумма факторов равна итогу» проходимой по неверной причине.
- **Сделать `SelectedScore` обязательным и завести отдельный флаг «решение заблокировано»** — отклонено: два поля вместо одного и два источника правды об одном факте, которые придётся согласовывать той же проверкой, что и сейчас, но уже с возможностью рассогласования.
- **Хранить `DeclinedBy` отдельным множеством** — отклонено: производно от `RespondedBy` и `AcceptedBy`, и теряет дизъюнктность как инвариант типа.
- **Заменить `RespondedBy` парой независимых множеств `AcceptedBy`/`DeclinedBy`** — отклонено по той же причине: сегодня «герой уже отвечал» — одна проверка, стала бы двумя, и состояние «числится в обоих» стало бы выразимым.
- **Передавать правилу `GameState`** — отклонено: тест правила обязан был бы строить целый мир, а правило получило бы доступ к данным, которых решение не касается.
- **Оставить `schema_version: 1`, сделав новые поля необязательными** — отклонено: герой без `pride` и контракт без `tags` пришлось бы чем-то доопределять на загрузке, то есть завести умолчания, которые никто не авторил и которые молча дают другое решение. Версия существует ровно для этого случая.
- **Написать миграцию файлов версии 1** — отклонено как работа без потребителя: файлов версии 1 вне репозитория не существует, сохранений нет.
- **Расширить формат манифеста сценария под контрастные пары** — отклонено: половина полей манифеста не относилась бы к его собственному прогону.
- **Оставить прежнюю `RulesetVersion`** — отклонено: тогда несовпадение старого и нового артефактов выглядит регрессом воспроизводимости, а не сменой правил.

## Последствия

- **Прежние канонические артефакты несравнимы с нынешними** — намеренно, и это заявлено обеими версиями (`artifact_version`, `ruleset_version`). Сравнивать их построчно бессмысленно.
- **Любой читатель следа обязан уметь форму «счёта нет».** Это касается артефакта, read model и всякого будущего просмотрщика: отсутствие `selected_score` — законное состояние, а не потеря данных.
- **Расход случайности зависит от пути решения.** Решение, закрытое воротами, не тратит ординалов; обычное тратит один или больше при отбраковке. Воспроизводимость сохраняется, потому что расход остаётся функцией состояния, но утверждение «ворота не тратят ординал» **нельзя проверить сравнением двух прогонов**: реализация, ошибочно тратящая ординал, останется полностью воспроизводимой, и replay-тест пройдёт. Поэтому оно проверяется прямыми тестами (см. «Проверка») — и это единственный контракт этой записи, у которого нет косвенного свидетеля.
- **Порядок предложения контракта стал значимым для результата.** Форма команды `ProposeContractToHero` не изменилась, но её исход теперь зависит от `AcceptedBy`, то есть от порядка предыдущих команд. Сценарии, различающиеся только порядком, законно расходятся.
- **Порядок перебора принципов — часть канонического артефакта**, поэтому он не предполагается, а проверяется на каждом вызове правила: черты во входе обязаны быть строго отсортированы по `Id`.
- **Границы контента заявлены дважды** — в `ContentBounds`/`ContentLimits` и в JSON-схемах — и это осознанно: схема проверяет автора и стадию валидации, константы проверяют каждую загрузку. Расхождение двух заявлений ловит `SchemaAgreementTests`; третьего заявления тех же чисел внутри функции счёта быть не должно.
- **Статус `proposed` при уже сделанной реализации.** `AGENTS.md` §5 говорит, что `proposed` не является разрешением реализовать спорный вариант. Здесь запись фиксирует уже сделанное по согласованному плану, а не открывает работу; спорным остаётся не факт изменения контрактов, а то, останутся ли они такими после плейтеста Milestone 1. Принимает запись владелец продукта.

## Проверка

Реализация: `simulation/OathAndCoin.Simulation/Decisions/` (`CausalTrace.cs`, `ContractDecisionRule.cs`, `DecisionContext.cs`, `ReasonCodes.cs`), `simulation/OathAndCoin.Simulation/State/` (`ContractState.cs`, `HeroState.cs`), `simulation/OathAndCoin.Simulation/SimulationEngine.cs`, `adapters/OathAndCoin.Content/` (`ContentSet.cs`, `ContentBounds.cs`, `ContentLimits.cs`, `LocaleCatalogue.cs`, `Scenarios/DeterminismArtifact.cs`, `Scenarios/ScenarioRunner.cs`, `Scenarios/ContrastDefinition.cs`, `Scenarios/ContrastRunner.cs`), `adapters/OathAndCoin.Presentation/`, `schemas/`, `content/`.

Тесты, которые покраснеют при отмене решения:

- **`BlockedBy` называет сущность** — `tests/OathAndCoin.Simulation.Tests/CausalTraceTests.cs`: `BlockedBy_NamesTheEntityThatBlocked`, `CausalTrace_RejectsDefaultImmutableArrayFactorCollections`; `tests/OathAndCoin.Content.Tests/ReplayDeterminismTests.cs`: `Artifact_RendersBlockedByAsObjectsWithSourceEntity`; `tests/OathAndCoin.Presentation.Tests/ContractOfferScreenModelTests.cs`: `FromOutcome_NamesTheBlockingPrincipleNotJustTheHero`.
- **`SelectedScore` отсутствует ровно на воротах** — `CausalTraceTests.cs`: `SelectedScore_IsNullExactlyWhenBlocked`, `DecisionResult_RejectsScoreTogetherWithBlock`, `DecisionResult_RejectsMissingScoreWithoutBlock`, `DecisionResult_ValidatesScoreAgainstBlockRegardlessOfInitializerOrder`; `ReplayDeterminismTests.cs`: `Artifact_OmitsSelectedScoreEntirelyWhenBlocked`, `Artifact_IncludesSelectedScoreForAnOrdinaryDecision`.
- **Поля состояния контракта и их равенство** — `tests/OathAndCoin.Simulation.Tests/StructuralEqualityTests.cs`: `ContractState_EqualityComparesAcceptedByMemberwise`, `ContractState_EqualityComparesTagsMemberwise`, `HeroState_EqualityComparesRelationshipsMemberwise`, `GetHashCode_IsConsistentWithEquals`; `tests/OathAndCoin.Simulation.Tests/ProposeContractTests.cs`: `Propose_KeepsAcceptedByASubsetOfRespondedBy`, `Propose_MarksContractCrewedWhenRequiredCrewIsReached`, `Propose_AddsAcceptingHeroToCrewAndKeepsOfferOpen`, `Propose_RejectsProposalOnAnAlreadyCrewedContract`, `Propose_RecordsBondFactorNamingTheAcceptedComradesDefinition`; `ReplayDeterminismTests.cs`: `Artifact_DistinguishesContractsThatDifferOnlyInTags`, `Artifact_DistinguishesContractsThatDifferOnlyInRequiredCrew`, `Artifact_DistinguishesContractsThatDifferOnlyInAcceptedBy`, `Artifact_DistinguishesHeroesThatDifferOnlyInPride`, `Artifact_DistinguishesHeroesThatDifferOnlyInTraits`, `Artifact_DistinguishesHeroesThatDifferOnlyInRelationships`.
- **Расход ординалов на воротах** — `ProposeContractTests.cs`: `Propose_KeepsOrdinalUnchangedWhenAPrincipleBlocked`, `Propose_NextScoredDecisionReusesTheOrdinalTheGateDidNotRead`; `tests/OathAndCoin.Simulation.Tests/GameStateTests.cs`: `WithEvent_LeavesDecisionOrdinalUntouchedWhenNothingWasDrawn`, `WithEvent_AdvancesDecisionOrdinalByTheDrawsActuallyConsumed`; `tests/OathAndCoin.Content.Tests/ScenarioCoverageTests.cs`: `MixedGateThenDecisions_TheBlockedStepSpendsNoRandomnessAndTheOtherTwoSpendExactlyOneEach`. Все три утверждают ординал **напрямую** — сравнением `NextDecisionOrdinal` с ожидаемым числом, а не сверкой артефакта с эталоном: реализация, тратящая ординал на воротах, обязана краснеть здесь, а не только там, где расхождение объяснимо любой правкой правил.
- **Вход правила** — `tests/OathAndCoin.Simulation.Tests/ContractDecisionRuleTests.cs`: `Decide_BondsCountOnlyHeroesWhoAlreadyAccepted`, `Decide_IgnoresInclinationWhoseTagTheContractLacks`; `ProposeContractTests.cs`: `Propose_ResolvesTraitsRegardlessOfTheirAuthoredOrder`; граница ядра — `CoreBoundaryTests.cs`: `SimulationAssemblies_ReferenceNoEngineAssemblyOrType`, `SimulationAssemblies_UseNoSingleOrDoublePrecisionFloat`.
- **Версия формата контента 2** — `tests/OathAndCoin.Content.Tests/ContentSetTests.cs`: `Load_RejectsSchemaVersionOne`, `Load_RejectsSchemaVersionOneWithoutTraitsDirectory`, `Load_ReadsTraitDefinitions`, `Load_ReadsPrincipleWithoutWeight`, `Load_RejectsWeightOnPrinciple`, `Load_ReadsHeroTraitsAndRelationships`, `Load_ReadsContractTagsAndCrew`, `Load_AcceptsPartialSetWhereNoContractCarriesTheTag`; `SchemaAgreementTests.cs`: `SchemaVersionConst_MatchesLoaderSupportedVersion`, `TraitSchema_RejectsPrincipleWithWeight`, `AllContentFiles_SatisfyTheirSchema`, `HeroSchemaLimits_MatchContentLimits`, `ContractSchemaLimits_MatchContentLimits`; каталог локализации — `LocaleCatalogueTests.cs`: `Load_ReadsEntries`, `Load_RejectsDuplicateKey`, `Load_RejectsUnsupportedSchemaVersion`.
- **Версия артефакта 2 и версия правил** — `ReplayDeterminismTests.cs`: `Artifact_DeclaresVersionTwoAndTheMilestoneOneRuleset`, `SameSeed_ProducesIdenticalCanonicalArtifact`, `CanonicalArtifact_ContainsFinalStateAndTraces`; `tests/OathAndCoin.Content.Tests/ScenarioCoverageTests.cs`: `EveryScenarioReplaysToItsCanonicalArtifact`.
- **Контрастные пары как отдельный формат** — `tests/OathAndCoin.Content.Tests/ContrastTests.cs`: `ContrastDefinition_RejectsAnInputOutsideTheClosedList`, `ContrastDefinition_RejectsFromEqualToTo`, `ContrastRunner_UsesTheSameSeedAndOrdinalOnBothSides`; неизменность формата манифеста — `ScenarioManifestTests.cs`: `AllScenarioManifests_SatisfyTheirSchema`, `Load_FailsOnUnsupportedSchemaVersion`.

Пересмотр — при появлении сохранений (`ADR-006`, Milestone 3): версионирование контента впервые встретится с версионированием сохранённого состояния, и правило «файл прежней версии не читается» придётся проверить на данных, которые нельзя переписать вручную. Второй повод — торг об условиях (`DEC-008`): он первым добавит к решению вход, которого сегодня нет, и покажет, выдержал ли `DecisionContext` своё назначение.

## Связи

`AGENTS.md` §5, §6; `TDD` §7.1, §7.4, §8, §11, §21; `MVP_PLAN` §4.2, §5. [`DEC-010`](DEC-010-hero-decision-model.md), [`HERO_DECISION_SPEC`](../technical/HERO_DECISION_SPEC.md); `ADR-002`, `ADR-003`, `ADR-004`, `ADR-005`, `ADR-007`, `ADR-008`.
