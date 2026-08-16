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

Манифестов без именованного checkpoint в дереве нет, поэтому запись корпуса называется именем checkpoint, а запасная запись `final.json` не создаётся ни для одного сценария.

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
| Task 2 — неизменяемый oracle corpus | agent | 2026-08-16 | 2026-08-16 | `dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1`; `dotnet test tests/OathAndCoin.MigrationOracle.Tests/OathAndCoin.MigrationOracle.Tests.csproj -c Release`; `git diff --exit-code -- migration/oracle/v1` | `migration/oracle/v1/**` (31 файл, manifest SHA-256 `32107b7c…d29c`); §3 этого файла | 27/27 манифестов и checkpoints; 18/18 тестов корпуса; повторный экспорт побайтно идентичен; мутация `HeroDecision = 3 → 9` красит 4 теста | принят, ожидает внешнего ревью segment PR |
| Task 3 — pinned TypeScript workspace | | | | `corepack pnpm install --frozen-lockfile`; `corepack pnpm typecheck`; `corepack pnpm test`; `corepack pnpm test:e2e` | `pnpm-lock.yaml`, bootstrap-тесты | | |
| Task 4 — packaged Electron + Steam gate (**stop gate**) | | | | `corepack pnpm package:desktop`; `corepack pnpm test:desktop` | `artifacts/electron-spike/**` | | Task 6 не начинается до зелёного; owner review 2026-08-31 |
| Task 5 — архитектурные границы и dual-stack CI | | | | `corepack pnpm lint:deps`; `corepack pnpm test` | `.github/workflows/typescript.yml` | | |
| Task 6 — canonical JSON, ID и контракты контента на Zod | | | | `corepack pnpm --filter @oath-and-coin/content test`; `corepack pnpm schema:check` | `schemas/generated/**` | | |
| Task 7 — детерминированный RNG | | | | `corepack pnpm --filter @oath-and-coin/simulation test -- deterministic-rng` | `migration/oracle/v1/rng-vectors.json` | | |
| Task 8 — состояние, команды, события, следы | | | | `corepack pnpm --filter @oath-and-coin/simulation test` | | | |
| Task 9 — правило решения героя и движок (**stop gate**) | | | | `corepack pnpm --filter @oath-and-coin/simulation test`; benchmark | baseline p50/p95 JSON | | parity к 2026-09-20 либо 10 focused days на Tasks 7–10 |
| Task 10 — исполнение сценариев и oracle parity | | | | `corepack pnpm test:scenario`; `... parity --oracle migration/oracle/v1` | отчёт parity | | 27 манифестов и все checkpoints |
| Task 11 — presentation models | | | | `corepack pnpm --filter @oath-and-coin/presentation test` | | | |
| Task 12 — application store и порты | | | | `corepack pnpm --filter @oath-and-coin/application test` | | | |
| Task 13 — React contract-offer screen | | | | `corepack pnpm --filter @oath-and-coin/web test`; `... build` | | | |
| Task 14 — PixiJS scene facade | | | | `corepack pnpm --filter @oath-and-coin/web test` | | | |
| Task 15 — browser evidence вместо Godot harness | | | | `corepack pnpm test:e2e` | screenshot + JSONL + report на каждое состояние | | |
| Task 16 — версионированные атомарные сохранения | | | | `corepack pnpm --filter @oath-and-coin/application test`; `corepack pnpm --filter @oath-and-coin/desktop test` | | | |
| Task 17 — production Electron host | | | | `corepack pnpm package:desktop`; `corepack pnpm test:desktop` | packaged report, SHA-256, RSS | | пакет ≤ 300 МБ, RSS ≤ 500 МБ |
| Task 18 — производительность, supply chain, релизные гейты | | | | `corepack pnpm verify`; `node scripts/audit-runtime-dependencies.mjs`; `dotnet test OathAndCoin.sln -c Release` | benchmark artifacts | | старый и новый гейты зелёные одновременно |
| Task 19 — cutover и удаление Godot/.NET | | | | `rg --files \| rg "(\.cs$\|\.csproj$\|\.sln$\|\.tscn$\|\.uid$\|project\.godot$)"`; `corepack pnpm verify` | | | требует зелёных Tasks 2, 4, 10, 15, 17, 18 |
| Task 20 — финальная проверка и закрытие решения | | | | `corepack pnpm install --frozen-lockfile`; `corepack pnpm verify`; `corepack pnpm build`; `corepack pnpm package:desktop`; `corepack pnpm test:desktop` | `artifacts/migration-final/**` | | заметка о завершении реализации в `ADR-010` |

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

