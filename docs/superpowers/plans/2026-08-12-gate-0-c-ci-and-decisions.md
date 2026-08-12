# Gate 0 / C — CI и принятие решений

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline из `TDD` §19, записи решений в статусе `proposed`, подтверждение владельца продукта и только затем — перевод решений в `accepted` с обновлением реестров.

**Architecture:** Три задачи и один барьер посередине. Задачи C1 и C2 готовят доказательства и предложения; задача C3 выполняется **исключительно после** явного решения владельца и никогда — по факту зелёного pipeline.

**Tech Stack:** GitHub Actions, `ubuntu-latest`, .NET 8.0.424.

## Global Constraints

Наследуются из планов A и B. Дополнительно:

- **Записи решений создаются со статусом `proposed`.** Перевод в `accepted` — отдельный коммит после go-решения владельца (спека §14.1).
- **Никаких новых процессных документов.** Правки идут в существующие файлы (`AGENTS.md` §12 п.2).
- **Артефакты прогонов публикуются CI**, а не коммитятся.

**Спека:** `docs/superpowers/specs/2026-08-12-technical-rules-design.md`
**Зависит от:** планов A и B.

---

### Task C1: Pipeline

**Files:**
- Create: `.github/workflows/dotnet.yml`
- Modify: `.gitignore` при необходимости

**Interfaces:**
- Consumes: все проекты планов A и B.
- Produces: обязательные проверки PR и артефакт `gate0-evidence` на каждом прогоне.

Pipeline реализует `TDD` §19 пп. 1–5 и 7. Пункт 6 (save round-trip) относится к Milestone 3 и отсутствует намеренно.

Репозиторий: `https://github.com/anshushunov/oath-and-coin`.

- [ ] **Step 1: Написать workflow**

Стадии по порядку:

| Стадия | Команда | Что доказывает |
|---|---|---|
| Restore | `dotnet restore OathAndCoin.sln` | зависимости разрешаются на зафиксированных версиях |
| Format | `dotnet format OathAndCoin.sln --verify-no-changes --no-restore` | `TDD` §19 п. 1 |
| Build | `dotnet build OathAndCoin.sln -c Release --no-restore` | п. 2; `TreatWarningsAsErrors` делает предупреждение падением |
| Test | `dotnet test OathAndCoin.sln -c Release --no-build` | пп. 3–5: guard границы, валидация контента и детерминизм — всё тестами |
| Determinism replay | два прогона раннера с одним seed и сравнение канонических артефактов | п. 7 |
| Upload evidence | публикация `artifacts/` | спека §8.1 — след воспроизводим и виден ревьюеру |

Требования к workflow:

- `runs-on: ubuntu-latest`, `timeout-minutes: 10`, `permissions: contents: read`;
- `actions/setup-dotnet@v4` с `dotnet-version: 8.0.424`;
- шаг сравнения артефактов завершается ненулевым кодом при расхождении;
- `actions/upload-artifact@v4` с `if: always()`, чтобы артефакт публиковался и при падении.

Сравнение файлов и генерация путей делаются средствами `dotnet` и стандартных действий GitHub, без завязки на `sed`/`rm`/`/tmp`: pipeline идёт на Linux, а разработка — на Windows, и команды должны быть одинаковыми в обоих местах. Где нужен сдвиг платформы, используется `shell: bash` явно.

- [ ] **Step 2: Прогнать те же проверки локально**

```bash
dotnet restore OathAndCoin.sln
dotnet format OathAndCoin.sln --verify-no-changes --no-restore
dotnet build OathAndCoin.sln -c Release --no-restore
dotnet test OathAndCoin.sln -c Release --no-build
```

Expected: все команды завершаются кодом 0. При замечаниях форматирования применить `dotnet format OathAndCoin.sln` и закоммитить.

- [ ] **Step 3: Коммит и PR из текущей ветки**

```bash
git add .github
git commit -m "ci: add engine-independent pipeline with determinism replay"
git push -u origin "$(git branch --show-current)"
gh pr create --fill
```

Ветка берётся текущая, а не зашитая в план: план переживает ветку, на которой был написан.

- [ ] **Step 4: Мутант на pipeline (новая CI-проверка — обязательная область)**

