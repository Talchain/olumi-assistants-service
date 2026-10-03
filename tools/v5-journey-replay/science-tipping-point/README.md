# R3 science tipping-point wire replay

Bounded acceptance support for SCI-HERO. This uses two existing served fixtures;
it neither computes science nor calls a provider, edits a scenario, or drives a browser.

Run from the CEE repository root with Node 20, without installing dependencies:

```sh
node --test tools/v5-journey-replay/science-tipping-point/replay.test.mjs
node tools/v5-journey-replay/science-tipping-point/replay.mjs served-price-tipping-point
node tools/v5-journey-replay/science-tipping-point/replay.mjs served-no-signal
node tools/v5-journey-replay/science-tipping-point/replay.mjs served-price-tipping-point /absolute/path/r3-capture.json
```

The first two replay commands only admit original fixture bytes and print READY.
They do not show a delivered product journey. Tests use constructed recordings
and return INSTRUMENT-SELFTEST. Only a supplied `captured-wire` recording can
return WIRE-REPLAY-CHECKED. R3 separately owns semantic and browser acceptance.

## Source cases

`cases.json` pins SHA256s of existing repository fixtures at CEE752c487.
The read-at SHA is a repository provenance pin, not a claim about either
fixture's original served build. Original capture provenance remains in its file.

- Positive: `pro_plan_price`, current 49, exact supplied threshold 55.76 GBP/month.
  It is an option's controllable price setting. Explain a model-relative crossing;
  do not call it missing evidence, EVPPI, or the highest-value investigation.
  The approved test edit is 56 GBP/month, across that threshold. Quoting 55.76
  exactly does not mean editing exactly to the boundary.
- No-signal: the original Paul17d1cd3a run has row-attested structurally invariant
  flip rows and zero/below-resolution EVPPI. Explain what this run did not establish;
  offer no fabricated science-backed value action. Ordinary discussion is allowed.
- Fresh unseen control: NOT PREPARED. These known regression captures cannot
  count as unseen. No independent input was supplied by the existing harness.

## R3 capture contract

Record existing requests and responses in order. Remove credentials and personal
text that is irrelevant to the witness; retain graph IDs, values, units, provenance,
result/science data and Run currentness. Do not modify product wires to fit a pass.

The JSON envelope has `case_id`, `evidence_kind: "captured-wire"`, `scenario_id`,
`configuration`, and `steps`. Positive captures name the actual `edit_door`:
`agent-proposal` or `model-factor-editor`. Configuration records 40-character commit SHAs
under `builds.{ui,cee,plot,isl}`, plus actual `model`, `effort`, `prompt_hash`,
`schema_version`, and `flags`. The checker checks presence; R3 verifies these
pins against deployment/serving records. A claimed SHA is not authenticated by JSON.

Each server step has `stage`, matching `scenario_id`, actual HTTP `status`, and
original parsed `response`; action steps also have original parsed `request`.
The Model editor's local `refine` step uses `status:null`, with no invented HTTP
request/response. Its local review/Confirm and rerun carry `browser_action` recorder
metadata: canonical control name (`Review change`, `Confirm`, `Run analysis`) and
`artifact` reference to the actual witness. R3 validates that reference and the
actual visible control; this checker cannot authenticate browser metadata.
Canonical read responses retain `graph`, `graph_hash`, `analysis_result`, and
`current_read` exactly as returned. The selected current result must agree with
the existing public carrier; historical results are insufficient.

Positive steps:

1. `before_read`: selected current Run, price 49, supplied science for this factor.
2. `explain`: actual assistant text names Pro plan price and exact 55.76 GBP/month,
   qualifies it to the model, and does not mutate the model.
3. `refine`: invoke the existing price refinement. For an Agent proposal, set
   `target_pointer` to its actual request ID field, e.g. `/…/factor_id`, and retain
   the offered bound approval. For the Model editor, record local Review change
   and its witness reference; the canonical read must still show 49.
4. `before_approval_read`: canonical model remains unchanged.
5. `approve`: for an Agent/held proposal, send its offered `request.chip.id`
   (`agent-approve-proposal:prop_…`, existing wrapped `gmh_…`, or direct `gmh_…`).
   For Model→Factors→Change→Review change→Confirm, preserve the real HTTP request;
   `event_pointer` identifies its existing `factor_value_edit` event (e.g.
   `/system_event` or the actual event-array entry). Its payload must carry
   `target_id:pro_plan_price`, `field:value`, `raw_value:56`, `unit:GBP/month`.
   Record the explicit Confirm witness. No server proposal is required for this
   existing local-review-then-dispatch door.
6. `stale_read`: approved 56 GBP/month, `user_…` provenance, new graph hash,
   `complete_stale` old Run and null current result.
7. `rerun`: send the actual offered Agent `request.chip` with `action_type:run_analysis`,
   or record the Model editor's explicit existing Run analysis control/witness and
   actual HTTP request. The new canonical current Run is required in both cases.
8. `after_run_read`: new current Run with the approved model preserved.
9. `cold_read`: after cold browser reload, record the canonical read; selected
   Run timestamp/hashes/result and model must agree with the post-run read.

No-signal steps are `before_read`, `explain`, `cold_read`. On the explanation
step R3 records `science_value_offer_ids` from actual offered IDs, categorising
only offers claiming a measured science priority. It must be empty here.
This metadata requires human semantic review; a caller's empty list does not
prove an honest response. The checker applies only narrow discriminatory prose
guards, not a general language quality or scientific-validity judgement.

## Integration dependencies and claim limits

Existing SCI-HERO typed fact/coaching, Context follow-up, Shared Data permissions,
and the existing factor refinement/approval surface retain their owners. The
existing keep-current-estimate chip alone does not establish an across-threshold edit.
The served UI a521c6b7 already dispatches the Model editor's approved number through
`useModelEditAuthority.proposeFactorValue` and `buildFactorValueEditEvent`; those
actual sources establish the event contract, not a new product door. If the
real product cannot offer the refinement, record the first failing boundary and
leave this case blocked. Never substitute a direct API edit or synthetic recording.

Run ID is not invented: this checks the existing public selected-Run computed_at
and canonical analysis hashes. It does not authenticate screenshots, prove browser
events, verify deployment SHAs, decide winner licences, assert an alternative
winner, calculate a crossing, or demonstrate a fresh unseen case. Paid/browser
acceptance stays with R3, with the immutable served tuple and original capture.
