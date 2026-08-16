# Oath & Coin — Technical Design Document

> Версия: 0.1
>
> Статус: proposed architecture skeleton
>
> Product source of truth: [`../design/GDD.md`](../design/GDD.md)
>
> Delivery source of truth: [`../production/MVP_PLAN.md`](../production/MVP_PLAN.md)

## 1. Назначение

TDD определяет технические границы, контракты и качества системы. Конкретные технологии намеренно не выбраны до Gate 0.

Документ не определяет художественный замысел и не закрывает геймдизайн-вопросы. Когда техническое решение меняет наблюдаемое поведение игрока, требуется отдельный `DEC`, а не только `ADR`.

## 2. Архитектурные цели

1. **Воспроизводимость:** ошибку или балансировочный случай можно повторить по seed и журналу команд.
2. **Объяснимость:** значимое решение героя имеет машинный causal trace.
3. **Headless execution:** симуляция работает без UI и графического движка.
4. **Data-driven content:** добавление контента обычно не требует изменения core-кода.
5. **Тестируемость:** правила проверяются на уровнях unit, scenario, property и batch.
6. **Эволюция:** сохранения и данные имеют версии и план миграции.
7. **Наблюдаемость:** состояние, команды, события и ошибки можно диагностировать.
8. **Scope control:** архитектура обслуживает текущий milestone, а не гипотетическую MMO.

## 3. Предлагаемая схема

```text
┌──────────────────────── Presentation ────────────────────────┐
│ UI, input, animation, audio, localization, view models       │
└───────────────────────────┬───────────────────────────────────┘
                            │ PlayerCommand / Query
┌───────────────────────────▼───────────────────────────────────┐
│ Application                                                   │
│ use cases, orchestration, save/load, milestone flow           │
└───────────────────────────┬───────────────────────────────────┘
                            │ SimulationCommand
┌───────────────────────────▼───────────────────────────────────┐
│ Simulation Core                                               │
│ heroes, contracts, combat, memory, economy, world ticks       │
│ deterministic rules + explicit RNG streams                    │
└───────────────────────────┬───────────────────────────────────┘
                            │ DomainEvent + CausalTrace
┌───────────────────────────▼───────────────────────────────────┐
│ Adapters & Tools                                              │
│ content loader, persistence, telemetry, headless runner       │
└───────────────────────────────────────────────────────────────┘
```

Зависимости направлены внутрь: simulation core не импортирует UI, animation API, файловую систему или платформенные сервисы.

## 4. Модули и ответственность

### 4.1. Simulation core

- авторитетное состояние кампании;
- проверка допустимости команд;
- переходы состояния;
- deterministic RNG;
- создание domain events;
- causal trace автономных решений;
- инварианты.

### 4.2. Application

- пользовательские use cases;
- начало/продолжение сессии;
- orchestration сохранения;
- управление фазами контракта и кампании;
- преобразование внешнего ввода в команды симуляции;
- запросы read models для UI.

### 4.3. Presentation

- ввод и навигация;
- отображение read models;
- визуализация намерений и trace;
- анимации событий без изменения результата;
- локализованный текст;
- accessibility настройки.

### 4.4. Content

- schemas и validators;
- стабильные content IDs;
- локализуемые ключи;
- определения traits, abilities, enemies, contracts и events;
- fixtures и тестовые наборы.

### 4.5. Persistence

- snapshot состояния;
- версия schema и build/ruleset;
- seed/RNG state;
- migration pipeline;
- проверка целостности;
- безопасная запись через временную версию и атомарную замену, если платформа поддерживает.

### 4.6. Tooling

- headless scenario runner;
- batch simulation;
- trace viewer;
- content validation;
- balance reports;
- сохранение и минимизация failing seeds.

## 5. Базовая модель состояния

Имена предварительные. Нельзя считать эту схему окончательным API до принятия соответствующего ADR.

```text
GameState
├── metadata
│   ├── save_schema_version
│   ├── ruleset_version
│   ├── campaign_seed
│   └── logical_time
├── guild
│   ├── resources
│   ├── reputation
│   ├── culture
│   └── obligations
├── heroes: HeroId → HeroState
├── relationships: HeroPair → RelationshipState
├── contracts: ContractId → ContractState
├── expeditions: ExpeditionId → ExpeditionState
├── world
│   ├── locations
│   ├── factions
│   └── threats
└── history
    ├── memories
    ├── domain_events
    └── chronicle_entries
```

### 5.1. Identity rules

- ID не зависит от отображаемого имени.
- ID уникален в пределах типа и не переиспользуется после удаления сущности.
- Ссылки в content data используют стабильные namespaced IDs.
- Runtime entity IDs создаются детерминированным ID source либо хранятся в команде/event log.
- Сортировка map/set не может неявно влиять на результат симуляции.

