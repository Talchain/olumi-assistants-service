# FIX-1 basis-text class audit

`event_risk_basis_text` is a readable CEE-authored companion of a valid Olumi occurrence on a risk node. It is neither an independent occurrence nor a numeric warrant token. `readOlumiEventRiskBasisText` in `src/schemas/event-risk.ts` owns the common companion-validity gate.

| Site | Decision and reason |
| --- | --- |
| `graph-management/field-safety.ts` | Same CEE-owned write class as `event_risk`. Added to `PIPELINE_OWNED_ROOTS`. Update-field, nested object and add-node payloads refuse it as `PIPELINE_OWNED_FIELD`; no patch/edit producer can author it. |
| `schemas/value-warrant-guard.ts`, CEE occurrence `p_low` | Readable textual companion supports the CEE Olumi writer's attestation. Updated adjudication to name the Olumi admission, CEE ownership and trusted register path. Do not add the text as a numeric leaf or generic `WARRANT_TOKENS` member. |
| `schemas/value-warrant-guard.ts`, CEE occurrence `p_high` | Same decision as `p_low`, inherited via existing adjudication reference. No detector expansion. |
| `schemas/value-warrant-guard.ts`, CEE horizon `months` | The numeric horizon remains warranted by its months unit and the valid occurrence basis; text is not a separate duration/warrant. |
| `schemas/value-warrant-guard.ts`, CEE mitigation `occurrence_reduction` | Fraction remains warranted by its existing event occurrence block, not by the textual companion. |
| `schemas/value-warrant-guard.ts`, contract occurrence `p_low` | Same attestation semantics, but the vendor block declares no companion. Do not pretend text is in the strict event_risk block or vendor contract. |
| `schemas/value-warrant-guard.ts`, contract occurrence `p_high` | Same decision as contract `p_low`. |
| `schemas/value-warrant-guard.ts`, contract horizon `months` | Same unit/basis semantics as CEE horizon; no textual numeric field. |
| `schemas/value-warrant-guard.ts`, contract mitigation `occurrence_reduction` | Same fraction/basis semantics as CEE mitigation; no textual numeric field. |
| `cee/transforms/schema-v3.ts` | Treat as a dependent occurrence companion at field-by-field egress. Forward only validated risk occurrence; forward text only when the shared gate accepts an Olumi occurrence. Orphan/malformed/non-risk/user/reference text disappears. |
| `routes/assist.v1.scenario-graph-register.ts` | CEE-only authorship. Strip client input text. The same existing register write accepts a construction's exact scenario/node/occurrence/text through an in-process AsyncLocalStorage grant. Preserve an unchanged stored valid Olumi occurrence's own text. User conversion or changed occurrence clears it. No request body/header confers trust. |
| `orchestrator/tools/analysis-ready-helper.ts` | Keep independent of numeric readiness. This reader tests `EventRiskV1` to excuse today's level; basis text alone must not qualify or change readiness. No sidecar reader exists here. |
| `agent-lane/disclosure.ts` | No new sidecar reader. It consumes code-authored outcome loss sentences, not raw node warrants. The interim sentence remains a code-authored disclosure. |
| `agent-lane/proposal-reply.ts` | No Olumi sidecar copying. Its add-risk likelihood is the existing held user figure and user quote; readable Olumi text cannot create a user claim. |
| `agent-lane/proposal-object/record.ts` | No raw sidecar reader. The card's existing user-event member is validated before its likelihood line. It does not copy arbitrary graph text. |
| `goal-target/held-user-links.ts` | No sidecar reader. The block's mitigation factor ids affect held-link semantics; textual basis must not alter a link, its size, existence or coverage. |
| `handlers/gm-held-execute.ts` | No sidecar writer. The existing user-event stamp only applies to new held risk nodes after re-referee; producer arguments are screened upstream. It creates no event-risk edit door on an existing risk. |
| `system-events/dispatch.ts` | No sidecar wire/hold member. Existing validated user-event input and member are carried; new occurrence basis text stays out of link objects and user holds. |
| `agent-lane/admit-model.ts` | Root-owned: dependent companion must be dropped/ignored for absent, invalid, non-Olumi occurrence. It cannot independently become admitted node metadata. |
| `agent-lane/olumi-event-risk-draft.ts` | Root-owned: admission writes text only on a valid Olumi occurrence; previous/orphan text is removed and conversion to basis user clears it. |
| `agent-lane/stated-event-risk-draft.ts` | Root-owned: the later shared user hold must clear the old Olumi sidecar when replacing an occurrence with basis user. |
| `attribution.ts` | Root-owned: display only via the shared gate; invalid/orphan/user/reference text earns no displayed basis. |
| `schemas/cee-v3.ts` | Preserve its plain `z.object` shape for existing introspection and ownership derivation. Declare the readable text, but companion validity is enforced by admission/ingress/egress/display readers; a parsed orphan is ignored and never displayed. |

The review's 16 textual `event_risk` occurrences in `value-warrant-guard.ts` cover eight adjudication entries plus their explanatory references; all eight entries and the referred-to shared decisions are accounted for above. No event-risk field is added to a link schema or object.

The AsyncLocalStorage grant snapshots occurrence data, binds the exact node and text, and closes in `finally`, including async descendants inherited before completion. This follows the existing `approved-adoption-context.ts` and `stated-link-band-context.ts` precedent and wraps the one existing construction register dispatch; it is not a new writer.
