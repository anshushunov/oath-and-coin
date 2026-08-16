# Полная миграция на TypeScript — рубеж, журнал и доказательства

> Решение: [`ADR-010`](../decisions/ADR-010-full-typescript-web-stack.md) (accepted, 2026-08-16)
>
> Область: замена Godot 4.7.1 + C# на TypeScript + React + PixiJS + Vite + Vitest + Playwright + Zod + Electron

Этот файл — журнал миграции. Он держит две вещи, которых нет больше нигде: **измеренный рубеж**, от которого миграция считается, и **таблицу гейтов**, в которой у каждого утверждения есть команда, артефакт и результат. Ничто здесь не пересказывается по памяти: число без команды, которой оно снято, в этот файл не попадает (`AGENTS.md` §11).

## 1. Рубеж

### 1.1. Коммит

| Факт | Значение | Команда |
|---|---|---|
| Ветка на момент снятия | `main` | `git branch --show-current` |
| Baseline commit | `12565862b1e88e0524f95def18c023571ec4269f` | `git rev-parse HEAD` |
| Состояние дерева | чистое (пустой вывод) | `git status --short` |
| Ветка сегмента Tasks 1–2 | `migration/01-oracle`, создана от baseline | `git checkout -b migration/01-oracle` |

`12565862` — merge PR #9 «hero decision core». Это и есть рубеж: миграция сохраняет поведение, доказанное на нём, а не поведение более раннего Gate 0.

### 1.2. Тестовый набор

Команда: `dotnet test OathAndCoin.sln -c Release` (SDK 8.0.424, пин `global.json`, `rollForward: disable`).

| Сборка тестов | Пройдено | Не пройдено | Пропущено |
|---|---:|---:|---:|
| `OathAndCoin.Simulation.Tests` | 174 | 0 | 0 |
| `OathAndCoin.Content.Tests` | 145 | 0 | 0 |
| `OathAndCoin.Presentation.Tests` | 91 | 0 | 0 |
| `OathAndCoin.Harness.Tests` | 75 | 0 | 0 |
| `OathAndCoin.GameProtocol.Tests` | 26 | 0 | 0 |
| **Итого** | **511** | **0** | **0** |

Число тестов — **511**, а не 499, как сообщал отчёт PR #9. Parity привязывается к перенесённым инвариантам, а не к числу тестовых методов: см. `AGENTS.md` §8 и Task 9 Step 1 плана миграции («port behavioral tests by invariant, not by test count»).

### 1.3. Сценарии

| Факт | Значение | Команда |
|---|---|---|
| Файлов `*.manifest.json` | 27 | `ls scenarios/*.manifest.json \| wc -l` |
| Именованных checkpoints | 27 (ровно один на манифест) | `for f in scenarios/*.manifest.json; do jq -c '[.checkpoints[].name]' "$f"; done` |

Манифестов без именованного checkpoint в дереве нет, поэтому запись корпуса адресуется именем checkpoint (`scenarios/<scenario>/<checkpoint>/seed-<seed>.json`), а запасная запись `final` не создаётся ни для одного сценария по отсутствию имени.

### 1.4. Объём C#

Команда: `bash ./scripts/code-lines.sh <path>...`. Правило счёта живёт в самом скрипте: строка считается кодом, если она не пуста и не начинается — после отступа — с `//`.

| Область | code | raw |
|---|---:|---:|
| `simulation` | 1045 | 2522 |
| `adapters` | 2824 | 5488 |
| `tools` | 1224 | 2472 |
| `tests` | 8221 | 12 823 |
| `game` | 500 | 1103 |
| **Итого** (`simulation adapters tools tests game`) | **13 814** | **24 408** |
| `tools/OathAndCoin.Harness` (потолок `ADR-008` — 1100) | 1082 | 2255 |

**Расхождение с оценочными документами, зафиксированное здесь как факт.** Решение о стеке (§11) называет «примерно 24 400 code lines по правилу `scripts/code-lines.sh`» и перечисляет 2522 / 5488 / 2472 / 12 823 / 1103. Эти числа — колонка `raw` того же скрипта, то есть строки вместе с пустыми и комментариями. По правилу `code` объём равен **13 814**. Оценка сроков в решении опиралась на большее из двух чисел, поэтому исправление ничего не удлиняет; переоценка объёма не производится, но дальнейшие сравнения «сколько осталось перенести» ведутся по колонке `code` и по этой таблице, а не по прежним числам.

### 1.5. Пины окружения на рубеже

| Пин | Значение | Источник |
|---|---|---|
| .NET SDK | 8.0.424, `rollForward: disable` | `global.json` |
| Godot | `Godot.NET.Sdk/4.7.1` | `ADR-001` |
| Версия артефакта детерминизма | 3 | `DeterminismArtifact.ArtifactVersion` |
| Версия правил | `m1-decision/1` | `ScenarioRunner.RulesetVersion` |
| Версия формата контента | 2 | `ContentSet.SupportedContentSchemaVersion` |
| Версия схемы сохранения | 1 | `ContentSet.SaveSchemaVersion` |
| Версия формата манифеста | 1 | `ScenarioManifest.SupportedManifestSchemaVersion` |
| Алгоритм RNG | `splitmix64-composed/1` | `DeterministicRng.AlgorithmVersion` |

### 1.6. Feature freeze

Feature freeze для новой функциональности старого runtime действует с принятия `ADR-010` (2026-08-16) до **2026-10-11**. Исключения: извлечение oracle, дефекты миграции и критические исправления данных. Продление после этой даты — отдельное решение владельца; возврат продуктовых фич в Godot и молчаливое сокращение migration DoD допустимым способом уложиться в срок не являются.

## 2. Журнал гейтов

Один focused work day — не менее 6 часов работы непосредственно над миграцией, без ожидания CI, внешнего ревью и организационных пауз; календарная модель предполагает 5 focused days в неделю.

Даты завершения не проставляются заранее. Пустая ячейка означает «ещё не сделано», а не «сделано без записи».

