# Governed draft_graph V5 evaluation pack

This directory is the only evaluation authority for a `draft_graph` prompt-quality claim on serving build `424f912`. It freezes the exact PMS v195 bytes, the ordered code-owned prompt layers, the prompt-specific model assignment, the production records contract, canonical readiness, and exactly 14 ordered briefs.

Status: **HOLD — exact baseline not yet executed.** No candidate prompt bytes are admitted until the baseline completes under this pack. This is deliberate: deriving a candidate first would optimise against an evaluator that has not yet proved it can reproduce the serving contract.

## Why the legacy evaluator is not an authority

The legacy draft path sends one raw graph prompt straight to a provider. Serving sends PMS v195 as system block one and the code-owned records instruction as system block two, constrains the response with the records grammar, validates and projects the record set, may run one additive completion turn, and only then exposes a graph. The legacy path also loads 16 Markdown files by default despite documenting a 14-brief corpus.

The old scorer remains an informational matched-pair signal. It cannot independently approve a candidate: 30% of its composite is not-applicable full credit on every canonical brief, and its coaching dimension addresses a field the records draft no longer emits. Structural validity, canonical readiness and provenance are hard non-regression gates in this pack.

## Reproducible workflow

1. Run the pack verifier. Any hash, order, route, model or disposition drift is a hard stop.
2. Run one baseline arm: 14 primary calls, one per pinned brief, on `claude-sonnet-4-6`. The production adapter may make at most one additive completion call per case.
3. Freeze the baseline results and failure classification. Provider failures are infrastructure failures, not zero-quality scores.
4. Only then derive one coherent candidate. Run it against the same 14 briefs, model, production adapter, records grammar, completion policy and rubric.
5. Accept only a meaningful matched quality gain and no structural, canonical-readiness or provenance regression. Otherwise HOLD WITH EVIDENCE.

No command in this pack writes to PMS, changes a serving model or environment, or promotes a prompt.

## Legacy disposition

- **KEEP:** the exact v195 baseline snapshot.
- **REPLACE:** the raw draft runner/adapter for any quality or promotion claim.
- **QUARANTINE:** historical prompt experiments and the stale topology-plan reminder; archaeology only.
- **REMOVE:** one byte-identical v175 duplicate and the two ad-hoc staging briefs from the governed selection. Their files are left untouched until controlled review; the verifier proves they cannot enter the canonical 14.

See `legacy-disposition.json` for the complete itemised matrix and `failure-taxonomy.json` for failure semantics.
