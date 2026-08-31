# Class-B: the producer input the projector cannot recover

Status: bounded source/acceptance investigation, not an implementation or a new
wire contract. Baseline source: `ac37890c3fc0d730560e09ffcb88b2c8951cc67d`.

The active delivery board authorizes projector provenance work and isolated
semantic controls. It does not authorize new grammar/schema fields, a lexical
classifier, a general assertion ontology, or changes to the baseline lane's
final-record acceptance helper. Primary owns allocation of the producer seam.

## Existing interface, unchanged

`projectDraftRecords(input: unknown, brief?: string)` validates and rebuilds a
`DraftRecordSet`, then calls `projectRecordsToGraph(records, brief)`.

The model-facing declared kinds are:

- `stated_items`: `goal`, `option`, `constraint`, `figure`, with `source_quote`.
- `claims`: `factor`, `causal_link`, `option_refinement`, `prior`, `risk`,
  `outcome`, with `label` and optional `basis`/relation/value fields.

`kind` / `claim_kind` already supplies the declared role; a duplicate role
classifier is not proposed. `option_refinement` already supplies a legal AI
action carrier. `basis` means support/refinement ownership, not authorship of
the claim. No existing claim field identifies an exact user-supplied assertion.

## First losses and precise sites

1. `records/instruction.ts:219-228` sends user-reported explanations into
   factor/risk claims, while line 259 describes claims as AI-added material.
   `records/grammar.ts:372-422` cannot carry a claim's source assertion.
2. `records/seam.ts:203-231` explicitly rebuilds the supported fields. A new
   signal supplied elsewhere would be discarded unless adopted at this seam.
3. `records/projector.ts:2119-2124` stamps stated items from array membership;
   lines 2531-2535 and 2724-2729 stamp every unmerged claim as AI-inferred.
   Quote occurrence verifies bytes, not action semantics or goal designation.
4. `records/projector.ts:2757-2862` withdraws an unconnected factor from the
   graph. Keeping its disclosure is not canonical hypothesis retention.

The hypothesis/action failure cannot be corrected from source class, topology,
or intervention values alone. The independent retained diagnostic/action pair
has the same shapes on those axes. The raw guest captures contain graphs, not
the original provider records; the fixed-record corpus is explicitly authored
acceptance input, not a reconstructed provider emission.

## Existing carriage that must be reused

V1 `node.body` is copied to canonical `NodeV3.description` by
`transforms/schema-v3.ts:245`. It survives strict graph parsing and is retained
by `orchestrator/context/graph-compact.ts:616-618`, ContextPack and the subsequent
model prompt. The existing `node-description-context-continuity.test.ts` covers
this path. Context descriptions are bounded to 160 characters with an ellipsis;
this is not unlimited proposition retention in the prompt.

This path carries prose, not a missing source declaration. Numberless node
provenance is currently reset to `system` / `ai_inferred` by
`graph-compact.ts:689-692`; final model-facing node formatting does not expose
node provenance/source quote. Those are separate downstream limits, not a
reason to infer source at the projector.

## Minimal allocation needed

Primary must name one producer owner for correct record role classification and
source-assertion binding before the `projectDraftRecords` rebuild. The projector
can then consume that sanctioned input while retaining existing role kinds and
origin vocabulary. A candidate internal quote carrier is a proposal only: no new
field or grammar member is adopted by this packet.

The source quote must identify the proposition being attributed, not merely
material supporting an inference. Missing or unverified source cannot become
user authorship. Genuine actions and legal `option_refinement` records must keep
their distinct option identities and intervention semantics. No explanation may
become an option solely to satisfy comparative readiness.

Baseline owns its final-record `option-framing` reconciliation and parse
recovery. It does not provide a hypothesis classifier or origin verdict; this
packet does not change that interface. Shared canonical/context changes need a
separate exact hunk allocation after the producer input is settled.

## Evidence limits

The new corpus exercises current public records fields and external expected
meaning. It does not define a replacement API. Normative failures expose the
unimplemented boundary; they must not be made green by weakening expectations,
inventing source fields in a fixture, or relabelling retained captures.

No production changes, provider calls, shared-schema changes, merge, deployment,
or mounted-journey claims are made by this packet.
