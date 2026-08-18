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
| Task 6 — canonical JSON, ID и контракты контента на Zod | agent | 2026-08-17 | 2026-08-17 | `pnpm --filter @oath-and-coin/content test`; `pnpm schema:check` | `schemas/generated/**`; §7.1, §7.2 | 78 проверок контента зелёные; дайджест воспроизводит `5d03734fd9c7abaa`; 10/10 JCS-векторов дают байты RFC 8785; 57/57 хешей корпуса пересчитаны своим SHA-256; 7 мутантов красят, плюс правки по внешнему ревью (§7.7) | версия артефакта детерминизма **не** шагает — обоснование в §7.2 |
| Task 7 — детерминированный RNG | agent | 2026-08-17 | 2026-08-17 | `pnpm --filter @oath-and-coin/simulation test`; `pnpm --filter @oath-and-coin/oracle-tests test` | `migration/oracle/v1/rng-vectors.json`; §7.3 | 306 raw и 1764 int32 вектора воспроизведены; 7 потоков совпали по имени и значению; ветка отбраковки закрыта сконструированным seed; 4 мутанта красят | принят; корпусные тесты переехали в новый член `tests/oracle` (§7.3) |
| Task 8 — состояние, команды, события, следы | agent | 2026-08-17 | 2026-08-17 | `pnpm --filter @oath-and-coin/simulation test` | §7.4 | 194 проверки симуляции; `withEvent` — единственный переход, пять счётчиков; четыре формы неверной пары «событие ↔ след» отвергаются; 7 мутантов на доменные инварианты красят; runtime-неизменяемость и границы ординала добавлены по ревью (§7.7) | принят |
| Task 9 — правило решения героя и движок (**stop gate**) | agent | 2026-08-17 | 2026-08-17 | `pnpm --filter @oath-and-coin/simulation test`; `pnpm bench:decision` | артефакт CI `decision-benchmark`; §9.1–§9.3 | 258 проверок симуляции; ворота тратят 0 ординалов; каждый член делится сам и к нулю, а не к −∞; ровно нулевой счёт назван ничьёй; 15 мутантов красят (один вернулся зелёным и купил две проверки); p50 решения 0,00138 мс, p50 команды 0,00910 мс на CI | принят |
| Task 10 — исполнение сценариев и oracle parity | agent | 2026-08-17 | 2026-08-17 | `pnpm test:scenario`; `pnpm scenario:parity` | отчёт parity (`--output`); §9.5–§9.8 | 54/54 записи корпуса воспроизведены **побайтно**; 27 сценариев × 27 checkpoints × 2 seed; все пять кодов `ErrorCodes` достижимы из фикстур, порядок стадий проверен входами, создающими два конкурирующих исхода; 13 мутантов красят (один вернулся зелёным и купил две проверки), плюс 14 на правки по двум раундам внешнего ревью (§9.9, §9.10) | принят после двух раундов внешнего ревью codex |
| Task 11 — presentation models | agent | 2026-08-18 | 2026-08-18 | `pnpm --filter @oath-and-coin/presentation test`; `pnpm scenario:parity` | отчёт parity, теперь со сверкой read model; §11.1, §11.2 | 54/54 записи корпуса воспроизведены **вместе с read model, его SHA-256 и состоянием экрана**; 13 мутантов на реализацию, из них один вернулся зелёным и купил проверку; ещё 7 на правки по внешнему ревью (§11.2) | принят после внешнего ревью codex: восемь находок, все приняты |
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
| `migration/03-core` | 6–10 | обязательно (Task 10) — фактически двумя PR: Tasks 6–8 (PR #13, ревью пройдено, §7.7) и Tasks 9–10 (PR #15, два раунда ревью, §9.9 и §9.10); см. §8.2 |
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
| Установленный пакет | 319 031 508 байт (304,3 МиБ), 24 файла | 319 031 508 байт (304,3 МиБ), 24 файла |
| RSS всех процессов | 347 439 104 байт (331,3 МиБ) | 270 209 024 байта (257,7 МиБ) |

CI-числа сняты прогоном `31975374976`, джоба `packaged-desktop`. Размер совпал с локальным **побайтно** — это и есть подтверждение объяснения ниже: пока в пакет не приезжало ничего лишнего, две машины собирают одно и то же. RSS у машин разный и таким останется: это живое потребление под чужой конфигурацией GPU, а не свойство сборки.

**Порог размера снят решением владельца (`ADR-011`), и вот почему это не поблажка.** 304 МиБ — пустое приложение: игрового контента нет, локали Chromium уже урезаны с 55 файлов до двух (минус 47 182 082 байта, `afterPack` печатает это в лог сборки). Остаток — бинарь Electron 43 (225,6 МиБ), лицензии Chromium (19,4 МиБ), компилятор шейдеров DirectX (24,4 МиБ), программный Vulkan (5,2 МиБ). Граница `ADR-010` в 300 МБ лежала ниже пола платформы. Бюджет RSS ≤ 500 МБ сохранён и проверяется тестом; замер укладывается с запасом.

**Разница в 4,4 МиБ между первым локальным замером (319 026 679) и первым CI-замером (323 406 869) объяснена и устранена.** Она не была шумом машины: между прогонами `zod` переехал из `devDependencies` в `dependencies` — правка под правило `not-to-dev-dep`, — а electron-builder добавляет production-зависимости к своим шаблонам поверх `files: [dist/**]`. В `app.asar` приехали **612 файлов и 4 224 422 байта** библиотеки, которая уже была забандлена в `main.cjs` и `preload.cjs`. Найдено при проверке правок ревью: разбор заголовка asar показал `node_modules/zod/src/v3/types.ts` третьим по размеру файлом пакета. Закрыто строкой `'!node_modules/**'` в `electron-builder.yml`; пакет вернулся к 304,3 МиБ, гейт остался зелёным — то есть ничего из выброшенного приложению и не требовалось.

### 5.3. Границы и dual-stack CI

| Факт | Значение | Команда |
|---|---|---|
| Модулей под проверкой границ | 21 модуль, 25 зависимостей, 0 нарушений | `pnpm lint:deps` |
| Правил в конфигурации | 10 | `.dependency-cruiser.cjs` |
| Оба стека в одном пуше | `build` (531 тест .NET) и `typescript` — оба success | run `31975373863` и `31975373654` |
| Гейт Task 4 на CI | джоба `packaged-desktop` на `windows-latest`, 6/6 | run `31975374976` |

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
| Тесты нового стека | 15 Vitest + 2 браузерных + 6 desktop = 23 пройдено (CI runs `31975373654`, `31975374976`) |
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

- ~~**`packages/*` не существуют**, и правила направления для них в `.dependency-cruiser.cjs` покраснеть не могут.~~ **Закрыто в сегменте 3 для двух из четырёх пакетов.** `packages/simulation` и `packages/content` существуют, и правило `simulation-depends-on-nothing` теперь краснеет на живом коде — мутант в §7.5. `packages/presentation` и `packages/application` появятся в Tasks 11–12, и до тех пор их правила остаются исполняемой документацией.
- ~~**Линтера и форматтера для TypeScript нет.**~~ **Закрыто после merge сегмента** отдельной веткой `chore/typescript-lint`: Prettier владеет форматированием, ESLint несёт **десять** правил, выбранных поимённо, а не пресет. Каждое ловит класс дефектов, невидимый компилятору: плавающие и неверно переданные промисы, `await` не над промисом, неполный `switch` по доменному union, `any`, нестрогое равенство и два правила React-хуков. Стадии `format:check` и `lint` стоят первыми в `typescript.yml` — самые дешёвые впереди (`TDD` §19.1). Мутанты: неожиданный плавающий промис красит `lint`, неформатированный файл красит `format:check`.
  - Вне форматтера: C#-дерево (у него свой `dotnet format` до cutover), `migration/oracle/**` и всё, что кормит `ContentDigest` — их байты покрыты хешем, и пробел от форматтера сломал бы доказательство.
  - `no-undef` и `no-unused-vars` выключены намеренно: они дублируют компилятор и при этом не читают `lib` из tsconfig, то есть ругаются на `document` в единственном пакете, которому он разрешён.
- **Браузеры Playwright не в lockfile.** Их версия определяется пином `@playwright/test`, а байты приезжают командой `playwright install` — воспроизводимость здесь слабее, чем у остального дерева.
- **Гейт Task 4 существует только под Windows.** Ни Linux, ни macOS сборки нет, и `ADR-010` их и не обещает.
- **`apps/web` ничего не знает о `window.desktop`.** Renderer не типизирует desktop API и не вызывает его; связь проверяется только гейтом Task 4 изнутри страницы. Настоящий порт — Task 12.
- **Схемы URL проверяются в одном месте, а окно открытия — в другом.** `mayOpenExternally` разрешает `http:`/`https:`, но за пределами `setWindowOpenHandler` есть ещё `will-navigate` (там навигация запрещена целиком) и будущие вызовы из main-процесса. Новый вызов `shell.openExternal` где угодно ещё обязан идти через тот же предикат, и механической проверки на это нет.
- **Sourcemaps едут в пакет** — 757 КБ на два файла хоста. Осознанно: они дешевле любого разбора креша вслепую, но это байты в поставке, а не в отладочной сборке.

## 7. Доказательства сегмента 3 — Tasks 6–8

Сегмент открыт на ветке `migration/03-core` от `main` @ `36942a8` (после merge PR #12, который закрыл долг по линтеру из §6.5). Tasks 9 и 10 в этот рубеж не входят — почему, в §8.2.

### 7.1. Что стоит в дереве после Tasks 6–8

| Факт | Значение | Команда |
|---|---|---|
| Члены workspace | 8: прежние 5 плюс `packages/simulation`, `packages/content`, `tests/oracle` | `cat pnpm-workspace.yaml` |
| Проверки Vitest | 321 в 21 файле (после правок по ревью; до них 256 в 18) | `pnpm test` |
| — из них симуляция | 194 | `pnpm --filter @oath-and-coin/simulation test` |
| — из них контент | 78 | `pnpm --filter @oath-and-coin/content test` |
| — из них корпус | 34 | `pnpm --filter @oath-and-coin/oracle-tests test` |
| Модулей под проверкой границ | 81 модуль, 200 зависимостей, 0 нарушений | `pnpm lint:deps` |
| Согласие трёх статей правил контента | зелёное | `pnpm schema:check` |
| Старый стек | 531 пройдено, 0 не пройдено (26 + 174 + 91 + 145 + 20 + 75) | `dotnet test OathAndCoin.sln -c Release` |

Оба стека зелёные одновременно — требование Task 18, проверенное на каждом коммите сегмента, а не отложенное до него.

**Дайджест контента воспроизведён.** `loadContentSet('content').contentVersion` даёт `5d03734fd9c7abaa` — то самое значение, которое C#-экспортёр записал в `inputs.content_version` всех 54 записей корпуса. Совпадение означает, что сходится вся цепочка: ordinal-порядок путей, путь как часть хеша, байт-разделитель и собственный SHA-256 этого репозитория.

**Начальное состояние воспроизведено.** `createInitialState` раздаёт `heroId` в порядке content-id и даёт ту же ростер-раскладку, что записана в `final_state` каждой записи корпуса: `core:bram` → 0, `core:doran` → 1, `core:ilsa` → 2, `core:kestrel` → 3, `core:mira` → 4, `core:zara` → 5.

### 7.2. Долг §3.3 оплачен: RFC 8785 принят, версия артефакта не шагнула

§3.3 и §4.5 требовали от Task 6 оплатить расхождение канонизации с RFC 8785 **одним явным шагом версии артефакта с сохранённым отображением старых и новых хешей**, запрещая молчаливую пересъёмку. Оплачено так:

1. **Реализован стандарт, а не копия старого писателя.** Все 10 векторов `jcs-compatibility-vectors.json` дают ровно записанные `rfc8785.canonical_base64` и `rfc8785.sha256`.
2. **Отображение старых и новых хешей уже лежит в корпусе** — каждый вектор несёт `current` и `rfc8785` рядом, плюс флаг `same_artifact_version`. Тесты утверждают обе половины: пять векторов с флагом `true` дают и байты `current`, у пяти с `false` хеши обязаны различаться.
3. **Версия артефакта детерминизма остаётся 3, и это записанное решение, а не упущение.** Шаг версии — способ двух сборок сказать «мы расходимся в форме»; здесь они не расходятся ни на одном существующем артефакте, потому что все строки артефакта лежат в `[a-z0-9_.:/-]`, а все числа — безопасные целые, то есть ровно в области, которую покрывают пять согласных векторов. Шаг версии сделал бы 54 побайтно идентичных артефакта формально несравнимыми и уничтожил бы доказательство parity, ради которого сегмент существует. Утверждение «в области артефакта правила совпадают» не берётся на доверие: Task 10 переигрывает все 54 записи против записанных байтов, и именно там оно проверяется до конца.

   **Правка после внешнего ревью (§7.7, блокер 1).** В первой редакции этот пункт был **ложным как утверждение о свойстве** и верным только как наблюдение о текущих файлах: `display_name_key` проверялся как `z.string().min(1)`, поэтому кириллица, control character и строка из пробелов принимались и без изменений доходили до поля `display_name_key` артефакта. Две сборки могли выпустить разные байты под одной версией 3 — ровно то, что версия существует предотвращать. Теперь область **обеспечена**, а не наблюдаема, и обеспечена дважды: контракты держат авторские строки в паттерне ключа локализации, а `requireArtifactSafeText` держит в том же наборе строки, приходящие не из контентного файла (версия правил, переданная инструментом), на границе входа в состояние. Рукописные схемы, которые до cutover читает C#, несут тот же паттерн, поэтому оба стека по-прежнему согласны о том, какой контент валиден.

Числовая область, которую C#-референс отказался покрывать (`out_of_scope`: дробные, экспоненциальные и целые за пределами ±(2^53−1)), закрыта тем, что закрывать было нечего: RFC 8785 §3.2.2.3 делегирует запись чисел ECMAScript `Number::toString`, а этот порт исполняется на ECMAScript. Специфицированный алгоритм здесь — платформенный, а не переписанный.

**Одно место, где порт слабее референса, записано как предел.** Целое `9007199254740993` C#-референс отвергал; здесь оно не доходит до писателя целым — `JSON.parse` уже округлил его до `9007199254740992`, потому что столько держит IEEE 754. Никакая ECMAScript-реализация RFC 8785 не может лучше. Это же и причина, по которой seed кампании — `bigint`, а не `number`.

### 7.3. Собственный SHA-256 и почему это не «своя криптография ради своей криптографии»

Правило `simulation-depends-on-nothing` запрещает чистому ядру любой внешний модуль, включая `node:*`, а записка §6.2 предупреждала: упёрся — не ослабляй правило, а спроси, зачем детерминированным правилам внешний модуль. Ответ: не нужен, хеш — чистая функция. Три места требуют её из слоёв, которым платформенный API недоступен:

- presentation считает `read_model_hash`, а `presentation-depends-only-on-simulation` не пускает её ни к `node:crypto`, ни к контенту (Task 11);
- браузерная сборка считает хеш в браузере, где `node:crypto` нет, а `crypto.subtle.digest` асинхронный — одна асинхронность заразила бы весь API read model;
- само ядро не имеет права ни на один импорт.

Цена названа и оплачена тремя независимыми доказательствами:

| Доказательство | Что именно |
|---|---|
| Векторы FIPS 180-4 | пустое сообщение, `abc`, 448 бит (ровно один блок), 896 бит (перелив во второй), миллион символов; плюс независимость от нарезки на чанки 1/7/63/64/65/127 байт |
| 57 хешей корпуса | `manifest.json` записал их `System.Security.Cryptography`; все 57 пересчитаны этим кодом побайтно по файлам, которые лежат на диске |
| Мутант | одна раундовая константа `0xc67178f2` → `0xc67178f3` красит 18 проверок |

UTF-8 тоже написан руками — по той же причине, что и хеш: `TextEncoder` существует в любом рантайме и ни в одной строке типовой поверхности этого пакета (`types: []`), а появление `types: ["node"]` ради одного вызова сделало бы и `readFileSync` типизированным.

**Корпусные тесты живут в новом члене `tests/oracle`.** `packages/simulation` не может открыть файл — это и есть граница, — поэтому проверка «порт совпадает с замороженным корпусом» не может быть тестом внутри него. `tests/oracle` — член, чья единственная работа в этом: сюда переехала сверка канонизации, здесь лежат RNG-векторы, здесь Task 10 положит parity сценариев. Команда гейта Task 7 в §2 поэтому названа двумя строками, а не одной.

**Предел RNG-векторов, записанный как предел.** Все 1764 int32-вектора корпуса сообщают `ordinals_consumed: "1"` — ветки отбраковки в замороженных данных нет вовсе. Сэмплированием она недостижима (около 5.4e-20 на самом широком диапазоне), поэтому seed `4892902761533153534`, дающий ровно `ulong.MaxValue`, взят из C#-теста, который его сконструировал: вход живёт в git (`AGENTS.md` §11), и пересчитывать его заново значило бы доказывать то же медленнее. Отдельная проверка утверждает, что в корпусе по-прежнему нет ни одной отбраковки — в тот день, когда это перестанет быть правдой, записка перестанет быть правдой вместе с ней.

### 7.4. Что упростилось против C# и почему это не потеря

| C# | Здесь | Почему это не ослабление |
|---|---|---|
| `ContentId` — struct с тремя nullable-полями, `ContentIdJsonConverter` с четырьмя переопределениями, охрана `default(ContentId)` | брендированная строка | Конвертер существовал потому, что struct сериализовался объектом и читался обратно как `default` **молча**. Строка и есть свой формат на проводе; второго представления, с которым можно разойтись, нет. Охрана `default` не нужна: язык не навязывает такое значение |
| Восемь пар `Equals`/`GetHashCode` | одна `deepEqual` | Пары существовали потому, что ни одна immutable-коллекция BCL не переопределяет `Equals`; сгенерированное равенство отвечало «не равно» на одинаковое содержимое и «равно», когда обе стороны держали общий `Empty`. Хеширование не нужно вовсе: ни одна коллекция состояния не ключуется объектом состояния |
| `switch` в проекции артефакта, бросающий на неизвестном типе события | union, различаемый по `kind` | Рантайм-охрана заменена компиляторной: новый член union ломает каждый исчерпывающий `switch`, и до полей нельзя добраться, не сузив по `kind` |
| `TraitFile` с nullable `Weight` плюс две проверки после разбора | union, различаемый по `kind` | Правило «у принципа нет веса» держал код, а не тип. Теперь его держит контракт: у ветки принципа поля `weight` просто нет, и `strictObject` отвергает его |
| `DecisionResult` с проверками в `init`-аксессорах и двумя флагами присваивания | фабрика `createDecisionResult` | Флаги существовали потому, что порядок в object-инициализаторе не гарантирован. У списка аргументов функции такой проблемы нет |

Два инварианта остались договорённостями с тестом, а не типами, и об этом сказано прямо: обычный spread даёт новое состояние, не двигая счётчики (та же дыра, что `with` в C#), и `drawsConsumed` не имеет значения по умолчанию, поэтому каждый переход обязан назвать в вызове, сколько случайности он потратил.

### 7.5. Мутация

Двадцать семь мутантов: восемнадцать локальных на Tasks 6–8, один на CI, и восемь на правки по внешнему ревью (§7.7). Каждый поставлен **после** коммита проверяемого состояния и откачен `git checkout HEAD --` с проверкой чистоты дерева после каждого отката (`AGENTS.md` §8; §8.4 объясняет, почему проверка чистоты добавлена именно здесь).

**Task 6 — семь:**

| Мутант | Что покраснело |
|---|---|
| `TRAIT_SCALE` 100 → 50 | `schema:check`: 5 расхождений — цепочка «делитель → граница → схема» держится |
| ordinal-порядок ключей → порядок вставки | 6 проверок: правила канонизации и векторы корпуса |
| раундовая константа SHA-256 | 18 проверок: векторы FIPS, 57 хешей корпуса, версия контента |
| `z.strictObject` → `z.object` у героя | тест «неизвестное поле отвергается»; **и `schema:check` остался зелёным** — см. ниже |
| правка `schemas/generated/hero.schema.json` руками | `schema:check`: «stale» |
| путь убран из дайджеста контента | `contentVersion` даёт `c389c6d8f2297909` вместо `5d03734fd9c7abaa` |
| `node:fs` в обычном модуле чистого ядра | `lint:deps`: `simulation-depends-on-nothing` |

Четвёртый мутант — единственный, который **не** покраснел там, где должен был, и он купил правку. Причина: в режиме `io: 'output'` Zod пишет `additionalProperties: false` и для `z.object`, потому что у *разобранного значения* в любом случае только известные ключи. Схема описывает файл на диске, значит правильный режим — `input`, и он же единственный, который различает строгий контракт и отбрасывающий. Генерируемые байты не изменились (все контракты и так строгие) — изменилось то, что гейт теперь краснеет, когда один из них перестаёт быть строгим. Коммит `f83760a`.

~~Отдельно — половина того же мутанта, показывающая, что ослабление правила границ под тесты не оставило дыры: тот же `node:fs` внутри `*.test.ts` правило `simulation-depends-on-nothing` пропускает (так и задумано), но `pnpm typecheck` краснеет с `TS2591`, потому что у пакета `types: []`. Две охраны закрывают разные половины.~~

**Опровергнуто внешним ревью (§7.7, major 3).** Утверждение верно ровно для статического импорта `node:*` и неверно как утверждение о границе: `types: []` не закрывает ни часы, ни глобальную случайность, ни динамический импорт с вычисляемым специфаетором — `Math.random`, `Date.now` и `import(specifier)` объявлены стандартной библиотекой либо невидимы резолверу, и файл со всеми тремя даёт пустой список диагностик и ноль нарушений границ. Запрет `ADR-010` на часы и глобальную случайность в симуляции был прозой без исполнения. Закрыто адресными правилами ESLint (§7.7), а само исключение для тестов снято: `vitest` в графе зависимостей не появляется вовсе, так что исключение никогда не было нужно, и правило теперь краснеет и внутри `*.test.ts`.

**Task 7 — четыре:**

| Мутант | Что покраснело |
|---|---|
| `HeroDecision` 3 → 9 | 7 проверок: значения потоков и raw-векторы |
| порог отбраковки → `MASK_64` (никогда не отбраковывает) | 1 проверка — инвариант `threshold % span === 0`; тесты самой ветки остались зелёными, и это ровно то, зачем инвариант проверяется напрямую |
| первый сдвиг миксера `>> 30n` → `>> 31n` | 6 проверок |
| снята одна 64-битная маска | 6 проверок |

**Task 8 — семь, все на доменные инварианты:**

| Мутант | Что покраснело |
|---|---|
| `stateVersion` перестаёт расти | 1 |
| ординал присваивается вместо накопления | 2 |
| `nextTraceId` растёт даже когда след не сохранён | 2 |
| снята проверка монотонности логического времени | 1 |
| сохранённое объяснение можно перезаписать | 1 |
| счёт разрешён рядом с красной линией | 1 |
| каждый герой получает `heroId(0)` | файл не собрался: `SortedMap.from` отвергает дубликат ключа |

**Новая CI-стадия — один, обязательный.** `AGENTS.md` §8 требует мутанта на каждую новую проверку в pipeline, иначе туда попадает стадия, которая никогда не краснела. Стадия — `Content schemas` (`pnpm schema:check`) в джобе `checks` файла `typescript.yml`.

| Мутант | Результат |
|---|---|
| правка `schemas/generated/hero.schema.json` руками (`maxItems` 4 → 9), пуш в ветке `migration/03-core-ci-mutant` без pull request | run `32032777673`: джоба `checks` — failure, упавший шаг именно `Content schemas`; джоба `build` того же пуша (531 тест .NET) — success. Ветка удалена после прогона |

### 7.6. Отклонения от ожиданий записки сегмента 2

| Ожидалось (§6.2) | Сделано | Причина |
|---|---|---|
| Task 6 заводит только `packages/content`; `packages/simulation` — Task 7 | Task 6 заводит оба | ID — deliverable Task 6, а зафиксированное направление `simulation ← content` кладёт `ContentId` в самый внутренний пакет. Положить его в контент значило бы заставить симуляцию импортировать контент |
| Три места регистрации нового члена | Три и есть (`pnpm-workspace.yaml`, `tsconfig.json`, аргументы `lint:deps`), плюс четвёртое для `tools/` в Task 10 | `tools` в аргументы `lint:deps` не добавлен: сегодня там только C#-проекты, и `depcruise` на каталоге без TS-файлов ничего не проверяет. Добавляется задачей, которая пишет `tools/scenario-runner` |
| Правило границ симуляции не трогается | В `from` добавлено исключение `*.test.ts` | Тест обязан импортировать раннер, которым исполняется. Исключение узкое — ровно тот суффикс, который собирает `vitest.config.ts`, — и щель закрыта с другой стороны: `types: []` роняет `node:fs` в тесте на typecheck (мутант в §7.5) |

### 7.7. Внешнее ревью сегмента и закрытые им дыры

Ревью провёл codex (`gpt-5.6-sol`, режим `review` скилла `peer`) по PR [#13](https://github.com/anshushunov/oath-and-coin/pull/13) — по коду ветки и по утверждениям §7 и §8. Вердикт: не готов к merge. Восемь находок: два блокера, пять major, один minor. **Каждая воспроизведена по исходнику до того, как что-то правилось**; семь исправлены, одна принята как унаследованный дефект с записанной причиной, по которой её нельзя исправить сейчас.

Из восьми находок **четыре — это ложные или слишком широкие утверждения самого журнала**, а не только дефекты кода. Это и есть главный итог ревью: гейты в основном мерили то, что обещали, а записка о них обещала больше, чем гейты мерят.

| Дыра | Как вскрыта | Чем закрыта | Мутант после правки |
|---|---|---|---|
| **blocker** — не-ASCII, control character и строка из пробелов доходят до артефакта через `display_name_key`; версия 3 остаётся ложным обещанием сравнимости | пробой `heroFileSchema.safeParse` с кириллическим ключом: принят. Ключ без преобразования идёт в `HeroState` и в поле `display_name_key` артефакта | паттерн ключа локализации в контрактах + `requireArtifactSafeText` на границе входа в состояние + тот же паттерн в рукописных схемах, которые читает C# | снятие паттерна красит 5 проверок контента; снятие проверки на границе красит 5 проверок начального состояния |
| **blocker** — persistence существует только в типах: `withEvent` валидирует объекты вызывающего и хранит их по ссылке | пробой после `withEvent`: `history[0].logicalTime` = 99 при `metadata.logicalTime` = 0, след под ключом 0 сообщает `traceId: 7`, в сохранённое объяснение добавлен фактор | `freezeDeep` на возвращаемое состояние (событие и след достижимы из него), плюс копирование и заморозка кортежей в `SortedMap` | снятие заморозки красит 4 проверки |
| **major** — `bigint` потерял нижнюю границу: `drawsConsumed: -1n` даёт `nextDecisionOrdinal === -1n`, который RNG маскирует в валидный unsigned | вызовом `withEvent(aState(), …, -1n)` | `requireUint64` на seed, ординал и счёт розыгрышей — обе границы | снятие границы `drawsConsumed` красит проверку «откат не проходит, даже если сумма осталась в диапазоне» |
| **major** — писатель называет свой вывод «RFC 8785 text», принимая `bigint`, который вне числового домена стандарта | контрпримером: `canonicalize(18446744073709551615n)` не переживает `JSON.parse` | документировано как одно осознанное расширение поверх стандарта, предел закреплён тестом на отсутствие round-trip | — (документация плюс тест) |
| **major** — `types: []` не закрывает часы, глобальную случайность и динамический импорт с вычисляемым специфаетором | файлом с `Math.random(); Date.now(); import(specifier)`: ноль диагностик TypeScript, ноль нарушений границ | адресные правила ESLint для `packages/simulation/**`: `no-restricted-properties` на `Math.random` и `Date.now`, `no-restricted-globals` на `Date`, `no-restricted-syntax` на динамический импорт с вычисляемым источником | тот же файл даёт 3 ошибки линтера |
| **major** — `schema:check` сверяет числа, а не форму: удаление `oneOf` из рукописной trait-схемы оставляет гейт зелёным | удалением `oneOf` и прогоном `pnpm schema:check` | сравниваются наборы свойств, типы и `required`, а trait-объединение — ветка за веткой по смыслу (рукописная схема объявляет свойства сверху и уточняет в ветках, Zod выдаёт две полные ветки) | удаление `oneOf` красит гейт; удаление `pride` из `required` красит гейт |
| **major** — дайджест контента допускает коллизию: 0x1F может встретиться в содержимом | один файл `a` с содержимым `b␟c␟d` и два файла `(a,b)`, `(c,d)` дают SHA одни и те же байты; воспроизведено | **не исправлено.** Констатация принята, лечение отклонено — см. ниже | коллизия закреплена тестом, названным тем, что он доказывает |
| **minor** — описание границы блока SHA-256 неверно: 448 бит это 56 байт и уже требует второго блока | арифметикой: в один padded-блок влезает не больше 55 байт | комментарий исправлен; обе стороны обеих границ (54/55/56/57/63/64/65 байт) закреплены дайджестами из реализации, которую этот репозиторий не писал | — |

**Почему коллизия дайджеста не исправлена.** Фрейминг входа с длинами её снимает, и это правильное лечение — но не сейчас. Алгоритм побайтно тот же, что в C#, а корпус записал `5d03734fd9c7abaa` как версию контента поставляемого дерева во всех 54 записях. Смена фрейминга меняет каждую версию контента, то есть обесценивает единственное доказательство, которым измеряется вся миграция, и ломает требование «оба стека согласны», пока C# ещё в дереве. Долг адресный: cutover (Task 19), когда корпусу больше не нужно совпадать с C#-реализацией. Коллизия закреплена тестом — в тот день, когда кто-то поменяет фрейминг, тест упадёт и заставит принять решение осознанно.

**Что ревью говорит о самих гейтах.** Четыре находки из восьми — правки не кода, а утверждений: §7.2 обещала обеспеченное свойство там, где было наблюдение о текущих файлах; §7.3 обещала «две охраны» там, где вторая закрывала только статический импорт; журнал упоминал потерянный потолок `bigint` и молчал о потерянном нуле; тест SHA-256 описывал границу блока неверно. Ни одно из этих утверждений не поймал бы прогон — они про то, чего гейты **не** проверяют, а такое проверяется только чтением со стороны. Это тот же вывод, что в §3.6 и §5.6, но в новой форме: раньше ревью находило зелёные гейты на сломанном коде, здесь — верные гейты под неверной подписью.

**Два мутанта в этом раунде оказались зелёными и купили правку кода**, а не новую проверку:

- снятие `freezeDeep(domainEvent)` из начала `withEvent` ничего не покрасило: возвращаемое состояние замораживается глубоко, а событие из него достижимо — значит заморозки аргументов не покупали ничего, кроме заморозки объекта вызывающего на вызове, который потом бросил. Удалены; осталась одна, та, которую мутант убивает;
- снятие границы `drawsConsumed` покраснело **не тем** guard'ом (поймала граница суммы). Обе нужны, и теперь это говорит отдельный тест: ординал 5 плюс −5n даёт 0, что проходит любую проверку суммы, пока кампания молча откатывает пять уже потраченных розыгрышей.

Плюс одна находка не от ревьюера, а от git: литеральный NUL, набранный прямо в исходнике теста, заставлял git считать файл бинарным — каждый его дифф читался как `Bin 6226 -> 6967 bytes`, то есть не читался вовсе, и нормализация переводов строк из `.gitattributes` к нему не применялась. Заменён на `String.fromCharCode`.

## 8. Хождённая земля: рубеж после Tasks 6–8

`AGENTS.md` §9. Записка для следующего исполнителя: что проверено, что опровергнуто замером, какие варианты прогнаны и отвергнуты. Она существует, чтобы следующий не передоказывал сделанное и не лез в тупики, за которые уже заплачено.

### 8.1. Где остановились

| Факт | Значение |
|---|---|
| Ветка | `migration/03-core`, слита в `main` через PR #13 (merge `cc1438c`) |
| Base | `main` @ `36942a8cc97253e6835781b6ade2463e86432d8c` |
| Дерево | чистое |
| Сделано | Tasks 6, 7, 8 — каждая своим коммитом, мутанты после коммита; внешнее ревью пройдено (§7.7) |
| Осталось в сегменте | Task 9 (стоп-гейт), Task 10 (обязательное внешнее ревью) — отдельной ветвью от обновлённого `main`. **Сделано, см. §9 и §10** |
| Тесты нового стека | 306 |
| Тесты старого стека | 531 |

Коммиты: `e8afd08` (Task 6) → `f83760a` (правка по мутанту) → `b6428df` (Task 7) → `5de7df4` (Task 8) → `e90964b` (журнал) → `4e5a8d8` (мутант на CI-стадию) → `aec281f` (восемь находок ревью) → `7bc82b5` (NUL в исходнике) → `a49b208` (правки по мутантам на правки) → коммит этой записки.

### 8.2. Сегмент 3 разбит на два PR, и почему это не обход точки ревью

`AGENTS.md` §2.1 назначает `migration/03-core` одной веткой на Tasks 6–10 с обязательным внешним ревью до merge. Фактически сегмент идёт двумя PR: Tasks 6–8 здесь, Tasks 9–10 следующей ветвью от обновлённого `main`.

Требование ревью при этом не обойдено, а исполнено дважды: PR #13 прошёл внешнее ревью codex до merge (§7.7 — восемь находок, два блокера), и PR по Tasks 9–10 обязан пройти его снова, потому что Task 10 — записанная точка ревью, а Task 9 — стоп-гейт. Обойти его merge'ем этого PR нельзя: parity сценариев в нём нет вовсе.

Причина разбиения — та, которую `AGENTS.md` §9 называет прямо: останов **до** исчерпания контекста, на границе задачи, а не на середине стоп-гейта. Три задачи закрыты с полным доказательством, четвёртая не начата.

### 8.3. Опровергнуто замером

Пять утверждений, которые выглядели верными. Не восстанавливать их обратно.

1. **`corepack pnpm` не единственная ловушка вложенности — Node вообще не читает импорт без расширения.** `import './limits'` в `.ts`-файле падает с `ERR_MODULE_NOT_FOUND`, `import './limits.ts'` работает. Проверено обоими написаниями под Node 24.12.0 до того, как была написана строка `allowImportingTsExtensions`. Отсюда же вывод: `schema:check` и CLI Task 10 — скрипты на чистом Node, а не тесты, притворяющиеся скриптами.
2. **Node исполняет `.ts`, но не компилирует его.** Constructor parameter properties (`private readonly x: T` в списке параметров) роняют загрузчик с `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. `SortedMap` был написан именно так, и генератор схем на нём умер. Механическая защита — `erasableSyntaxOnly` в `tsconfig.base.json`: компилятор отказывает там, где сообщение называет конструкцию, а не стек внутри загрузчика. Тот же запрет убирает `enum`, поэтому закрытые словари здесь — замороженный объект плюс тип того же имени.
3. **`z.toJSONSchema` в режиме `output` не различает `z.object` и `z.strictObject`.** Оба дают `additionalProperties: false`. Нашёл мутант; правильный режим для схемы файла — `input` (§7.5).
4. **Динамический `import()` абсолютного пути на Windows не работает.** Буква диска читается как схема URL: `ERR_UNSUPPORTED_ESM_URL_SCHEME`, `Received protocol 'c:'`. Нужен `pathToFileURL(...).href`. Наступили оба скрипта из `scripts/`.
5. **`vitest run --dir <путь>` не годится для скрипта внутри пакета.** `--dir` разрешается относительно cwd, а корень vitest при запуске из подкаталога становится этим подкаталогом, и корневой шаблон `include` перестаёт совпадать. Рабочая форма — `vitest run --root ../.. <путь>`; именно она стоит в `test` каждого пакета, и команды гейтов из §2 проверены в этом виде.
6. **`Object.isFrozen` — негодный memo для глубокой заморозки.** `freezeDeep` сначала пропускал уже «замороженное», а `SortedMap` замораживает кортежи поверхностно — значит обход останавливался ровно на уровень выше всего, что стоило заморозить, и `Object.isFrozen(state.heroes.values()[0])` был `false`. «Заморожен» и «заморожен глубоко» — разные факты, memo годится только для второго. Поймал тест, написанный на правку по ревью.
7. **`vitest` не появляется в графе зависимостей `dependency-cruiser` вовсе.** Ни для одного тестового файла воркспейса — при том что `node:fs` и `node:path` появляются. Поэтому исключение `*.test.ts` из правила `simulation-depends-on-nothing`, добавленное по предположению «тест обязан импортировать раннер», никогда не было нужно и снято; правило теперь абсолютное и краснеет внутри тестов тоже. Остаточная слепота названа в самом правиле: этот гейт нельзя считать видящим каждый npm-импорт, поэтому запреты `ADR-010` на часы и случайность держит ESLint.

### 8.4. Грабли процесса, на которые наступили в этом сегменте

- **«Мутант после коммита» недостаточно — надо ещё убедиться, что коммит состоялся.** Коммит Task 7 ушёл с частично проиндексированного дерева (предыдущий вызов `git add -A && git commit` был убит по таймауту, повторный вызов сделал только `commit`), поэтому в коммит попал один переименованный файл. Дальше четыре мутанта откатывались через `git checkout --` по путям, которых git не знал, откаты молча провалились, и в дереве осталось четыре наложенных мутации; «контрольный» прогон показал 8 падений и выглядел как настоящая поломка. Спасло то, что поломку видно: 2070 векторов корпуса сошлись сразу после восстановления файлов. Отсюда правило, которым сняты мутанты Tasks 7 и 8: после каждого откáта проверяется `git status --porcelain`, и непустой вывод печатается как ошибка. Это третий случай той же боли (§4.6 записал два), так что правило заведено, а не залечено одной правкой.
- **Утверждение в тесте может быть моим собственным изобретением.** Тест требовал, чтобы `deepEqual(-0, 0)` было `false`, и комментарий рядом объяснял, почему это важно. В целочисленном домене `-0` не возникает, а канонический писатель пишет оба как `0` — то есть тест требовал равенства строже байтов, что ломает свойство «равные состояния сериализуются одинаково» в другую сторону. Правкой стал не код, а утверждение и комментарий.

### 8.5. Прогнано и отвергнуто

| Вариант | Почему отвергнут |
|---|---|
| `ContentId` как объект-обёртка, как в C# | Понадобился бы конвертер сериализации, переопределения для ключей словаря и охрана «неинициализированного» значения — три защиты от того, что брендированная строка делает невозможным |
| Хеш через `node:crypto` в контенте, а presentation получает функцию извне | Асинхронный `crypto.subtle` в браузере заразил бы весь API read model, а инъекция хеша размазала бы платформенную заботу по домену. Чистая реализация в самом внутреннем слое — одна на node, браузер и Electron |
| Шаг версии артефакта детерминизма 3 → 4 под RFC 8785 | Сделал бы 54 побайтно идентичных артефакта формально несравнимыми и уничтожил бы доказательство parity. Расхождение существует только на входах, которых в артефакте нет (§7.2) |
| `Map` и обычные массивы для коллекций состояния | Перечисление в порядке вставки сделало бы канонические байты функцией порядка чтения файлов — свойства, которое загрузчик специально уничтожает, сортируя пути. С `SortedMap` это невыразимо |
| Корпусные тесты внутри `packages/simulation` | Пакету запрещён любой импорт, включая `node:fs`, и `types: []` закрепляет это на уровне компилятора. Проверка «совпадаю с корпусом» не может жить внутри того, кто не умеет открыть файл |
| Корпусные тесты внутри `packages/content` | Так и было в Task 6, и переехало в Task 7: контент-пакету положено тестировать контент, а parity сценариев Task 10 в нём выглядела бы явно не на месте |
| Полное структурное сравнение генерируемой и рукописной схем в `schema:check` | Различаются `$id`, `title`, описания и форма `oneOf`/`anyOf` у трейта. Сравнение выдавало бы шум на каждом прогоне и было бы отключено за неделю. Сверяется явная таблица фактов: пины версий, каждый min/max, `maxItems`, паттерн ID, `additionalProperties` |
| `uniqueItems` в генерируемой схеме | Zod не умеет это выразить. Асимметрия записана как проверка: рукописная схема обязана нести `uniqueItems`, генерируемая обязана его не нести — иначе это перестало бы быть известным пределом и стало бы «кто-то забыл» |

### 8.6. Известные пределы того, что построено в сегменте

- ~~**Правило решения героя и движок ещё не перенесены** (Tasks 9–10), поэтому parity сценариев не доказана ничем: сегодня сходятся дайджест контента, начальное состояние, RNG-векторы и канонические байты — но ни одна из 54 записей корпуса целиком.~~ **Закрыто в Tasks 9–10:** все 54 записи воспроизводятся побайтно (§9.5).
- ~~**`nextDecisionOrdinal` не имеет потолка.**~~ **Закрыто по ревью (§7.7):** `requireUint64` держит обе границы — и потолок, который C# держал `checked`, и ноль, о потере которого этот пункт молчал. Отдельная проверка закрывает откат, оставляющий сумму в диапазоне.
- **Дайджест контента допускает коллизию** между деревом из одного файла и деревом из двух (§7.7). Дефект унаследован от C# и осознанно не исправлен до cutover: исправление меняет каждую версию контента и обесценивает корпус. Закреплён тестом, адресован Task 19.
- **Локализационные ключи в TS строже, чем в C#-загрузчике.** Контракты держат их в паттерне, потому что ключ доходит до артефакта; `ContentSet.RequireLocalizationKey` в C# по-прежнему проверяет только «не пусто и не пробелы». На поставляемом контенте оба стека зелёные (18 ключей и 94 записи локали паттерну соответствуют), расхождение возможно только на контенте, которого никто не авторил. Рукописные схемы, которые читает C#-валидация, паттерн несут.
- **`uniqueItems` для тегов контракта не проверяется загрузчиком** — дубликат тега поглощается множеством, как и в C#. Для трейтов дубликат отвергается по имени. Асимметрия унаследована и проверена тестами с обеих сторон.
- **Целые за пределами ±(2^53−1) округляются, а не отвергаются** (§7.2). Точный путь для 64-битных значений — `bigint`.
- **Правила границ для `packages/presentation` и `packages/application`** по-прежнему написаны над пустотой (§6.5).
### 8.7. Бриф на Tasks 9–10: что известно до первой строчки

Не пересказ плана, а то, что стоило бы знать заранее и что стоило времени здесь. Task 9 — стоп-гейт (`ADR-010` §102: parity к 2026-09-20 либо 10 focused days на Tasks 7–10), Task 10 — обязательное внешнее ревью.

**Ветка.** От обновлённого `main` (в нём уже Tasks 6–8). Правило §2.1 про ветвление от свежего `main` держится; PR по Tasks 9–10 обязан пройти внешнее ревью до merge, потому что Task 10 — записанная точка ревью.

#### Task 9 — правило решения и движок

Что переносится: `ContractDecisionRule` (354 строки), `DecisionContext`, `Actions`, `ReasonCodes`, `SimulationEngine` (193). Всё, что им нужно из состояния, уже есть.

Пять ловушек, которые видно только изнутри C#-исходника:

1. **Целочисленное деление.** В C# `/` для `int` усекает к нулю, в JS `/` даёт число с плавающей точкой. Нужен `Math.trunc`, **не** `Math.floor`: они расходятся на отрицательных. Сегодня все четыре делимых члена (`payment*greed`, `risk*caution`, `(risk−payment)*pride`, `trustInGuild`) неотрицательны, так что на поставляемом контенте floor и trunc совпадают — то есть мутант `trunc → floor` останется **зелёным**, и это не повод считать его безопасным. Записать как известный предел либо покрыть отрицательным случаем через фикстуру, а не через корпус.
2. **Каждый член делится сам, до сложения.** `HERO_DECISION_SPEC` §2.3: деление суммы округляет иначе. Три копии `/ 100` в C# были заменены на `TRAIT_SCALE` — не возвращать литерал.
3. **Гейт принципов идёт до любой арифметики и до розыгрыша настроения.** Заблокированное решение тратит **0** ординалов, а не один: `new HeroDecision(blockedResult, 0)`. Ординал, потраченный на решение, которое закрыла красная линия, сдвинул бы всю дальнейшую случайность кампании.
4. **Ровно нулевой счёт — это ничья, а не согласие с маленьким запасом.** `score == 0` даёт `tieBreak = no_reason_to_refuse` и действие `accept`. Это правка по внешнему ревью в C# (см. `ReasonCodes.NoReasonToRefuse`): раньше `score >= 0` решал молча, и герой соглашался с двумя пустыми списками факторов и без блокировки — автономное решение без единой причины.
5. **Порядок факторов в следе — канонический вывод.** Таблица `HERO_DECISION_SPEC` §2.3 дословно: payment, risk, insult, склонности (в порядке `Traits`, отсортированном по id), trust, связи (в порядке `AcceptedBy`), настроение последним. `AssertTraitsAreSortedById` бросает на неотсортированном входе, и это проверка на каждом вызове, а не `Debug.Assert` — она обязана работать в Release.

Плюс два обязательства, которых в C# не было:

- **Каждый reason code и action id обязан проходить `isArtifactSafeText`.** Они доходят до артефакта, а версия 3 держится на том, что домен обеспечен (§7.2, §7.7). Добавить тест по всему списку `ReasonCodes.All` и `Actions.All` — это ровно тот класс дыры, который ревью нашло в `display_name_key`.
- **Движок не двигает ординал RNG на отклонённой команде.** Порядок проверок от дешёвых к дорогим не косметика: версия состояния и дубликат id — свойства самой команды, поэтому отвечают до любого обращения к состоянию, а решение (единственный шаг, тратящий случайность) происходит, когда отказать уже нечем.

#### Task 10 — исполнение сценариев и parity

Что переносится: `ScenarioManifest` (281), `ScenarioCommands`, `CheckpointResolver`, `ScenarioRunner`, `DeterminismArtifact` (277), плюс `tools/scenario-runner` как CLI.

- **Parity сверяет байты, а не хеш.** У каждой из 54 записей есть `canonical_base64` и `canonical_sha256`. Совпадение хеша при разных байтах невозможно, но отчёт, сравнивающий только хеш, не покажет, *где* разошлось. Сравнивать байты, а хеш — как второй, независимый признак.
- **27 манифестов × по одному именованному checkpoint × 2 seed = 54 записи.** Seed входит в идентичность записи; путь — `scenarios/<scenario>/<checkpoint>/seed-<seed>.json`.
- **Версия артефакта — 3, проекция побайтно та же.** `selected_score` **отсутствует** (а не равен `null`), когда решение заблокировано. `trait_rules` — часть проекции; без него два состояния, различающиеся смыслом трейта, дают одинаковые байты.
- **Добавить `tools` в аргументы `lint:deps`.** Сегодня их там нет намеренно: в `tools/` только C#-проекты, и `depcruise` на каталоге без TS-файлов ничего не проверяет. Задача, которая пишет первый TS-файл в `tools/`, добавляет и аргумент — иначе новый член окажется вне гейта (тест `every member is inside the dependency-boundary gate` это поймает).
- **Долг Task 2 (§3.1) закрывается здесь, а не «когда-нибудь»:** порядок стадий загрузки и все пять кодов `ErrorCodes`. Корпус покрывает один — `CONTENT_ROOT_NOT_FOUND`; `SCHEMA_INVALID` и `CONTENT_INVALID` недостижимы на валидном контенте, `SCENARIO_INVALID` и `CHECKPOINT_UNKNOWN` экспортёр не обрабатывал вовсе. Их parity — это фикстуры, а не корпус.
- **`screen_incomplete`** — единственный сценарий, чей checkpoint намеренно останавливается после первой из шести команд, и тест обязан утверждать **расхождение** с полным canonical-артефактом. Checkpoint, молча начавший покрывать всё, должен быть замечен.
- **Предложение, а не требование:** пусть писатель артефакта сам проверяет `isArtifactSafeText` на каждой строке, которую пишет. Тогда обещание версии 3 держится не только контрактами на входе, но и на выходе — а это последнее место, где ложное обещание сравнимости ещё можно поймать.

#### Чего не делать

- Не ослаблять `simulation-depends-on-nothing` под новый импорт. Если правилам решения понадобился внешний модуль — сначала вопрос «зачем», как это было с SHA-256 (§7.3).
- Не менять фрейминг дайджеста контента (§7.7): это меняет каждую версию контента и обесценивает корпус. Долг адресован cutover.
- Не шагать версию артефакта детерминизма без замера: расхождение с RFC 8785 существует только на входах, которых в артефакте нет, и §7.2 объясняет, почему шаг уничтожил бы parity.
- Не считать зелёный мутант доказательством отсутствия дефекта (`AGENTS.md` §8). В этом сегменте зелёными вернулись три мутанта: один купил правку гейта (`io: 'input'`), два — удаление избыточного кода. Ни один не закрылся словами.


## 9. Доказательства сегмента 3 (продолжение) — Tasks 9–10

Сегмент 3 идёт двумя PR (§8.2). Здесь — вторая половина: ветка
`migration/03-core-decision` от `main` @ `f6276a2`, то есть от рубежа, в котором
Tasks 6–8 уже слиты.

### 9.1. Что стоит в дереве после Task 9

| Факт | Значение | Команда |
|---|---|---|
| Проверки Vitest | 385 в 25 файлах (было 321 в 21) | `pnpm test` |
| — из них симуляция | 258 (было 194) | `pnpm --filter @oath-and-coin/simulation test` |
| Модулей под проверкой границ | 92 модуля, 263 зависимости, 0 нарушений | `pnpm lint:deps` |
| Старый стек | 531 пройдено, 0 не пройдено | `dotnet test OathAndCoin.sln -c Release` |
| p50/p95 одного решения | 0,00138 / 0,00235 мс на 20 000 замерах (CI, `ubuntu-latest`) | стадия `Decision benchmark`, run `32067980553` |
| p50/p95 одной команды через движок | 0,00910 / 0,01464 мс на 20 000 замерах (CI) | там же |

Оба стека зелёные одновременно на каждом коммите этой ветки, а не к её концу.

**Benchmark — замер, а не бюджет, и это записано в самом артефакте.** Ни один
документ репозитория не закрепляет задержку решения: `ADR-010` называет
`tools/scenario-runner` местом, где живут benchmarks, и на этом останавливается.
Порог здесь был бы числом, которое придумал скрипт и надел на себя вид
требования. Артефакт существует, чтобы Task 18 — задача, которая владеет
гейтом производительности, — имела точку до появления UI-стека.

**Правка по внешнему ревью (§9.9, находка 3).** В первой редакции отсюда
выводилось, что `bench:decision` не нужен в CI, а числа приводились из
локального прогона. Вывод смешивал две разные вещи: отсутствие порога и
отсутствие воспроизводимого следа. `AGENTS.md` §11 требует второго независимо
от первого — «инструмент агента обязан оставлять воспроизводимый след, а не
ответ в контексте», и след это «артефакт CI, а не файл в git». p50, живущий в
одной локальной консоли, непроверяем третьей стороной, как бы честно он ни был
снят, — а `artifacts/` под `.gitignore`, так что и в репозитории его нет.
Стадия `Decision benchmark` добавлена, артефакт публикуется, числа выше сняты
ею, и мутант на неё есть (§9.7). Порога по-прежнему нет, и это по-прежнему
решение, а не забывчивость.

Каждый замер таймирует ровно один вызов. Замер пачки с делением сообщал бы
число, которого движок не производит — стоимость вызова после того, как
оптимизатор увидел один и тот же вход тысячу раз, — и прятал бы хвост, ради
которого p95 и снимается.

### 9.2. Пять ловушек §8.7 и чем каждая закрыта

| Ловушка | Как закрыта | Что краснеет |
|---|---|---|
| Целочисленное деление к нулю, не к −∞ | `divideTowardZero` — отдельный модуль, а не выражение внутри правила | таблица пар, где C# и `Math.floor` расходятся, плюс контекст с отрицательной гордостью: `(70−0)*(−45)/100` даёт −31, а не −32, и счёт вычитает его |
| Каждый член делится сам, до сложения | три отдельных вызова `divideTowardZero`, `TRAIT_SCALE` вместо литерала | контекст `payment*greed = 150`, `risk*caution = 90`: почленно 1, суммой 0 |
| Ворота до арифметики и до розыгрыша | `return { result, ordinalsConsumed: 0n }` на пути ворот | сравнение с обычным путём: 0n против 1n |
| Ровно нулевой счёт — ничья | `score === 0 ? NoReasonToRefuse : null`, действие `accept` | ординал 6 на seed 7 даёт настроение 0, поэтому счёт ровно 0 достижим по требованию |
| Порядок факторов — канонический вывод | порядок таблицы `HERO_DECISION_SPEC` §2.3 дословно; `assertTraitsAreSortedById` на каждом вызове | контекст со всеми семью видами вклада: два списка сверяются целиком, поэлементно |

Плюс два обязательства, которых в C# не было:

- **Каждый reason code и action id проходит `isArtifactSafeText`.** `REASON_CODES`
  и `ACTIONS` выводятся из замороженных объектов через `Object.values`, а не
  переписываются вторым списком, — то, ради чего C# держал рефлексионный тест.
  Проверка идёт по всему списку, а не по выборке.
- **Отклонённая команда не двигает ординал RNG.** Утверждается не только
  «ординал на месте», но и сильная форма: решение после трёх отказов побайтно
  то же, что решение без них.

**Отрицательный делимый на поставляемом контенте невозможен, и это записано как
предел, а не как гарантия.** Все четыре делимых члена (`payment*greed`,
`risk*caution`, `(risk−payment)*pride`, `trustInGuild`) неотрицательны по
границам контента, поэтому мутант `trunc → floor` остался бы зелёным на всех
54 записях корпуса. Ловит его фикстура с отрицательной шкалой — шкала героя в
состоянии это `number`, и ничто в пакете отрицательную не отвергает.

**Одна находка не из плана: `Math.trunc(-1 / 100)` даёт `-0`.** Значение,
которого целочисленное деление C# произвести не может вовсе, и которое
неразличимо под `===`, `<` и `>`. Оно доехало бы до величины фактора и до
артефакта незамеченным. `divideTowardZero` нормализует ноль, и отдельная
проверка утверждает это через `Object.is`.

### 9.3. Мутация Task 9

Пятнадцать мутантов. Каждый поставлен **после** коммита проверяемого состояния
(`67e1a8d`; факт коммита проверен `git show --stat`, §8.4), откачен
`git checkout HEAD -- <path>`, и после каждого отката проверен
`git status --porcelain` — непустой вывод останавливает прогон.

| Мутант | Что покраснело |
|---|---|
| `Math.trunc` → `Math.floor` | 8 проверок: таблица деления, свойство «расходятся только на отрицательных», отрицательная гордость |
| ворота возвращают `ordinalsConsumed: 1n` | 2 |
| `tieBreak` всегда `null` | 1 |
| `score < 0` → `score <= 0` | 1 |
| счёт считается делением суммы, а не почленно | 1 |
| снята `assertTraitsAreSortedById` | 2 |
| склонность уходит в начало списка (`push` → `unshift`) | 1 — порядок факторов |
| `no_reason_to_refuse` → `NoReasonToRefuse` | 1 — `isArtifactSafeText` |
| `action:decline` → `action:Decline` мимо парсера (`as ContentId`) | 1 — `isArtifactSafeText` |
| `rejected` возвращает состояние с ординалом +1 | 6 |
| движок отдаёт черты в авторском порядке | 9 — правило отказывается |
| `acceptedBy.size >= requiredCrew` → `>= 1` | 3 |
| событие называет противоположный ответ | 2 |
| отказ тоже вступает в команду | 2 |
| таблица команды строится из `respondedBy` | **сначала 0** — см. ниже; после правки 1 |

**Пятнадцатый вернулся зелёным и купил две проверки, а не слова.** Правило
обходит `contract.acceptedBy` и только *ищет* в таблице, поэтому таблица с
лишними записями отвечает так же — пока `acceptedBy ⊆ respondedBy`. Это
утверждение жило в комментарии к `ContractState` и не проверялось нигде.
Добавлены две проверки: подмножество на живом прогоне, где множества
действительно различаются (Брам отказывается от неоплачиваемой опасной работы,
Зара — нет), и ветка «`acceptedBy` называет героя, которого в кампании нет»,
до которой не доходил ни один случай. После них тот же мутант краснеет.

### 9.4. Что упростилось против C# в Task 9

| C# | Здесь | Почему это не ослабление |
|---|---|---|
| `SimulationEngine` — sealed class без полей плюс рефлексионный тест на отсутствие полей | модуль функций | Класс существовал, чтобы будущая вариация правил была *экземпляром*, и чтобы тесту было о чём. У модульной функции некуда положить генератор, счётчик или кэш, поэтому «движок ничего не держит» перестаёт быть тестом и становится фактом о форме кода |
| `ReasonCodes.All` и `Actions.All` — рукописные списки плюс рефлексионный тест против дрейфа | `Object.values` замороженного объекта | Список выводится, а не пишется второй раз: код, добавленный в объект, попадает в список раньше, чем кто-то вспомнит про список |
| `HeroDecision` — record с двумя полями | тот же интерфейс | Ничего не упростилось, и это тоже запись: счёт потраченных ординалов обязан ехать вместе со значением, которое его стоило |

### 9.5. Parity: 54 из 54, побайтно

Главное утверждение сегмента и то, ради чего он существует.

| Факт | Значение | Команда |
|---|---|---|
| Записей корпуса воспроизведено | **54 из 54**, побайтно | `pnpm scenario:parity` |
| Сценариев / checkpoints / seed | 27 / 27 / 7 и 424242 | там же |
| Рубеж, с которого снят корпус | `12565862b1e88e0524f95def18c023571ec4269f` | там же |
| Проверки Vitest | 520 в 31 файле (было 385 в 25) | `pnpm test` |
| — из них сценарии и корпус | 117 в 5 файлах | `pnpm test:scenario` |
| — из них симуляция / контент / корпус / CLI | 258 / 130 / 92 / 25 | `pnpm --filter … test` |
| Модулей под проверкой границ | 108 модулей, 331 зависимость, 0 нарушений | `pnpm lint:deps` |
| Старый стек | 531 пройдено, 0 не пройдено | `dotnet test OathAndCoin.sln -c Release` |

**Сверяются байты, а не хеш, и различие названо честно.** У каждой записи есть
`canonical_base64` и `canonical_sha256`. Совпадение хеша при разных байтах не
случается, поэтому хеш — второй, независимый признак (он считается своим
SHA-256 этого репозитория, другим кодом и по другому пути). Чего хеш не умеет —
сказать, *где* разошлось: он отвечает «нет» и замолкает. Поэтому сравниваются
байты, а при расхождении структуры обходятся и называется первый путь JSON,
который не сошёлся, и первое смещение в тексте.

**Правка по внешнему ревью (§9.9, находка 5).** Формулировка «обнаружение
покупает хеш, локализацию — байты» была безусловной и потому неверной: она
молча предполагала, что два записанных поля согласны между собой. На записи,
которая не согласна сама с собой, расхождение обнаруживают именно байты — хеш
совпадает с портом и молчит. Поэтому согласие полей теперь проверяется **до**
сверки: пересчитывается SHA-256 от `canonical_base64` записи и сравнивается с
её же `canonical_sha256`. После этого утверждение верно и в узком виде: при
согласованной записи расхождение прогона ловит любое из двух, а байты добавляют
ответ на вопрос «где» — и ловят несогласованную запись, которую хеш пропускает.

**Два факта лежат вне канонических байт и поэтому сверяются отдельно.**

1. **Сколько случайности потратил каждый шаг.** Артефакт несёт только конечный
   ординал, поэтому прогон, потративший ординал на шаге, который не должен был
   тратить ничего, и ничего — на шаге, который должен был потратить один,
   приходит к тому же итогу и к тем же байтам. Считается так же, как считал
   экспортёр: переигрыванием префиксов того же списка команд через тот же
   production-раннер, а не вторым счётчиком розыгрышей. Второй счётчик
   согласился бы сам с собой и не сказал бы ничего о правиле.
2. **Код ошибки записи, которая артефакта не произвела вовсе.** Запись,
   остановившаяся на стадии загрузки, не должна молча «совпасть» с записью,
   которая дошла до конца.

Seed сверяется явно, хотя байты его и так покрывают: `campaign_seed` конечного
состояния сравнивается с seed записи. Это тот самый мутант из §3.1 —
`createInitialState(seed, …)` → `7UL`, — и здесь он красит 30 проверок.

**`read_model` и `screen_state` в область Task 10 не входят.** Обе величины
корпус несёт, и обе строит фабрика представления, которой ещё нет: это Task 11.
Сказать «54/54 воспроизведены» и умолчать об этом значило бы обещать больше,
чем сделано, — записи корпуса сверены по всему, что производит слой домена и
контента, и ни по чему из того, что производит слой экрана.

### 9.6. Долг §3.1 закрыт: пять кодов и порядок стадий

`LoadModel` уезжает из `game/app/Main.cs` и становится production-функцией
`loadAndRunScenario`. §3.6 записала и констатацию, и отказ: ни экспортёр, ни
тест не наблюдали эту последовательность, смена порядка стадий там не покрасила
бы ничего, — а лечение *в C#* было отклонено, потому что означало рефакторинг
Godot-хоста, который целиком удаляется на Task 19. Долг был адресован сюда, и
здесь оплачен.

| Код | Чем достигнут в фикстуре |
|---|---|
| `SCENARIO_INVALID` | манифеста нет; манифест есть и не разбирается |
| `CHECKPOINT_UNKNOWN` | имя checkpoint, которого сценарий не объявляет; сценарий без файла команд, чей checkpoint называет id команды |
| `CONTENT_ROOT_NOT_FOUND` | каталога контента нет |
| `SCHEMA_INVALID` | `greed` строкой вместо числа |
| `CONTENT_INVALID` | герой ссылается на черту, которой не объявляет ни один файл — контракт возразить не может, знает об этом только загрузчик |

Порядок важнее самих кодов, поэтому каждая проверка порядка создаёт **два
конкурирующих исхода** и утверждает **ранний**:

- сломанный манифест плюс несуществующий checkpoint → `SCENARIO_INVALID`;
- несуществующий checkpoint плюс отсутствующий контент → `CHECKPOINT_UNKNOWN`;
- `loading`-манифест плюс несуществующий checkpoint → `CHECKPOINT_UNKNOWN`
  (короткое замыкание на экран загрузки не перепрыгивает проверку checkpoint:
  иначе пропавший файл команд был бы «предположен» экраном, который не читает
  контент);
- отсутствующий контент плюс невалидная схема → `CONTENT_ROOT_NOT_FOUND`;
- поле вне диапазона плюс неизвестный id черты → `SCHEMA_INVALID`. Это самая
  дорогая из пяти: под обратным порядком автор читает сообщение о ссылочной
  целостности для файла, настоящая беда которого — число, уже описанное схемой.

**Один аргумент C#-версии исчез.** `LoadModel` принимала `schemaRoot` и звала
`ContentSchemas.Load(schemaRoot).ValidateOrThrow(contentRoot)`; здесь стадия 1 —
сами Zod-контракты, то есть код, а не файлы на диске, и указывать не на что.
Рукописные JSON-схемы остаются для .NET-стороны и держатся за контракты
`pnpm schema:check` до cutover.

**Коды живут в `packages/content`, а не рядом с экраном, и цена названа.** В C#
они лежали в `OathAndCoin.Presentation`. Направление зависимостей это
запрещает: `presentation-depends-only-on-simulation`, а все пять кодов
производит чтение файлов, ни один — экран. Плата: Task 11 переносит `ErrorKeys`,
которому список нужен для проверки полноты каталога локали, и эта проверка не
может жить внутри `packages/presentation` — ей место в тестовом члене, как и
корпусным сверкам. Записано здесь, а не обнаружено потом.

### 9.7. Мутация Task 10

Тринадцать мутантов, каждый после коммита проверяемого состояния (`882fde8`,
`cdb2217`; факт коммита проверен `git show --stat`), откачен
`git checkout HEAD -- <путь>` с проверкой `git status --porcelain` после
каждого отката.

| Мутант | Что покраснело |
|---|---|
| раннер игнорирует переданный seed (`7n` вместо `seed`) | 30 |
| артефакт перестаёт нести `trait_rules` | 50 |
| у заблокированного решения `selected_score` пишется как `null` | 13 |
| срез checkpoint теряет граничную команду (`<` вместо `<=`) | 55 |
| checkpoint по умолчанию — первый, а не последний | 1 |
| артефакт сообщает ординал 0 вместо достигнутого | 43 |
| `responded_by` строится из `acceptedBy` | 32 |
| загрузчик идёт до валидации схемы | 2 |
| короткое замыкание на `loading` перепрыгивает проверку checkpoint | 1 |
| манифест перестаёт проверять объявленное имя экрана | 1 |
| parity перестаёт сравнивать байты и оставляет только хеш | 1 |
| parity перестаёт сравнивать пошаговые розыгрыши | 2 |
| `matched` всегда `true` | **сначала 0**; после правки 2 |

**Тринадцатый вернулся зелёным и купил две проверки.** `matched` — производное
поле: все существующие случаи утверждали про `failures`, а CLI считает
`matched`, и `54/54 reproduced` вместе с кодом выхода 0 строятся именно на нём.
То есть путь, который читает pipeline, не был покрыт ничем. Добавлены: проверка
самого поля на испорченной записи и проверка кода выхода `1` на испорченном
корпусе из одной записи. После них мутант красит две.

**Отдельно — проверка того, что сама сверка умеет краснеть.** 54 зелёные записи
говорят, что порт согласен с корпусом, и ничего не говорят о том, будет ли
замечено несогласие. Поэтому `tools/scenario-runner/src/parity.test.ts` строит
корпус из одной настоящей замороженной записи и портит по одному полю за раз:
байты, хеш, версию контента, код ошибки, вид исхода, пошаговый расход ординалов,
конечный ординал, наличие артефакта.

**Стадии `scenario:parity` не заводится, и это решение, а не забывчивость.**
`pnpm test` уже гоняет и `tests/oracle`, и `tools/scenario-runner`, поэтому
отдельная стадия могла бы покраснеть только одновременно со стадией `Test` — то
есть стоила бы прогона, не добавляя ни одного различимого исхода. `AGENTS.md`
§8 требует мутанта на каждую новую стадию именно затем, чтобы в pipeline не
попадала стадия, которая не умеет краснеть сама по себе; стадия, которая умеет
краснеть только вместе с другой, — тот же расход без того же выигрыша.

**Стадия `Decision benchmark` заводится, и по другой причине** (§9.1): она не
гейт, а публикация артефакта, которой требует `AGENTS.md` §11. Краснеть она
умеет — benchmark, переставший запускаться, останавливает джобу, — поэтому
мутант на неё обязателен и снят:

| Мутант | Результат |
|---|---|
| `scripts/benchmark-decision.mjs` импортирует несуществующий модуль правила, пуш в ветке `migration/03-core-decision-ci-mutant` без pull request | run `32068030545`: джоба `checks` — failure, упавший шаг именно `Decision benchmark`, все стадии до него (включая `Test`) зелёные; джоба `build` того же пуша (531 тест .NET) — success. Ветка удалена после прогона |

### 9.8. Что упростилось против C# в Task 10

| C# | Здесь | Почему это не ослабление |
|---|---|---|
| `switch` в проекции артефакта, бросающий на неизвестном типе события, и второй такой же на `ContractStatus` | дискриминант союза и есть строка, которую пишет артефакт | Рантайм-охрана заменена компиляторной: новый член союза ломает исчерпывающий `switch`, а до полей нельзя добраться, не сузив по `kind` |
| `selected_score` пишется условным присваиванием | `undefined`, который `canonicalize` опускает | Правило «в каноническом артефакте нет пустых слотов» заявлено один раз, в писателе, а не на каждом необязательном ключе |
| `RenderTrace` / `RenderDecision` через `InternalsVisibleTo` | обычный экспорт | Проекция — чистая функция своего аргумента, и прятать в ней нечего; `InternalsVisibleTo` открывал ровно тем тестам, которые и так вызывали её |
| `ScenarioManifest.Load` разбирает JSON вручную и проверяет поля по одному | Zod-контракт плюс именованные проверки на то, что контракт выразить не может | Неизвестное поле, отсутствующее обязательное и неверный тип ловит контракт с указанием файла и пути JSON; кросс-полевые правила остаются кодом, потому что они и есть код |

### 9.9. Внешнее ревью Tasks 9–10 и закрытые им дыры

Ревью провёл codex (`gpt-5.6-sol`, режим `review` скилла `peer`) по ветке
`migration/03-core-decision` — по коду и по утверждениям §9 и §10. Вердикт:
не готов к работе. Шесть находок: четыре major, две minor. **Каждая
воспроизведена самим ревьюером** — вызовом, контрпримером или конкретными
строками, — и каждая подтвердилась при перепроверке по исходнику до того, как
что-то правилось. Отклонённых нет.

Из шести находок **три — про утверждения самого журнала**, а не только про
дефекты кода. Это тот же итог, что в §7.7, и он устойчив: гейты в основном
мерят то, что обещают, а записка о них обещает больше.

| Дыра | Как вскрыта | Чем закрыта | Мутант после правки |
|---|---|---|---|
| **major** — `heroId` отвергал отрицательные и принимал значения за пределами int32: домен разъехался с C# **в обе стороны** | контрпримером: `hero_index: -1` проходит контракт сценария, в C# `new HeroId(-1)` законен, `Heroes.TryGetValue` промахивается и движок отвечает `UNKNOWN_HERO`; здесь прогон падал `Invalid HeroId -1`. Отдельно: `heroId(2147483648)` принимался, хотя C# `int` этого не удержит | домен ровно тот, что у `readonly record struct HeroId(int Value)`: `HERO_ID_MIN..HERO_ID_MAX`; `hero_index` в контракте сценария ограничен тем же диапазоном | возврат к «отвергаем отрицательные» красит 5, снятие границы int32 — 2 |
| **major** — parity не связывала идентичность из manifest с содержимым файла записи | вызовом `verifyEntry` с настоящим `path` и подменённым `checkpoint`: вернулось `matched: true` под чужим именем | сверяются `scenario`, `checkpoint`, `seed` и канонический путь `scenarios/<scenario>/<checkpoint>/seed-<seed>.json` | подмена каждого из трёх полей и путь мимо правила адресации красят; снятие сверки красит 4 |
| **major** — вывод «benchmark не бюджет, значит CI-стадия не нужна» смешивал отсутствие порога с отсутствием воспроизводимого следа | командой: `bench:decision` есть только в `package.json`, workflow его не запускает, `artifacts/` под `.gitignore` — то есть p50/p95 из §9.1 существовали лишь как локальный замер, чего `AGENTS.md` §11 прямо не допускает | стадия `Decision benchmark` без порога плюс публикация артефакта; числа §9.1 пересняты прогоном CI | сломанный benchmark красит именно эту стадию (run `32068030545`) |
| **major** — CLI нарушал собственный контракт кодов выхода | прогонами: `run --scenario` без значения — исключение мимо `main`, exit **1** (код «корпус разошёлся»); `run --scenario gate0 --bogus value` — exit **0**, флаг молча проигнорирован | опции разрешены поимённо на команду, повтор опции отвергается, все пути ошибки возвращают 2; проверки запускают **процесс**, а не `main` с заведомо корректным массивом | возврат к игнорированию неизвестной опции красит 1, вынос разбора из `try` — 4 |
| **minor** — утверждение «обнаружение покупает хеш, локализацию — байты» безусловно неверно | указанием на собственную проверку журнала: в ней портится `canonical_base64`, а `canonical_sha256` остаётся прежним, и расхождение ловят именно байты | согласие двух полей записи проверяется **до** сверки (пересчёт SHA-256 от `canonical_base64`); формулировка сужена до условия, при котором верна | снятие проверки согласованности красит 1 |
| **minor** — «каждая проверка порядка ломает две стадии сразу» не подтверждается случаем checkpoint перед `loading` | чтением: там сломана одна стадия, а `loading` — законная терминальная ветка, а не вторая поломка | формулировка исправлена на «создаёт два конкурирующих исхода и утверждает ранний» | — |

**Что это говорит о гейтах.** Две находки — про то, что проверки звали `main`
с уже разобранным массивом и потому не видели процессных путей, и про то, что
54 зелёные записи не проверяли, связан ли индекс с содержимым. Обе — гейты,
зелёные на сломанном коде, и ни одна не видна в диффе. Третья и пятая — про
утверждения, которые были сильнее того, что стоит за ними: один вывод смешивал
два разных требования записи, второй молча предполагал условие, которого код не
обеспечивал. Это ровно то распределение, которое §7.7 назвала главным итогом
прошлого раунда, и оно повторилось.

**Одна правка не из находок, а из них следует.** Тест `hero-id.test.ts`
утверждал, что `-1` отвергается, «которое C# не мог выразить», — и эта фраза и
была дефектом целиком: C# выражает её прекрасно. Тест изобрёл себе требование и
затем его же прошёл. Это второй такой случай за миграцию (§8.4 записал первый,
про `deepEqual(-0, 0)`), поэтому он записан не как частность, а как повторяемая
форма ошибки: **утверждение в тесте про чужую сборку проверяется по чужой
сборке, а не по памяти.**

### 9.10. Второй раунд внешнего ревью

Тот же ревьюер (codex, `gpt-5.6-sol`) по ветке с уже внесёнными правками первого
раунда. Вердикт: не готов к слиянию. Шесть находок: один blocker, два major, три
minor. Все воспроизведены ревьюером и подтверждены по исходнику до правки; все
приняты.

Числа гейтов после этого раунда: `pnpm test` — **565** в 31 файле
(симуляция 275, контент 135, корпус 92, CLI 48), `pnpm test:scenario` — 140,
`pnpm lint:deps` — 109 модулей и 339 зависимостей, parity — 54/54, старый стек —
531.

| Дыра | Как вскрыта | Чем закрыта | Мутант после правки |
|---|---|---|---|
| **blocker** — parity гоняла сценарий из **записанных в корпусе** входов, поэтому файлы в `scenarios/` гейт не читал вовсе; `content_root` и `fault` манифеста не потреблял никто, кроме тестов | подменой `expected_error_code` у `screen_error` на другой валидный код: `54/54 reproduced`, 0 расхождений. Отдельно: `run --scenario screen_error` грузил production-контент и выходил с кодом 0 | общий резолвер `resolveContentRoot`: манифест решает, если вызывающий не переопределил; parity сверяет **всю декларативную половину** сегодняшнего манифеста с замороженной и путь контента, которым прогон фактически пошёл | снятие сверки манифеста красит 1, снятие `fault` — 4, снятие `content_root` — 14, снятие сверки пути — 1 |
| **major** — правило умножало в double там, где C# перемножает два `int` unchecked | контрпримером `payment = greed = 2147483647`: TS дал `46116860141324210`, C#-эквивалент — `0` (`BigInt.asIntN(32, …)` = 1, делённое на 100). `CheckForOverflowUnderflow` не включён ни в одном проекте | `multiplyInt32` (`Math.imul`) на три произведения и одна свёртка `toInt32` на сумму | возврат к `*` красит 4, снятие свёртки суммы — 3 |
| **major** — `command_id`, `expected_state_version`, `after_command_id` были `long`, стали double; предел не назван | подменой `command_id` на `9007199254740993`: C# `long` держит точно, здесь — отказ | предел закреплён проверками и записан в §10.5. Не расширено: `bigint` здесь сдвинул бы `stateVersion`, `nextEventId` и числовой домен самого артефакта — это решение, а не попутная правка | — (предел, а не дефект) |
| **minor** — CLI принимал написания seed, которых оригинал не принимает | прогонами: `--seed 0x7` и `--seed +7` дали код 0 и тот же хеш; `ulong.TryParse` с `NumberStyles.None` отвергает оба | seed разбирается только как беззнаковое десятичное | **сначала 0** — см. ниже; после правки 5 |
| **minor** — исправление шестой находки первого раунда не доехало до сводной таблицы §2 | чтением: строка Task 10 всё ещё говорила «входами, сломанными на двух стадиях сразу», хотя §9.6 уже говорила иначе | формулировка приведена к §9.6 в обоих местах | — |
| **minor** — в §10.7 числа названы записями корпуса, а посчитаны как пары сценарий/checkpoint | пересчётом по 54 файлам: `Incomplete` 44, `Normal` 4, `Empty` 2, `Error` 2, `Loading` 2 | числа приведены к записям, единица измерения названа явно | — |

**Мутант на seed вернулся зелёным и купил проверку.** Код был исправлен, а
случая под него не написано: снятие всей проверки оставляло 565 зелёных. Это
ровно то, о чём `AGENTS.md` §8 предупреждает — правка без мутанта выглядит как
закрытая дыра. Добавлены процессные случаи на семь написаний, которые оригинал
отвергает, и на одно (ведущие нули), которое принимает; после них мутант красит
пять.

**Три правки этого раунда сделаны не в коде, а в утверждениях**, и одна из них —
про предыдущий раунд: §9.9 сообщала, что шестая находка закрыта, тогда как
исправлена была одна из двух копий формулировки. Вывод, который стоит запомнить
дороже самой правки: **«исправлено» проверяется поиском по всем повторениям, а
не по тому месту, где замечание было замечено.**

**Ещё одна правка родилась из линтера, а не из ревью.** Первая версия проверок
на `long` писала `9007199254740993` числовым литералом; `no-loss-of-precision`
отказался. Он был прав дважды: литерал уже не то число, и проверка проходила бы
по причине, отличной от заявленной. Настоящий предел оказался жёстче
формулировки — `JSON.parse` округляет токен **до** того, как контракт его
увидит, поэтому загрузчику не достаётся шанса отвергнуть авторское значение, он
отвергает соседнее. Проверки переписаны на сырой JSON-текст и утверждают именно
это.

## 10. Хождённая земля: рубеж после Tasks 9–10

`AGENTS.md` §9. Записка для следующего исполнителя: что проверено, что
опровергнуто замером, какие варианты прогнаны и отвергнуты. Она существует,
чтобы следующий не передоказывал сделанное и не лез в тупики, за которые уже
заплачено.

### 10.1. Где остановились

| Факт | Значение |
|---|---|
| Ветка | `migration/03-core-decision`, слита в `main` через PR [#15](https://github.com/anshushunov/oath-and-coin/pull/15) (merge `31bda42`) |
| Base | `main` @ `f6276a2` |
| Дерево | чистое |
| Сделано | Tasks 9 и 10 — каждая своим коммитом, мутанты после коммита |
| Сегмент 3 закрыт целиком | Tasks 6–8 слиты PR #13, Tasks 9–10 — PR #15 |
| Тесты нового стека | 565 в 31 файле |
| Тесты старого стека | 531, 0 не пройдено |
| Parity | 54/54 записи корпуса побайтно |
| Внешнее ревью | два раунда по этой ветке: шесть находок и ещё шесть, все приняты и закрыты (§9.9, §9.10) |

Коммиты: `67e1a8d` (Task 9) → `2071b5d` (две проверки по зелёному мутанту) →
`6a3f9d4` (журнал Task 9) → `882fde8` (Task 10) → `cdb2217` (сверка умеет
краснеть) → `75663ef` (код выхода и `matched`) → `e5a4772` (журнал Task 10 и
записка) → `0818d78` (шесть находок первого раунда) → `c6e356c` (шесть находок второго) →
`784b4c3` (проверка на зелёный мутант seed) → `1c21055` (журнал второго раунда).

### 10.2. Что блокирует Task 11

Ничего: PR #15 слит, `main` стоит на `31bda42` и зелёный на обоих стеках.
Ветка `migration/04-ui` создаётся от него. Плюс своё: Task 11
заводит `packages/presentation` — четвёртого настоящего члена `ADR-010` §45, и
регистрировать его надо в трёх местах (`pnpm-workspace.yaml`, `tsconfig.json`,
аргументы `lint:deps`), из которых два покраснеют сами, а первое — нет. Аргумент
`tools` в `lint:deps` уже добавлен здесь, вместе с первым TS-файлом в `tools/`.

### 10.3. Опровергнуто замером

Не восстанавливать эти утверждения обратно.

1. **`Math.trunc(-1 / 100)` даёт `-0`.** Значение, которого целочисленное
   деление C# произвести не может: у `int` один ноль. Оно неразличимо под `===`,
   `<` и `>`, поэтому доехало бы до величины фактора и до артефакта
   незамеченным. `divideTowardZero` нормализует ноль, `Object.is` это проверяет.
2. **Корпус не отличает усечение от округления вниз.** Все четыре делимых члена
   решения неотрицательны по границам контента, поэтому мутант `trunc → floor`
   зелёный на всех 54 записях. Разделяет их только фикстура с отрицательной
   шкалой. «Проверено на корпусе» не значит «проверено».
3. **Байты parity покрывают меньше, чем кажется на первый взгляд, и больше,
   чем хеш.** Внутри байт: seed, версия правил, версия контента, все шаги, все
   следы и всё конечное состояние. Снаружи: пошаговый расход ординалов (артефакт
   несёт только конечный) и код ошибки записи, которая артефакта не произвела.
   Оба проверяются отдельно, и оба имеют свой мутант.
4. **Цена байтов зависит от того, согласна ли запись сама с собой.** §8.7
   требовала сверять байты, «а хеш — как второй, независимый признак», и была
   права. Уточнение стоило раунда ревью и одной неверной формулировки: пока
   `canonical_base64` и `canonical_sha256` записи согласны, расхождение прогона
   ловит любое из двух, и байты добавляют только ответ «где». Как только они не
   согласны — а до ревью это ничем не проверялось, — расхождение ловят
   **только** байты. Поэтому согласие полей проверяется до сверки, и лишь после
   этого утверждение о разделении труда между хешем и байтами верно (§9.5).
5. **`matched` был производным полем, которое никто не проверял.** Мутант
   `matched: true` вернулся зелёным при 54 честно совпавших записях: все случаи
   утверждали про `failures`, а код выхода CLI строится на `matched`. Путь,
   который читает pipeline, не был покрыт ничем.
6. **Домен `HeroId` — знаковый int32, а не «неотрицательное целое».** C# это
   `readonly record struct HeroId(int Value)` без единой проверки: `-1` там
   законен, промахивается мимо ростера и даёт `UNKNOWN_HERO`. Прежняя граница
   отвергала отрицательные и при этом пропускала `2147483648`, то есть была
   неверна в обе стороны сразу. Так выходит всегда, когда границу выбирают из
   того, что передают сегодняшние вызывающие, а не из того, что мог выразить
   оригинал.
7. **Проверка, зовущая `main` с уже разобранным массивом, не видит процессных
   путей.** CLI выходил с кодом 1 на пропущенном значении опции и с кодом 0 на
   неизвестном флаге — оба вопреки собственному контракту, и оба были невидимы
   in-process. Проверки кодов выхода теперь запускают процесс.
8. **`int * int` в C# — unchecked 32-битное умножение, а не арифметика
   двойной точности.** `payment = greed = 2147483647` даёт здесь
   `46116860141324210`, а в C# — `0`. Ни в одном проекте не включён
   `CheckForOverflowUnderflow`, поэтому оригинал молча заворачивает, и
   верный порт заворачивает тоже: отказ был бы расхождением в другую сторону,
   на кампании, которую C# продолжил бы считать.
9. **Манифест сценария решал ничего.** `content_root` и `fault` разбирались и
   не потреблялись никем вне тестов, поэтому `screen_error` грузил production-
   контент и завершался успехом, а parity гоняла сценарии из записанных в
   корпусе входов — то есть файлы `scenarios/` гейт не читал вовсе.
10. **Мутант «таблица команды из `respondedBy`» эквивалентен, пока
   `acceptedBy ⊆ respondedBy`.** Правило обходит `acceptedBy` и только *ищет* в
   таблице, поэтому лишние записи ничего не меняют. Подмножество жило в
   комментарии `ContractState` и не проверялось; теперь проверяется, и мутант
   краснеет.

### 10.4. Прогнано и отвергнуто

| Вариант | Почему отвергнут |
|---|---|
| `SimulationEngine` классом, как в C#, плюс рефлексионный тест на отсутствие полей | Класс существовал ради будущей вариации правил экземпляром и ради того теста. У модульной функции некуда положить состояние — свойство перестаёт быть тестом и становится формой кода |
| Рукописные списки `ReasonCodes.All` и `Actions.All` | В C# их держал от дрейфа рефлексионный тест. `Object.values` замороженного объекта делает дрейф невыразимым |
| `ErrorCodes` рядом с экраном, как в C# | `presentation-depends-only-on-simulation` этого не позволяет, и все пять кодов производит чтение файлов, ни один — экран. Цена (проверка полноты каталога локали в Task 11 уедет в тестовый член) названа в §9.6 |
| Отдельная CI-стадия под `scenario:parity` | Покраснела бы только одновременно со стадией `Test`. `AGENTS.md` §8 требует мутанта на новую стадию затем, чтобы в pipeline не попадала стадия, которая не умеет краснеть; стадия, краснеющая только вместе с другой, — тот же расход без выигрыша |
| ~~Не заводить CI-стадию под `bench:decision`~~ | **Отвергнуто по ревью.** Рассуждение смешивало отсутствие порога с отсутствием следа: `AGENTS.md` §11 требует воспроизводимого артефакта CI независимо от того, есть ли гейт. Стадия заведена, порога по-прежнему нет (§9.1) |
| Порог задержки решения в benchmark-артефакте | Ни один документ его не закрепляет. Число, придуманное скриптом и надетое на себя как требование, — ровно тот класс дефекта, который ревью ловит («замерено» ≠ «обеспечено») |
| Сравнивать объекты исхода вместо артефакта | Сравнение зависело бы от того, какие поля сегодня оказались на этих типах. Артефакт — явная стабильная проекция, и версия у неё своя |
| Считать расход ординалов вторым счётчиком розыгрышей | Второй счётчик согласился бы сам с собой и не сказал бы ничего о правиле. Считается переигрыванием префиксов через тот же production-раннер — как считал экспортёр |
| Сравнивать `error_detail` | Машинно-зависимый текст: он несёт абсолютный путь. Корпус специально не хранит его в `read_model` |
| `switch` по `argv` в CLI | `switch-exhaustiveness-check` требует `case undefined`, существующий только ради правила, чей смысл — в доменных союзах. Две `if`-ветки и явный `default` |

### 10.5. Известные пределы того, что построено

- **`read_model` и `screen_state` корпуса не сверяются** — их строит фабрика
  представления, которой ещё нет. Это Task 11, и до него «54/54 воспроизведены»
  означает «по всему, что производят слои домена и контента».
- **Отрицательный делимый недостижим на поставляемом контенте.** Шкала героя в
  состоянии это `number`, и ничто в пакете отрицательную не отвергает, но
  границы контента её не пропустят. Ловушка закрыта фикстурой, а не корпусом.
- **Benchmark — замер, а не бюджет.** Гейтом производительности владеет
  Task 18; `artifacts/decision-benchmark/report.json` лежит под `.gitignore` и
  существует как точка до появления UI-стека.
- **`command_id`, `expected_state_version` и `after_command_id` были `long`, а
  здесь это double.** Значение за пределами ±(2^53−1) не просто отвергается —
  `JSON.parse` округляет его до того, как контракт его увидит, поэтому
  отвергается соседнее значение, а не авторское. В поставляемом дереве id
  начинаются с 1. Точный путь для 64 бит — `bigint`, но он сдвинул бы
  `stateVersion`, `nextEventId` и числовой домен артефакта, поэтому это
  отдельное решение, а не попутная правка.
- **Арифметика решения воспроизводит int32 оригинала, а не расширяет его.**
  Переполнение заворачивается, как в C#; на поставляемом контенте до границы
  двадцать с лишним бит, поэтому корпус этого не видит и увидеть не может.
- **Дайджест контента по-прежнему допускает коллизию** (§7.7). Адресовано
  cutover, закреплено тестом.
- **Правила границ для `packages/presentation` и `packages/application`**
  по-прежнему написаны над пустотой (§6.5). Первое из двух закрывает Task 11.
- **`outcome.kind` корпуса — это объявленный манифестом исход**, а не второе
  наблюдение прогона: экспортёр отказывался писать запись, чей прогон на него не
  попал. Сверка с ним — это согласие со сценарием о самом себе.

### 10.6. Грабли процесса, на которые наступили в этом сегменте

- **Дописывание длинного фрагмента в журнал через shell-heredoc провалилось
  молча**: команда вернула ошибку разбора, файл остался нетронутым, и это видно
  только по `wc -l`. Фрагмент пишется файлом и присоединяется `cat`, а результат
  проверяется числом строк. Это тот же класс, что §4.6 «`git diff` не видит
  untracked»: команда отчиталась, ничего не сделав.
- **«Исправлено» проверяется поиском по всем повторениям.** Формулировку,
  снятую первым раундом ревью, второй нашёл живой в сводной таблице §2: правка
  дошла до места, где замечание было сделано, и не дошла до копии. Утверждение,
  живущее в двух местах, исправляется в двух местах или не исправлено.
- **Правка без мутанта выглядит как закрытая дыра.** Проверка синтаксиса seed
  была написана и не покрыта случаем; снятие её целиком оставляло 565 зелёных.
  Мутант ставится на правку по ревью так же, как на новый код.
- **Сорок два мутанта за сегмент прошли без происшествий** — впервые.
  Работает правило, заведённое в §8.4: откат `git checkout HEAD -- <путь>` и
  сразу `git status --porcelain`, непустой вывод останавливает прогон. Правило
  стоило трёх инцидентов, чтобы появиться, и с ним стоимость мутанта — четыре
  операции, а не расследование.

### 10.7. Бриф на сегмент 4: что известно до первой строчки Task 11

Не пересказ плана, а то, что стоило бы знать заранее.

**`read_model` уже описан корпусом, и это спецификация, а не подсказка.** Ключи
верхнего уровня: `contract`, `error_code`, `responses`, `roster`, `sha256`,
`state`, `title_key`. Внутри `responses[]` — `action`, `blocked_by_entity`,
`blocked_by_display_name_key`, `hero_definition`, `hero_display_name_key`,
`reasons[]`, `tie_break_code`, `wavered`. Внутри `reasons[]` — `direction`
(`Supported`/`Opposed`), `reason_code`, `source_entity`,
`source_display_name_key`, `strength` (качественная шкала, не число).

- **Числа наружу не выходят.** `risk`, `greed`, `caution`, `pride` и `strength`
  в модели — качественные (`Low`/`Moderate`/`High`), а не значения. `DEC-006`:
  ранжированные причины, не вероятности.
- **`error_detail` в модели нет** — там машинно-зависимый путь (§4.5). Не
  добавлять.
- **`ScreenState` — пять значений**, и корпус покрывает все пять. По записям
  (то есть по 54 файлам, два seed на checkpoint): `Incomplete` 44, `Normal` 4,
  `Empty` 2, `Error` 2, `Loading` 2. По сценариям — вдвое меньше каждого.
  Список уже лежит в `KNOWN_SCREEN_STATES` (`packages/content`), и манифест
  проверяет объявленное имя против него.
- **`read_model_hash` считается своим SHA-256 этого репозитория** — той же
  чистой реализацией, что и всё остальное (§7.3): `presentation` не имеет права
  ни на `node:crypto`, ни на контент.
- **Строка ответа называет `blockedBy[0]`**, а не все нарушенные принципы
  (`HERO_DECISION_SPEC` §2.1): след полон, показ сужен намеренно. Расширение —
  отдельное решение, меняющее форму `ResponseLine` и оба хеша.
- **«Колебался» выводится из следа арифметикой**, а не хранится:
  `score_before_mood = final − mood`, `wavered = (score_before_mood ≥ 0) ≠
  (final ≥ 0)`. Для решения, закрытого воротами, признак не вычисляется вовсе —
  броска не было (`HERO_DECISION_SPEC` §2.4).
- **Три места под причины, из них минимум два — поддержавшим мотивам**, а
  оставшееся — сильнейшему встречному; незанятые одной стороной места забирает
  другая. Внутри стороны порядок полный: по величине, при равенстве — по коду
  причины, при равенстве — по `SourceEntity`. Иначе одинаковые прогоны дадут
  разный порядок строк и разойдётся `read_model_hash` (`HERO_DECISION_SPEC`
  §4.2).
- **Проверка полноты каталога локали не может жить в `packages/presentation`.**
  Ей нужен `ERROR_CODES` из `packages/content`, а граница это запрещает (§9.6).
  Место — тестовый член, как `tests/oracle`.
- **Сверка `read_model` замыкает parity.** Записи корпуса уже несут и модель, и
  её `sha256`; §3.6 отдельно записала, почему сверять надо канонизированную
  модель **без** её же `sha256` против записанного хеша, а не хеш против хеша:
  иначе проверка согласится с экспортёром во всём, в чём тот неправ.

**Чего не делать.**

- Не сверять `read_model` по одному лишь `sha256`, лежащему рядом с ним (§3.6).
- Не выводить числа шкал на экран: качественная шкала — решение `DEC-006`, а не
  недоделка.
- Не ослаблять `presentation-depends-only-on-simulation` ради `ERROR_CODES` или
  ради контента: список кодов передаётся данными, проверка полноты живёт в тесте.
- Не считать зелёный мутант доказательством отсутствия дефекта. В этом сегменте
  зелёными вернулись два: один купил две проверки границ движка, второй — две
  проверки кода выхода CLI. Ни один не закрылся словами.

## 11. Доказательства сегмента 4 — Tasks 11–15

### 11.1. Task 11 — read model и то, что он замкнул

`packages/presentation` — четвёртый настоящий член дерева `ADR-010` §45.
Он закрыл последнюю зону, которую корпус покрывал, а parity — нет: до этой
задачи «54/54 воспроизведены» означало «по всему, что производят слои домена
и контента» (§10.5), потому что read model в новом стеке не существовало.

| Факт | Значение | Команда |
|---|---|---|
| Проверок в пакете | 102 | `pnpm --filter @oath-and-coin/presentation test` |
| Проверок в `tests/locale` | 4 | `pnpm --filter @oath-and-coin/locale-tests test` |
| Проверок по workspace | 676 в 37 файлах | `pnpm test` |
| Записей корпуса | 54/54, теперь включая read model | `pnpm scenario:parity` |
| Границы | 0 нарушений, 124 модуля, 387 зависимостей | `pnpm lint:deps` |

#### Что именно сверяет parity после Task 11

Три сравнения на каждую запись, и каждое покупает то, чего не покупают
остальные:

1. **Запись против себя самой.** `read_model.sha256` — утверждение об объекте,
   внутри которого он лежит. Канонизация записанного `read_model` **без** его
   же `sha256` обязана дать записанный хеш. Та же дисциплина, что
   `compareInternalConsistency` применяет к артефакту, и та же причина, что в
   §3.6: тест, сверяющий хеш с хешем, соглашается с экспортёром во всём, в чём
   тот неправ.
2. **Хеш порта против записанного.** Одно число, посчитанное своим SHA-256 над
   канонической проекцией.
3. **Сами проекции, поле за полем.** Хеш говорит, *что* два экрана разошлись.
   Где — говорят только структуры, и «где» это вся разница между гейтом, по
   которому можно действовать, и гейтом, который надо перевыводить.

Плюс `outcome.screen_state` записи против состояния построенной модели.
Сверка идёт на **всех** записях, а не только на тех, что дали артефакт:
`screen_loading` и `screen_error` несут записанный экран именно потому, что
провалившийся прогон всё равно обязан что-то показать игроку.

Совпадение вышло побайтным с первого прогона, и это не удача: проекция
состоит из ASCII (коды причин и ключи локали держит `isArtifactSafeText`), а
на ASCII текущая канонизация и RFC 8785 совпадают — те самые пять расхождений
§3.3 сюда не дотягиваются.

#### Две границы, принятые до первой строчки

**Фабрика не видит `ScenarioOutcome`.** `presentation-depends-only-on-simulation`
запрещает импорт из `packages/content`, а `StepOutcome.command` — это
`ScenarioCommand`. Разворачивать маппинг на стороне вызывающего значило бы
вынести правило из слоя: какие шаги принадлежат этому экрану, решает *какому
контракту они ответили*, и это фильтр фабрики, а не вызывающего. Поэтому
presentation объявляет свою структурную форму `DecidedStep`, которой
`readonly StepOutcome[]` удовлетворяет без единой строчки маппинга. Цена
названа: компилятор сверяет формы в точке вызова, а не в точке объявления.
Точка вызова сегодня одна — parity; со следующей задачей их станет две. Обещать
вторую как уже действующий контракт нельзя: `packages/application` не
существует, и typecheck его не видит (найдено вторым раундом внешнего ревью).

**Списка `ERROR_CODES` в пакете нет.** Коды принадлежат контенту, поэтому
`errorKey` — функция без списка рядом, а проверка полноты каталога живёт в
новом члене `tests/locale`, которому видны обе стороны. Скопировать пять кодов
в presentation значило бы завести второе объявление закрытого множества,
которое нечем сверить с первым. Там же живёт вторая проверка, которой негде
больше жить: `KNOWN_SCREEN_STATES` (content) и `SCREEN_STATES` (presentation)
описывают одно множество из пяти значений по разные стороны границы.

#### Мутация

Тринадцать мутантов, каждый поставлен после коммита проверяемого состояния
(`AGENTS.md` §8) и откачен `git checkout HEAD -- <путь>` с немедленной
проверкой `git status --porcelain` (§10.6).

| Мутант | Проверки пакета | Parity |
|---|---|---|
| порог шкалы черт `<= 64` → `<= 65` | 1 красный | `contract.risk: "Moderate"` вместо `"High"` |
| шкала причин переписана порогами шкалы черт | 7 красных | 16/54 |
| `MIN_SUPPORTING_REASONS` 2 → 0 | 1 красный | 25/54, `reasons[0].direction` разошлось |
| обрезка стороны до сортировки | **зелёный**, затем 1 красный | 54/54 — корпус этого не видит |
| третий тай-брейк (`sourceEntity`) снят | 1 красный | 54/54 — в корпусе нет двух причин, равных и по величине, и по коду |
| `wavered` — константа `false` | 1 красный | 52/54 |
| `wavered` считается для заблокированного ответа | 1 красный | 44/54 |
| полнота экрана по числу строк ответов | 3 красных | 54/54 — в корпусе нет героя, ответившего дважды |
| `Empty` только при пустых контрактах | 2 красных | 54/54 — в корпусе нет кампании с контрактами и пустым ростером |
| `payment_attractive` попал в список «называет источник» | 1 красный | 18/54 |
| `read_model_hash` включает `error_detail` | 2 красных | 0/54 |
| снимок печатает `contract.definition` | 3 красных | — |
| ключ `field.hero.greed` исчез из `content/locale/ru.json` | 2 красных (`tests/locale`) | — |

Четыре мутанта оставили parity зелёной, и это не слабость сверки, а её
измеренная граница — та же, что §10.3 назвала для `trunc → floor`: **корпус
покрывает поставляемый контент, а не область определения правила.** Ни одна
поставляемая запись не содержит стороны длиннее трёх причин, двух причин,
равных и по величине, и по коду, героя, ответившего дважды, или кампании с
контрактами и пустым ростером. Все четыре случая закрыты фикстурами.

**Зелёный мутант, купивший проверку.** Обрезка каждой стороны до трёх причин
**до** сортировки вернулась зелёной на 97 проверках и всех 54 записях. Причина
стоит того, чтобы её записать, а не пожать плечами: во всех случаях сторона
была не длиннее лимита, а сторона не длиннее лимита переживает обрезку до
сортировки без изменений. Проверка теперь кладёт в след четыре поддержавших
фактора, из которых сильнейший вычислен последним; обрезка до сортировки
выбрасывает ровно тот мотив, который решил исход, и показывает вместо него два
самых слабых (коммит `d7e23d5`).

### 11.2. Внешнее ревью Task 11 и закрытые им дыры

Ревью провёл codex (`gpt-5.6-sol`, режим `review` скилла `peer`) по диффу ветки и
живым исходникам, включая C#-оригинал. Восемь находок, все восемь подтверждены по
исходнику и приняты. Три из них — гейты, зелёные на сломанном коде, и ни одна не
была видна в диффе.

Это тот же счёт, что в §3.6 и §5.6, и он повторяется третий сегмент подряд.

| Дыра | Как вскрыта | Чем закрыта | Мутант после правки |
|---|---|---|---|
| `presentation-depends-only-on-simulation` перечисляло запрещённое и пропускало `node:*`, npm и что угодно ещё | сверкой с `simulation-depends-on-nothing`, переписанным по ревью сегмента 2 | правило перечисляет **одно разрешённое**: путь внутри `packages/presentation` или `packages/simulation` | `node:fs` в пакете — на прежнем правиле `0 violations` (воспроизведено), на новом красит; отдельно красит импорт `zod` |
| Сверка read model ни разу не проверена на красном входе: удаление вызова `compareReadModel` оставляло 54/54 и все тесты parity зелёными | чтением `parity.test.ts`: у каждой второй сверки есть свой отрицательный случай, у этой не было ни одного | пять отрицательных случаев — испорченная проекция, испорченный `sha256`, испорченный `screen_state`, отсутствующий `read_model`, испорченная запись без артефакта | удаление вызова красит 5 из 53 |
| `failedScreen` принимал любой `errorCode`, и `A+B` давал хеш, которого C# произвести не мог | воспроизведением: ревьюер назвал вход и хеш `8b1fead9…` | домен «сравнимого с корпусом текста» и обход **всей** проекции перед хешированием; `error_code` больше не единственное проверяемое поле | снятие обхода красит 2 проверки |
| Инварианты модели не переживали обычный spread — `{ ...LOADING_SCREEN, state: 'Normal' }` хешировался как Normal-экран без контракта | воспроизведением: ревьюер назвал значение и хеш `54a6996d…`; в C# `init`-аксессоры перезапускались на `with` и бросали | оба места, где модель становится доказательством — проекция и снимок, — перепроверяют её | снятие перепроверки красит по одной проверке в каждом месте |
| `everyKeyOf` в тестах снимка строит каталог из исключений самой проверяемой функции, поэтому удаление ветки `inclinationKeys` оставалось зелёным | ревьюер назвал ветку: в фикстуре был один герой с пустым списком склонностей | фикстура достаёт каждую ветку проекции разом — теги, обе группы черт, герой без них, названный и неназванный источник причины, заблокированный ответ, тай-брейк; плюс независимая проверка покрытия ключей | удаление ветки красит 2 проверки |
| Проверка «текст, а не ключ» в `tests/locale` отвергала только совпадение с собственным ключом | ревьюер назвал вход: `field.hero.greed: "field.hero.caution"` проходил | отвергается **форма** ключа — точечный путь в нижнем регистре без пробелов | тот же вход красит |
| Журнал утверждал 385 зависимостей | прогоном `pnpm lint:deps` | 386, снято той же командой | — |
| Журнал §11.1 обещал две точки вызова `DecidedStep` «обе в гейте», хотя `packages/application` не существует | сверкой с §12.6, где то же сказано верно | §11.1 приведена к действующему состоянию | — |

Отклонённых находок нет.

**Что это говорит о самой Task 11.** Три из восьми дыр — проверки, зелёные на
сломанном коде, и две из трёх сидели в тестах, написанных в тот же заход, что и
код. Тринадцать мутантов сегмента прошли по *реализации* и ни один — по самим
проверкам: мутант «удали вызов сверки целиком» и мутант «удали ветку проекции»
относятся к другому классу, чем «поменяй порог», и первый класс этот сегмент не
покрывал. Вывод адресный: мутант на новую проверку обязан включать её удаление,
а не только искажение того, что она измеряет.

**Второй вывод — про правило, которое уже чинили.** Формулировка границы
presentation была написана в том же виде, который внешнее ревью сегмента 2
признало дефектным для симуляции (§5.6), и написана после этого признания. Урок
дошёл до правила, на котором был получен, и не дошёл до правила, написанного
рядом. Это тот же класс, что §10.6 «исправлено проверяется поиском по всем
повторениям», только применённый не к формулировке в документе, а к форме кода.

## 12. Хождённая земля: рубеж после Task 11

`AGENTS.md` §9. Записка для следующего исполнителя: что проверено, что
опровергнуто замером, какие варианты прогнаны и отвергнуты. Она существует,
чтобы следующий не передоказывал сделанное и не лез в тупики, за которые уже
заплачено.

### 12.1. Где остановились

| Факт | Значение |
|---|---|
| Ветка | `migration/04-ui`, создана от `main` @ `2a055cf` |
| PR | [#17](https://github.com/anshushunov/oath-and-coin/pull/17), draft, открыт |
| Дерево | чистое |
| Сделано | **Task 11 целиком.** Tasks 12–15 не начаты |
| Тесты нового стека | 676 в 37 файлах |
| Parity | 54/54, теперь включая read model |
| Внешнее ревью | проведено по Task 11 (codex): восемь находок, все приняты и закрыты (§11.2). Обязательное ревью сегмента — на Task 15 |

Коммиты: `39367f1` (Task 11) → `d7e23d5` (проверка, купленная зелёным
мутантом) → `6a68847` (журнал) → `cae5327` (эта записка) → правки по внешнему
ревью (§11.2).

Рубеж поставлен на границе задачи намеренно. Task 12 начинается с правки,
проходящей через весь `packages/content`, его тесты, `tools/scenario-runner`,
`tests/oracle`, `tests/locale` и `scripts/`; начатая и не доведённая, она
оставляет дерево в состоянии хуже нынешнего.

### 12.2. Что блокирует Task 12 — и чего оно стоит

Ничего внешнего: `main` не двигался, ветка от него. Блокирует само содержание
задачи, и его стоит знать до первой строчки.

**`packages/content` держится за `node:fs`, а браузеру он нужен.** `ADR-010`
§59 фиксирует направление `content ← application ← apps/web`, то есть контент
попадает в браузерный бандл. Сегодня попасть не может: `strict-json.ts`,
`content-digest.ts`, `content-set.ts`, `locale.ts`, `scenarios/*.ts` и
`load-sequence.ts` импортируют `node:fs`/`node:path`, и Vite на таком импорте
падает при сборке. Task 13 упрётся в это на первой строчке экрана, который
должен показать настоящий контент.

**Отвергнуто: снимок контента, собранный build-шагом.** Node-загрузчик
прогоняется на сборке, результат сериализуется, браузер десериализует. Дешевле
в объёме правки и дороже по смыслу: появляется второй путь получения
`ContentSet`, обязанный сойтись с первым, и `content_version` начинает
зависеть от сериализатора, а не от контента. Дрейф двух путей — тот самый
класс дефекта, за который репозиторий уже платил (§3.6, писатель терминального
события).

**Принято и спроектировано: источник файлов вместо файловой системы.**
Проектирование сделано на этом рубеже, чтобы следующий исполнитель не
переизобретал его. Форма:

```ts
export interface ContentFileSource {
  /** Пути относительно корня источника, POSIX, ordinal-порядок. */
  list(directory: string, extension?: string): readonly string[];
  read(path: string): Uint8Array;
  exists(path: string): boolean;
  /** Как путь называть в диагностике — репозиторно-относительно, никогда абсолютно (`TDD` §18). */
  describe(path: string): string;
}
```

Всё адресуется путями относительно источника, всегда с `/`. Отсюда четыре
следствия, каждое проверяемо:

1. `node:path` уходит целиком — вместо него ~20 строк чистых POSIX-хелперов
   внутри пакета. Побочно исчезает класс расхождений Windows/POSIX, который
   `toRelativePosixPath` сегодня чинит постфактум.
2. `readBounded`, `parseJsonFile`, `readFile` принимают источник вместо пары
   `(displayPath, fullPath)`: имя для диагностики даёт сам источник.
3. `computeContentDigest(source)` считает над теми же (путь, байты), значит
   `content_version` совпадает с node-путём **побайтно**. Это и есть проверка,
   которую надо написать: два источника на одном дереве дают один дайджест.
4. Файловые обёртки (`loadContentSet(root)` и прочие) остаются, но переезжают
   в `packages/content/src/node/` и экспортируются отдельным входом
   `@oath-and-coin/content/node`. Браузерный адаптер — `import.meta.glob` с
   `query: '?raw'` — живёт в `apps/web` и есть реализация порта.

К этому обязательно правило границ: `packages/content/src` вне `node/` не
импортирует `node:*`. Без него разделение развалится первым же удобным
импортом, и узнаем мы об этом на упавшей сборке Vite, а не на гейте. Правило
пишется на **разрешённое**, а не списком запрещённых — по той же причине, по
которой так переписано `simulation-depends-on-nothing` после ревью сегмента 2
(§5.6).

**Что придётся тронуть, кроме самого пакета:** `tools/scenario-runner`
(parity и CLI), `tests/oracle`, `tests/locale`, `scripts/generate-schemas.mjs`
и `scripts/check-schemas.mjs`, а также тесты самого контента, которые сегодня
строят временные деревья через `mkdtempSync`. Последние менять не обязательно
— тестовый член вправе оставаться node-овым.

**Порядок, снимающий риск.** Разделение — свой коммит, и его гейт — то, что
уже есть: `pnpm test` и `pnpm scenario:parity` обязаны остаться зелёными,
плюс новая проверка «два источника, один дайджест». Application-слой — второй
коммит. Смешивать их значит потерять способность сказать, что именно
покрасило parity.

### 12.3. Что Task 12 получит бесплатно

`parity.ts` уже содержит функцию `screenFor(result)` — трёхветочный разбор
`loading | failed | ran` в один из пяти экранов. Это ровно то, что обязан
делать application-слой, и это единственная её копия. Task 12 переносит её в
`packages/application` и удаляет отсюда; сегодня она живёт в инструменте
потому, что слоя ещё нет, а не потому, что там ей место.

### 12.4. Опровергнуто замером

Не восстанавливать эти утверждения обратно.

1. **Корпус не отличает обрезку до сортировки от обрезки после.** Мутант,
   срезающий сторону до трёх причин перед сортировкой, зелёный на всех 54
   записях и был зелёным на всех 97 проверках пакета. Ни один поставляемый
   сценарий не кладёт на одну сторону больше трёх факторов, а сторона не
   длиннее лимита переживает обрезку до сортировки без изменений. Закрыто
   фикстурой с четырьмя поддержавшими факторами, сильнейший вычислен
   последним.
2. **Ещё три правила корпус не проверяет, и это не слабость сверки, а её
   граница.** Третий тай-брейк по `sourceEntity`, полнота экрана по
   `respondedBy` вместо числа строк, и `Empty` при непустых контрактах с
   пустым ростером — все три мутанта оставляют 54/54. В поставляемом дереве
   нет двух причин, равных и по величине, и по коду; нет героя, ответившего
   дважды; нет кампании с контрактами и без героев. Все три закрыты
   фикстурами. Это тот же вывод, что §10.3 сделала про `trunc → floor`.
3. **Read model совпал с C# побайтно с первого прогона.** Пять расхождений
   канонизации с RFC 8785 (§3.3) сюда не дотягиваются: проекция состоит из
   ASCII — коды причин и ключи локали держит `isArtifactSafeText`, — а на
   ASCII старый писатель и RFC 8785 дают одни байты. Проверять, «не надо ли
   шагнуть версией», здесь не нужно: вопрос закрыт замером.
4. **`presentation` обходится без `node:crypto` и без `TextEncoder`.** Пустой
   `types: []` в её `tsconfig.json` — не косметика: без него `@types/node`
   виден из корня, и `node:fs` прошёл бы тайпчек в слое, которому
   `dependency-cruiser` его запрещает. Компилятор ловит это раньше гейта.

### 12.5. Прогнано и отвергнуто

| Вариант | Почему отвергнут |
|---|---|
| Фабрика read model принимает `ScenarioOutcome` | `presentation-depends-only-on-simulation` запрещает импорт из content. Объявлена своя структурная форма `DecidedStep`, которой `readonly StepOutcome[]` удовлетворяет без маппинга |
| Маппинг `StepOutcome → DecidedStep` на стороне вызывающего | Вынес бы правило из слоя: какие шаги принадлежат экрану, решает то, какому контракту они ответили. Это фильтр фабрики |
| Копия `ERROR_CODES` в `packages/presentation` | Второе объявление закрытого множества, которое нечем сверить с первым. `errorKey` — функция без списка, список собирает `tests/locale` из константы контента |
| Ослабить границу presentation ради `ERROR_CODES` | Явно запрещено §10.7. Заведён тестовый член `tests/locale` |
| `packages/presentation` берёт фикстуры из `packages/simulation/src/testing` | Импорт мимо публичной поверхности соседнего пакета — ровно то, что границы и существуют останавливать. Плюс те фикстуры описывают кампанию, про которую спрашивают *правила* (один герой, шкалы в нуле), а экран спрашивает про ростер, фильтр и порядок |
| Восемь файлов ключей, по одному на тип, как в C# | Тот раскол шёл от соглашения C# «один публичный тип — один файл», а не от границы. Все построители отвечают на один вопрос, и их списки читает одна проверка полноты |
| `qualitative.*` собирать рукописным списком из пяти градаций | Второе объявление закрытого множества; шестая градация просто перестала бы проверяться против каталога. `Object.values` замороженного объекта — как в C# `Enum.GetValues` |

### 12.6. Известные пределы того, что построено

- **Структурная совместимость `StepOutcome` → `DecidedStep` проверяется в
  точке вызова, а не в точке объявления.** Несовместимое изменение
  `StepOutcome` покраснеет там, где его передают, а не там, где форму
  объявили. Точек вызова сегодня одна (parity), со следующей задачей их станет
  две; обе в гейте.
- **`tests/locale` читает только `ru.json`.** Второй локали в дереве нет, и
  проверка полноты по построению покрывает ту, что есть. Появление второй
  требует правки списка, а не новой проверки.
- **`LOADING_SCREEN` — константа, и это правило, а не удобство.** `loading` —
  факт о манифесте сценария, не об исходе прогона. Соблазн «пусть фабрика
  вернёт Loading, если контракта нет» склеил бы Loading с Empty, а корпус их
  различает: `screen_loading` и `screen_empty` несут одинаковое содержимое и
  разные `read_model.sha256`.
- **`describeReadModel` экспортирована наружу намеренно.** Parity сверяет сами
  байты проекции, а не только хеш: хеш говорит, *что* экраны разошлись, где —
  говорят только структуры.
- **Экран пока никем не рисуется.** `apps/web` остаётся bootstrap-поверхностью
  до Task 13; `expectedSnapshot` описывает тексты, которые обязана произвести
  разметка, и сверять их пока не с чем.

### 12.7. Грабли процесса

- **Мутант, поставленный через файловый редактор агента, отдаёт в контекст
  весь файл целиком.** На тринадцати мутантах это дороже самой мутации. Прогон
  вынесен в скрипт: правит файл, гоняет гейты, откатывает
  `git checkout HEAD -- <путь>` и печатает одну строку с вердиктом и
  результатом `git status --porcelain`. Правило §10.6 от этого не меняется —
  меняется только его цена.
- **Тот же shell-heredoc, та же осечка, теперь громкая.** §10.6 записала, что
  длинный фрагмент, дописываемый в журнал через heredoc, проваливается молча.
  На этот раз он провалился с ошибкой разбора — и лечение то же, что там
  записано: фрагмент пишется файлом и присоединяется, а результат проверяется
  числом строк.
- **Число в журнале снимается командой в тот же заход, что и запись.** В
  первой редакции §11.1 стояло «670 в 38 файлах» по устному счёту; `pnpm test`
  дал 666 в 37. Это третий случай того же класса (§4.6, §10.6): число, не
  снятое командой рядом, неверно.
