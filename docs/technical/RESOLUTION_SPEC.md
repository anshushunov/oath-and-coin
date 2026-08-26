# Contract Resolution System Spec

> Версия: 1.1
>
> Статус: proposed
>
> Продуктовое основание: [`2026-08-25-contract-resolution-design`](../superpowers/specs/2026-08-25-contract-resolution-design.md) (локальный документ), решения владельца от 2026-08-25.
>
> Редакция 1.1 закрывает четвёртый раунд внешнего ревью (codex `gpt-5.6-sol`). Из исправленного важнее всего два: формула мотивации меняла знак эффекта на отрицательном разрыве — преданный отряд ухудшал провал, обиженный улучшал; и «Чисто» допускало полностью непокрытую потребность, если избыток по другой перевешивал.
>
> Связанные: [`HERO_DECISION_SPEC`](HERO_DECISION_SPEC.md), [`NEGOTIATION_SPEC`](NEGOTIATION_SPEC.md), [`TDD`](TDD.md), [`GDD`](../design/GDD.md) §10, §21.4, [`ADR-002`](../decisions/ADR-002-simulation-core-boundary.md), [`ADR-003`](../decisions/ADR-003-deterministic-rng.md), [`ADR-007`](../decisions/ADR-007-events-and-causal-trace.md), [`DEC-006`](../decisions/DEC-006-ranked-reasons-not-probabilities.md), [`DEC-010`](../decisions/DEC-010-hero-decision-model.md), [`DEC-012`](../decisions/DEC-012-negotiation-offer-protocol.md), [`DEC-013`](../decisions/DEC-013-hero-capability-layer.md), [`ADR-014`](../decisions/ADR-014-contract-resolver-boundary.md)

---

## 1. Зачем система существует

Игрок торгуется, обещает и собирает отряд — и на этом взаимодействие кончается. **Согласие героя не является исходом**; это допуск к исходу, которого в игре нет. Без исхода нет последствия, без последствия нет петли, а `MVP_PLAN` §5.7 требует измерить именно петлю (H-B).

Система превращает отправленный отряд в исход: **события с провенансом, ступень, дефициты и личные последствия**. Без боя, детерминированно, целочисленно.

Три обещания, за которые эта спека отвечает:

1. **Исход объясним.** Каждое число называет своё происхождение, каждое последствие — свой источник (`GDD` §21.4).
2. **Исход не читается как бросок кубика.** В первой редакции случайности нет вовсе (§7.4).
3. **Исход считается из того, что игрок решал.** Кого позвал, на каких условиях, что обещал.

---

## 2. Модель данных

### 2.1. Полные объявления

Всё, на что ссылаются последующие разделы, объявлено здесь. Литералы — стабильные строки: они попадают в канонический артефакт и в ключи локализации.

```ts
// packages/simulation/src/domain/need-id.ts
export const NeedId = Object.freeze({
  Frontline: 'frontline',
  UndeadKnowledge: 'undead_knowledge',
  Wilderness: 'wilderness'
});
export type NeedId = (typeof NeedId)[keyof typeof NeedId];
export const NEED_IDS: readonly NeedId[] = Object.freeze(Object.values(NeedId));
/** Порядок объявления, не алфавит. Единственный компаратор для SortedMap<NeedId, …>. */
export function compareNeedIds(left: NeedId, right: NeedId): number;

// packages/simulation/src/domain/commitment.ts
export const CommitmentState = Object.freeze({
  Committed: 'committed',
  Fragile: 'fragile',
  Resentful: 'resentful'
});
export type CommitmentState = (typeof CommitmentState)[keyof typeof CommitmentState];

// packages/simulation/src/domain/outcome.ts
export const OutcomeGrade = Object.freeze({
  Clean: 'clean', Costly: 'costly', Failed: 'failed', Disaster: 'disaster'
});
export type OutcomeGrade = (typeof OutcomeGrade)[keyof typeof OutcomeGrade];

export const CoverageVerdict = Object.freeze({
  Closed: 'closed', Weak: 'weak', Uncovered: 'uncovered'
});
export type CoverageVerdict = (typeof CoverageVerdict)[keyof typeof CoverageVerdict];

export const OutcomeIntentKind = Object.freeze({
  NeedCovered: 'need_covered',
  NeedShort: 'need_short',
  FalteredEarly: 'faltered_early',
  ObjectiveTaken: 'objective_taken',
  ObjectiveLost: 'objective_lost',
  ConsequenceSuffered: 'consequence_suffered',
  ContractResolved: 'contract_resolved'
});
export type OutcomeIntentKind = (typeof OutcomeIntentKind)[keyof typeof OutcomeIntentKind];

export const DeficitKind = Object.freeze({
  Capability: 'capability_gap',
  Coverage: 'coverage_gap',
  Commitment: 'commitment_drag'
});
export type DeficitKind = (typeof DeficitKind)[keyof typeof DeficitKind];

export const ConsequenceKind = Object.freeze({
  Wound: 'wound', Grudge: 'grudge', TrustLost: 'trust_lost'
});
export type ConsequenceKind = (typeof ConsequenceKind)[keyof typeof ConsequenceKind];

// packages/simulation/src/domain/outcome-reason-codes.ts
export const OutcomeReasonCodes = Object.freeze({
  NeedUncovered: 'outcome.need_uncovered',
  NeedWeak: 'outcome.need_weak',
  NeedClosed: 'outcome.need_closed',
  FalteredEarly: 'outcome.faltered_early',
  ObjectiveTaken: 'outcome.objective_taken',
  ObjectiveLost: 'outcome.objective_lost',
  WoundOnThePoint: 'outcome.wound_on_the_point',
  GrudgeAfterFaltering: 'outcome.grudge_after_faltering',
  TrustLostInDisaster: 'outcome.trust_lost_in_disaster'
});
export type OutcomeReasonCode =
  (typeof OutcomeReasonCodes)[keyof typeof OutcomeReasonCodes];
export const OUTCOME_REASON_CODES: readonly OutcomeReasonCode[] =
  Object.freeze(Object.values(OutcomeReasonCodes));
```

