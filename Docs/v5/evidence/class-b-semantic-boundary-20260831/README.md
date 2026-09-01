# Class-B semantic boundary: acceptance checkpoint

**Not fixed. This packet contains no production change.** It banks the smallest
current-record counterexamples for the #1250/#1238 successor while Primary
allocates the missing internal source-assertion contract. Do not merge this
deliberately red acceptance branch as a product correction.

Source under test: `ac37890c3fc0d730560e09ffcb88b2c8951cc67d` (CEE staging snapshot).
Installed contract: vendored `@talchain/schemas@0.50.0`. Node: `v22.16.0`.
The branch changes tests, authored fixtures and this evidence only.
The existing source-only `pnpm typecheck` gate passed. It excludes test files;
the separate isolated check of this test and its imports also passed using
`typecheck.config.json`. No full test-tree typecheck/ratchet claim is made.

## Measured result

The seven-case packet has **4 PASS / 3 RED**. Failures are visible assertions,
not skipped tests, expected-failure wrappers or an LLM judge.
See [results.json](results.json) for case signatures and input hashes, and
`raw/` for the unchanged runner reports and the source-typecheck log annotated
with its observed exit code.

| Boundary | Result | What the control establishes |
| --- | --- | --- |
| External oracle / lawful ingress | PASS | Every record fixture is accepted by the unchanged seam; test-only semantic expectations are never passed as producer fields. |
| Incorrect producer role | RED | A deliberately option-typed explanation retains that role, intervention and model-facing option membership; readiness remains false in this fixture. A matching source quote proves the text, not its role. |
| User-stated versus AI-inferred origin | RED | Identical correctly typed factor records have AI origin through V3 in both briefs; the explicit-user arm loses the expected source quote. This measures V3 origin only. |
| AI explanation | PASS | A connected factor retains exact identity and proposition, has AI origin at V3, and gains no option or intervention. |
| Connected competing explanations | PASS | Both non-action factors and a stated fact's quote survive through canonical serialization and compact/model-facing graph formatting, with no decision/options and comparative readiness false. This does not establish a canonical hypothesis enum or numerical carriage of the fact. |
| Disconnected explanation | RED | Removing only the pricing causal link causes factor `b639f9c9` to disappear at the projector's `unconnected_to_goal` prune, before canonical/context retention. Output guards forbid satisfying the requirement by inventing an incident edge. |
| Genuine alternatives | PASS | The user action and legal AI `option_refinement` retain distinct exact IDs, target-bound synthetic effects 0.8/0.4, origins and option membership; readiness is true. No actual analysis is executed. |

The role/source witnesses expose an insufficient current producer contract.
They are not permanent unchanged unit regressions: rebind them to the approved
producer output when that interface exists. In particular, legitimate role
reclassification changes the current kind-derived node ID. Neither a lexical
projector classifier nor matching a label against the brief is an authorized
way to satisfy those witnesses.

An independent code review of this acceptance instrument identified three
weaknesses: a fabricated reconnection could satisfy retention, origin scope
stopped at V3, and the wrongly typed role fixture could be mistaken for a
permanent regression. All three were corrected and rechecked before banking;
the final execution still measures 4 PASS / 3 RED. This review approves only
the bounded measurement, not an implementation or runtime outcome.

Previously existing focused controls also passed **22/22**: diagnostic-record
consumer 6, future-prompt description continuity 1, records grammar budget 15.
The historical diagnostic test supplies actions and synthetic effect values and
asserts readiness; its header's completed-analysis claim is not established by
the test. This packet does not inherit that claim.

## Replay

From the CEE repository with the frozen lockfile installed:

```sh
pnpm exec vitest run --config vitest.required.config.ts \
  src/cee/draft/records/__tests__/class-b-semantic-boundary.test.ts --maxWorkers 1
```

Expected baseline process exit is **1**, with the three failures above. The
fixture JSON lives beside the records tests under
`fixtures/class-b-semantic-boundary.json`. Its records use only current declared
fields. They are hand-authored acceptance inputs, not provider captures.

The isolated typecheck, expected exit 0, is:

```sh
pnpm exec tsc -p Docs/v5/evidence/class-b-semantic-boundary-20260831/typecheck.config.json
```