## 6. Команды, события и запросы

### 6.1. Команда

Команда выражает намерение игрока или системного scheduler:

```text
ProposeContractToHero
  command_id
  actor_id
  contract_id
  offered_terms
  expected_state_version
```

Команда:

- валидируется до изменения состояния;
- либо применяется полностью, либо отклоняется;
- не содержит локализованного текста как игрового правила;
- возвращает результат и созданные события.

### 6.2. Domain event

Событие — свершившийся факт:

```text
HeroDeclinedContract
  event_id
  logical_time
  hero_id
  contract_id
  causal_trace_id
```

Event log не обязан быть единственным способом persistence в MVP, но события должны позволять диагностировать важные изменения.

### 6.3. Query/read model

UI не получает произвольный mutable доступ к state. Специализированные queries формируют:

- roster summary;
- contract comparison;
- hero profile;
- expedition preparation;
- battle intent;
- after-action report;
- chronicle timeline.

Read model может содержать локализуемые reason codes, confidence и distinction между fact/estimate/unknown.

## 7. Детерминизм

### 7.1. Контракт воспроизводимости

Результат определяется набором:

```text
initial_state
+ ordered_commands
+ ruleset_version
+ content_version
+ RNG algorithm/version
+ seed/stream states
```

### 7.2. RNG streams

Предлагаемые независимые потоки:

- world generation;
- world tick;
- contract generation;
- hero decision;
- expedition event;
- combat;
- cosmetic presentation.

Косметический RNG никогда не меняет симуляцию. Конкретный алгоритм и способ derivation streams должны быть зафиксированы ADR.

### 7.3. Запрещённые источники

В simulation core нельзя использовать без адаптера и фиксации:

- текущее системное время;
- platform random/global random;
- нестабильный порядок hash collections;
- frame delta;
- сетевой ответ;
- локаль машины;
- результат генеративной модели.

### 7.4. Floating point и целевой уровень детерминизма

Целевой уровень для MVP — воспроизводимость на поддерживаемой платформе при фиксированных **`ruleset_version + content_version + RNG version/seed`** (контракт §7.1): этого достаточно для replay, тестов, отладки и багрепортов. Повторная сборка того же ruleset не должна менять replay — воспроизводимость привязана к версиям правил и контента, а не к артефакту сборки. Бит-в-бит кроссплатформенный детерминизм не является требованием MVP — это критерий для `ADR-003`, а не открытая амбиция.

Критичные сравнения должны иметь определённые правила округления/tie-break; для воспроизводимых оценок предпочтительны integer/fixed-point шкалы, если они не усложняют модель непропорционально.

## 8. Hero decision system

Решение должно возвращать действие и trace из одного вычисления, а не реконструировать объяснение постфактум.

```text
DecisionResult
├── selected_action
├── considered_actions[]
├── selected_score_or_priority
├── trace
│   ├── positive_factors[]
│   ├── negative_factors[]
│   ├── blocked_by[]
│   ├── tie_break
│   └── confidence/uncertainty
└── emitted_events[]
```

Каждый фактор использует стабильный reason code, source entity и величину/ранг влияния. UI решает, сколько деталей показать, но не изобретает другую причину.

**Запись о блокировке** (`blocked_by[]`) — не строка, а пара «reason code + source entity»: экран обязан назвать не только то, что сработал жёсткий запрет, но и **какой именно**, иначе он вынужден догадываться по герою, то есть изобретать причину. Величины у записи нет намеренно — жёсткий запрет не является очень большим отрицательным вкладом, он закрывает решение до того, как вклады появятся ([ADR-009](../decisions/ADR-009-decision-contracts-and-content-v2.md), [DEC-010](../decisions/DEC-010-hero-decision-model.md)).

**`selected_score_or_priority` может отсутствовать** — и отсутствует ровно тогда, когда `blocked_by[]` непуст. Заполнитель здесь запрещён: ноль неотличим от честного нуля обычного пути, при правиле «согласие при score ≥ 0» читается как согласие и позволяет проверке «сумма факторов равна итогу» пройти по неверной причине. Эквивалентность «нет счёта ⟺ есть блокировка» — двусторонняя и проверяется с обеих сторон. Всякий читатель trace — артефакт, read model, просмотрщик — обязан уметь эту форму: отсутствие счёта законно, а не является потерей данных.

Долговечная форма модели решения Milestone 1 — [`HERO_DECISION_SPEC`](HERO_DECISION_SPEC.md).

### Инварианты

- выбранное действие присутствует среди допустимых;
- hard taboo/constraint не обходится обычным положительным score;
- tie-break детерминирован;
- trace соответствует использованным данным;
- изменение незначимого поля не меняет решение;
- отсутствующая локализация не ломает логику.