| Gate | Владелец | Начато | Завершено | Команда | Артефакт | Результат | Решение |
|---|---|---|---|---|---|---|---|
| Task 1 — рубеж и ADR-010 | agent | 2026-08-16 | 2026-08-16 | `dotnet test OathAndCoin.sln -c Release`; `bash ./scripts/code-lines.sh simulation adapters tools tests game` | §1 этого файла; `docs/decisions/ADR-010-full-typescript-web-stack.md` | 511 тестов зелёные; 27 манифестов; code=13 814 raw=24 408 | принят: рубеж `12565862`, `ADR-010` accepted |
| Task 2 — неизменяемый oracle corpus | agent | 2026-08-16 | 2026-08-16 | `dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1`; `dotnet test tests/OathAndCoin.MigrationOracle.Tests/OathAndCoin.MigrationOracle.Tests.csproj -c Release`; `git diff --exit-code -- migration/oracle/v1` | `migration/oracle/v1/**` (58 файлов, manifest SHA-256 `b6af9b19…9f35`); §3 этого файла | 27/27 манифестов, 54 записи на двух seed; 20/20 тестов корпуса; повторный экспорт побайтно идентичен; четыре мутанта красят проверки (§3.5, §3.6) | принят после внешнего ревью codex; правки — коммит `94f4e24` |
| Task 3 — pinned TypeScript workspace | agent | 2026-08-16 | 2026-08-17 | `corepack enable`; `pnpm install --frozen-lockfile`; `pnpm typecheck`; `pnpm test`; `pnpm test:e2e` | `pnpm-lock.yaml`; `tests/architecture/workspace.test.ts`; §5 этого файла | pnpm 11.22.0 с integrity-хешем, TypeScript 6.0.3, Node 24.12.0; 12 проверок workspace и 2 браузерных зелёные; 10 мутантов красят (§5.4) | принят |
| Task 4 — packaged Electron gate (**stop gate**) | agent | 2026-08-16 | 2026-08-17 | `pnpm package:desktop`; `pnpm test:desktop` | `artifacts/electron-spike/gate-report.json`; §5.2 | 6/6 проверок гейта зелёные на packaged-сборке; 304,3 МиБ установлено и 331,3 МиБ RSS локально; 6 мутантов красят | сужен `ADR-011`: Steam изъят, порог размера снят, бюджет RSS сохранён |
| Task 5 — архитектурные границы и dual-stack CI | agent | 2026-08-16 | 2026-08-17 | `pnpm lint:deps`; `pnpm test` | `.dependency-cruiser.cjs`; `.github/workflows/typescript.yml`; §5.3 | 21 модуль, 25 зависимостей, 0 нарушений; оба стека зелёные в одном пуше (531 тест .NET + 23 TypeScript); ветка-мутант красит новую стадию | принят |
| Task 6 — canonical JSON, ID и контракты контента на Zod | | | | `pnpm --filter @oath-and-coin/content test`; `pnpm schema:check` | `schemas/generated/**` | | |
| Task 7 — детерминированный RNG | | | | `pnpm --filter @oath-and-coin/simulation test -- deterministic-rng` | `migration/oracle/v1/rng-vectors.json` | | |
| Task 8 — состояние, команды, события, следы | | | | `pnpm --filter @oath-and-coin/simulation test` | | | |
| Task 9 — правило решения героя и движок (**stop gate**) | | | | `pnpm --filter @oath-and-coin/simulation test`; benchmark | baseline p50/p95 JSON | | parity к 2026-09-20 либо 10 focused days на Tasks 7–10 |
| Task 10 — исполнение сценариев и oracle parity | | | | `pnpm test:scenario`; `... parity --oracle migration/oracle/v1` | отчёт parity | | 27 манифестов и все checkpoints |
| Task 11 — presentation models | | | | `pnpm --filter @oath-and-coin/presentation test` | | | |
| Task 12 — application store и порты | | | | `pnpm --filter @oath-and-coin/application test` | | | |
| Task 13 — React contract-offer screen | | | | `pnpm --filter @oath-and-coin/web test`; `... build` | | | |
| Task 14 — PixiJS scene facade | | | | `pnpm --filter @oath-and-coin/web test` | | | |
| Task 15 — browser evidence вместо Godot harness | | | | `pnpm test:e2e` | screenshot + JSONL + report на каждое состояние | | |
| Task 16 — версионированные атомарные сохранения | | | | `pnpm --filter @oath-and-coin/application test`; `pnpm --filter @oath-and-coin/desktop test` | | | |
| Task 17 — production Electron host | | | | `pnpm package:desktop`; `pnpm test:desktop` | packaged report, SHA-256, RSS | | RSS ≤ 500 МБ; размер пакета снимается **без порога** (`ADR-011`); Steam-часть задачи не выполняется, пока не принято решение о релизе |
| Task 18 — производительность, supply chain, релизные гейты | | | | `pnpm verify`; `node scripts/audit-runtime-dependencies.mjs`; `dotnet test OathAndCoin.sln -c Release` | benchmark artifacts | | старый и новый гейты зелёные одновременно |
| Task 19 — cutover и удаление Godot/.NET | | | | `rg --files \| rg "(\.cs$\|\.csproj$\|\.sln$\|\.tscn$\|\.uid$\|project\.godot$)"`; `pnpm verify` | | | требует зелёных Tasks 2, 4, 10, 15, 17, 18 |
| Task 20 — финальная проверка и закрытие решения | | | | `pnpm install --frozen-lockfile`; `pnpm verify`; `pnpm build`; `pnpm package:desktop`; `pnpm test:desktop` | `artifacts/migration-final/**` | | заметка о завершении реализации в `ADR-010` |

### 2.1. Ветки и точки внешнего ревью

Работа идёт шестью последовательными ветками, каждая создаётся от обновлённого `main` после merge предыдущего segment PR:

| Ветка | Tasks | Внешнее ревью до merge |
|---|---|---|
| `migration/01-oracle` | 1–2 | обязательно |
| `migration/02-foundation` | 3–5 | обязательно (Task 5) |
| `migration/03-core` | 6–10 | обязательно (Task 10) |
| `migration/04-ui` | 11–15 | обязательно (Task 15) |
| `migration/05-delivery` | 16–18 | обязательно (Task 18) |
| `migration/06-cutover` | 19–20 | обязательно (Task 20) |

Стоп-гейты Tasks 4 и 9 решением о merge не обходятся.

## 3. Доказательства Task 2 — oracle corpus

### 3.1. Что экспортируется

`tools/OathAndCoin.MigrationOracle` — read-only экспортёр. Он вызывает production-загрузчики, правила и фабрику представления (`ContentSchemas`, `ContentSet`, `ScenarioManifest`, `ScenarioCommands`, `CheckpointResolver`, `ScenarioRunner`, `DeterminismArtifact`, `ContractOfferScreenModelFactory`, `DeterministicRng`, `CanonicalJson`) и не содержит ни одной копии решающего правила.

**Что покрыто по ошибкам, и что нет.** Из пяти стабильных кодов `ErrorCodes` корпус содержит один — `CONTENT_ROOT_NOT_FOUND`, единственный, который объявляет хоть один манифест дерева. `SCHEMA_INVALID` и `CONTENT_INVALID` экспортёр обрабатывает как данные, но на валидном контенте эти ветки недостижимы, поэтому записей нет. `SCENARIO_INVALID` и `CHECKPOINT_UNKNOWN` экспортёр не обрабатывает вовсе: испорченный manifest или commands прерывают экспорт. Утверждать, что «ошибки загрузчиков становятся данными корпуса», значит утверждать больше, чем сделано.

Это осознанный предел, а не оплошность: задание Task 2 требовало покрыть **фактические** манифесты и checkpoints HEAD, а сценариев с этими четырьмя кодами в дереве нет — их добавление означало бы изобретение нового контента. Долг адресный: перенос порядка стадий загрузки и всех пяти кодов проверяется в Task 10 (parity сценариев и кодов ошибок), а не остаётся ничьим. Найдено внешним ревью сегмента.

Состав `migration/oracle/v1`:

| Файл | Содержание |
|---|---|
| `manifest.json` | версия схемы артефакта, baseline commit, SHA-256 каждого файла корпуса, перечень 27 сценариев и их checkpoints |
| `rng-vectors.json` | все 7 значений `RngStream`, граничные seeds, ординалы вокруг нуля, диапазоны `DrawInt32` с числом потраченных ординалов и случаи из `tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json` |
| `jcs-compatibility-vectors.json` | вход, текущие канонические байты/хеш C#, целевые байты/хеш RFC 8785 и признак совпадения версии артефакта |
| `scenarios/<scenario>/<checkpoint>.json` | входы, исход и код ошибки, финальное состояние, шаги, события, следы, presentation read model, канонические байты и SHA-256 |
| `README.md` | правило неизменности корпуса |

