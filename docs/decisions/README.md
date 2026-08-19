# Decision records

В этой папке хранятся решения, влияющие на несколько систем или дорого меняющиеся после реализации.

Это **единственный реестр решений** проекта. Полный текст решения живёт только здесь; GDD §25 содержит индекс со ссылками, но не дублирует содержание. Продуктовые (`DEC`) и технические (`ADR`) записи лежат в одной папке, каждая серия нумеруется независимо.

## Идентификаторы

- `DEC-XXX` — продуктовое/геймдизайн-решение;
- `ADR-XXX` — техническое/архитектурное решение.

Рекомендуемое имя файла:

```text
DEC-005-short-kebab-case-title.md
ADR-001-engine-and-language.md
```

## Статусы

- `proposed` — предложено, но не является общим правилом;
- `accepted` — действует как источник истины;
- `superseded` — заменено более новым решением;
- `rejected` — рассмотрено и отклонено.

## Перечень

Продуктовые решения:

| ID | Решение | Статус |
|---|---|---|
| [DEC-001](DEC-001-no-direct-hero-control.md) | Игрок не управляет героями напрямую | accepted |
| [DEC-002](DEC-002-autobattle-as-exam.md) | Автобой является экзаменом подготовки | accepted |
| [DEC-003](DEC-003-region-scale-world.md) | Мир симулируется в масштабе региона | proposed |
| [DEC-004](DEC-004-reasons-in-ui.md) | Причины решений являются частью интерфейса | accepted |
| [DEC-005](DEC-005-retreat-signal.md) | Игроку разрешён сигнал общего отступления | proposed, принятие после Milestone 2 |
| [DEC-006](DEC-006-ranked-reasons-not-probabilities.md) | Ранжированные причины вместо числовых вероятностей | accepted |
| [DEC-007](DEC-007-ui-first-presentation.md) | UI-first презентация и схематичный бой до валидации MVP | accepted |
| [DEC-008](DEC-008-negotiation-first-differentiation.md) | Переговоры и обещания — приоритетный дифференциатор | accepted |
| [DEC-009](DEC-009-hero-portraits-in-m1.md) | Шесть портретов героев в M1 как исключение из DEC-007 | accepted |
| [DEC-010](DEC-010-hero-decision-model.md) | Модель решения героя: ворота и взвешенная сумма, непокупаемые красные линии | accepted |

Технические решения:

| ID | Решение | Статус |
|---|---|---|
| [ADR-001](ADR-001-engine-and-language.md) | Движок и язык: Godot 4.7.1 и C# на net8.0 | superseded [ADR-010](ADR-010-full-typescript-web-stack.md) |
| [ADR-002](ADR-002-simulation-core-boundary.md) | Граница simulation core: две сборки и механическая проверка | accepted |
| [ADR-003](ADR-003-deterministic-rng.md) | Counter-based RNG без хранимого состояния | accepted |
| [ADR-004](ADR-004-content-format.md) | Контент: JSON с JSON Schema и вычисляемой версией | accepted |
| [ADR-005](ADR-005-stable-ids.md) | Стабильные namespaced идентификаторы | accepted |
| [ADR-007](ADR-007-events-and-causal-trace.md) | Конверт события и хранение causal trace в состоянии | accepted |
| [ADR-008](ADR-008-runtime-harness.md) | Runtime harness: свой инструмент и состав условий успеха прогона | accepted |
| [ADR-009](ADR-009-decision-contracts-and-content-v2.md) | Контракты решения и формат контента 2 | accepted |
| [ADR-010](ADR-010-full-typescript-web-stack.md) | Полный переход на TypeScript web stack с Electron-хостом | accepted, область стоп-гейта сужена [ADR-011](ADR-011-electron-gate-without-steam.md) |
| [ADR-011](ADR-011-electron-gate-without-steam.md) | Desktop-приложение без магазина; Task 4 проверяет Electron, а не Steam | accepted |
| [ADR-012](ADR-012-interface-text-outside-content.md) | Тексты интерфейса живут вне `content/`, в каталоге `ui-text/` | accepted |

`ADR-001` заменён `ADR-010`. Тело `ADR-001` и Godot-специфичный механизм `ADR-008` переписываются на этапе cutover, вместе с удалением кода, который они описывают ([`FULL_TYPESCRIPT_MIGRATION`](../production/FULL_TYPESCRIPT_MIGRATION.md), Task 19): до тех пор `ADR-001` читается как исторический контекст Gate 0, а действующим решением о движке и языке является `ADR-010`.

`ADR-012` вводит названное исключение из `AGENTS.md` §6 («данные живут в `content/`») со сроком до Task 19. Оно **второе** — первым был `Theme` UI-kit, — и пункт §6 переписан целиком, чтобы называть оба; правку санкционировал владелец. Третье исключение по §12 п. 3 переписывает пункт заново.

Зарезервированные номера: `ADR-006` — стратегия сохранений (Milestone 3). Номер `ADR-009` держали пустым под фиксированный симуляционный тик; тик отозван из Gate 0 и входит в постановку модели времени боя на старте Milestone 2, где получит свой номер, а `ADR-009` занят записью выше.

## Шаблон

```markdown
# DEC/ADR-XXX — Название

> Дата: YYYY-MM-DD
>
> Статус: proposed | accepted | superseded | rejected

## Контекст

Почему нужно решение и какие ограничения важны.

## Решение

Что именно принято.

## Альтернативы

Какие варианты рассматривались и почему не выбраны.

## Последствия

Положительные, отрицательные и нейтральные последствия.

## Проверка

Как понять, что решение работает, и когда его пересматривать.

## Связи

Разделы GDD, milestone, задачи и другие решения.
```

## Правило изменения

Принятое решение не переписывается так, будто прежней версии не существовало. Существенная смена направления создаёт новую запись, а старая получает `superseded` со ссылкой на замену.