## 9. Combat simulation

Конкретная пространственно-временная модель блокируется решениями G0-D2/G0-D3. Независимо от выбора:

- бой получает immutable snapshot участников и подготовительных решений;
- внешний UI не изменяет state напрямую;
- simulation step создаёт intents, resolutions и events;
- результат не зависит от frame rate или animation timing;
- смерть/травма/отступление разрешаются доменными правилами;
- battle replay возможен по initial snapshot, commands и RNG state;
- batch runner использует тот же core, что и клиент.

## 10. Время и scheduler

Нужны минимум три явных масштаба:

- campaign logical time;
- expedition phase/time;
- combat step/time.

Нельзя использовать одно неструктурированное число для всех масштабов без спецификации переходов. Advancement времени — команда или доменная операция с явным порядком обработки систем.

До реализации живого мира необходимо зафиксировать:

- порядок обновления фракций, угроз, контрактов и экономики;
- обработку одновременно наступивших событий;
- tie-break;
- происходят ли ticks во время активной экспедиции.

## 11. Content pipeline

### 11.1. Требования

- человекочитаемый формат с утверждённой schema;
- стабильные namespaced IDs;
- обязательная версия content schema;
- ссылки валидируются до запуска игры;
- дубликаты, циклы и недостижимые ссылки диагностируются;
- gameplay values отделены от localization keys;
- schema допускает небольшие overrides/composition, но не произвольный код;
- тестовые fixtures хранятся отдельно от production content.

### 11.2. Validation stages

1. Schema/type validation.
2. Referential integrity.
3. Semantic validation диапазонов и взаимоисключающих полей.
4. Domain invariants.
5. Smoke simulation контентных сущностей.

## 12. Persistence

Минимальный save header:

```text
format_version
save_schema_version
ruleset_version
content_version
created_at (metadata only)
campaign_seed
logical_time
checksum
```

Текущее время может храниться как метаданные файла, но не влияет на симуляцию.

### Policy, требующая ADR

- snapshot-only, snapshot + command log или event sourcing;
- частота autosave;
- число слотов;
- backward compatibility window;
- поведение при отсутствующем/modded content;
- crash-safe write на целевых платформах.

К Milestone 3 обязательны round-trip tests и deterministic continuation после загрузки.

## 13. Наблюдаемость и диагностика

Каждый тестовый запуск должен уметь вывести:

- build/ruleset/content versions;
- campaign и subsystem seeds;
- список команд;
- ключевые domain events;
- causal trace;
- нарушенный invariant;
- checksum состояния на контрольных шагах.

Логи не должны содержать секреты платформы или персональные данные тестеров. Telemetry проектируется отдельно и включается только после решения о privacy/consent.

## 14. Headless simulation harness

Минимальные режимы:

```text
run-scenario <fixture> --seed <n>
replay <recording>
batch-combat <fixture> --seeds <range>
batch-campaign <fixture> --runs <n>
validate-content
diff-rulesets <old> <new> <scenario-set>
```

Формат CLI зависит от стека; перечисленные capabilities обязательны, конкретные команды — нет.

Batch report должен агрегировать:

- win/fail/retreat/death rates;
- длительность;
- частоту действий и причин;
- недостижимые действия/контент;
- доминирующие составы и доктрины;
- распределение денег, травм и churn героев;
- failing seeds.

## 15. Стратегия тестирования

### Unit

- formulas;
- command validation;
- state transitions;
- reason factor evaluation;
- content validators.

### Scenario/golden

- согласие и отказ героев;
- конфликт мотивов;
- нарушение доктрины;
- отступление/травма/смерть;
- контрактная цепочка;
- save/load continuation.

Golden scenario фиксирует смысловые события и checksum на стабильных границах, но не обязан фиксировать presentation text.

### Property/invariant

- герой не находится в двух экспедициях;
- погибший не принимает решения;
- деньги/инвентарь не уходят в недопустимое состояние;
- контракт разрешается один раз;
- все ссылки существуют;
- каждое значимое решение имеет trace;
- одинаковый вход даёт одинаковый выход.

### Batch/regression

- распределения исходов;
- редкие deadlocks;
- бесконечные бои;
- экономические спирали;
- недостижимый контент;
- сравнение rulesets.

## 16. Производительность

Точные budgets принимаются после выбора платформы. До этого действуют относительные требования:

- UI и animation не блокируют simulation batch;
- один бой может симулироваться быстрее реального времени без presentation;
- batch из тысяч коротких боёв не требует запуска графического клиента;
- profile data измеряется, а не предполагается;
- оптимизация не ухудшает детерминизм и trace без отдельного решения.

## 17. Локализация и текст