Зелёная стадия, которая никогда не краснела, ничего не доказывает.

Во временной ветке проверить три падения по отдельности:

| Мутант | Ожидаемая падающая стадия |
|---|---|
| `greed: 500` в `content/heroes/bram.json` | Test — `AllContentFiles_SatisfyTheirSchema` |
| использование типа `Godot.Vector2` в `simulation/` | Test — `CoreBoundaryTests` |
| возврат константы из `DeterminismArtifact.Hash` | Determinism replay либо соответствующий тест |

Каждый мутант — отдельный push, наблюдение красной стадии, затем закрытие PR и удаление ветки. Ссылки на три красных прогона идут в описание основного PR: это и есть доказательство, что pipeline работает.

---

### Task C2: Записи решений в статусе `proposed` и правки `AGENTS.md`

**Files:**
- Create: `docs/decisions/ADR-001-engine-and-language.md`, `ADR-002-simulation-core-boundary.md`, `ADR-003-deterministic-rng.md`, `ADR-004-content-format.md`, `ADR-005-stable-ids.md`, `ADR-007-events-and-causal-trace.md`, `DEC-009-hero-portraits-in-m1.md`
- Modify: `AGENTS.md` — §6, §7, §8, §9, §11, §12

**Interfaces:**
- Consumes: работающий код планов A и B как доказательство реализуемости.
- Produces: семь записей со статусом `proposed`, готовых к решению владельца.

Записи пишутся после кода намеренно: запись фиксирует проверенное решение, а не намерение.

- [ ] **Step 1: Написать семь записей**

Формат — как у существующих `DEC-001`…`DEC-008`: «Контекст», «Решение», «Альтернативы», «Последствия», «Проверка», «Связи».

Каждая обязана содержать:

- статус **`proposed`** и дату;
- ссылку на файл реализации;
- ссылку на тест, который сломается при отмене решения;
- отклонённые альтернативы с причиной.

| Запись | Содержание | Ключевой тест |
|---|---|---|
| `ADR-001` | Godot `4.7.1` + C#, `net8.0`; точный пин, подтверждённый рабочим проектом Dungeon Fortress | сборка проекта |
| `ADR-002` | две сборки: чистая `Simulation` и `Content` с вводом-выводом | `CoreBoundaryTests` |
| `ADR-003` | counter-based RNG, потоки `TDD` §7.2, состояние не хранится | `DeterministicRngTests` |
| `ADR-004` | JSON + JSON Schema, вычисляемая `ContentVersion` | `SchemaAgreementTests` |
| `ADR-005` | namespaced `ContentId`, детерминированные `HeroId` | `ContentIdTests` |
| `ADR-007` | конверт события, trace хранится в состоянии; отложенное — `offered_terms`, `confidence/uncertainty` | `CausalTraceTests`, `GameStateTests` |
| `DEC-009` | шесть портретов в M1 как исключение из `DEC-007` | нет теста; решение продуктовое |

`ADR-007` обязан явно перечислить исключённый scope из спеки §2.0, иначе через месяц отложенное будет неотличимо от забытого.

Записи `ADR-009` **не существует**: фиксированный тик отозван из Gate 0 (спека §2.4) и входит в постановку `G0-D2`/`G0-D3` на старте Milestone 2.

- [ ] **Step 2: Внести шесть правок в `AGENTS.md`**

Каждая переписывает свой пункт целиком и не ссылается на другие правила (спека §1.1).

| Раздел | Правка |
|---|---|
| §6 | информационный UI строится кодом; сцена остаётся тонким корнем; данные живут в `content/` |
| §7 | DoD UI-задачи получает шестое требование — артефакт прогона в CI |
| §8 | мутант обязателен для детерминизма, доменных инвариантов и новых CI-проверок; для остального достаточно red/green; мутант после коммита проверяемого состояния; зелёный мутант означает, что проверка мерит не то |
| §9 | остановка на рубеже: исполнитель останавливается до исчерпания контекста, коммитит и пишет файл с хождённой землёй |
| §11 | каждое число — с командой, которой снято; инструмент оставляет воспроизводимый след в CI-артефактах; для тиров «обязательное» и «лёгкое» ревью ревьюер — не автор; тир «достаточно зелёного CI» остаётся без назначенного ревьюера |
| §12 | бюджет правил: новое правило после второго случая одной боли; изменяемое правило переписывается целиком |

