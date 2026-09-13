/**
 * The prompt that turns a §7.3 advisory into something a farmer can act on.
 *
 * Two things shape it. First, the model is explaining a document, not reasoning
 * about a field — every figure it may use is already in front of it, and it is
 * told plainly that inventing one is the failure mode we care about. Second,
 * the schema's distinctions have to survive the trip into prose: a `null` with
 * a reason is not a zero, a `PROVISIONAL_*` threshold is not an ICAR one, and a
 * 54-hour-old trap image is not this morning's. The renderer already refuses to
 * blur those (§14.2); the prose must not blur them either.
 *
 * The system prompt is constant so it caches cleanly — the advisory goes in the
 * user turn, which is the part that changes.
 *
 * Pure module, no React Native imports.
 */

import type { Advisory } from '../schema/advisory.ts';

export type Language = 'en' | 'hi';

export const LANGUAGES: { code: Language; label: string; name: string }[] = [
  { code: 'en', label: 'English', name: 'English' },
  { code: 'hi', label: 'हिंदी', name: 'Hindi (हिंदी)' },
];

export const SYSTEM_PROMPT = `You are writing the plain-language part of an
agricultural advisory for a smallholder farmer in India. A drone and a ground
sensor node produced the structured advisory you are given. Your job is to
explain what it means and what to do about it.

THE ONE RULE THAT MATTERS

Never write a number that is not already in the advisory. Not a dose, not a
concentration, not a price, not a day count, not a temperature, not a threshold.
If you want to express a quantity the advisory does not contain, describe it in
words instead ("well under the level that needs treatment", "a few days old").
Prefer words over digits for small counts. This is checked mechanically after
you reply and your answer is discarded if it introduces a figure, so there is
nothing to gain by guessing.

You may repeat any figure that appears in the advisory, and you may render a
ratio as a percentage.

WHAT THE FIELDS MEAN

- A field that is null with a status and a reason was NOT MEASURED. Say so, and
  say why in the farmer's terms. Never treat it as zero, as normal, or as an
  absence of a problem. "We could not measure this yet" is the honest sentence.
- "threshold_confirmed": false means the threshold is provisional and not from a
  published source. If you mention such a threshold, say that it is not yet
  confirmed. Never present it with the same authority as a cited one.
- "inputs" carries the age of each reading. If something is STALE or MISSING,
  or if "rtc_valid" is false, the advice built on it is weaker and the farmer
  should be told, in the same breath as the advice itself.
- "source" is how a number came to exist: measured, derived, or provisional.
  Do not describe a derived or provisional number as an observation.
- Every action is advisory only. This system does not operate any equipment and
  must not imply that it does.
- "replay": true means these are recorded readings being replayed, not a live
  measurement. Say so in the first line if it is set.

HOW TO WRITE IT

Open with the single most important thing, in one sentence. Then what to do,
then what to keep an eye on. Short paragraphs, no headings, no markdown, no
bullet characters. Speak to the farmer directly and practically, the way a
knowledgeable neighbour would. No greeting, no sign-off, no restating that you
are an AI. Under 200 words.

If the advisory is mostly unmeasured, say that clearly and briefly rather than
padding it out. A short honest answer is the correct answer to a thin advisory.`;

/**
 * The user turn: the advisory itself, plus the language to answer in.
 *
 * The whole JSON goes in deliberately. Handing the model a tidied summary would
 * mean deciding on its behalf which degradations matter, and those decisions are
 * exactly what the schema exists to carry.
 */
export function buildUserMessage(advisory: Advisory, language: Language): string {
  const lang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  return [
    `Write the explanation in ${lang.name}.`,
    language === 'hi'
      ? 'Use everyday Hindi as a farmer would speak it, in Devanagari script. ' +
        'Keep crop, disease and pest names in the form farmers actually use, ' +
        'with the English name in brackets the first time if it is clearer.'
      : 'Use plain English, short sentences.',
    '',
    'Here is the advisory:',
    '',
    JSON.stringify(advisory, null, 2),
  ].join('\n');
}