**`OUTCOME_REASON_CODES` не пересекается с `REASON_CODES`.** `FACTOR_REASON_CODES` — вокабуляр трассы решения героя; код исхода там бессмыслен, и `vocabulary.test.ts` держит те три множества разбиением своего словаря.

Значимые формы:

```ts
export interface HeroCapability {
  readonly grade: number;                          // 0..100
  readonly expertise: SortedMap<NeedId, number>;   // значения 0..100
}

export interface NeedCoverage {
  readonly need: NeedId;
  readonly weight: number;      // авторский вес контракта
  readonly required: number;    // вес, поднятый риском (§4.2)
  readonly supplied: number;    // §4.3
  readonly effective: number;   // supplied с потолком избытка
  readonly verdict: CoverageVerdict;
  readonly contributors: readonly { readonly hero: HeroId; readonly amount: number }[];
}

export interface OutcomeIntent {
  readonly kind: OutcomeIntentKind;
  readonly hero: HeroId | null;
  readonly need: NeedId | null;
  readonly marginDelta: number;
  readonly reason: OutcomeReasonCode;
  /** Только у `need_short`: к какому дефициту относится нехватка (§4.7). */
  readonly gap: DeficitKind | null;
  /** Только у `consequence_suffered`. */
  readonly consequence: ConsequenceKind | null;
  readonly magnitude: number;
}

export interface HeroContribution {
  readonly amount: number;
  readonly commitment: CommitmentState;
  readonly provenance: readonly OutcomeReasonCode[];
}

export interface Deficit {
  readonly kind: DeficitKind;
  readonly magnitude: number;
  readonly needs: readonly NeedId[];
  readonly heroes: readonly HeroId[];
}

export interface HeroConsequence {
  readonly hero: HeroId;
  readonly kind: ConsequenceKind;
  readonly reason: OutcomeReasonCode;
  readonly magnitude: number;
}

export interface ContractResolution {
  readonly grade: OutcomeGrade;
  readonly coverage: readonly NeedCoverage[];
  readonly contributions: SortedMap<HeroId, HeroContribution>;
  readonly deficits: readonly Deficit[];
  readonly dominant: DeficitKind | null;
  readonly consequences: readonly HeroConsequence[];
}

export interface ResolutionInput {
  readonly contract: ContractState;
  readonly crew: readonly { readonly hero: HeroState; readonly commitment: CommitmentState }[];
}

export interface ResolutionDraft {
  /** В порядке применения (§3.3). Последнее — всегда `contract_resolved`. */
  readonly intents: readonly OutcomeIntent[];
  readonly resolution: ContractResolution;
}

export type ContractResolver = (input: ResolutionInput) => ResolutionDraft;
```

### 2.2. Способность героя

`grade` — общая величина, аналог Current Ability в Football Manager: сегодня авторская константа, завтра производная от атрибутов, навыков и снаряжения. `expertise` — вклад по конкретной потребности, аналог позиции и роли.

**Слой физически отделён от `greed`, `caution`, `pride` и `trustInGuild`** (`DEC-013`). Границы объявлены отдельными константами, хотя числа совпадают: их нельзя поднять одной правкой.

**Отсутствие ключа и явный ноль — разные вещи, и различие механическое:**

> `expertise.has(need)` означает, что герой **отвечает** за эту потребность, даже если умеет в ней ноль. Отсутствие ключа означает, что она не его дело.

Ответственность решает две вещи: за какую потребность герой может получить `faltered_early` (§4.4) и кто попадает под выбор `Wound` (§5.2). На арифметику покрытия обе формы влияют одинаково — нулевым вкладом.

### 2.3. Потребности контракта

```ts
readonly needs: SortedMap<NeedId, number>;  // 2..3 записи, значения 1..100
```

Вес строго положительный. Одна потребность возвращает доминирующую стратегию «бери сильнейшего», которую `MVP_PLAN` §3.2 называет kill-criterion; потребность веса `0` формально даёт вторую запись, фактически оставляя одну — тот же вырожденный случай, и загрузчик его отвергает.

### 2.4. Состояние согласия — вычисляется в момент ответа

Живёт на пакете:

```ts
readonly commitments: SortedMap<HeroId, CommitmentState>;
```

Это не деталь размещения. `DecisionContext` несёт `contract` (с `acceptedBy` внутри пакета) и `crew`; между ответом ключевого героя и разрешением контракта состав растёт, появляются факторы отношений — и пересчёт «того же решения» при разрешении дал бы **другой** ответ. Ключевой герой, согласившийся в одиночестве, при разрешении увидел бы полный отряд, и хрупкое согласие превратилось бы в твёрдое.

Поэтому состояние вычисляется там же, где герой отвечает, — внутри `proposeContractToHero` и `pollCrew`, на **том самом контексте**, и записывается в пакет.

**Правило вычисления:**

