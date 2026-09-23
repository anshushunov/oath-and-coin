import { BattleFieldKeys, battleUnitSide, type BattleUnitLine } from '@oath-and-coin/presentation';

import { Bar } from '../../ui/bar.tsx';
import { Panel } from '../../ui/panel.tsx';
import { Tag } from '../../ui/tag.tsx';
import { useText } from '../../text.tsx';

import { Captioned, Label } from '../labels.tsx';

/**
 * Everybody on the field, a line each (`COMBAT_SPEC` §10.2, the spec of the kit §5.2).
 *
 * **It replaces the text sheet «Поле», and it cannot simply be deleted.** The canvas above is
 * a picture, and a picture is not a text dub: `GDD` §16.6 asks one of every visual signal the
 * board makes — the side a token is coloured with, the cell it stands on, the share of its
 * bar, the mark beside it, whether it is down. The board has no text a reachability check can
 * read, so the words live here.
 *
 * **A list of people, not the grid told over again.** One line per man: who he is, where he
 * stands, a bar for what is left of him with the number on it, and a chip for every status
 * with its mark. The words, and their order, are the ones the list always carried —
 * `expectedSnapshot` holds this panel to exactly the texts the old sheet had, so the change is
 * how they are set, not what they say.
 *
 * The side is a word on every line *and* the colour of the line's edge: the colour repeats
 * what the token on the board is painted with, and the word is there so the colour is never
 * the only thing saying it.
 */
export function CrewPanel({ units }: { readonly units: readonly BattleUnitLine[] }) {
  return (
    <Panel titleKey={BattleFieldKeys.Board} testId="battle-board">
      {units.map((unit) => (
        <UnitRow key={unit.unit} unit={unit} />
      ))}
    </Panel>
  );
}

/** One man: who he is, where he stands, what is left of him and what is on him. */
function UnitRow({ unit }: { readonly unit: BattleUnitLine }) {
  const text = useText();
  // The word and the edge colour are the presentation's decision (`battleUnitSide`), the same
  // rule the journal's names are coloured by: this row reads them and branches on nothing.
  const side = battleUnitSide(unit);

  return (
    <div className="unit" data-testid={`battle-unit-${unit.unit}`} data-side={side.tone}>
      <div className="unit-who">
        {/*
          Which side he is on, in a word and not only in a colour. Found by looking at the
          frame: the list under the board read as nine men with four names and five roles,
          and nothing on it said which of them the player had sent (`GDD` §16.6).
        */}
        <Label text={text(side.sideKey)} />
        {unit.displayNameKey === null ? null : <Label text={text(unit.displayNameKey)} />}
        {/* The full word for his job: only the board is short of room (owner, 2026-09-23). */}
        <Label text={text(unit.roleKey)} />
      </div>
      <div className="unit-facts">
        {/*
          Where he stands, in the two words `COMBAT_SPEC` §3.1 names a cell by. The owner's
          first play: «непонятно, как стоят» — the list carried everything about a man except
          his cell, and the canvas beside it has no text a reader can check the picture against.
        */}
        <Captioned captionKey={BattleFieldKeys.Row} value={String(unit.row)} />
        <Captioned captionKey={BattleFieldKeys.Column} value={String(unit.column)} />
        <div className="unit-health">
          <Label text={text(BattleFieldKeys.Health)} />
          <Bar value={unit.health} max={unit.maxHealth} label={String(unit.health)} />
        </div>
        {unit.leftKey === null ? null : <Label text={text(unit.leftKey)} />}
        {unit.statuses.map((status) => (
          // The word and the mark, both, and never the tint alone (§10.2 п.5, `GDD` §16.6).
          <span className="status" key={status.key}>
            <Tag role="status" word={text(status.key)} />
            <Label text={text(status.markKey)} />
          </span>
        ))}
      </div>
    </div>
  );
}