Правка §8 и §11 сознательно **сохраняет** существующую риск-ориентированную модель, а не заменяет её сплошной дисциплиной: сплошная стоит дороже ошибок, которые предотвращает.

- [ ] **Step 3: Коммит**

```bash
git add docs/decisions AGENTS.md
git commit -m "docs: propose Gate 0 decisions and update agent rules"
```

Реестры `TDD` §21 и `MVP_PLAN` §14 на этом шаге **не трогаются**: они отражают принятые решения, а решения ещё не приняты.

---

### Task C3: Подтверждение владельца и перевод решений в `accepted`

**Files:**
- Modify: `docs/decisions/*` — статусы
- Modify: `docs/technical/TDD.md` §21, `docs/production/MVP_PLAN.md` §14, `docs/decisions/README.md`
- Delete: `docs/superpowers/`

**Interfaces:**
- Consumes: зелёный pipeline C1 и записи C2.
- Produces: закрытый Gate 0.

- [ ] **Step 1: Собрать пакет для владельца**

Gate 0 закрывается ручным решением (`MVP_PLAN` §4.3), а не фактом зелёного CI. В запрос входят:

- ссылка на PR и на зелёный прогон;
- ссылки на три красных прогона мутантов из C1 Step 4 — доказательство, что проверки работают;
- артефакт `gate0-evidence`: канонический артефакт и человекочитаемый отчёт с отказом Зары и принятием Брама;
- перечень семи записей в статусе `proposed`;
- команда, воспроизводящая спайк одной строкой:

```bash
dotnet run --project tools/OathAndCoin.SimulationRunner -- run-scenario \
  --content content --schemas schemas --commands scenarios/gate0.commands.json --seed 424242
```

- [ ] **Step 2: Барьер — дождаться решения**

Владелец даёт go, pivot или stop. **Шаги 3–5 не выполняются ни при каком состоянии pipeline, пока решение не получено.** Зелёный CI доказывает, что решение реализуемо, но не что оно правильное.

При pivot или stop записи остаются в статусе `proposed`, а `docs/superpowers/` не удаляется: он ещё понадобится для следующей итерации.

- [ ] **Step 3: Перевести решения в `accepted`**

Только после go. В каждой из семи записей статус меняется на `accepted`, дата решения проставляется.

- [ ] **Step 4: Обновить реестры**

- `TDD` §21 — `ADR-001`–`ADR-005` и `ADR-007` отмечаются принятыми со ссылками на файлы записей;
- `MVP_PLAN` §14 — `BQ-001`, `BQ-008`, `BQ-009` помечаются закрытыми;
- `docs/decisions/README.md` — семь записей добавляются в перечень.

- [ ] **Step 5: Проверить ссылки и удалить временные документы**

Собрать все markdown-ссылки в `docs/` и `AGENTS.md` и убедиться, что каждый путь существует. Битая ссылка на этом шаге — типовой дефект переноса решений между документами: в Dungeon Fortress перенос восемнадцати решений дал семь дефектов, три из них блокирующих.

```bash
git rm -r docs/superpowers
```

Спека и три плана — форма передачи, а не источник истины (спека §14). После переезда содержания в `docs/decisions/` второй источник истины не оставляется.

- [ ] **Step 6: Финальная проверка и коммит**

```bash
dotnet test OathAndCoin.sln -c Release
git add -A
git commit -m "docs: accept Gate 0 decisions and close blocking questions"
```

---

## Definition of Done плана C

- pipeline красный на каждом из трёх мутантов и зелёный на основной ветке;
- семь записей решений существуют, ссылаются на код и на тесты;
- `AGENTS.md` содержит шесть правок, ни одна не ссылается на другое правило;
- владелец дал явное go-решение **до** перевода записей в `accepted`;
- реестры обновлены, битых ссылок нет;
- `docs/superpowers/` удалён.

После этого Gate 0 закрыт и начинается Milestone 1 — первая настоящая проверка гипотезы проекта. Перед первой UI-задачей M1 выполняется отдельный план портирования runtime harness (спека §7).