1. `hero.grievance > 0` → `Resentful`, без пересчёта;
2. иначе контрфакт: тот же `DecisionContext`, тот же `decisionOrdinal`, тот же `traceId`, но `contract.offer.promisedBonus = 0`;
3. контрфакт принял → `Committed`; отказал → `Fragile`.

**До появления модуля согласия каждое принятие записывается как `Committed`.** Инвариант `commitments.keys() === acceptedBy` действует с той минуты, как поле появилось, значит записывать что-то обязано уже состояние; выбрать *что именно* без `DecisionContext`, с которым переход уже расстался, нельзя. Константа верна для героя без обиды, которого не решила надбавка, — то есть в обычном случае, — и неверна ровно там, где надбавка или обида в игре. Поправка 2026-08-26: это заявлено, а не подразумевается.

**Контрфакт не тратит RNG.** `decide` детерминирована от `(campaignSeed, decisionOrdinal)`; повторный вызов с тем же ординалом вытягивает то же настроение, а счётчик двигает `withEvent`, а не правило. Проверяется по `metadata.nextDecisionOrdinal` и `HeroDecision.ordinalsConsumed`.

**Почему пересчёт, а не вычитание фактора.** Снятие надбавки может **создать или увеличить** `PaymentInsulting`: оплата, приемлемая с надбавкой, без неё становится личным оскорблением. Разность двух факторов этого не видит.

**Обнуляется вместе с ответами.** Новая версия пакета очищает `commitments` тем же движением, что и `respondedBy`.

### 2.5. Инварианты состояния

Разделены по тому, кто физически может их проверить.

**Локальные для пакета — в `createContractState` (`offer-state.ts`):**

| Инвариант | Почему |
|---|---|
| `keyHero === null ⇒ invited.isEmpty()` | начальный оффер строится загрузчиком до первой команды (`NEGOTIATION_SPEC` §6.1): звать некого, пока игрок никого не позвал. Безусловный размер означал бы, что состояние, собранное из контента, не проходит собственный конструктор |
| `keyHero !== null ⇒ invited.size === requiredCrew` | §7 продуктовой спеки; без фиксированного размера оптимально звать лишних |
| `keyHero === null ∨ invited.has(keyHero)` | пакет обсуждается с тем, кто в него зван |
| `respondedBy ⊆ invited` | ответ от неприглашённого — состояние, которого не бывает |
| `acceptedBy ⊆ respondedBy` | принять, не ответив, нельзя |
| `commitments.keys() === acceptedBy` | без этого `commitments.get(hero)` в команде вернёт `undefined` |
| `resolution !== null ⇒ phase ∈ {Locked, Settled} ∧ status === Crewed` | разрешённый черновик означал бы отряд, ушедший по редактируемому пакету |
| `resolution !== null ⇒ resolution.contributions.keys() === acceptedBy` | **поправка 2026-08-26.** Тот же довод, что и у `commitments`, приложенный к соседнему полю: экран разбора читает `resolution.contributions.get(hero)` для каждого участника, и `undefined` у человека, который заведомо был в отряде, — состояние, которого не производит ни одна команда. Обратная сторона тоже: вклад, записанный тому, кто не принимал, — число, приписанное экраном человеку, которого там не было |
| `phase === Settled ⇒ resolution !== null` | рассчитать неразрешённое нечего |

**`phase === Settled ⇒ resolution !== null` вводится не вместе с остальными, и это записано, а не забыто.** `settleContract` сегодня рассчитывает заблокированный укомплектованный контракт, не имея никакого разрешения, — так делают четырнадцать поставляемых сценариев. Правило приходит вместе с `resolveContract`, то есть с командой, которая единственная может его удовлетворить, и вместе с переписыванием этих сценариев. Включить его раньше означало бы, что зелёного дерева не существует до самой той задачи, — размен хуже, чем правило, опоздавшее на одну задачу с явно записанным отсутствием.

**Межсущностные — там, где виден ростер:** существование каждого `HeroId` из `invited` проверяют команды (`composeOffer`), валидатор состояния в загрузчике и декодер сейва. `createContractState` не получает `GameState.heroes` и физически этого не может; требовать от неё такую проверку — приглашение написать её неправильно.

### 2.6. Последствия

Переходы состояния героя: `Wound` → `wounds + magnitude`; `Grudge` → `grievance + magnitude`, не выше `GRIEVANCE_MAX`; `TrustLost` → `trustInGuild − magnitude`, не ниже нуля.

Новое поле героя одно: `readonly wounds: number`, `0` при старте. Раны в M1 **не имеют доменного потолка** и ничего не модифицируют, кроме того, что видны и накапливаются, — это объявленная граница M1, а не забытая механика (`R-08` закрыт).

**Активная память со значимостью и вытеснением (`GDD` §6.5) — вне scope.** M1 даёт вместо неё неизменяемое событие в `history` с источником и изменение состояния героя с названной причиной. Этого достаточно, чтобы прошлое влияло на следующее решение, и недостаточно, чтобы называть это памятью.

### 2.7. Границы модулей

Наивное размещение даёт цикл, который `lint:deps` отвергает:

> `ContractState → ContractResolution → CommitmentState → DecisionContext → ContractState`

Поэтому вся лексика §2.1 живёт в `packages/simulation/src/domain/`, и **ни один файл этого каталога не импортирует состояние или правила**. Направление: `domain ← state ← resolution ← engine`; `decisions` зависит от `domain` и `state`, но `state` не зависит ни от `decisions`, ни от `resolution`.