The test executes `projectDraftRecords` → real normalization and
`LLMDraftResponse`/`Graph` validation → V3 projection → JSON round-trip and
strict `GraphV3` parsing → strict compact graph ingress →
the real graph formatter and readiness helper. It manually assembles the
formatter input from compactor output. It does not execute actual persistence,
reload, a routed subsequent turn, a provider draw, ranking or a browser journey.

The V1 transform signature excludes a constraint-data branch allowed by the
public graph schema. This fixture helper validates its factor/option data with
the existing schemas and checks the full serialized graph is unchanged before
the transform. It does not cast around that mismatch or silently replace data.
The actual `LLMDraftResponse` output remains the input: the extra `Graph.parse`
validation does not substitute Graph's broader nullable-goal representation.

## Ownership and next implementation boundary

See [INTERFACE.md](INTERFACE.md) for current fields and exact first-loss sites.
Existing `kind`/`claim_kind` already declares role. The missing input is a
source assertion on a claim, separate from support in `basis`. Primary is
allocating the narrow internal records instruction/grammar/seam/projector
contract or an approved existing source signal. No field has been added here.

Existing `node.body` → `NodeV3.description` carriage reaches future prompts,
bounded to 160 characters. The current compact graph separately discards
numberless-node source origin, and the final formatter omits node source quote.
Source binding alone therefore cannot certify future-context source fidelity.
Disconnected retention is a separate first loss and must not be repaired with
fabricated causal links or merely a dropped-record disclosure.

- #1250: salvage discriminating provenance controls and real seam execution;
  do not promote its lexical goal classifier.
- #1238: salvage opposite-direction corpus and legal AI refinement controls;
  do not promote the unmeasured prompt or require generated actions for diagnosis.
- #1268: separate sequencing containment, currently reported BRITTLE by the
  delivery board. No changes or new liveness claim here.
- Baseline lane: owns final-record reconciliation/parse recovery. No overlap.
- Graph Truth: quantity-only hunk remains separate; its conditional adoption
  lease is now held pending proof of same-quantity binding. `basis` support and
  `source_quote` alone do not authorize quantity equality. No quantity,
  label/source restamping, shared schema or pruning edit here.
- System B, Lane C ontology, Canvas and Reasoning: untouched.

Independent liveness evidence at programme-docs commit
`20a5d5743c74f5b24c045a08924f2ee0e48aca56` contains five additional bounded
controls (4 PASS / 1 RED), including the same disconnected-retention first loss
and exact action/baseline effects. It preserves earlier real diagnostic/action
graph captures unchanged and does not recast them as raw records. Its evidence
does not supply provider, persistence or deployed successor proof:
[independent packet](https://github.com/Talchain/olumi-programme-docs/blob/20a5d5743c74f5b24c045a08924f2ee0e48aca56/codex-evidence/classb-records-acceptance-20260831/README.md).

## Required handoff verdict

- **CLASS-B SEMANTIC LOSS FIXED:** NO; first losses isolated, no runtime patch.
- **HYPOTHESIS/OPTION DISTINCTION PROVEN:** PARTIAL; correctly typed connected
  non-actions and real actions remain distinct. Incorrect producer role remains
  unresolved, and non-action factor storage is not a new hypothesis ontology.
- **USER-STATED / OLUMI-INFERRED DISTINCTION PROVEN:** NO; user-stated factor
  origin fails through V3. Future-context source fidelity is also unproven.
- **#1268 RELATIONSHIP:** complementary containment, unchanged here.
- **ANALYSIS BEHAVIOUR:** pure connected framing and the deliberately misfiled
  explanation fixture remain not-ready. The latter still retains the incorrect
  role, intervention and option membership. Genuine supplied/synthetic action
  controls are ready. No completed analysis claim.
- **STILL UNPROVEN:** approved producer contract and generative role quality,
  full source/proposition retention, disconnected canonical retention,
  assumption/evidence/dissent semantics, persistence/reload, subsequent routed
  AI consumption, completed analysis and deployed/mounted behaviour.
- **READY FOR INDEPENDENT REVIEW:** acceptance checkpoint only; no implementation
  successor exists yet. Primary must allocate the missing producer/source seam.
