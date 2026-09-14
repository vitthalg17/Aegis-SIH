/**
 * The call to Claude, and the only file in the app that talks to the internet.
 *
 * This is the fourth tier (F1). Everything about it is additive: the advisory
 * was already pulled, validated, stored and rendered before this file runs, and
 * if it never runs the app is exactly what it was. Nothing in the field path
 * may wait on this, and nothing here may write to the advisory tables.
 *
 * ── Where the key lives, and why that is a problem (F3a) ─────────────────────
 * A key compiled into an APK can be extracted from it. That is not a bug we can
 * fix in this file — it is a property of shipping a secret to a device someone
 * else holds. The two honest options are a proxy that keeps the key server-side,
 * or accepting the exposure with a rate-limited key for demo week.
 *
 * Both are supported here and the call site is identical, so the decision is a
 * config change rather than a rewrite:
 *
 *   EXPO_PUBLIC_AEGIS_LLM_PROXY   set  -> requests go to the proxy, no key here
 *   EXPO_PUBLIC_ANTHROPIC_API_KEY set  -> requests go direct, key is in the app
 *
 * `EXPO_PUBLIC_` is Expo's marker for "this is inlined into the bundle", which
 * is a usefully blunt name for the risk. Prefer the proxy.
 */

import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from '@anthropic-ai/sdk';

import type { Advisory } from '../schema/advisory.ts';
import { checkFigures } from './guard.ts';
import type { Figure } from './guard.ts';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.ts';
import type { Language } from './prompt.ts';

/** Latest and most capable; this runs once per advisory, not per screen. */
export const MODEL = 'claude-opus-5';

const PROXY_URL = process.env.EXPO_PUBLIC_AEGIS_LLM_PROXY;
const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;

const TIMEOUT_MS = 60_000;

export type ExplainResult =
  | { status: 'ok'; text: string; model: string }
  /** The guard fired. The text is discarded; the evidence is not. */
  | { status: 'rejected'; offending: Figure[] }
  | { status: 'unconfigured'; reason: string }
  | { status: 'failed'; reason: string };

export function isConfigured(): boolean {
  return Boolean(PROXY_URL || API_KEY);
}

/** Which of the two F3a paths is live, for the sync screen to report. */
export function configSummary(): string {
  if (PROXY_URL) return `via proxy ${PROXY_URL}`;
  if (API_KEY) return 'direct, key in app bundle';
  return 'not configured';
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  client = new Anthropic({
    ...(PROXY_URL ? { baseURL: PROXY_URL, apiKey: API_KEY ?? 'proxy' } : { apiKey: API_KEY }),
    timeout: TIMEOUT_MS,
    // React Native has no `window.document`, so the SDK's browser check usually
    // does not fire — but on a client device the concern the flag names is real
    // and is exactly F3a. Set deliberately, not to silence a warning.
    dangerouslyAllowBrowser: true,
  });
  return client;
}

/**
 * Explains one advisory, in one language.
 *
 * Errors are returned rather than thrown: having no internet is the ordinary
 * state of this app, not an exception, and the UI renders it as one of several
 * normal states.
 */
export async function explainAdvisory(
  advisory: Advisory,
  language: Language,
): Promise<ExplainResult> {
  if (!isConfigured()) {
    return {
      status: 'unconfigured',
      reason:
        'No LLM endpoint configured. Set EXPO_PUBLIC_AEGIS_LLM_PROXY (preferred) ' +
        'or EXPO_PUBLIC_ANTHROPIC_API_KEY and restart the dev server.',
    };
  }

  let text: string;
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Ranking what matters in a degraded advisory is a judgement call, but a
      // small one, and a farmer is waiting on a phone. Medium is the balance.
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(advisory, language) }],
    });

    // Opus 5 can decline a request outright; that arrives as a 200, so it has
    // to be checked before reading content.
    if (response.stop_reason === 'refusal') {
      return {
        status: 'failed',
        reason: 'The model declined to answer for this advisory.',
      };
    }

    text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  } catch (err) {
    return { status: 'failed', reason: describeFailure(err) };
  }

  if (!text) {
    return { status: 'failed', reason: 'The model returned an empty response.' };
  }

  // F2, mechanically. Anything the model invented dies here rather than on a
  // farmer's screen.
  const guard = checkFigures(text, advisory);
  if (!guard.ok) return { status: 'rejected', offending: guard.offending };

  return { status: 'ok', text, model: MODEL };
}

/**
 * Most specific first — the distinction that matters is between a failure worth
 * retrying (no signal, rate limit, a 5xx) and one that will fail identically
 * forever (a bad key). Collapsing them into one message would leave a farmer
 * tapping "Try again" at a problem only a developer can fix.
 */
function describeFailure(err: unknown): string {
  if (err instanceof AuthenticationError) {
    return 'The API key was rejected. Check the key in the app config.';
  }
  if (err instanceof RateLimitError) {
    return 'Rate limited. Wait a moment and try again.';
  }
  if (err instanceof APIConnectionError) {
    return (
      'Could not reach the internet. This part of AEGIS needs a connection — ' +
      'the advisory above does not, and is already complete without it.'
    );
  }
  if (err instanceof APIError) {
    return `The service returned ${err.status ?? 'an error'}. Try again later.`;
  }
  return err instanceof Error ? err.message : String(err);
}
