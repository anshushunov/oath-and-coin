/**
 * The five inputs a visual run declares about itself, read from the query string.
 *
 * `ADR-008` gave a run four declared inputs — scenario, checkpoint, seed and locale —
 * and `ADR-010` §157 keeps that intention while dropping the Godot-specific mechanism:
 * `GameArguments` parsed a command line because the run was a process, and this parses a
 * query string because the run is a page. What survives is the property that mattered:
 * **a run states its inputs rather than inheriting them from the machine it happens on.**
 * A page that showed whatever its source file was last edited to show cannot be evidence
 * of anything, because two runs of it are only comparable by inspection.
 *
 * Everything unrecognised is refused. A `?scenarion=screen_error` that quietly ran
 * `screen_normal` would produce a screenshot, a report and a green verdict about a
 * scenario nobody asked for — the failure mode that is worst precisely because it looks
 * like success. Same for an empty value: `?scenario=` is somebody meaning to state one
 * and failing, never somebody asking for the default.
 */

export interface RunRequest {
  readonly scenario: string;
  /** The checkpoint to stop at, or `null` for the one the manifest ends on. */
  readonly checkpoint: string | null;
  readonly seed: bigint;
  readonly locale: string;
  /**
   * Which of the two screens this run opens on.
   *
   * The fifth input, and it is one for the same reason the other four are (design spec
   * §3: "не роутер: прогон обязан уметь заявить свои входы"). The page now draws two
   * screens, and a browser run that could not say which of them it was on would produce
   * a frame and a report that a third party cannot place — which is the whole property
   * `ADR-008` asked declared inputs for. It is not a router: there is no history entry,
   * no path and no navigation, only a run stating what it opened.
   */
  readonly screen: ScreenName;
}

/** The two screens the page can open on. Anything else is a typo, not an extension. */
/**
 * Which screen the page opens on.
 *
 * `battle` is the combat lab (`COMBAT_SPEC` §10.2, `DEC-007`): a scenario run to a placed
 * crew, and the fight it is about to go to, played back from the opening position. It is a
 * screen name rather than a second page for the reason the spike measured — a second entry
 * point costs one line of `vite.config.ts` and it would still need this parameter to say
 * *which* fight — and the lab is where the five states of that screen are reachable at all.
 */
export const SCREEN_NAMES = ['contract-offer', 'saves', 'battle'] as const;

export type ScreenName = (typeof SCREEN_NAMES)[number];

/**
 * What a run means when it declares nothing.
 *
 * The same three values `App.tsx` carried as constants until this file existed, kept
 * because a page opened by hand must still show something: `screen_normal` is the state
 * a player would expect, the seed is the one the scenario runner's CLI defaults to — so
 * what the page shows can be reproduced from a command line — and `ru` is the only
 * catalogue `content/locale/` ships.
 */
export const DEFAULT_RUN: RunRequest = {
  scenario: 'screen_normal',
  checkpoint: null,
  seed: 424242n,
  locale: 'ru',
  // The screen the page had before it had two. Every URL already written down — in the
  // corpus, in the browser evidence, in `ADR-008`'s examples — names no screen at all,
  // and each of them has to keep meaning what it meant.
  screen: 'contract-offer'
};

/** The parameters a run may declare. Anything else is a mistake, not an extension. */
const KNOWN_PARAMETERS = ['scenario', 'checkpoint', 'seed', 'locale', 'screen'] as const;

/**
 * Reads a run request out of `location.search`.
 *
 * @param search the query string, with or without its leading `?`.
 * @throws when a parameter is unknown, stated empty, or — for the seed — not a
 * non-negative decimal integer.
 */
export function parseRunRequest(search: string): RunRequest {
  const parameters = new URLSearchParams(search);

  for (const name of parameters.keys()) {
    if (!(KNOWN_PARAMETERS as readonly string[]).includes(name)) {
      throw new Error(
        `Unknown run parameter '${name}'. A run declares exactly ` +
          `${KNOWN_PARAMETERS.join(', ')}; anything else is a typo that would otherwise run ` +
          'the defaults under a name nobody asked for.'
      );
    }
  }

  return {
    scenario: stated(parameters, 'scenario') ?? DEFAULT_RUN.scenario,
    // `null` when absent, and absent is the only way to ask for the manifest's last
    // checkpoint. There is no spelling of "the default checkpoint" as a value, because a
    // name is what a checkpoint is.
    checkpoint: stated(parameters, 'checkpoint') ?? DEFAULT_RUN.checkpoint,
    seed: parseSeed(stated(parameters, 'seed')),
    locale: stated(parameters, 'locale') ?? DEFAULT_RUN.locale,
    screen: parseScreen(stated(parameters, 'screen'))
  };
}

/**
 * The screen this run opens on, refused unless it is one of the two that exist.
 *
 * Refused rather than defaulted, for the reason the whole module exists: `?screen=slots`
 * quietly showing the contract offer would produce a screenshot, an `events.jsonl` and a
 * green verdict about a screen nobody asked for.
 */
function parseScreen(stated: string | null): ScreenName {
  if (stated === null) {
    return DEFAULT_RUN.screen;
  }

  if (!(SCREEN_NAMES as readonly string[]).includes(stated)) {
    throw new Error(
      `Run parameter 'screen' must be one of ${SCREEN_NAMES.join(', ')}, not '${stated}'. A run ` +
        'that names a screen this build does not have is a run whose evidence is about some ' +
        'other screen than the one its URL claims.'
    );
  }

  return stated as ScreenName;
}

/** The value of a parameter, or `null` when it was not stated at all. */
function stated(parameters: URLSearchParams, name: string): string | null {
  // `getAll`, not `get`: `get` answers the *first* value and says nothing about there
  // having been a second. `?scenario=screen_error&scenario=screen_normal` is a URL
  // declaring two contradictory runs, and a reader who took the last value — which is
  // how several other tools read a repeated parameter — would disagree with this page
  // about which run it performed. Refused rather than resolved, including when the two
  // values are identical: the ambiguity is in the URL, not in the values.
  const values = parameters.getAll(name);

  if (values.length > 1) {
    throw new Error(
      `Run parameter '${name}' was stated ${String(values.length)} times. A run declares each of ` +
        'its inputs once; a URL that names two is a URL two readers can disagree about.'
    );
  }

  const value = values[0] ?? null;

  if (value === null) {
    return null;
  }

  if (value === '') {
    throw new Error(
      `Run parameter '${name}' was stated with no value. That is a run that meant to declare ` +
        'something and did not, so it is refused rather than silently defaulted.'
    );
  }

  return value;
}

/**
 * The seed as a `bigint`, which is what the simulation's RNG takes.
 *
 * Spelled out rather than handed to `BigInt` alone: `BigInt` accepts `0x2a`, `1_000`,
 * leading and trailing whitespace and an empty string (as `0n`), and a seed that parsed
 * differently from the one on the scenario runner's command line would make two runs
 * that look identical produce different draws.
 */
function parseSeed(stated: string | null): bigint {
  if (stated === null) {
    return DEFAULT_RUN.seed;
  }

  if (!/^\d+$/u.test(stated)) {
    throw new Error(
      `Run parameter 'seed' must be a non-negative decimal integer, not '${stated}'. A seed is ` +
        'the whole of what makes a run reproducible, so a spelling that means something else ' +
        'somewhere else is refused here.'
    );
  }

  return BigInt(stated);
}