**Два объявления §2.1 из этого правила выпадают, и это не исключение, а то же самое правило.** `ResolutionInput` и `ContractResolver` называют `ContractState` и `HeroState`, поэтому в `domain/` им нельзя: там они замкнули бы ровно тот цикл, ради которого каталог отделён (`domain/outcome.ts → state/contract-state.ts → domain/outcome.ts`). Они живут в `packages/simulation/src/resolution/` вместе с резолвером — выше состояния, и там же, где становятся вызываемыми. Всё остальное §2.1, включая `ResolutionDraft` и `HeroCapability`, состояния не называет и лежит в `domain/`.

**Держит это отдельное правило `domain-vocabulary-imports-only-what-is-below-it`, а не `no-circular`.** Второй запрещает цикл, а не направление: импорт из `domain/` наверх остаётся зелёным до дня, когда кто-нибудь замкнёт петлю обратно. Правило перечисляет разрешённое (`collections/`, `ids/`, `canonical/`), не делает исключения для тестов и проверено мутантом — ациклический импорт `domain/commitment.ts → state/game-state.ts` краснит `lint:deps` по имени правила. Проверка, которой нужны оба словаря сразу, живёт в `decisions/vocabulary.test.ts`: вниз смотреть можно, наверх нельзя.

Экспорт из `packages/simulation/src/index.ts` обязателен: `packages/content` импортирует `NeedId` и `compareNeedIds` оттуда, как уже импортирует `CONTENT_ID_PATTERN`.

### 2.8. Версии форматов

| Что | Действие |
|---|---|
| `SUPPORTED_CONTENT_SCHEMA_VERSION` | 3 → 4: `capability` и `needs` обязательны |
| `SAVE_SCHEMA_VERSION` | +1 на **поля состояния**, ещё +1 на **варианты событий** |
| `ARTIFACT_VERSION` | так же: +1 на поля, +1 на события и новую команду |
| `rulesetVersion` | `m1-negotiation/1` → `m1-resolution/1` |
| `content_version` | дайджест по байтам `content/`; двигается сам, пины и слепки обновляются в том же коммите |

**Два bump'а, а не один.** Поля состояния и варианты событий — самостоятельные изменения схемы, и они приходят в разное время: `snapshot-codec.ts` несёт закрытый discriminated union событий и ручной `toDomainEvent`, который правится вместе с событиями. Один общий номер на оба оставил бы промежуточное состояние, где формат изменился, а версия — нет: сейв, записанный после первого изменения, читался бы под тем же номером, что и сейв до него.

**Но поля и события одного изменения версионируются вместе.** Добавить вариант события в кодек, не подняв номер, — то же самое молчание, только внутри одного шага.

---

## 3. Действия игрока и переходы

### 3.1. Шестая команда

```ts
export interface ResolveContract {
  readonly commandId: number;
  readonly contractId: ContentId;
  readonly expectedStateVersion: number;
}
```

`NEGOTIATION_SPEC` §3.1 называл пять команд; эта — шестая, между `pollCrew` и `settleContract`. Оба документа приведены в соответствие 2026-08-25 (§8).

### 3.2. Предусловия, по порядку проверки

1. `expectedStateVersion` совпадает → иначе `StaleState`;
2. `commandId` не применялся → иначе `DuplicateCommand`;
3. контракт существует → иначе `UnknownContract`;
4. `offer.phase === Locked` → иначе `OfferNotLocked`;
5. `status === Crewed` → иначе `CrewNotFilled`;
6. `invited` и `acceptedBy` равны как множества → иначе `CrewNotFilled`;
7. `resolution === null` → иначе `AlreadyResolved`.

Проверки 4 и 5 раздельны потому, что заблокированный, но недоукомплектованный пакет достижим: приглашённый мог отказать. Выход из тупика — §6.2.

Проверка 4 существует и при `requiredCrew === 1`: ключевой герой заполняет отряд ещё в черновике, и без неё можно было бы разрешить контракт, не заблокировав пакет.

### 3.3. Свёртка: эффект перед своим событием

`ADR-007` требует, чтобы эффект конкретного события вносился **до** соответствующего `withEvent`, который является единственной санкционированной точкой перехода. Поэтому команда не проводит сначала все события, а потом эффекты:

```
state ← исходное
для каждого intent из draft.intents (в порядке, который задал резолвер):
    state ← применить эффект этого intent к state       // спред
    state ← withEvent(state, eventOf(intent, state), null, 0n)
state ← добавить commandId в appliedCommandIds
```

- **`contract_resolved` — всегда последний intent**, и именно его эффект записывает `resolution` на контракт. Так итоговая запись оказывается внутри перехода, а не после последнего увеличения `stateVersion` и вне deep-freeze.
- **`causalTraceId === null` у всех событий исхода.** Разрешение — не решение героя; объяснение живёт в `resolution` и в провенансе, а не в трассе решения (`ADR-007`: трасса объясняет выбор агента).
- **`drawsConsumed = 0n`** на каждом переходе.
- **`commandId` добавляется один раз**, после свёртки.

**Требуется `fromEvents`.** Существующий `CommandResult` даёт `fromEvent` для одного самодостаточного события и `fromDecisions` для событий с решениями; формы «несколько событий, ни одного решения» нет. Она добавляется в `command-result.ts` с тем же контрактом, что у `fromEvent`: каждое событие обязано нести `causalTraceId === null`, иначе бросок.

Набор событий не может быть пустым: даже «Чисто» производит `objective_taken` и `contract_resolved`.

### 3.4. Соответствие intent → событие

