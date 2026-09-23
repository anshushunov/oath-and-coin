import { BlockerKeys, type BlockingReason } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';
import { Panel } from '../../ui/panel.tsx';

import { Label } from '../labels.tsx';

/**
 * "What stands in the way" (`DEC-019`): one line per reason that held somebody back — the
 * reason, whom it held, and what in the package changes it. The squad's cards say the same
 * thing hero by hero; this says it reason by reason, which is the question a player asks
 * before he moves a lever.
 *
 * **Where it stands, and why there.** Under the ladder of commands and over the squad. The
 * summary row pinned at the top holds only the contract, the count and the treasury (owner's
 * decision of 2026-09-23 — the whole band pinned took more than half of a 1280×800 window),
 * so the summary goes in the flow. Under the ladder rather than over the levers, for two
 * reasons: the lines appear after "Опросить приглашённых", and under the ladder is where the
 * player's eye already is when he pressed it; and the levers he is about to move do not jump
 * down by the summary's height each time a poll fills it or a compose empties it.
 * `tests/e2e/contract-offer.spec.ts` measures that the whole block is inside the window at the
 * top of the page on the e2e states that draw one — measured, not guaranteed: the summary
 * measured there (`screen_normal`) is two lines, while a squad's refusals can reach every
 * negative factor code (six) plus the principle lines. Nothing here keeps a longer summary
 * above the fold.
 *
 * A reason is keyed with its remedy: one code can stand on two lines, when it fired on the
 * contract's own tag for one hero and on the chosen method for another.
 *
 * The lines and their order are `blockingReasons`'s; this component only maps the list and
 * decides nothing — the one branch is the caller's, on the list being empty. Where a line's
 * lever stands (`leverId`) is carried as an attribute for a reader and a test, and paints the
 * remedy dim when there is none, never deciding a word.
 */
export function BlockersBlock({ blockers }: { readonly blockers: readonly BlockingReason[] }) {
  const text = useText();

  return (
    <Panel titleKey={BlockerKeys.Title} testId="offer-blockers">
      <ul className="blockers">
        {blockers.map((blocker) => (
          <li
            className="blocker"
            key={`${blocker.reasonCode} ${blocker.remedyKey}`}
            data-testid="blocker"
            data-blocker-lever={blocker.leverId ?? 'none'}
          >
            <span className="blocker-reason">
              <Label text={text(blocker.reasonCode)} />
            </span>
            <span className="blocker-heroes">
              {blocker.heroDisplayNameKeys.map((key) => (
                <Label key={key} text={text(key)} />
              ))}
            </span>
            <span className="blocker-remedy">
              <Label text={text(blocker.remedyKey)} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
