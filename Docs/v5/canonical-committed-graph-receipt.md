# Canonical committed-graph receipt — component handoff

Status: **foundation frozen for independent review; not merged, pushed or
deployed**. The CEE branch is based exactly on serving staging
`dfb5bd708c81a3c5e5a455a4f2e8b74897c2d3ca`. Do not rebase it onto an
unreviewed feature branch.

## Boundary and completion state

This component makes a successful transactional response describe the exact
analysis-affecting graph bytes accepted by the atomic append. It does not add
model repair, science, Context/Memory, product-experience work, or a second
readiness authority.

The five canonical hash carriers are:

- `nodes`
- `edges`
- `options`
- own `goal_node_id` (`string` or explicit `null`)
- `goal_constraints` (including explicit `[]`)

`node_count` and `edge_count` are derived receipt metadata. They must equal the
lengths of the exact carried arrays; they are not copied from the stored object
and are not hash inputs.

Legacy `draft_graph` reads remain additive-compatible: legacy responses may
omit the newer carriers. Canonical transactional producers are a stricter
barrier. Before append, `projectGraphForPersistence` authors explicit carrier
absence and refuses to guess between multiple goal nodes. After commit,
`buildCanonicalCommittedGraphReceipt` requires every own key and validates the
exact `CommitResult.persistedGraph`; it never falls back to an applied,
requested, parsed, or pre-projection graph. A missing or invalid persisted graph
therefore produces no success receipt.

## Shared contract authority

CEE is pinned locally to the live schemas 0.43.0 contract built from:

- schemas base/tag v0.42.0:
  `bbfb7eb1e3f450598ff061a8651ce8c7e053468d`
- guarded main/tag `v0.43.0`:
  `fdc30a4d74d3b3cf52c5674fcd4a7805cb8e6807`
- original isolated correction head (same exact tree):
  `3c3dc78cb08eb63135da7c2a90a9d4609ce28267`
- corrected schemas tree:
  `fc96888fc41cf537ed83f041bab159447e23bc2d`
- vendored sha256:
  `9865bfc0891cfed383ae7a0741b324087ba33db03479f97295174f031dc8ea5e`

Schemas 0.43 provides two deliberately different reader/producer shapes:

- additive legacy `DraftGraphBlockSchema`, for compatibility;
- strict `CanonicalCommittedGraphReceiptSchema` and producer block, including
  count refinements and explicit goal absence.

It also exports the versioned nested projection vocabulary. CEE remains the
only hash projector/digest implementation and imports that vocabulary directly;
there is no second keep-list or shared competing digest. A manifest-derived
mutation suite proves every declared nested field moves the hash, including the
conditional treatment of `raw_interventions`.

## Migrated writers

The singular post-commit builder is wired into:

- initial `draft_graph`;
- `edit_graph`;
- edge-strength set and `confirm_current`;
- factor-value set;
- graph-management held apply (single and all);
- routed D1 application.

Adoption/no-write responses remain receipt-free. `confirm_current` remains a
provenance-only operation: canonicalising omitted explicit empty/null carriers
is admitted only when the raw-before and projected-before analysis hashes are
equal. A legacy graph with one goal but no `goal_node_id` is refused because
deriving that id moves the hash; confirmation cannot silently migrate it.

## Readiness dependency — intentionally fenced

Do not derive readiness in the receipt builder and do not add
`canonical_graph_hash_analysis_state` or any other attestation sidecar. #983's
`buildCanonicalAnalysisReadyFromGraph` is the required sole whole-status
authority.

At this freeze, #983's correction exists at
`91df6abb3a8d5b9b6a36db03f896e566aef35699` (tree
`6e3d2065`) on the same `dfb5bd70` base. Independent review has returned a
terminal merge recommendation, but its required/full CI is still running and
serving staging remains `dfb5bd70`. It is not yet an admissible integration
base. Residual `computeStructuralReadiness` uses outside the receipt builder are
**QUARANTINE**, not endorsed architecture.

Required completion sequence:

1. **Complete:** schemas 0.43 is reviewed, guarded-merged, tagged and published;
   CEE and UI hold the same source-pack artifact bytes.
2. Deploy the UI's 0.43 canonical-receipt reader from serving origin
   `7ad0cefcd8c386491680e9656b8720ce36df6b4e` or newer. Producer-first emission
   is forbidden.
3. Independently accept #983 and integrate it into staging.
4. Derive the resulting exact serving CEE staging SHA.
5. Rebase this receipt branch onto that serving SHA, resolve coexistence, and
   replace residual whole-status writer derivations with the merged canonical
   builder. Do not cherry-pick or self-integrate the review head above.
6. Run focused receipt/writer/readiness coexistence suites, type/lint, then the
   serialized broad gate; obtain a fresh independent review.
7. Integrate the CEE producer only after the UI reader and canonical readiness
   authority are both serving; then delete the UI's provisional sidecar mirror.

## Architecture disposition

| Item | Disposition | Reason |
|---|---|---|
| `buildCanonicalCommittedGraphReceipt` | **KEEP** | Sole exact post-commit receipt validator/transporter. |
| schemas 0.43 producer receipt + nested vocabulary | **KEEP** | Shared wire contract and one field vocabulary; no duplicate digest. |
| `projectGraphForPersistence` carrier authoring | **KEEP** | Makes append bytes canonical before the irreversible commit. |
| `buildAppliedGraphWireField` / `applied-graph-emit.ts` | **REMOVE** | Lossy nodes/edges-only projection from the wrong authority. |
| manual initial-draft receipt composer | **REPLACE** | Now routed through the singular post-commit helper. |
| writer fallbacks to `appliedGraph`, request graph or `committedParse.data` | **REMOVE** | Can attest bytes that were never stored. |
| `computeStructuralReadiness` as whole-status response authority | **QUARANTINE** | Superseded by reviewed #983; removal waits for staging integration. |
| receipt-side readiness or hash-state sidecar | **REMOVE / FORBID** | Would create a parallel authority. |

## Verification and operational properties

Decisive tests cover the five exact carriers, nested option/intervention fields,
explicit null goal identity, empty-constraint deletion, projection-mutating
append, factor/edge set and no-op/confirmation, held single/all, routed D1,
invalid/missing post-commit graphs, count mismatch, architecture drift, and the
shared projection version/manifest.

The receipt path is linear in graph size: one schema validation, bounded numeric
validation, one canonical hash, and one receipt hash witness. It performs no
network or persistence read and does not log graph content. Typed failures carry
only a fixed code, preventing labels, values, or private scenario content from
leaking into logs. The helper does not mutate its input; carrier defaults are
authored once before append, and the persisted projection is reference-idempotent
after canonicalisation.