| `OutcomeIntentKind` | Событие | Поля события |
|---|---|---|
| `need_covered` | `need_covered` | `contractId`, `need`, `verdict` |
| `need_short` | `need_short` | `contractId`, `need`, `verdict`, `gap` |
| `faltered_early` | `hero_faltered_early` | `contractId`, `heroId`, `need` |
| `objective_taken` / `objective_lost` | одноимённые | `contractId` |
| `consequence_suffered` | `hero_suffered_consequence` | `contractId`, `heroId`, `consequence`, `magnitude` |
| `contract_resolved` | `contract_resolved` | `contractId`, `grade` |

Каждое — новый член union `DomainEvent`; компилятор потребует закрыть каждый `switch`, включая проекцию артефакта и `toDomainEvent` в кодеке.

---

## 4. Арифметика

Целочисленная (`TDD` §7.4). Помощники — реальные: `divideTowardZero`, `multiplyInt32`, `toInt32` из `packages/simulation/src/integer-division.ts`. Функции `integerDivision` не существует.

### 4.1. Вклад героя по потребности

```
contribution(h, n) = divideTowardZero(multiplyInt32(expertise(h, n), grade(h)), 100)
```

Отсутствующий ключ `expertise` даёт `0`.

### 4.2. Требование, поднятое риском

```
required(n) = divideTowardZero(multiplyInt32(weight(n), 100 + risk), 100)
```

Риск **поднимает планку**, а не вычитается из разрыва. Вычитаемое в тех же единицах сделало бы любой опасный контракт непроходимым: избыток ограничен потолком §4.3 и никогда бы его не догнал.

### 4.3. Покрытие

Участники по потребности сортируются по убыванию вклада, ничьи — по `HeroId`. Вклад `k`-го (с нуля) уполовинивается `k` раз:

```
supplied(n) = Σ divideTowardZero(contribution(h_k, n), 2^k)
effective(n) = min( supplied(n), divideTowardZero(multiplyInt32(required(n), SURPLUS_CAP_PERCENT), 100) )
SURPLUS_CAP_PERCENT = 120
```

Убывающая отдача отвечает на «взять четырёх одинаковых»; потолок избытка — на «закрыть одну потребность вдвое и забыть про вторую».

**Вердикт** (`COVERAGE_FLOOR_PERCENT = 60`):

| Вердикт | Условие |
|---|---|
| `closed` | `supplied(n) >= required(n)` |
| `weak` | `multiplyInt32(supplied(n), 100) >= multiplyInt32(required(n), COVERAGE_FLOOR_PERCENT)` |
| `uncovered` | иначе |

### 4.4. Намерения

| Вид | Когда | `marginDelta` | Носит |
|---|---|---|---|
| `need_covered` | `verdict === closed` | `effective − required` (≥ 0) | `need` |
| `need_short` | иначе | `effective − required` (< 0) | `need`, `gap` (§4.7) |
| `faltered_early` | герой `Fragile` или `Resentful` **и** отвечает (§2.2) хотя бы за одну потребность с вердиктом, отличным от `closed` | `0` | `hero`, `need` — та из его потребностей, что закрыта хуже всех (§4.8) |
| `objective_taken` / `objective_lost` | по знаку `margin` | `0` | — |
| `consequence_suffered` | §5 | `0` | `hero`, `consequence`, `magnitude` |
| `contract_resolved` | всегда, последним | `0` | `grade` |

`faltered_early` выпускается **не более одного на героя**: иначе один и тот же человек попал бы в ленту трижды и создал бы впечатление, что он и есть причина провала.

**Производные намерения несут `marginDelta = 0` и не участвуют в повторной свёртке** (§4.7): иначе исход влиял бы на разрыв, из которого выведен.

### 4.5. Разрыв и мотивация

```
base   = Σ marginDelta(intents)                       // фактически только need_* дают ненулевую
motive = divideTowardZero(Σ percentOf(commitment(h)), |crew|)
margin = base + divideTowardZero(multiplyInt32(abs(base), clamp(motive, -20, 20)), 100)
```

| Состояние | `percentOf` |
|---|---|
| `Committed` | `+20` |
| `Fragile` | `−10` |
| `Resentful` | `−20` |

**`abs(base)` — не косметика, а исправление ошибки редакции 1.0.** Формула `base + base * motive / 100` меняет знак эффекта на отрицательном разрыве: при `base = −100` преданный отряд получал `−120`, а обиженный `−80`. То есть верность ухудшала провал. С модулем положительная мотивация всегда двигает разрыв вверх, отрицательная — вниз, при любом знаке базы.

**`Fragile` стоит денег, и это осознанно.** Редакция 1.0 давала ему `0`, из чего следовало, что «согласие было куплено, а не дано» никогда не становится дефицитом — а это ровно третий диагноз продуктовой спеки §5.1. Штраф здесь не за честную оплату: платить нормально. Штраф за то, что согласие **держалось** на надбавке и потому хрупко.

**Мотивация применяется один раз, к сумме.** Поштучное применение тихо превышает потолок.

### 4.6. Ступень

```
totalRequired = Σ required(n)
COSTLY_PERCENT = 10
FAILED_PERCENT = 35
```

| Ступень | Условие |
|---|---|
| Чисто | `margin >= 0` **и все** потребности `closed` |
| С ценой | `margin >= 0` (но есть `weak` или `uncovered`), либо `multiplyInt32(margin, 100) >= −multiplyInt32(COSTLY_PERCENT, totalRequired)` |
| Сорвано | `multiplyInt32(margin, 100) >= −multiplyInt32(FAILED_PERCENT, totalRequired)` |
| Катастрофа | иначе |