- игровые правила используют reason/event codes;
- текст формируется presentation/localization layer;
- параметры подставляются структурированно;
- pluralization и grammar учитываются выбранной библиотекой;
- fallback локаль явная;
- runtime AI text generation не является зависимостью MVP;
- chronicles хранят факты и ссылки, а не только готовую строку.

## 18. Безопасность и приватность

Для offline single-player MVP attack surface мал, но необходимо:

- валидировать внешние content/save data;
- ограничивать размер и глубину загружаемых структур;
- не выполнять код из data files;
- не включать приватные пути и токены в crash reports;
- документировать opt-in telemetry;
- закрепить версии third-party dependencies.

## 19. CI quality gates

Минимальный pipeline после Gate 0:

1. formatting/lint;
2. compile/typecheck;
3. content validation;
4. unit tests;
5. deterministic scenario tests;
6. save round-trip tests после Milestone 3;
7. короткий headless smoke batch;
8. artifact с failing logs/seeds.

Длинные batch simulations могут выполняться по расписанию, но regression scenarios — в каждом PR.

## 20. Предлагаемая структура репозитория

Конкретные имена адаптируются к стеку после ADR:

```text
docs/
  design/
  production/
  technical/
  systems/
  decisions/
  research/
game/                  # presentation/application host
simulation/            # engine-independent core
content/
schemas/
tests/
  unit/
  scenarios/
  integration/
tools/
  simulation-runner/
  content-validator/
```

Не нужно создавать пустые каталоги до появления их первого артефакта.

## 21. Реестр технических ADR

Блокирующие решения Gate 0 сгруппированы в четыре блока (MVP_PLAN §4.1); остальные ADR принимаются позже.

| ID | Решение | Когда | Критерии выбора |
|---|---|---|---|
| ADR-001 | Движок и язык | принят 2026-08-13: [ADR-001](../decisions/ADR-001-engine-and-language.md) | скорость агентной разработки, UI, 2D/3D, headless, CI, лицензия |
| ADR-002 | Core boundary | принят 2026-08-13: [ADR-002](../decisions/ADR-002-simulation-core-boundary.md) | отсутствие engine imports, serializable state, test runner |
| ADR-003 | RNG | принят 2026-08-13: [ADR-003](../decisions/ADR-003-deterministic-rng.md) | стабильность, streams, replay, cross-platform behavior |
| ADR-004 | Content format/schema | принят 2026-08-13: [ADR-004](../decisions/ADR-004-content-format.md) | tooling, diffability, validation, localization |
| ADR-005 | IDs and references | принят 2026-08-13: [ADR-005](../decisions/ADR-005-stable-ids.md) | стабильность, диагностика, mod/content evolution |
| ADR-006 | Save strategy | Milestone 3 | migration, crash safety, replay/debug value |
| ADR-007 | Event and causal trace | принят 2026-08-13: [ADR-007](../decisions/ADR-007-events-and-causal-trace.md) | размер, запросы UI, debugging, localization |
| ADR-008 | Test/headless tooling | принят 2026-08-15: [ADR-008](../decisions/ADR-008-runtime-harness.md) | локальный запуск, CI, batch performance |
| ADR-009 | Контракты решения и формат контента 2 | предложен 2026-08-15: [ADR-009](../decisions/ADR-009-decision-contracts-and-content-v2.md) | наблюдаемость причины, версионирование формата и правил, граница ядра |

Фиксированный симуляционный тик, под который номер `ADR-009` держали пустым, отозван из Gate 0 и входит в постановку модели времени боя на старте Milestone 2 (§9); свой номер он получит там.

## 22. Открытые технические вопросы

- Snapshot + command log или полный event sourcing оправдан для MVP?
- ~~Какая часть trace хранится постоянно?~~ Закрыто [ADR-007](../decisions/ADR-007-events-and-causal-trace.md): trace хранится в состоянии целиком и адресуется `TraceId` из события. Открытым остаётся, как он агрегируется в хронику кампании — вопрос Milestone 3.
- Как минимизировать failing scenario автоматически?
- Нужен ли mod-ready namespace с первого MVP или только возможность эволюции data schemas?
- Как обеспечить локализуемые причинные фразы для языков с различной грамматикой?
- Где проходит граница между доменным событием и presentation-only событием боя?
- Нужна ли background simulation thread в клиенте или последовательная модель достаточна?

## 23. Следующее действие

Не начинать реализацию полной игры из этого каркаса. Следующий технический шаг — принять Gate 0 и создать минимальный simulation spike, который:

1. загружает двух героев и контракт из валидируемых данных;
2. применяет одну команду предложения контракта;
3. возвращает детерминированное решение с causal trace;
4. воспроизводит результат по seed;
5. выполняется в headless test runner.