`tools/OathAndCoin.MigrationOracle` — read-only экспортёр. Он вызывает production-загрузчики, правила и фабрику представления (`ContentSchemas`, `ContentSet`, `ScenarioManifest`, `ScenarioCommands`, `CheckpointResolver`, `ScenarioRunner`, `DeterminismArtifact`, `ContractOfferScreenModelFactory`, `DeterministicRng`, `CanonicalJson`) и не содержит ни одной копии решающего правила. Ошибки загрузки — данные корпуса с машиночитаемым кодом из `ErrorCodes`, а не падение экспортёра.

Состав `migration/oracle/v1`:

| Файл | Содержание |
|---|---|
| `manifest.json` | версия схемы артефакта, baseline commit, SHA-256 каждого файла корпуса, перечень 27 сценариев и их checkpoints |
| `rng-vectors.json` | все 7 значений `RngStream`, граничные seeds, ординалы вокруг нуля, диапазоны `DrawInt32` с числом потраченных ординалов и случаи из `tests/OathAndCoin.Simulation.Tests/Fixtures/rng-golden.json` |
| `jcs-compatibility-vectors.json` | вход, текущие канонические байты/хеш C#, целевые байты/хеш RFC 8785 и признак совпадения версии артефакта |
| `scenarios/<scenario>/<checkpoint>.json` | входы, исход и код ошибки, финальное состояние, шаги, события, следы, presentation read model, канонические байты и SHA-256 |
| `README.md` | правило неизменности корпуса |

Seed корпуса — **7**. Это тот же seed, под которым `ScenarioCoverageTests.EveryScenarioReplaysToItsCanonicalArtifact` воспроизводит каждый сценарий, поэтому запись, checkpoint которой покрывает весь список команд, обязана побайтно совпасть с закоммиченным `scenarios/<scenario>.canonical.json`. Корпус на другом seed был бы внутренне согласованным и не связанным с уже проверенным свидетельством репозитория.

`screen_incomplete` — единственный сценарий, где checkpoint намеренно останавливается после первой из шести команд; тест утверждает расхождение с полным canonical-артефактом, чтобы checkpoint, молча начавший покрывать всё, был замечен.

### 3.2. Размер и дайджест

| Факт | Значение | Команда |
|---|---|---|
| Файлов в корпусе | 31 (27 записей сценариев + `manifest.json` + `rng-vectors.json` + `jcs-compatibility-vectors.json` + `README.md`) | `fd . migration/oracle/v1 --type f \| wc -l` |
| Сценариев / checkpoints | 27 / 27 | `jq '{scenarios:(.scenarios\|length), checkpoints:([.scenarios[].checkpoints[]]\|length)}' migration/oracle/v1/manifest.json` |
| Файлов под дайджестом | 30 (все, кроме самого `manifest.json`) | `jq '.files\|length' migration/oracle/v1/manifest.json` |
| Суммарный объём файлов под дайджестом | 1 082 875 байт | `jq '[.files[].bytes]\|add' migration/oracle/v1/manifest.json` |
| SHA-256 корневого `manifest.json` | `32107b7c39b0c9c06633c9afb698ce52ff1516d8d18349f954f73ddca272d29c` | `sha256sum migration/oracle/v1/manifest.json` |
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

### 3.6. Отклонения от плана

| План | Сделано | Причина |
|---|---|---|
| Task 2 Step 5: «Add a **job** that validates, but does not regenerate, the committed corpus» | Добавлены три **шага** в существующий job `build` (`.github/workflows/dotnet.yml`) | Отдельный job повторил бы restore и build ради того, что solution-прогон уже собрал. Комментарии самого workflow задают «один раннер, один отчёт, одно место, куда смотреть». Намерение выполнено полностью: именованный шаг валидации, шаг `git diff --exit-code -- migration/oracle`, доказывающий, что валидация ничего не переписала, и публикация `manifest.json` артефактом |
| Task 2 Files: `Program.cs`, `OracleEnvelope.cs` | Добавлены также `RngVectors.cs`, `JcsVectors.cs`, `JcsReference.cs` | Справочный сериализатор RFC 8785 и два набора векторов внутри `OracleEnvelope.cs` сделали бы файл про сценарии файлом про всё сразу |
| — | `.gitattributes` получил вторую строку `migration/oracle/**/*.md text eol=lf` сверх указанной в плане `*.json` | `README.md` корпуса тоже покрыт дайджестом в `manifest.json`. Без этой строки свежий Windows-клон получил бы его в CRLF, и дайджест на него не сошёлся бы при верных JSON-файлах рядом — отказ, выглядящий как испорченный корпус, а на деле правило переводов строк с дырой |
