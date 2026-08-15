# Fragile-edge backend product contract

Audience: Claude Product Experience. This is a rendering contract, not a new UI brief.

## Backend authority

- CEE orders fragility priority by the producer's finite conditional `switch_probability`; this field is not a sensitivity score.
- The greatest finite value becomes the first fragility priority; equal values keep producer order.
- The producer head is used only when no row carries a finite value.
- Action offers additionally require exact endpoint identity, endpoint labels, a joined non-degenerate `edge_e_values` row, an in-domain `flip_mean`, and acceptable source input quality. If the highest-ranked row is not actionable, CEE may use the next eligible metric-ranked row.
- No other metric is substituted. CEE does not surface the raw probability or the Tier-3 edge-e-value quantities.

## Existing product output

When CEE emits a fragile-edge coaching offer, the existing block already carries:

- `signal_code: "FRAGILE_RESULT"`;
- a quantity-free body naming both endpoint labels;
- one `target_refs` entry with `kind: "edge"` and the exact `from→to` identity;
- `action_label: "Adjust this relationship"`;
- a producer-label-bound action prompt for the canonical edit path.

When the gates refuse, there is no fragile-edge offer. Absence is an honest empty, not permission to choose another edge locally.

## Current projection boundary

- Full metric-bearing coaching paths use the shared authority above.
- The Claude-owned analysis projection currently carries endpoint labels but drops `switch_probability`. Advice-gate and `explain_results` consumers therefore use the explicit no-finite-metric head fallback and keep their copy non-superlative.
- `context/analysis-fallback.ts` still owns a separate max-and-dedupe rule before that labels-only projection, while the per-option compact path retains arrival order. This is a residual duplicate authority, not resolved in this backend-only change.
- A later projection integration should carry either the finite producer metric or a typed backend priority selection. Until then, the client must not infer a maximum or add ranking language.

## Rendering obligations

- Render the CEE-authored relationship and action; do not re-rank fragile edges in the client.
- Keep the action bound to the supplied edge target reference.
- Do not translate `switch_probability` into `most sensitive`, `top sensitivity`, or equivalent copy. A future superlative would require separate typed semantic evidence, not merely this metric.
- Do not display raw `switch_probability`, `e_value`, `current_mean`, or `flip_mean` from this contract.
- A missing offer needs no replacement card. Other existing CEE reasoning blocks may take the slot normally.

## Acceptance examples

- Unsorted values `0.12, 0.81, 0.40` make the `0.81` row the first fragility priority.
- Equal finite values select the first producer row.
- Missing, `NaN`, infinite, or string values do not count as metrics; if all rows are invalid, the head is compatibility-only and copy stays non-superlative.
- Missing identity or labels never produces a half-named or unbound action.