**«Все `closed`», а не «нет `weak`».** Редакция 1.0 требовала лишь отсутствия `weak`, и при разных весах большой разрешённый избыток перекрывал маленькую полностью пустую потребность: `+40` при требовании 200 и `−10` при требовании 10 давали положительный разрыв и формальное «Чисто» с непокрытой потребностью.

**Ступень читается из намерений**, а не из разрыва напрямую: `gradeFromIntents` смотрит на `objective_taken`/`objective_lost` и на вердикты покрытия. Если ступень выбрана раньше событий, автономные действия героев не могут причинно породить исход, и трасса объясняет декорацию (`ADR-014`).

### 4.7. Дефициты

Три вида в несоизмеримых единицах, поэтому величина каждого — **контрфактическая, в единицах разрыва**:

```
magnitude(kind) = margin( вход без вклада этого вида ) − margin( фактический вход )
```

Что именно убирается:

| Вид | Контрфакт |
|---|---|
| `capability_gap` | все `need_short` с `gap === Capability` заменяются на нулевую дельту |
| `coverage_gap` | все `need_short` с `gap === Coverage` заменяются на нулевую дельту |
| `commitment_drag` | мотивация заменяется на нейтральную (`motive = 0`), намерения не трогаются |

**Классификация `need_short` происходит при его создании** и записывается в поле `gap`, а не выводится позже. Правило — второй контрфакт: пересчитать `supplied(n)`, приняв `grade = 100` у всех, кто **отвечает** за эту потребность (§2.2).

- покрылось бы → `Capability`: люди были те, умения не хватило;
- не покрылось бы → `Coverage`: людей с нужной ответственностью в отряде нет.

Это ровно два из трёх диагнозов продуктовой спеки §5.1, и различие вычислимо, а не назначено.

**Дефицит с неположительной величиной в список не попадает.**

**Доминирование:**

```
dominant = null                         если дефицитов нет
dominant = ranked[0].kind               если дефицит один
dominant = ranked[0].kind               если multiplyInt32(ranked[0].magnitude, 100)
                                           >= multiplyInt32(ranked[1].magnitude, 100 + 25)
dominant = null                         иначе
```

`DOMINANCE_MARGIN_PERCENT = 25`. Три класса не взаимоисключающие: слабый герой одновременно не закрывает потребность и идёт неохотно. Модель, обязанная назвать главную причину, начнёт её выдумывать; `null` — точное описание, а не отговорка.

### 4.8. Сравнения, округление, переполнение

**«Закрыта хуже всех» — сравнение долей без плавающей точки**, перекрёстным умножением:

```
worseThan(a, b) = multiplyInt32(supplied(a), required(b)) < multiplyInt32(supplied(b), required(a))
```

Ничьи — по `compareNeedIds`, затем по `HeroId`.

Округление — к нулю на каждом делении; порядок операций §4.1–§4.5 зафиксирован, потому что при целочисленном делении он влияет на результат. Все промежуточные величины остаются в `int32`: `expertise` и `grade` ограничены сотней, потребностей не больше трёх, отряд не больше шести; `multiplyInt32` держит границу явно.

---

## 5. Последствия

### 5.1. Матрица по ступеням

| Ступень | Число записей | Виды, по порядку выбора |
|---|---|---|
| Чисто | 0 | — |
| С ценой | ровно 1 | `Grudge`, если есть `faltered_early`; иначе `Wound` |
| Сорвано | ровно 1 | `Grudge`, если есть `faltered_early`; иначе `Wound` |
| Катастрофа | ровно 2 | `Wound`, затем `Grudge`, если есть `faltered_early`, иначе `TrustLost` |

Редакция 1.0 назначала `TrustLost` **всему отряду**, из чего следовало до шести записей при объявленных двух, и ставила `Wound` первым при лимите в одну запись, из-за чего `Grudge` был недостижим. Обе ошибки исправлены: число записей фиксировано, `TrustLost` достаётся одному герою.

Величины: `WOUND_MAGNITUDE = 1`, `GRUDGE_MAGNITUDE = 1`, `TRUST_LOST_MAGNITUDE = 1`.

### 5.2. Кому и по какому правилу

| Вид | Кому | Ничьи | Код причины |
|---|---|---|---|
| `Wound` | из героев, **отвечающих** (§2.2) за потребность, закрытую хуже всех (§4.8), — тот, чей личный вклад в неё наибольший: он был на острие | по `HeroId` | `WoundOnThePoint` |
| `Grudge` | герой с `faltered_early`; при нескольких — с наименьшим вкладом в свою потребность | по `HeroId` | `GrudgeAfterFaltering` |
| `TrustLost` | ключевой герой пакета | — | `TrustLostInDisaster` |

Ни одно последствие не назначается «слабейшему по вкладу»: в аддитивной модели слабейший участник всё равно улучшал итог, и обязательный виноватый после каждого нечистого исхода учит игрока искать козла отпущения (§6.3).

### 5.3. Условия расчёта

| Ступень | Цель | Оплата заказчика | Обещанная надбавка |
|---|---|---|---|
| Чисто | взята | 100% | обязательна |
| С ценой | взята | 100% | обязательна |
| Сорвано | не взята | `PARTIAL_FEE_PERCENT = 40` | **остаётся обязательством** |
| Катастрофа | не взята | 0% | **остаётся обязательством** |

Выплата — `divideTowardZero(multiplyInt32(patronFee, percent), 100)`.