Корпус заморожен на **двух** seed — 7 и 424242, — и seed входит в идентичность записи (`scenarios/<scenario>/<checkpoint>/seed-<seed>.json`).

- **7** — тот же seed, под которым `ScenarioCoverageTests.EveryScenarioReplaysToItsCanonicalArtifact` воспроизводит каждый сценарий, поэтому запись на нём, checkpoint которой покрывает весь список команд, обязана побайтно совпасть с закоммиченным `scenarios/<scenario>.canonical.json`. Корпус на одном лишь чужом seed был бы внутренне согласованным и не связанным с уже проверенным свидетельством репозитория.
- **424242** — seed, под которым реально гоняется живой harness (`CommandLine.DefaultSeed`) и CI-проверка детерминизма.

Второй seed добавлен по итогам внешнего ревью, и не для симметрии. Мутант `content.CreateInitialState(seed, …)` → `content.CreateInitialState(7UL, …)` на корпусе из одного seed оставлял **все 18** тестов зелёными: порт, полностью игнорирующий переданный seed, совпал бы с оракулом идеально. Ловил этот мутант ровно один тест в `OathAndCoin.Content.Tests` — то есть в наборе, который удаляется на Task 19 вместе с гарантией. Теперь мутант красит 2 теста оракула, а `EveryEntry_CarriesTheSeedItWasRunUnder` сверяет seed записи с `final_state.metadata.campaign_seed` — местом, где прогон единственно может сообщить, что ему на самом деле дали.

`screen_incomplete` — единственный сценарий, где checkpoint намеренно останавливается после первой из шести команд; тест утверждает расхождение с полным canonical-артефактом, чтобы checkpoint, молча начавший покрывать всё, был замечен.

### 3.2. Размер и дайджест

| Факт | Значение | Команда |
|---|---|---|
| Файлов в корпусе | 58 (54 записи + `manifest.json` + `rng-vectors.json` + `jcs-compatibility-vectors.json` + `README.md`) | `fd . migration/oracle/v1 --type f \| wc -l` |
| Сценариев / checkpoints / записей | 27 / 27 / 54 (два seed на checkpoint) | `jq '{scenarios:(.scenarios\|length), entries:([.scenarios[].checkpoints[].entries[]]\|length)}' migration/oracle/v1/manifest.json` |
| Файлов под дайджестом | 57 (все, кроме самого `manifest.json`) | `jq '.files\|length' migration/oracle/v1/manifest.json` |
| Суммарный объём файлов под дайджестом | 1 672 238 байт | `jq '[.files[].bytes]\|add' migration/oracle/v1/manifest.json` |
| SHA-256 корневого `manifest.json` | `b6af9b19c5f2eb89fdacac9737450bb6d6cf9bc335407aff372919de67809f35` | `sha256sum migration/oracle/v1/manifest.json` |
| Строк RNG-векторов | 306 raw + 1764 int32, 7 потоков | `jq '{raw:(.raw_draws\|length), int32:(.int32_draws\|length), streams:(.streams\|length)}' migration/oracle/v1/rng-vectors.json` |

### 3.3. Расхождение текущей канонизации с RFC 8785

`jcs-compatibility-vectors.json` содержит 10 векторов. Пять совпадают побайтно (`object_key_ordering`, `nested_structure`, `scalars`, `safe_integer_bounds`, `artifact_shaped_fragment`) — на них старый хеш сохраняет смысл. Пять расходятся и названы поимённо:

| Вектор | Различие |
|---|---|
| `non_ascii_text` | текущий писатель экранирует каждый не-ASCII символ в `\uXXXX`; RFC 8785 выдаёт его литерально в UTF-8 |
| `html_sensitive_text` | encoder по умолчанию экранирует `<`, `>`, `&`, `'`, `+`; RFC 8785 — нет |
| `negative_zero` | RFC 8785 сводит `-0` к `0` (ECMAScript `Number::toString`); текущий писатель сохраняет авторский токен |
| `control_characters` | RFC 8785 использует пять коротких экранов там, где они есть, и `\u00xx` иначе |
| `astral_plane_text` | суррогатная пара: RFC 8785 выдаёт код-поинт как UTF-8, текущий писатель экранирует обе единицы |

Эти пять — счёт, который Task 6 обязан оплатить **одним** явным шагом версии артефакта с сохранённым отображением старых и новых хешей. Молчаливая пересъёмка прежних артефактов под новое правило запрещена.

Область чисел векторов ограничена целыми в пределах ±(2^53−1) — ровно то, что содержит канонический артефакт детерминизма. Дробные числа, экспоненциальные формы и целые за пределами безопасного диапазона этими векторами **не покрыты**: RFC 8785 делегирует их ECMAScript `Number::toString`, и приближённая реализация выдала бы цель, выглядящую авторитетной и неверную. Они закрываются в Task 6 официальными conformance-векторами RFC 8785. Ограничение записано в самом файле (`covered_number_domain`, `out_of_scope`), а не только здесь.

### 3.4. Воспроизводимость

```powershell
dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1
git add migration/oracle/v1
dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1
git diff --exit-code -- migration/oracle/v1
```

Результат: `git diff --exit-code` вернул 0 и не напечатал ничего — второй экспорт побайтно совпал с первым. Первый экспорт индексируется намеренно: untracked-файлы обычному `git diff` не видны, и без `git add` эта проверка была бы зелёной, ничего не сравнив.

`dotnet test tests/OathAndCoin.MigrationOracle.Tests/OathAndCoin.MigrationOracle.Tests.csproj -c Release` — 18 из 18 пройдено. Полный набор решения после добавления проекта: `dotnet test OathAndCoin.sln -c Release` — **529** пройдено, 0 не пройдено (511 baseline + 18 новых).

### 3.5. Мутация

Гейт, который никогда не краснел, гейтом не является (`AGENTS.md` §8). Мутант поставлен **после** коммита проверяемого состояния (`2dd8c81`), иначе откат мутанта снёс бы саму правку.

**Мутация:** `simulation/OathAndCoin.Simulation/Random/RngStream.cs`, `HeroDecision = 3` → `HeroDecision = 9`.

**Команда:** `dotnet test tests/OathAndCoin.MigrationOracle.Tests/OathAndCoin.MigrationOracle.Tests.csproj -c Release`

**Результат:** 4 из 18 покраснели — три независимых семейства проверок:

| Упавший тест | Что поймал |
|---|---|
| `RngVectors_ReproduceThisBuildsGenerator` | значения draw разошлись: `Assert.Equal() Failure: Strings differ`, ожидалось `8599741187704137444` |
| `RngVectors_CoverEveryStreamAndTheProductionMoodRange` | объявленное значение потока перестало совпадать с `enum` |
| `EveryEntry_ReproducesTheCanonicalArtifactThisBuildProduces` | замороженное поведение сценариев разошлось с текущей сборкой |
| `EveryEntry_ReproducesTheReadModelThisBuildProduces` | замороженный экран разошёлся с тем, что строит фабрика |

**Откат:** `git checkout -- simulation/OathAndCoin.Simulation/Random/RngStream.cs`; повторный прогон — 18 из 18 пройдено, `git diff --exit-code -- migration/oracle/v1` пуст.

