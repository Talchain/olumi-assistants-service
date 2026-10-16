/**
 * `propose_add_option` — the CONTRACT and its quality guarantees.
 *
 * ⭐ WHAT THIS FILE IS TRYING TO RULE OUT. Not "does the schema validate", but
 * the four ways a model-authored option could damage a user's model:
 *   1. a link to a factor that is not there            → UNKNOWN_FACTOR_ID
 *   2. a link to a DIFFERENT factor that looks similar → FACTOR_LABEL_MISMATCH
 *   3. an invented size of effect                      → STRUCTURALLY IMPOSSIBLE
 *   4. an option filed under the wrong decision        → label echo + clarify
 * Three of those four are made unreachable rather than merely tested: (3) has
 * no field to travel in, and (1),(2),(4) are rejected by a deterministic
 * validator the model cannot influence. That is the point of the design, so it
 * is what the tests assert.
 *
 * ⭐ THE GRAPHS ARE REAL. Every scenario below runs against a captured
 * strategic model from `cee/context-integrity` fixtures (geographic expansion,
 * cost restructuring, a four-day week), not a hand-built two-node toy — so
 * "the factor exists" and "the label matches" are being asked of genuine
 * modelling vocabulary with near-miss names in it.
 *
 * ⚠ HONEST LIMIT, STATED NOT PAPERED OVER: no live model call happens here.
 * The adapter is scripted, INCLUDING with adversarial payloads a real model
 * could plausibly emit. So this file proves what the SYSTEM does with a given
 * model output; it does not measure how good a real model's output is. The
 * live-model arm below runs only when an API key is present and SKIPS loudly
 * otherwise — and it was skipped when this was written.
 */
import { expect,it } from 'vitest';



// ---------------------------------------------------------------------------
// Real captured strategic models.
// ---------------------------------------------------------------------------















// ---------------------------------------------------------------------------
// The validator — the only authority. Realistic + adversarial payloads.
// ---------------------------------------------------------------------------












// ---------------------------------------------------------------------------
// Transport.
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// Quality across real strategic models — the system's guarantees, per model.
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Live model — runs only with a key; SKIPS LOUDLY otherwise.
// ---------------------------------------------------------------------------

const LIVE_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;



it('DISCLOSURE: whether the live-model arm ran in this run', () => {
  // Not a pass/fail — a record in the output, so a green suite can never be
  // read as "the real model was measured" when no key was present.
  console.log(
    LIVE_KEY
      ? '[propose-add-option] live-model arm RAN'
      : '[propose-add-option] live-model arm SKIPPED — no ANTHROPIC_API_KEY/OPENAI_API_KEY in this environment',
  );
  expect(true).toBe(true);
});