**«Чисто» означает отсутствие внеплановой потери, а не бесплатную победу.** Плановая цена — аванс, время, износ — платится всегда, иначе нарушается pillar P7.

**Надбавка остаётся обязательством при любой ступени.** Это и есть момент, ради которого механика обещаний существует: соблазн нарушить максимален тогда, когда контракт сорвался и денег нет.

---

## 6. Что видит игрок

### 6.1. Экран разбора

**Вход модели — `GameState` и `contractId`, а не только `resolution`.** Хронология событий живёт в `history`, и из одного сохранённого результата её не восстановить. Модель отбирает события этого контракта в порядке `history` и соединяет их с `resolution`.

Показывает: ступень; события исхода в хронологии, каждое со своим `need`/`hero`/`reason`; вклад каждого героя с провенансом; покрытие тремя вердиктами; ранжированные дефициты **с их источниками** (`needs`, `heroes`); последствия с причинами; блок расчёта обещания.

Числа здесь — свершившиеся факты, и `DEC-006` их не запрещает: решение запрещает числовые **вероятности в прогнозах**, а `GDD` §16.3 прямо оставляет числом объективные факты. Покрытие показывается **качественно**: это оценка подготовки, а не факт.

### 6.2. Выход из тупика

Заблокированный пакет, опрошенный целиком и не набравший состав, — не конец. `composeOffer` разрешён при `Locked` и не `Crewed` и создаёт версию `n+1` с очищенными `respondedBy`, `acceptedBy` и `commitments`. Без этого отказ приглашённого запирал бы контракт навсегда.

### 6.3. Формулировки

Фактические. «Мира отступила первой» — если событие произошло. «Сорвалось из-за страха Миры» — нет, пока нет контрфактической модели на уровне отдельной причины.

Коллективный дефицит называется коллективно. Мнение атрибутируется тому, кто его высказывает.

### 6.4. Навигация

| Событие | Экран |
|---|---|
| `resolveContract` применён | разбор |
| `resolveContract` отвергнут | остаётся оффер |
| `settleContract` применён | доска |
| `settleContract` отвергнут | остаётся разбор |
| старт сессии или загрузка: `resolution === null` | оффер |
| загрузка: `resolution !== null`, `phase === Locked` | разбор |
| загрузка: `phase === Settled` | доска |

Без последних трёх строк сейв разрешённой кампании открывался бы на экране оффера, и разбор был бы недостижим.

---

## 7. Edge cases

| Случай | Поведение |
|---|---|
| Никто не отвечает за потребность | `supplied = 0`, вердикт `uncovered`, `gap = Coverage` |
| Все герои `Resentful` | мотивация `−20%`; на явном запасе ступень не переворачивается (§10.1) |
| Все `Fragile` | мотивация `−10%`; дефицит `commitment_drag` существует |
| `requiredCrew === 1` | ключевой герой набирает отряд в черновике; `resolve` всё равно требует `Locked` |
| Обещание было нулевым | контрфакт §2.4 тождественен исходному решению → `Committed` |
| Приглашённый отказал после блокировки | `CrewNotFilled`, выход через §6.2 |
| Кампания перезагружена после разрешения | `resolution` в сейве, разбор восстанавливается целиком (§6.4) |

### 7.4. Случайности нет

Первая редакция полностью детерминирована. Игрок оценивает честность **в момент ставки**: два одинаковых состава, давших разные ступени из-за скрытого seed, разрушают доверие, и посмертное «случайность у границы» его не возвращает. Кроме того, случайность смешала бы проверку понимания людей с проверкой калибровки риска.

Неопределённость вернётся позже: до отправки — качественной оценкой, в исходе — именованным осложнением с провенансом. Не скрытым сдвигом числа.

---

## 8. Интеграция и синхронизация принятых документов

| Точка | Что добавляется |
|---|---|
| `packages/simulation/src/index.ts` | доменная лексика, команда, резолвер |
| `command-result.ts` | `fromEvents` (§3.3) |
| `ScenarioCommandKind` | `ResolveContract`, файловая схема, ветка `toCommand`, ветка раннера |
| `determinism-artifact.ts` | `describeCommand`, проекция полей и всех новых событий |
| `snapshot-codec.ts` | поля и варианты событий — вместе, один bump (§2.8) |
| `SessionController` | шестой метод |

**Принятые документы правятся до кода, а не после.**

- **`DEC-012`** фиксировал пять команд, опрос всего оставшегося ростера и расчёт сразу после `locked + crewed`. Изменены все три: состав как часть пакета, опрос `invited`, обязательный `resolve` перед `settle`, выплата, зависящая от ступени. Внесено поправкой от 2026-08-25 — прежний текст пунктов сохранён, изменения помечены датой.
- **`NEGOTIATION_SPEC`** §3 обновлён теми же тремя пунктами.
- **`DEC-013`** и **`ADR-014`** заводятся со статусом `accepted`: они фиксируют решения, уже принятые владельцем 2026-08-25, а не предлагают их. `proposed` не разрешил бы зависимую реализацию.

---

## 9. Критерии готовности

- каждое число на экране разбора имеет провенанс, и ни один сохранённый источник не теряется в read model;
- одинаковый вход даёт одинаковый исход, включая перестановку отряда;
- положительная мотивация улучшает разрыв при любом знаке базы;
- «Чисто» невозможно при непокрытой потребности;
- существует контент, где более сильный по сумме `grade` состав проигрывает закрывающему потребности;
- для каждого поставляемого контракта существует состав, достигающий «Чисто» или «С ценой»;
- одна причина не входит в итог дважды — доказано мутантом;
- `lint:deps` зелёный.

