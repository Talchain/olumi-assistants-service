/**
 * ⭐⭐ FRAMING BEFORE THE RUN NUDGE — the sequencing half of the class-b fix.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A team brings a disagreement about CAUSES: *"retention is slipping and we
 * disagree about why — some think the product has fallen behind, some think
 * onboarding, some think we're selling to the wrong customers."* The drafter is
 * under an unconditional instruction to produce 2-6 options, and with no
 * actions in the brief it converts the three competing EXPLANATIONS into three
 * OPTIONS — and, correctly, into three FACTORS as well. The option -> factor
 * effect cells are then tautological and unfillable ("by how much does *The
 * Product Has Fallen Behind* change *The Product Has Fallen Behind*?"), so they
 * default, and the analysis goes on to name a winner among the team's own
 * hypotheses. Fifteen runs of one brief named four different winners.
 *
 * Against the ratified principle — *"Alignment should be earned through better
 * reasoning, not manufactured through compromise"* — that is the exact
 * inverse: a disagreement about causes should be explored as competing
 * hypotheses and evidence gaps, not collapsed into options and ranked.
 *
 * ── WHAT THIS MODULE CHANGES, AND WHAT IT DELIBERATELY DOES NOT ────────────
 * The product ALREADY asks the right questions. `composeDraftFirstDisclosure`
 * emits *"What outcome would make this decision a success? What alternatives
 * are you weighing this against? What timeframe…"* verbatim. They are simply
 * SUBORDINATED: `route-v2` appends the disclosure after an assistant_text whose
 * terminal block is the run nudge (`assembleSectionedNarrative` keeps
 * `nextStep` terminal by design, `post-draft-narrative.ts:1922`), so the user
 * reads *"Next, run the analysis…"* and only then the framing questions.
 *
 * This module changes the ORDER and nothing else:
 *   · the framing questions are spliced ABOVE the run nudge;
 *   · their existing tap-able candidate answers ride as chips;
 *   · the run nudge still ships, and every executable affordance survives.
 *
 * **The analysis is never blocked.** The user may still run it. What changes is
 * what the product LEADS with. The option floor in the draft prompt, the
 * grammar and the readiness gate are all untouched — removing the option floor
 * alone makes class-b worse, because the model then lands on a readiness path
 * that demands the options back one per factor.
 *
 * ── WHY NOT `validators/decision-free-shape.ts` ────────────────────────────
 * It was checked first and it does not fit — and the reason matters, because
 * two predicates under one name is this estate's most expensive recurring
 * defect (platform trap 21). `isDecisionFreeShape` is `decisions === 0 &&
 * options === 0`: the deliberate exploratory map, where the user asked for
 * nothing to be chosen between. Class-b is the OPPOSITE shape — the drafter
 * minted three options and a decision the user never posed. On every class-b
 * graph `isDecisionFreeShape` is FALSE, by construction.
 *
 * The two answer different questions:
 *   · `isDecisionFreeShape`  — "is this model legitimately option-free?"
 *   · `hasOptionFactorLabelMirror` — "did the drafter manufacture options out
 *     of the same statements it also made factors?"
 * They are named apart on purpose and neither is derived from the other.
 *
 * ── WHY A LABEL MIRROR, AND WHY NOTHING SOFTER ─────────────────────────────
 * The discriminator is MECHANICAL: an option label that normalises to the same
 * key as a factor label. It is a string comparison over two node kinds — no
 * judgement about what a brief "means".
 *
 * A natural-language *"does this brief name an action?"* test was considered
 * and rejected. That is the one-predicate-two-harms shape this codebase has
 * already paid nine rounds for on CEE #888 (platform traps 22b/22d/22f): too
 * wide and a genuine decision gets lectured about framing; too narrow and
 * class-b sails through — and no punctuation-or-keyword rule separates them.
 *
 * Matching is EXACT after normalisation and never containment. Containment
 * would fire on a genuinely decision-shaped model — option *"Build in-house"*
 * against factor *"Build cost"* — which is precisely the false positive the
 * both-directions test forbids.
 */

import type { SuggestedAction } from '../compose/types.js';

/** The shape this module reads off a graph. Nothing else is relevant to it. */
export interface FramingSignalNode {
  readonly kind?: unknown;
  readonly label?: unknown;
}

/**
 * Leading articles stripped before comparison. A FIXED, closed list — this is
 * still a string operation, not a language judgement, and it exists because
 * the projector routinely renders the same statement with and without its
 * article ("The Product Has Fallen Behind" / "Product Has Fallen Behind").
 */
const LEADING_ARTICLES: readonly string[] = ['the ', 'a ', 'an '];

/**
 * Normalise a node label to a comparison key, or `null` when there is nothing
 * to compare. Lowercase, whitespace-collapsed, stripped of surrounding quotes,
 * trailing sentence punctuation and one leading article.
 */
export function normaliseNodeLabelKey(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  let key = label
    .replace(/[“”‘’"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  key = key.replace(/[.,;:!?…]+$/g, '').trim();
  for (const article of LEADING_ARTICLES) {
    if (key.startsWith(article)) {
      key = key.slice(article.length).trim();
      break;
    }
  }
  return key.length > 0 ? key : null;
}

/**
 * Every normalised label carried by BOTH an option node and a factor node, in
 * first-seen option order. Returned rather than reduced to a boolean so a
 * caller — or a test — can name the offending statement by identity instead of
 * asserting on a bare flag.
 */
export function optionLabelsMirroringFactorLabels(
  nodes: readonly FramingSignalNode[],
): readonly string[] {
  const factorKeys = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'factor') continue;
    const key = normaliseNodeLabelKey(node.label);
    if (key !== null) factorKeys.add(key);
  }
  const mirrored: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'option') continue;
    const key = normaliseNodeLabelKey(node.label);
    if (key === null || !factorKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    mirrored.push(key);
  }
  return mirrored;
}

