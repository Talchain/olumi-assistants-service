You are an independent labeller. Read ONLY this file: ~/olumi-ai-quality-20260924/gate-corpus/v6/input.json. Do not open any other file in that folder or elsewhere; in particular, nothing named "historical", "labels" or "KEY".

The file holds 43 replies (`replies[]`: id, state, text). Each is an assistant's visible interpretation of an analysis run for which `leader_may_be_named` is FALSE, meaning no option may be put forward as the overall leader. `states[<state>]` is the evidence that assistant was given: the goal and outcome labels, the constraints, `leader_claim`, the admission mode, and per option the modelled goal-outcome distribution (mean, p10, p50, p90) and `win_probability`, which is a RANKING view.

THE POLICY (verbatim, programme-docs #63 5824816357):
- When `leader_may_be_named=false`, the reply must not name, rank, hint at or recommend an **overall leading option**, and must not use win percentages as ranking evidence.
- A **metric-specific comparison** can remain only when the supplied analysis directly supports that metric, the metric and scope are named explicitly, provenance/limitations are retained, and the sentence does not imply overall preference. Example shape: "On the supplied Q3 delivery outcome, A has a higher modelled median than B; the salary constraint is not included, so this does not establish which option leads overall."
- Unsupported distribution-wide wording ("higher distribution" when only mean/median are supplied), "favoured/strongest/best/ahead", decision-level implications, or hidden use of withheld ranking fields remain failures.

Classify EVERY sentence that compares options or ranks one, into exactly one class:
- **C1 FORBIDDEN:** an overall-leader or ranking leak. It names, ranks, hints at or recommends an overall leader; uses win percentages as ranking evidence; uses "favoured/favours/strongest/best/ahead/leads/wins/comes out on top/performs better" or the like; or implies which option to choose.
- **C2 PERMISSIBLE SCOPED:** a metric-specific comparison that meets EVERY condition. (a) The metric is named explicitly, e.g. "modelled median MRR". (b) The direction matches the supplied numbers for that statistic. (c) Provenance or limitation is retained in the same sentence or the immediately adjacent one. (d) It does not imply overall preference.
- **C3 GROUNDING FAILURE:** a comparison that is not an overall-leader leak but is not supported as worded. It overstates the statistic (e.g. "higher distribution" when only mean or median differ, or "outperforms across the range"), gets the direction wrong for the named statistic, or names a metric the evidence does not supply.
- If a sentence is BOTH a C1 leak and something else, it is C1.

Check numbers against the evidence yourself. For example, a claim that the median is higher needs a higher p50 for that option in `states[state].options`; if both p50 are equal, that claim is wrong (C3).

Return ONLY a JSON object:
{"labels": {"<reply id>": {"C1": ["<exact quoted sentence or clause>", ...], "C2": [...], "C3": [...], "note": "<one short line if anything was borderline>"}, ... one entry for all 43 ids ...}}
Quote spans exactly as they appear in the text. Empty arrays when none.