---

## 10. Проверка

### 10.1. Свойства

1. **Монотонность.** Увеличение `expertise` участника не ухудшает ступень.
2. **Направление мотивации.** На положительной и на отрицательной базе `Committed`-отряд даёт разрыв **строго больше**, чем `Resentful`-отряд. Проверять равенство ступеней недостаточно: оно зелено и при полностью проигнорированной мотивации.
3. **Потолок мотивации.** Разница между крайними состояниями не переворачивает ступень при объявленном запасе.
4. **Однократный учёт.** В три шага: черта меняет `commitment`; покрытие не меняется; дельта разрыва равна вкладу ровно этого канала. Дельта `0` тест **не** проходит.
5. **Независимость от порядка.** Перестановка отряда во входе не меняет ни одного числа.
6. **Ровно один раз.** Повторная команда отвергается.
7. **Отказ не двигает состояние.** `Object.is` до и после.

### 10.2. Арифметика — таблицами

- порог покрытия — три точки вокруг **обоих** порогов (`closed` и `weak`), на требовании, отличном от 100;
- уполовинивание — точные числа для одного, двух и трёх участников;
- потолок избытка — на потребности, закрытой вдвое;
- `required(n)` — **точное ожидаемое значение** при нескольких `risk`, а не «стало больше»;
- мотивация — точные значения разрыва для трёх однородных отрядов, на положительной и отрицательной базе;
- «Чисто» — именованный пример с сильно различающимися весами, положительным разрывом и одной полностью непокрытой потребностью: ожидается «С ценой»;
- жизнеспособность — именованный пример: контракт, состав, `capability`, ожидаемая ступень; плюс batch-проверка, что у каждого поставляемого контракта такой состав есть;
- вся таблица §5.1 и §5.3 — каждая ячейка;
- пороги §4.6 — три точки на порог;
- доминирование — `24%` и `25%`, а также случаи «дефицитов нет» и «дефицит один»;
- выплата — случай, где произведение не делится на 100 нацело.

### 10.3. Предусловия и переход

Все семь пунктов §3.2 отдельными случаями, включая `DuplicateCommand`, `UnknownContract` и несовпадение множеств.

Переход: непрерывность `eventId`, рост `history` и `stateVersion` на каждое событие, состояние **после каждого** события, глубокая неизменяемость результата, `nextDecisionOrdinal` не двинулся.

### 10.4. Сценарии

Живут в `tests/oracle`: simulation не импортирует content (`ADR-002`), файловый сценарий запускается через `loadAndRunScenario`.

- `resolution-strongest-loses` — опровергающая проверка модели покрытия;
- `resolution-keep-promise`, `resolution-break-promise` — обе ветки развилки до второго разрешения, обе жизнеспособны.

### 10.5. Мутанты

Ставятся **после** коммита зелёного состояния (`AGENTS.md` §8), по одному, каждый с воспроизводимым красным следом и откатом:

- мотивация игнорируется → property 2;
- мотивация применяется к каждому вкладу → §10.2;
- мотивация без `abs` → property 2 на отрицательной базе;
- «Чисто» проверяет только `weak` → §10.2;
- страх применяется повторно внутри покрытия → property 4;
- `covered` без масштабирования на требование → §10.2.

### 10.6. Плейтест

Сначала открытый вопрос «что бы вы изменили и почему», **потом** показ классификации дефицитов, потом сравнение. Экран печатает названия дефицитов; вопрос после показа проверяет чтение надписи.

---

## 11. Явно вне scope

Бой; активная память со значимостью и вытеснением; лечение ран и их доменный потолок; найм; недельный цикл; экономика сверх казны и развилки; атрибуты, навыки и снаряжение как система; открытый набор; случайность в исходе; подсказка о заинтересованности героев до фиксации оффера (решение владельца 2026-08-25).

---

## 12. Открытые вопросы

- **R-01** пороги §4.6, доли §5.3 и веса §4.5 — числа объявлены до балансировки и уточняются по batch-прогону;
- **R-07** форма именованного осложнения, когда неопределённость вернётся (§7.4);
- **R-09** нужен ли `weak` отдельный вклад в разрыв, помимо того что он закрывает путь к «Чисто».

Закрыты этой редакцией: `R-05` (`capability` хранится данными героя — записано решением [`DEC-013`](../decisions/DEC-013-hero-capability-layer.md) §4), `R-06` (две или три потребности — обе допустимы схемой), `R-08` (раны в M1 без потолка).

Ни один из трёх не является решением, принимаемым по ходу реализации: `R-05` закрыт `DEC-013`, `R-06` — §2.3, `R-08` — §2.6. Из оставшихся открытыми `R-01`, `R-07` и `R-09` реализацию не блокирует ни один: первый уточняется батч-прогоном после того, как система заработает, второй относится к неопределённости, которой в первой редакции нет вовсе (§7.4), третий — к возможному будущему вкладу `weak` в разрыв, а не к сегодняшнему поведению.

---

## 13. Связи

`HERO_DECISION_SPEC` §2.1 — форма `DecisionContext`, на которой стоит контрфакт §2.4. `NEGOTIATION_SPEC` §2.1 — версионирование пакета, которому подчиняются `invited` и `commitments`. `ADR-002` — граница simulation/content. `ADR-007` — порядок «эффект перед своим событием» (§3.3). `ADR-014` — почему события первичны, а ступень производна.
