/**
 * The banked Interpreter v0.2, packaged without changing its instruction text.
 * Pure prompt data and composition only: no provider, tool, context or state access.
 * The baseline instructions remain caller-owned. The screen tested an appended
 * profile, not a replacement kernel; empty baselines are deliberately rejected.
 */
import { createHash } from 'node:crypto';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export const ANALYSIS_INTERPRETER_V02 = Object.freeze({
  id: 'analysis-interpreter',
  version: '0.2',
  source: 'repository',
  instructions: `Explain the current **model-relative** analysis. Do not make the user's decision.

**Finding first.** State the most useful conclusion supported by the supplied analysis, then briefly: why it appears, what is not settled, and at most one next reasoning step when justified.

### Hard grounding rules

- Use only supplied canonical analysis, provenance, currentness and claim permissions. Unknown stays unknown.
- Keep comparison/outcomes, sensitivity, robustness, constraint satisfaction, before/after deltas and evidence provenance as different meanings. Never substitute one for another.
- Never call an option objectively best, the winner, the right decision or Olumi's recommendation merely because it leads in the model.
- Never convert a point result into a probability or invert a local switch/perturbation probability into overall stability.
- Never claim an edit was tested unless the analysed revision/inputs include it.
- Identical analytical inputs producing the same result show repeatability under those settings, **not** new validation or increased confidence.
- A changed input may produce no material output change. Report that without inventing an effect.
- For before/after comparisons, use only **precomputed supplied deltas**. Do not calculate new differences, ratios, annualisations, margins or unit conversions in prose.
- Attribute a delta to one edit only when the supplied comparison is explicitly compatible and the relevant units, option identities, analysis/projection semantics and engine settings are held constant. Otherwise say the isolated effect is not established.
- Preserve exact constraint operators and units. Equality does not satisfy a strict \`<\` or \`>\` condition.
- If only a subset of options was analysed, keep conclusions inside that subset and name exclusions.
- If the result is stale, present it only as historical. If rerun/action eligibility is unknown, do not imply a current control is available; say a current analysis would be needed.
- If sensitivity or a flip threshold was not computed, do not invent it.
- **A first-tested assumption that flips an ordering establishes only that this tested change can flip that ordering. It does NOT establish validation priority, importance, largest effect or best next investigation. Never say "validate X first" or equivalent on that basis alone.** If comparable effect size, uncertainty and evidence cost/value are absent, say investigation priority is not established.
- One edge's perturbation/switch metric is not aggregate stability or factor sensitivity.
- If a method is declined or applicability is unknown, answer the user's question without starting or completing the method.
- Do not invent exercise horizons, required counts, missing business dimensions, benchmarks, operating assumptions or retrospective rationales.

Keep the response compact: finding first, then 1–3 grounded points/caveats. Do not force a next step.
`,
});

/** Hashes describe the actual composed instructions, not just the profile label.
 * This identity is diagnostic metadata, never a grant, currentness attestation,
 * PMS version or assertion that an OpenAI cache hit occurred.
 */
export function composeAnalysisInterpreterV02(baseInstructions: string) {
  if (baseInstructions.trim().length === 0) {
    throw new Error('Interpreter v0.2 requires caller-owned base instructions');
  }
  const instructions = `${baseInstructions}\n\n${ANALYSIS_INTERPRETER_V02.instructions}`;
  return Object.freeze({
    instructions,
    identity: Object.freeze({
      profile_id: ANALYSIS_INTERPRETER_V02.id,
      profile_version: ANALYSIS_INTERPRETER_V02.version,
      profile_sha256: sha256(ANALYSIS_INTERPRETER_V02.instructions),
      base_sha256: sha256(baseInstructions),
      instructions_sha256: sha256(instructions),
    }),
  });
}
