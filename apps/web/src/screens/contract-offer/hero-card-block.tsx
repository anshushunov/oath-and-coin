import { FieldKeys, qualitativeKey, type HeroCard } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * One hero: their name and three scales on one line, then whichever of their
 * principles and inclinations they have.
 *
 * The name and the scales share a row because six heroes at four lines each fill a
 * 720px window on their own, and a hero's scales belong beside the hero rather than
 * under them.
 */
export function HeroCardBlock({ hero }: { readonly hero: HeroCard }) {
  const text = useText();

  return (
    <div className="hero">
      <div className="row">
        <Label text={text(hero.displayNameKey)} />
        <Captioned captionKey={FieldKeys.HeroGreed} value={text(qualitativeKey(hero.greed))} />
        <Captioned captionKey={FieldKeys.HeroCaution} value={text(qualitativeKey(hero.caution))} />
        <Captioned captionKey={FieldKeys.HeroPride} value={text(qualitativeKey(hero.pride))} />
      </div>

      <KeyList captionKey={FieldKeys.HeroPrinciples} keys={hero.principleKeys} />
      <KeyList captionKey={FieldKeys.HeroInclinations} keys={hero.inclinationKeys} />
    </div>
  );
}