Мутация подтверждает то, что структурных проверок доказать не может: корпус, проверяемый только дайджестами, остался бы зелёным при любом изменении правил — файлы на диске не тронуты, и каждый хеш от них по-прежнему сходится. Красным его делают проверки воспроизведения, которые заново прогоняют production-загрузчики, правила и фабрику представления.

### 3.6. Внешнее ревью сегмента и закрытые им дыры

Ревью провёл codex (`gpt-5.6-sol`, режим `review` скилла `peer`) по коду сегмента и выборке корпуса. Из девяти находок семь подтверждены по исходнику, одна принята частично, у одной принята констатация при отклонённом лечении. Три подтверждались мутантами — и все три показывали, что проверка была слепа.

| Дыра | Как вскрыта | Чем закрыта | Мутант после правки |
|---|---|---|---|
| `--output .` снёс бы `scenarios/` — все 27 манифестов, команды и канонические артефакты | чтением `Reset`: его список имён коллидирует с корнем репозитория, при том что комментарий рядом обещал обратное | экспорт идёт в staging-каталог и подменяет цель только целиком; цель отвергается, если не пуста и не несёт `manifest.json` с нашим `generated_by` | `export --root . --output .` отказывает, `scenarios/` цел (27 манифестов), staging не остаётся |
| Один seed не доказывал, что seed вообще применяется | мутант `CreateInitialState(seed, …)` → `7UL`: **18 из 18 зелёные** | второй seed 424242, seed в пути и идентичности записи, `EveryEntry_CarriesTheSeedItWasRunUnder`, `TheTwoSeeds_DisagreeWhereAMoodWasDrawn` | тот же мутант красит 2 теста |
| `read_model` — ручная копия приватной проекции фабрики, сверялись только состояние, размеры и хеш рядом | мутант «`greed` ← `hero.Caution`» в экспортёре: корпус переписан (25 файлов), **18 из 18 зелёные** | тест канонизирует сохранённый `read_model` без его же `sha256` и требует совпадения с `ReadModelHash` — это ровно те байты, которые хеширует фабрика | тот же мутант красит `EveryEntry_ReproducesTheReadModelThisBuildProduces` |
| CI-шаг «валидация ничего не переписала» не видел untracked-файлов и ни разу не краснел | `git diff` слеп к untracked — факт, задокументированный в §3.4 и тут же нарушенный в CI | `git status --porcelain=v1 --untracked-files=all -- migration/oracle`, падение на любом выводе, `if: always()` | лишний файл в корпусе: прежняя команда — exit 0 и пусто, новая — `?? migration/oracle/v1/stray.json` |
| `JcsReference` подменял одиночный суррогат на U+FFFD вместо отказа | чтением: дефолтный fallback `Encoding.UTF8` | строгий UTF-8 и явная проверка пар; отвергнутые входы записаны в `jcs-compatibility-vectors.json` как `rejected_inputs` вместе с тем, **какой слой** отказал | экспорт падает, если объявленный отвергнутым вход вдруг сериализовался |
| `ADR-010` утверждал, что harness «размером с половину симуляции» | сверкой по одному правилу: harness 1082, simulation 1045 — harness *больше* | формулировка исправлена, приведена одна команда на оба числа | — |
| Документ утверждал, что ошибки загрузчиков становятся данными корпуса | чтением: испорченный manifest/commands прерывает экспорт | §3.1 теперь называет, какой один код из пяти покрыт и почему, и адресует долг в Task 10 | — |

Отклонено: предложение вынести `Main.LoadModel` в production application-компонент. Констатация верна — ни экспортёр, ни тест не наблюдают `game/app/Main.cs`, и смена порядка стадий там ничего не покрасит, — но лечение означает рефакторинг Godot-хоста, который целиком удаляется на Task 19, ради оракула, описывающего поведение, а не структуру. Долг адресован в §3.1 и в Task 10.

Отброшено как шум: утверждение, что `--output .` удалил бы корневой `README.md` — такого файла в репозитории нет. Опасность при этом оказалась выше названной: удалялся бы `scenarios/`.

### 3.7. Отклонения от плана

| План | Сделано | Причина |
|---|---|---|
| Task 2 Step 5: «Add a **job** that validates, but does not regenerate, the committed corpus» | Добавлены три **шага** в существующий job `build` (`.github/workflows/dotnet.yml`) | Отдельный job повторил бы restore и build ради того, что solution-прогон уже собрал. Комментарии самого workflow задают «один раннер, один отчёт, одно место, куда смотреть». Намерение выполнено полностью: именованный шаг валидации, шаг `git status --porcelain=v1 --untracked-files=all -- migration/oracle`, доказывающий, что валидация ничего не переписала, и публикация `manifest.json` артефактом |
| Task 2 Files: `Program.cs`, `OracleEnvelope.cs` | Добавлены также `RngVectors.cs`, `JcsVectors.cs`, `JcsReference.cs` | Справочный сериализатор RFC 8785 и два набора векторов внутри `OracleEnvelope.cs` сделали бы файл про сценарии файлом про всё сразу |
| — | `.gitattributes` получил вторую строку `migration/oracle/**/*.md text eol=lf` сверх указанной в плане `*.json` | `README.md` корпуса тоже покрыт дайджестом в `manifest.json`. Без этой строки свежий Windows-клон получил бы его в CRLF, и дайджест на него не сошёлся бы при верных JSON-файлах рядом — отказ, выглядящий как испорченный корпус, а на деле правило переводов строк с дырой |

## 4. Хождённая земля: рубеж после сегмента 1

`AGENTS.md` §9. Записка для следующего исполнителя: что проверено, что опровергнуто замером, какие варианты прогнаны и отвергнуты. Она существует, чтобы следующий не передоказывал сделанное и не лез в тупики, за которые уже заплачено.

### 4.1. Где остановились