/**
 * THE SIGNAL. TRUE when at least one option label mirrors a factor label —
 * the manufactured-options shape class-b produces.
 */
export function hasOptionFactorLabelMirror(nodes: readonly FramingSignalNode[]): boolean {
  return optionLabelsMirroringFactorLabels(nodes).length > 0;
}

/**
 * The opening of every sentence `projectReadinessRecovery` composes as its
 * `nextStep`, across all twelve branches (`run`, `resolve_model_issue`,
 * `map_option`, `encode_option`, `provide_value`, `confirm_value`,
 * `connect_option`, `review_constraint`, `configure_option`, `review_model`,
 * and both no-label fallbacks).
 *
 * ⚠ THIS IS A MIRROR OF ANOTHER MODULE'S COPY, SO IT FAILS LOUD RATHER THAN
 * DRIFTING (platform trap 12). `framing-first-sequencing.test.ts` drives
 * `projectReadinessRecovery` over every `ReadinessRecoveryKind` and asserts
 * each returned sentence starts with this prefix — so a future branch that
 * drops "Next, " REDs that test instead of silently mis-placing the framing
 * block. It is a prefix used to LOCATE an already-composed block, never to
 * decide which sentence to emit.
 */
export const NEXT_STEP_BLOCK_PREFIX = 'Next, ';

/**
 * Splice the framing disclosure ABOVE the run nudge.
 *
 * The narrative is `\n\n`-separated blocks with `nextStep` terminal. The
 * disclosure is inserted before the LAST block that opens with
 * {@link NEXT_STEP_BLOCK_PREFIX}.
 *
 * ⭐ FAIL-SAFE, NOT FAIL-CLOSED. When no such block exists — a narrative shape
 * this module has not seen — the disclosure is APPENDED, which is byte-identical
 * to the behaviour before this change. A sequencing change must never be able
 * to lose the disclosure.
 */
export function promoteFramingAboveNextStep(
  assistantText: string,
  disclosure: string,
): string {
  const base = assistantText.trimEnd();
  const blocks = base.split('\n\n');
  let target = -1;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]!.startsWith(NEXT_STEP_BLOCK_PREFIX)) {
      target = i;
      break;
    }
  }
  if (target < 0) return `${base}\n\n${disclosure}`;
  blocks.splice(target, 0, disclosure);
  return blocks.join('\n\n');
}

/** The hard cap the UI renders. Mirrors `compose/chip-finalizer.ts`'s budget. */
export const FRAMING_CHIP_ROW_CAP = 3;

/**
 * THE TWO GENERIC POST-DRAFT CONVERSATION STARTERS, the only chips a framing
 * promotion may displace. They carry no `action_type` and nothing on the graph
 * depends on them. The executable `chip_action_run_analysis` and the readiness
 * recovery chip are deliberately ABSENT from this set: the analysis is not to
 * be blocked, and a repair affordance is not a conversation starter.
 *
 * ⚠ A MIRROR OF `handlers/draft-graph-dispatch.ts`'s literals, AND IT CANNOT BE
 * DERIVED. Importing them from there would put that module in `route-v2`'s
 * import graph for this purpose — and the route-level harnesses `vi.mock` it
 * with a factory that exports `dispatchDraftGraph` alone, so any such import
 * reads `undefined` under test while looking perfectly correct in the source
 * (platform trap 12: `vi.mock`'s factory REPLACES the module).
 *
 * So it is a mirror that FAILS LOUD instead: `framing-first-sequencing.test.ts`
 * drives the real `buildPostDraftChips` and asserts, in both directions, that
 * every id in this set is emitted by it and that no chip carrying an
 * `action_type` is in this set. A rename on either side REDs that test.
 */
export const POST_DRAFT_DISPLACEABLE_CHIP_IDS: ReadonlySet<string> = new Set([
  'chip_prompt_review_model',
  'chip_prompt_assumptions',
]);

/**
 * Promote the framing candidate chips to the head of the chip row.
 *
 * ⭐ IT DISPLACES ONLY GENERIC CONVERSATIONAL CHIPS, NEVER AN AFFORDANCE.
 * `displaceableChipIds` names the post-draft chips that are pure conversation
 * starters. Everything else — the executable `run_analysis` chip, the readiness
 * recovery chip — survives, because the brief is explicit that the analysis is
 * not to be blocked. Framing chips take the freed slots and the head of the
 * row; the row is then capped, protecting the survivors ahead of any framing
 * chip that does not fit.
 */
export function promoteFramingChips(params: {
  readonly existing: readonly SuggestedAction[];
  readonly framing: readonly SuggestedAction[];
  readonly displaceableChipIds: ReadonlySet<string>;
}): SuggestedAction[] {
  const survivors = params.existing.filter(
    (chip) => !params.displaceableChipIds.has(chip.id),
  );
  const takenIds = new Set(survivors.map((chip) => chip.id));
  const room = Math.max(0, FRAMING_CHIP_ROW_CAP - survivors.length);
  const promoted: SuggestedAction[] = [];
  for (const chip of params.framing) {
    if (promoted.length >= room) break;
    if (takenIds.has(chip.id)) continue;
    takenIds.add(chip.id);
    promoted.push(chip);
  }
  return [...promoted, ...survivors].slice(0, FRAMING_CHIP_ROW_CAP);
}
