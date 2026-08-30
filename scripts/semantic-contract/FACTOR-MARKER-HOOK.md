# Accepted factor edits retire superseded qualifiers

This change adopts FQ's shared `clearSupersededFactorMarkers` helper at the
existing `set_factor_value` mutation. It is stacked on #1230; the original
percentage fixtures are unchanged.

The semantic question is whether a freshly accepted user value still carries
qualifiers belonging to the superseded model quantity. The handler writes the
value and verified attribution, replaces the selected node with the helper's
returned copy, then validates and commits that same graph. It does not invent
another source vocabulary or infer provenance from a number.

The shared owner is Factor Quantification. The dependency is its unpublished
0.53.0 artifact from schemas `51dca7aa03efaef9160c8a9f806b804b7f8a68fd`, SHA256
`a532fb3ce386be8610bb56d4e4efee77fe39f75da7269a774c1d97009997eea1`.
CEE dependency commits `f898c87a71e12b90060c7a5750c1a679358bf7b4` and
`f8dbee7de226495cacc64d9b6f9aaced5b10dadb`, followed by
`831c50cef48e6e84d28f9ced88a34910a1894ef7`, are reused without a competing pin.

An accepted point loses its stale value tier and model reasoning. Only an
explicitly system-created unknown/fallback prior is removed. An unattributed
prior is retained byte for byte; `user_override` selects the newly accepted
point without relabelling the prior. A genuinely supplied prior survives and
its conflict with a supplied point remains explicit in the shared selector.
An untouched same-label factor retains its original identity and neutral source.

Confirming the same number may still change its provenance or remove fallback
qualifiers. That is acknowledged as applied, without claiming that the number
changed. The same number with identical attribution and no stale qualifiers
remains a no-op. Verified panel participant and evidence IDs survive; an ordinary
retype clears the superseded panel attribution.

An unknown quantity can still have a known unit, cap and declared scale. When
the shared selector identifies an unprotected unknown/fallback prior, the
handler supplies that scale to the existing validator and normaliser before
writing the new point. For example, a GBP prior with cap 100000 licenses a
75000 GBP edit as value 0.75, preserving the cap and declaration. Its ignorance
range never becomes a point estimate. Existing unit-mismatch and ambiguous
bare-value rules still apply. The cleanup refuses to delete known scale
metadata that was not coherently retained; it does not convert units or borrow
a competing prior's scale.
The existing normaliser enforces `DECLARED_SCALE_BOUNDS` on every result with
a recognised declaration. A declared raw count refuses a nontrivial divisor,
including at zero; retaining its label beside a normalised value is not fidelity.

## Replay

```sh
pnpm exec vitest run \
  src/orchestrator-v5/tools/handlers/__tests__/set-factor-value-qualifier-cleanup.test.ts \
  src/orchestrator-v5/tools/handlers/__tests__/set-factor-value-prior-scale.test.ts
```

This executes the actual handler, mutation validation, persistence merge and
projection, JSON reload, full applied-graph receipt and shared quantity selector.
Only panel storage is substituted; its attribution verifier is real. The
semantic-loss arm restores the stale fallback tier and must fail the supplied
point invariant; changing the display label leaves that invariant green.
Removing the production hook must also make the same assertions fail.

Replay the unchanged cross-service percentage fixture using the instructions
in `README.md`. It remains the supplied 12% to 24% versus old unflagged-prior
control through the actual PLoT/ISL analysis adapters.

## UI handoff: deletion does not survive overlay

```sh
UI_REPO=/absolute/path/to/pinned/ui NODE_ENV=test \
  node_modules/.bin/tsx scripts/semantic-contract/factor-marker-ui-loss.ts
```

At UI `e8f86b1a02bb9b68bd80f2fdbc813558eee17bfe`, the command must exit 1:
an accepted user zero deletes the model ignorance prior from the canonical full
receipt, but `overlayNode` retains the omitted key from the old canvas node.
Autosave then retains that prior through JSON readback. The genuine supplied
prior opposite control passes. Nested observed-state cleanup, zero, unit and
user source all survive. The report includes the actual target node at receipt,
overlay and readback, source hashes and exact dependency identity.

CCUX owns `mergeAppliedGraph.ts` and the UI correction. Do not clear every
prior, hide the defect by changing the scientific value, or alter legitimate
extraction metadata to compensate for a UI classification problem. The separate
fractional-percentage display failures in #1230 remain with CCUX too.

## Integration limits

Evidence rung is TESTED using production adapters. Storage is in memory and
JSON readback is not a database or mounted-browser witness. This does not close
general user-visible percentage or quantity semantics.

Science owns the existing private CEE analysis hash projection. Its factor
adoption must include source, value tier, standard deviation and unknown markers
so same-number qualifier changes invalidate prior analysis consistently. The
helper alone does not establish that freshness contract.

FQ's separate CEE prior-schema adoption is required for nonnumeric unknown
priors; the current CEE boundary still requires numeric distribution support.
This fixture uses accepted numeric priors and does not bypass that boundary.

CC retains integration and merge authority. Adopt the hook with the matching
FQ and Science consumers; it is not a standalone release clearance. After
independent closure, choose the highest-impact first-failing unowned Graph
Truth contract from current evidence, rather than preassigning its successor.