| Факт | Значение |
|---|---|
| Ветка | `migration/01-oracle` |
| HEAD | `d62996647bcf4282b39e1d28c37a6dc581383746` |
| Base | `main` @ `12565862b1e88e0524f95def18c023571ec4269f` |
| PR | [#10](https://github.com/anshushunov/oath-and-coin/pull/10), draft, открыт |
| Дерево | чистое |
| Тесты | `dotnet test OathAndCoin.sln -c Release` — 531 пройдено, 0 не пройдено |

Коммиты сегмента: `0bc00fc` (ADR-010 и рубеж) → `2dd8c81` (экспортёр, тесты, корпус) → `8e7e386` (первые доказательства) → `94f4e24` (правки по внешнему ревью) → `55c0098` (разбор ревью) → `d629966` (исправленные числа).

### 4.2. Что блокирует Task 3

Task 3 не начинается, пока PR #10 не смержен: каждая segment branch создаётся от обновлённого `main` после merge предыдущего segment PR. Это не формальность — Task 3 создаёт workspace в корне репозитория, и делать это поверх неслитой ветки значит получить два расходящихся корня.

### 4.3. Опровергнуто замером

Три утверждения, которые выглядели верными и оказались ложными. Не восстанавливать их обратно.

1. **Объём C# — 13 814 code lines, не ~24 400.** Документы решения приводили колонку `raw` скрипта `code-lines.sh` как `code`. Проверяется `bash ./scripts/code-lines.sh simulation adapters tools tests game`. Оценка сроков опиралась на большее число, поэтому переоценка не делалась.
2. **Harness больше всей симуляции, а не «половина» её.** 1082 против 1045 по одному правилу. `ADR-010` исправлен.
3. **Тестов на рубеже 511, не 499.** Число из отчёта PR #9 не подтвердилось свежим прогоном. Parity не привязывается к числу тестовых методов.

### 4.4. Прогнано и отвергнуто

| Вариант | Почему отвергнут |
|---|---|
| `source_commit` из `git rev-parse HEAD` | Корпус перестал бы воспроизводиться побайтно: коммит меняется в тот момент, когда корпус коммитят, и каждый следующий экспорт отличался бы по причине, не связанной с поведением. Константа с объяснением в коде |
| Тесты корпуса ссылаются на типы экспортёра | Тест согласился бы с экспортёром во всём, в чём тот неправ. Тестовый проект ссылается только на production-сборки и композирует те же вызовы независимо |
| Корпус проверяется только дайджестами и полнотой | Остался бы зелёным при любом изменении правил: файлы на диске не тронуты, хеши сходятся. Мутант `HeroDecision = 3 → 9` это подтвердил. Нужны проверки воспроизведения |
| Один seed | Мутант `CreateInitialState(seed, …)` → `7UL` оставлял 18/18 зелёными. Два seed, seed в идентичности записи |
| Удаление старого корпуса «по именам файлов» вместо staging | Список имён коллидирует с корнем репозитория: `--output .` снёс бы `scenarios/`. Staging плюс отказ на чужом каталоге |
| Полная реализация ECMAScript `Number::toString` в `JcsReference` | Приближение выдало бы target-байты, выглядящие авторитетно и неверные. Область сужена до безопасных целых, предел записан в самом файле векторов |
| Вынести `Main.LoadModel` в production application-компонент (предложение ревью) | Рефакторинг Godot-хоста, который целиком удаляется на Task 19, ради оракула, описывающего поведение, а не структуру. Долг адресован в §3.1 и Task 10 |
| Отдельный CI job под корпус | Повторил бы restore и build ради того, что solution-прогон уже собрал. Три шага в существующем job |

### 4.5. Известные пределы корпуса

Не дефекты, а записанные границы. Следующий исполнитель должен знать, чего в корпусе **нет**.

- **Покрыт один код ошибки из пяти** — `CONTENT_ROOT_NOT_FOUND`. Порядок стадий загрузки и остальные четыре кода проверяются в Task 10, см. §3.1.
- **Корпус не наблюдает `game/app/Main.cs`.** Экспортёр и тест композируют ту же последовательность независимо; смена порядка стадий в самом Godot-хосте не покрасит ничего.
- **Пять векторов канонизации расходятся с RFC 8785** (не-ASCII, HTML-чувствительный ASCII, `-0`, control characters, суррогатная пара). Task 6 обязан оплатить это **одним** шагом версии артефакта с отображением старых и новых хешей, а не молчаливой пересъёмкой.
- **Числовая область JCS-векторов** — целые в пределах ±(2^53−1). Дробные, экспоненциальные и большие целые закрываются в Task 6 официальными conformance-векторами.
- **`read_model` не несёт `error_detail`** — там машинно-зависимый путь. Порт не должен ожидать это поле.

### 4.6. Грабли процесса, на которые уже наступили

- **Мутант ставится только после коммита проверяемого состояния** (`AGENTS.md` §8). Нарушено дважды за сегмент: `git checkout --` откатил мутант вместе с незакоммиченной правкой, работу пришлось восстанавливать.
- **Число в документе устаревает от правки соседнего файла.** Правка README корпуса сдвинула его дайджест, дайджест сдвинул `manifest.json`, и записанный в журнале SHA-256 стал ложным. Числа в §3.2 пересниматься обязаны при любой правке содержимого корпуса.
- **`git diff` не видит untracked.** Верно и для проверки экспорта (поэтому первый экспорт индексируется), и для CI-шага (поэтому там `git status --porcelain`). Одна и та же слепота дважды.

### 4.7. Календарь на входе в сегмент 2

> Записано на выходе из сегмента 1 и здесь оставлено как есть. Что из этого сбылось, а что отменено решением владельца, — в §5.7. Коротко: Steam из миграции изъят (`ADR-011`), стоп-гейт Task 4 пройден 2026-08-17, то есть за две недели до даты обязательного ревью.

- **Task 4 — стоп-гейт.** Task 6 не начинается, пока packaged Windows Electron не поднимет `steamworks.js` в main-процессе при `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Дата обязательного ревью владельца — **2026-08-31**.
- **Steam App ID.** Спайк идёт на Spacewar `480`, но собственные достижения, схема статистики, квоты Cloud и конфигурация depot им не доказываются — это повторяется с реальным App ID в Task 17. Получение своего App ID — Steam Direct плюс модерация, то есть дни календаря. Если релиз планируется, процедуру запускать параллельно с Tasks 3–5, а не когда очередь дойдёт до Task 17.
- **Feature freeze** до 2026-10-11.

## 5. Доказательства сегмента 2 — Tasks 3–5

### 5.1. Что стоит в дереве после Task 3

| Факт | Значение | Команда |
|---|---|---|
| Пакетный менеджер | `pnpm@11.22.0+sha512.1ff870c4…dd621` (integrity проверяет corepack) | `node -e "console.log(require('./package.json').packageManager)"` |
| Node | 24.12.0, он же нижняя граница `engines.node` | `cat .nvmrc` |
| Компилятор | TypeScript 6.0.3 во всех членах workspace (`ADR-010`) | `pnpm test` → «TypeScript is the compiler ADR-010 pins» |
| Члены workspace | 5: `apps/web`, `apps/desktop`, `tests/architecture`, `tests/desktop`, `tests/e2e` | `cat pnpm-workspace.yaml` |
| Проверки Vitest | 15 зелёных: 12 про сам workspace и 3 про предикат схем URL в хосте | `pnpm test` |
| Браузерные проверки | 2 зелёных на production-сборке в Chromium | `pnpm test:e2e` |
| Typecheck | 0 ошибок, один процесс на все проекты | `pnpm typecheck` |

**Пакеты `packages/simulation`, `packages/content`, `packages/presentation`, `packages/application` и `tools/scenario-runner` не созданы.** `ADR-010` §45 фиксирует дерево целиком, но `TDD` §20 запрещает создавать пустые каталоги до первого артефакта, и здесь второе весит больше: член workspace без файлов всё равно проходит install, typecheck, тесты и границы — все зелёные ни на чём, и это читается как покрытие несуществующего пакета. Каждый из них заводит та задача, которая пишет его первый файл (Tasks 6–12). Гейт от забывчивости есть: тест `every member is inside the dependency-boundary gate` требует, чтобы новый член попал в аргументы `lint:deps`, а `every member is referenced by the typecheck solution` — чтобы он попал в `tsconfig.json`.

### 5.2. Гейт Task 4 — что доказано на packaged-сборке

Шесть проверок, все на запущенном packaged-приложении, ни одна не читает настройки обратно из кода, который их выставил:

| Проверка | Чем наблюдается |
|---|---|
| окно поднимается и показывает браузерную сборку | `#root` в `index.html` пуст; `app-root` в нём рисует React |
| renderer работает в песочнице ОС | `app.getAppMetrics()` — процесс типа `Tab`, `sandboxed: true` |
| страница не достаёт ни `require`, ни `process`, ни `ipcRenderer` | `page.evaluate` в самой странице |
| CSP не даёт выполнить инлайн-скрипт | страница пытается вставить `<script>` и сообщает, выполнился ли он |
| ОС получает только web-схемы | `shell.openExternal` подменён в main-процессе на время пробы, страница зовёт `window.open` с `file:` и с `https:` |
| единственный разрешённый IPC-метод отвечает и проходит схему | `window.desktop.describeHost()` через `contextBridge`, Zod с обеих сторон |

Числа прогона (`artifacts/electron-spike/gate-report.json`, пишется тестом до сверки с бюджетами):

| Замер | Локально (Windows 11) | CI (`windows-latest`) |
|---|---:|---:|
| Установленный пакет | 319 031 508 байт (304,3 МиБ), 24 файла | _снимается прогоном CI на этом коммите_ |
| RSS всех процессов | 347 439 104 байт (331,3 МиБ) | _там же_ |

**Порог размера снят решением владельца (`ADR-011`), и вот почему это не поблажка.** 304 МиБ — пустое приложение: игрового контента нет, локали Chromium уже урезаны с 55 файлов до двух (минус 47 182 082 байта, `afterPack` печатает это в лог сборки). Остаток — бинарь Electron 43 (225,6 МиБ), лицензии Chromium (19,4 МиБ), компилятор шейдеров DirectX (24,4 МиБ), программный Vulkan (5,2 МиБ). Граница `ADR-010` в 300 МБ лежала ниже пола платформы. Бюджет RSS ≤ 500 МБ сохранён и проверяется тестом; замер укладывается с запасом.

**Разница в 4,4 МиБ между первым локальным замером (319 026 679) и первым CI-замером (323 406 869) объяснена и устранена.** Она не была шумом машины: между прогонами `zod` переехал из `devDependencies` в `dependencies` — правка под правило `not-to-dev-dep`, — а electron-builder добавляет production-зависимости к своим шаблонам поверх `files: [dist/**]`. В `app.asar` приехали **612 файлов и 4 224 422 байта** библиотеки, которая уже была забандлена в `main.cjs` и `preload.cjs`. Найдено при проверке правок ревью: разбор заголовка asar показал `node_modules/zod/src/v3/types.ts` третьим по размеру файлом пакета. Закрыто строкой `'!node_modules/**'` в `electron-builder.yml`; пакет вернулся к 304,3 МиБ, гейт остался зелёным — то есть ничего из выброшенного приложению и не требовалось.

### 5.3. Границы и dual-stack CI

| Факт | Значение | Команда |
|---|---|---|
| Модулей под проверкой границ | 21 модуль, 25 зависимостей, 0 нарушений | `pnpm lint:deps` |
| Правил в конфигурации | 10 | `.dependency-cruiser.cjs` |
| Оба стека в одном пуше | `build` (531 тест .NET) и `typescript` — оба success | run `31972896800` и `31972896818` |
| Гейт Task 4 на CI | джоба `packaged-desktop` на `windows-latest`, 5/5 | run `31972896818` |

Из десяти правил четыре сегодня имеют под собой код (`no-circular`, `no-orphans`, две границы между `apps/web` и `apps/desktop`, `not-to-dev-dep`), а правила направления для `packages/*` написаны над пустотой: пакетов ещё нет, и покраснеть эти правила не могут. Это записано намеренно — граница должна существовать в день, когда ляжет первый файл, а не изобретаться тем, кто его пишет. Но пока они документация, которая умеет исполняться, а не проверка.

Гейт Task 4 исполняется на CI ровно благодаря `ADR-011`: без SDK площадки ему не нужен ни клиент, ни учётная запись, ни App ID, поэтому вердикт воспроизводит кто угодно, а не тот, кто был залогинен.

### 5.4. Мутация

Двадцать четыре мутанта, каждый поставлен после коммита проверяемого состояния (`AGENTS.md` §8) и откачен `git checkout --`. Восемнадцать до внешнего ревью и шесть после, на правки по его находкам (§5.6).

**Task 3 — десять.** Каждый краснит ровно ту проверку, ради которой написан:

| Мутант | Что покраснело |
|---|---|
| `"vite": "8.2.1"` → `"^8.2.1"` | «every dependency of every member is pinned to an exact version» |
| TypeScript 6.0.3 → 6.0.2 в одном члене | «a dependency has one version across the whole workspace» и «TypeScript is the compiler ADR-010 pins» |
| `packages/simulation/package.json` вне списка workspace | «every package on disk is a declared member» |
| `tests/e2e` убран из ссылок `tsconfig.json` | «every member is referenced by the typecheck solution» |
| `apps/web` extends не базовый tsconfig | «every member extends the shared compiler options» |
| `engines.pnpm` разошёлся с `packageManager` | pnpm отказывается запускаться вовсе; тест краснеет при прямом вызове vitest |
| `.nvmrc` 24.12.0 → 24.11.0 | «the Node version in .nvmrc is the lower bound of the supported range» |
| файл с ошибкой типа в `apps/web/src` | `pnpm typecheck` — exit 2 |
| React монтируется не в `#root` | обе браузерные проверки |
| страница сообщает `present` вместо `absent` | «no Node API is reachable from the page» |

**Task 4 — четыре**, каждый требует пересборки пакета:

| Мутант | Что покраснело |
|---|---|
| `sandbox: false` | «the renderer runs sandboxed» |
| `contextIsolation: false` | «the page reaches the desktop API and nothing else» |
| `'unsafe-inline'` в CSP (и в заголовке хоста, и в `<meta>`) | «the content security policy blocks an inline script» |
| main отвечает `platform: 42` | вызов `describeHost` падает `ZodError` в preload |

**Task 5 — три локальных плюс один на CI:**

| Мутант | Что покраснело |
|---|---|
| `apps/web` импортирует `electron` | `no-unresolvable` |
| `apps/web` импортирует `apps/desktop/src/contract` | `renderer-must-not-import-the-host` |
| цикл `App.tsx ↔ cycle.ts` | `no-circular` |
| та же граница, но пушем в ветке `migration/02-foundation-ci-mutant` | стадия «Dependency boundaries» джобы `checks`, run `31972969346` — failure; джоба `build` того же пуша зелёная |

Последний — обязательный по `AGENTS.md` §8 мутант на новую CI-проверку: без него в pipeline попадает стадия, которая никогда не краснела. Ветка запушена без pull request и удалена после прогона.

**Правки по ревью — шесть.** Три из них сначала воспроизвели дыру на неисправленном коде (столбец «до правки»), и это и есть доказательство, что проверка чего-то стоит:

| Мутант | До правки | После правки |
|---|---|---|
| `import { readFileSync } from 'node:fs'` в `packages/simulation` | `0 violations` | `simulation-depends-on-nothing` |
| импорт `apps/desktop/src/contract` из `packages/simulation` | — | `simulation-depends-on-nothing` |
| падающий `tests/architecture/review-mutant.test.tsx` | `1 file / 12 tests passed`, файл не собран | `1 failed \| 12 passed`, файлов 2 |
| `steamworks.js` в `optionalDependencies` | 12/12 зелёных | красит «pinned to an exact version» и «no storefront SDK» |
| снятая проверка схемы в `setWindowOpenHandler` | — | красит пробу и отчёт: `openedExternally` содержит `file:///C:/Windows/System32/calc.exe` |
| `'unsafe-inline'` в CSP, взгляд на отчёт | отчёт печатал бы `inlineScriptBlocked: true` константой | отчёт печатает `inlineScriptBlocked = false`, оба теста красные |

### 5.5. Отклонения от плана и находки, оплаченные отладкой

| Ожидалось | Сделано | Причина |
|---|---|---|
| Команды вида `corepack pnpm <script>` (так они записаны в §2 до этой правки) | `corepack enable` один раз, дальше `pnpm <script>` | Под `corepack pnpm` вложенный `pnpm` — из скрипта или из чужого инструмента — резолвится в known-good release corepack (11.9.0) вместо закреплённого (11.22.0) и отказывается работать. Ловушка сработала трижды: на `pnpm --recursive typecheck`, на webServer Playwright и внутри `electron-builder`, который сам зовёт `pnpm` для обхода node_modules. Сообщение при этом говорит про версии pnpm и ничего — про то, что виновата вложенность |
| `pnpm --recursive typecheck` | `tsc --build tsconfig.json --force` по solution-файлу | Та же ловушка. Побочно вышло лучше: один процесс на все проекты, а список ссылок сверяется тестом со списком членов workspace |
| Пакет собирается одной сборкой Vite с двумя входами | Две отдельные сборки: `vite.main.config.ts` и `vite.preload.config.ts` | Rollup выносит общий модуль (`contract.ts`) в отдельный чанк, а preload при `sandbox: true` не умеет `require` файла: его модульная система — маленький полифилл на `electron` и горстку встроенных. Окно поднимается без `window.desktop`, ошибки нет ни в странице, ни в main — preload просто упал на первой строке |
| Зависимости хоста внешние, как в обычной SSR-сборке | `ssr: { noExternal: true }` | Vite по умолчанию выносит всё из `node_modules` наружу, а рядом с packaged-приложением их нет. Хост умирает на старте с диалогом «Cannot find module 'zod'» до появления окна, а гейт сообщает про 30-секундный таймаут ожидания окна — про причину ни слова |
| Локали урезаются штатным `electronLanguages` | `afterPack`-хук `apps/desktop/build/after-pack.cjs` | На Windows `electronLanguages` — молчаливый no-op: пакет вышел 350 МБ со всеми 55 `.pak`. Настройка, которая читается как указание и ничего не делает, хуже отсутствующей |
| CSP объявлен один раз | `<meta>` в `index.html` **и** заголовок ответа в main-процессе | `frame-ancestors` в `<meta>` браузер игнорирует и пишет об этом ошибкой в консоль — браузерная проверка «чистая консоль» её и поймала. Директива живёт только в заголовке, остальная политика — в обоих местах, потому что браузерная сборка обязана иметь ту же политику без Electron |
| Границы проверяются по всему дереву | Из проверки исключены файлы конфигурации Vite | Резолвер dependency-cruiser не умеет пройти ESM-only `exports` Vite: `import { defineConfig } from 'vite'` приходит как неразрешимый, пока все импорты приложения рядом разрешаются. Держать их в области значило бы либо вечно красный гейт, либо `no-unresolvable`, пониженный до warning, — то есть правило, которое перестало значить |

### 5.6. Внешнее ревью сегмента и закрытые им дыры

Ревью прошло по PR #11 после того, как все гейты сегмента были зелёными, — и нашло шесть проблем, из которых **три оставляли гейт зелёным на сломанном коде**. Каждая воспроизведена до правки, каждая правка закрыта мутантом. Согласились со всеми шестью.

| Дыра | Как вскрыта | Чем закрыта | Мутант после правки |
|---|---|---|---|
| Единственная авторитетная проверка границ пропускала `import { readFileSync } from 'node:fs'` в чистое ядро | ревьюер положил `packages/simulation/review-mutant.ts` с этим импортом и получил `0 violations` | правило `simulation-depends-on-nothing` перечисляет теперь **одно разрешённое** — импорт внутри самого пакета, — вместо списка запрещённых соседей | тот же импорт красит правило; отдельно красит импорт из соседнего пакета |
| `vitest` не собирал `.test.tsx` вовсе | падающий `tests/architecture/review-mutant.test.tsx` — прогон сообщил `12 passed` и не заметил файла | `include` покрывает `*.test.{ts,tsx}`; React-тесты Task 13 иначе были бы невидимы при зелёном pipeline | тот же файл теперь красит прогон: `1 failed \| 12 passed` |
| `shell.openExternal` получал любую схему из страницы — `file:`, `ms-msdt:`, что угодно с зарегистрированным обработчиком | чтением `setWindowOpenHandler` и ссылкой на security-руководство Electron: недоверенный URL здесь ведёт к выполнению произвольных команд | предикат `mayOpenExternally` разрешает только `http:`/`https:`; отдельный unit-тест по строкам и packaged-проба, подменяющая `shell.openExternal` в main-процессе | снятие проверки красит и пробу, и отчёт: в `openedExternally` появляется `file:///C:/Windows/System32/calc.exe` |
| Отчёт гейта писал `inlineScriptBlocked: true` константой | чтением: при перезапуске worker'а артефакт, публикуемый CI через `always()`, утверждал бы обратное тому, что произошло | обе проверки безопасности вынесены в пробы, отчёт записывает **измеренное**, и утверждения делаются по записанным значениям | ослабленный CSP: отчёт печатает `inlineScriptBlocked = false`, тест красный |
| Проверки пинов, единой версии и отсутствия storefront SDK читали две секции зависимостей из четырёх | чтением: `optionalDependencies` — типовой способ «деградировать без него», то есть ровно то, как приехал бы SDK площадки | общий перечислитель по `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` | `steamworks.js` в `optionalDependencies` красит две проверки; до правки — 12/12 зелёных |
| Строка Task 17 в таблице гейтов требовала снятый порог «пакет ≤ 300 МБ» | сверкой таблицы с `ADR-011`, принятым в этой же правке | строка приведена к действующему решению: RSS ≤ 500 МБ, размер без порога, Steam-часть не выполняется | — |

Обошлось без отклонённых замечаний: все шесть подтвердились по исходнику или воспроизведением.

Что это говорит о самих гейтах сегмента: три из шести дыр — гейты, зелёные на сломанном коде, и ни одна не была видна в диффе. Это тот же вывод, что и в §3.6 сегмента 1, и он же — причина, по которой мутант обязателен на каждую новую проверку, а не на каждую вторую.

### 5.7. Что изменилось в решениях за сегмент

- **`ADR-011` принят** (`docs/decisions/ADR-011-electron-gate-without-steam.md`): игра делается как desktop-приложение прежде всего для владельца, поставки через магазин в области миграции нет. Из Task 4 изъят `steamworks.js` и App ID `480`, Steam-часть Task 17 не выполняется, `BQ-002` остаётся открытым. Цена названа в самой записи: проверка native module в packaged Electron переезжает на момент решения о релизе, и спайк тогда обязателен немедленно.
- **Порог размера установленного пакета отменён** тем же решением по замеру §5.2. Бюджет RSS ≤ 500 МБ действует.
- **`ADR-010` правлен точечно** в четырёх местах, где иначе читатель получил бы недействующее правило: раздел о стоп-гейте, обоснование отказа от `autoUpdater`, численные границы и список проверки.

## 6. Хождённая земля: рубеж после сегмента 2

`AGENTS.md` §9. Записка для следующего исполнителя. Что проверено и чем — в §5; здесь только то, что нужно знать до первой строчки Task 6.

### 6.1. Где остановились

| Факт | Значение |
|---|---|
| Ветка | `migration/02-foundation` |
| HEAD на момент записки | `5a130cf` (правки по ревью); следом идёт коммит самой записки |
| Base | `main` @ `c6462ab819d90b4ca56c75f6a3416fe101bdc18f` |
| PR | [#11](https://github.com/anshushunov/oath-and-coin/pull/11), draft, открыт |
| Дерево | чистое |
| Тесты старого стека | `dotnet test OathAndCoin.sln -c Release` — 531 пройдено, 0 не пройдено (CI run `31972896800`) |
| Тесты нового стека | 15 Vitest + 2 браузерных + 6 desktop = 23 пройдено |
| Внешнее ревью | проведено по PR #11, шесть находок, все приняты и закрыты (§5.6) |

Коммиты сегмента: `06550e5` (workspace) → `ef7ccd1` (LF) → `f687261` (`ADR-011`) → `ebc3e95` (Electron-гейт) → `1e7096e` (границы и CI) → `5a130cf` (правки по ревью).

### 6.2. Что блокирует Task 6

То же правило, что и в сегменте 1: следующая ветка создаётся от обновлённого `main` после merge segment PR. Плюс своё: Task 6 заводит `packages/content`, а вместе с ним первый настоящий член workspace из `ADR-010` §45 — он обязан попасть сразу в три места, иначе окажется вне гейтов. Два из трёх покраснеют сами (`pnpm test`), третье — нет:

1. `pnpm-workspace.yaml` — иначе pnpm его не устанавливает;
2. `tsconfig.json` (ссылка) — тест `every member is referenced by the typecheck solution`;
3. аргументы `lint:deps` в `package.json` — тест `every member is inside the dependency-boundary gate`;
4. `vitest.config.ts` трогать не нужно: `include` покрывает `{apps,packages,tests,tools}/**/*.test.{ts,tsx}` шаблоном, а не списком.

Отдельно про `packages/simulation`, который заведёт Task 7: правило границ разрешает ему импортировать **только самого себя** — ни соседний пакет, ни npm-зависимость, ни `node:*`. Это не строгость ради строгости, а починка после ревью (§5.6): прежняя формулировка пропускала `node:fs` в чистое ядро. Если Task 7 упрётся в это правило, правильный ход — не ослабить его, а спросить, почему детерминированным правилам понадобился внешний модуль.

### 6.3. Опровергнуто замером

1. **300 МБ на установленный пакет недостижимы.** Пустое Electron-приложение — 304,3 МиБ с уже урезанными локалями и без лишнего `node_modules`. Порог снят `ADR-011`, замер остался. Не возвращать число, не измерив заново.
2. **`electronLanguages` на Windows ничего не делает.** Пакет вышел 350 МБ со всеми 55 `.pak`. Локали режет `afterPack`-хук.
3. **`corepack pnpm <script>` ломает всё, что внутри зовёт `pnpm`.** Правильный вход — `corepack enable` один раз, дальше `pnpm`. Трижды за сегмент, в том числе внутри `electron-builder`.
4. **`frame-ancestors` в `<meta>` игнорируется браузером.** Живёт только в заголовке ответа, который ставит main-процесс.
5. **`files: [dist/**]` не означает «только dist».** electron-builder добавляет production-зависимости к своим шаблонам: `zod` уехал в пакет вторым экземпляром — 612 файлов поверх того, что уже забандлено. Нужна явная строка `'!node_modules/**'`, и она держится тем, что гейт запускает packaged-сборку: если что-то перестанет бандлиться, приложение не стартует.
6. **Три гейта сегмента были зелёными на сломанном коде** — это нашло внешнее ревью (§5.6), а не прогоны. `node:fs` в чистом ядре, несобранный `.test.tsx` и отчёт с константой вместо замера. Вывод не «ревью полезно», а конкретнее: проверка, у которой нет мутанта именно на её обещание, скорее всего мерит не то.

### 6.4. Прогнано и отвергнуто

| Вариант | Почему отвергнут |
|---|---|
| `pnpm --recursive typecheck` как корневой скрипт | Вложенный pnpm под corepack. Заменено на `tsc --build` по solution-файлу — заодно один процесс вместо шести |
| Одна сборка Vite с двумя входами для хоста | Общий чанк, который sandboxed preload не может `require`. Окно поднимается без `window.desktop` и без единой ошибки |
| Внешние зависимости в сборке хоста (умолчание Vite SSR) | Рядом с packaged-приложением их нет: «Cannot find module 'zod'» до появления окна |
| Читать `webPreferences` обратно через `getLastWebPreferences` | В типах Electron 43 метода нет, и он доказывал бы, что код говорит `sandbox: true`, а не что процесс в песочнице. Наблюдаем флаг ОС через `app.getAppMetrics()` и достижимость API из самой страницы |
| Создать все пакеты `ADR-010` §45 сразу | Член workspace без файлов проходит все гейты зелёным и читается как покрытие. Заводит та задача, которая пишет первый файл (`TDD` §20) |
| Урезать `dxcompiler.dll` и `vk_swiftshader.dll` ради 300 МБ | Купили бы проходимость гейта ценой программного рендера на машинах без GPU, и первый же арт-ассет всё равно вернул бы превышение. Владелец снял порог |
| Перечислять в правиле границ, что симуляции запрещено | Список не знает про то, что придумают дальше: он называл соседние пакеты и пропускал `node:fs`. Правило перечисляет единственное разрешённое — импорт внутри самого пакета |
| Записывать в отчёт гейта заранее известный результат проверки | Артефакт, публикуемый CI через `always()`, начинал противоречить вердикту ровно в тех прогонах, ради которых его читают. Обе пробы измеряются в том же прогоне, который пишет отчёт |

### 6.5. Известные пределы того, что построено

- **`packages/*` не существуют**, и правила направления для них в `.dependency-cruiser.cjs` покраснеть не могут. Пока это исполняемая документация, а не проверка (§5.3).
- **Линтера и форматтера для TypeScript нет.** `TDD` §19.1 просит стадию formatting/lint, у .NET-пайплайна она есть (`dotnet format`), у нового — нет: Task 5 назвал только `lint:deps`, и вводить ESLint сверх заявленного объёма сегмент не стал. Долг адресный — либо отдельная задача, либо явное решение обойтись без него.
- **Браузеры Playwright не в lockfile.** Их версия определяется пином `@playwright/test`, а байты приезжают командой `playwright install` — воспроизводимость здесь слабее, чем у остального дерева.
- **Гейт Task 4 существует только под Windows.** Ни Linux, ни macOS сборки нет, и `ADR-010` их и не обещает.
- **`apps/web` ничего не знает о `window.desktop`.** Renderer не типизирует desktop API и не вызывает его; связь проверяется только гейтом Task 4 изнутри страницы. Настоящий порт — Task 12.
- **Схемы URL проверяются в одном месте, а окно открытия — в другом.** `mayOpenExternally` разрешает `http:`/`https:`, но за пределами `setWindowOpenHandler` есть ещё `will-navigate` (там навигация запрещена целиком) и будущие вызовы из main-процесса. Новый вызов `shell.openExternal` где угодно ещё обязан идти через тот же предикат, и механической проверки на это нет.
- **Sourcemaps едут в пакет** — 757 КБ на два файла хоста. Осознанно: они дешевле любого разбора креша вслепую, но это байты в поставке, а не в отладочной сборке.
