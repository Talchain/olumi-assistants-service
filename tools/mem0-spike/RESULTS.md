# Mem0 Context Accelerator — results

Branch `exp/mem0-context-spike-20260929`, based on CEE `staging` @ `5a9c9e0`. SDK `mem0ai@3.3.1`, hosted Platform, verbatim `infer=false`.

## Pre-registered verdict rules
These rules were committed **before** any benchmark run. Arm C (IN-HOUSE + MEM0) is compared with arm B (IN-HOUSE), not with today's control.

**KILL Mem0** if any of the following holds:
- C fixes fewer than 2 of the probes B still fails, **or** cuts repeated and forgotten-fact failures by less than 30% relative to B.
- C states a stale fact as current where B does not.
- Recall leaks an approval, or recall content drives a write.
- Any memory crosses scenarios.
- Fewer than 90% of recalls land inside the 300 ms deadline, which is measured after the state read.

**KEEP** if C beats B on those thresholds **at reply level** (Layer 2), with zero regressions in truth, permission or scope.

**KEEP + REFINE** if the signal is strong but exactly one bounded retrieval or freshness issue remains.

**ESCALATE TO COGNEE** if C matches or beats B on simple recall, but the diagnosis shows the remaining failures are relational or cross-turn structure that neither arm reaches.

**INCONCLUSIVE** if Layer 2 (reply level) could not run.

Arms (`tools/mem0-spike/run-ab.ts`): all three use the same history mechanics, canonical state (Paul's stored graph), loop, tools and instructions.
- **A** CONTROL: today's lane.
- **B** IN-HOUSE: older words paired with the question they answered.
- **C** MEM0: B plus guarded recall.

## Results
Run `spike-2026-09-29T1849`. The raw file is `results-20260929.json`; reproduce with `run-ab.ts --infer-side-run`.
- **Canonical state:** the real `getCanonicalState` over Paul's stored graph (`paul-cbd15f83`).
- **Context assembly:** the real `HistoryStore`, `historyFromDurableTurns` and `runAgentTurn`.
- **Mem0:** real hosted calls.
- **Reply level (Layer 2):** **did not run**, because there is no `OPENAI_API_KEY` in this environment.

### Layer 1: what each arm puts in front of the model

| Probe | Class | A CONTROL | B IN-HOUSE | C MEM0 |
|---|---|---|---|---|
| P1: "moderate", given 10 turns earlier, never written | old history + not captured | ✗ bare "It is a moderate effect." (moderate *what*?) | ✓ paired with "How strongly does the Pro plan price drive…?" | ✓, plus **unreconciled** "you said moderate; the model holds strong" |
| P2: "churn is 5% now, not 7%", never written | not captured | ✓ (in older words) | ✓ | ✓, plus **unreconciled** 5% vs 7% |
| B: 9% corrected to 7% (applied) | correction | ✓ | ✓ | ✓. 9% suppressed (`figure_conflict_revision_moved`); a question quoting 9% is dropped |
| C: other scenario says KESTREL | isolation | ✓ none | ✓ none | ✓ none (filter plus guard re-check) |
| D: "Pro is £49", model moved to £50 | canonical conflict | ✓ | ✓ | ✓. £49 suppressed |
| D2: "really £45 after discount", model £50, same revision | not captured | ✓ (in window) | ✓ | ✓, plus **unreconciled** £45 vs £50 |
| E: "analysis shows £59 wins", run `complete_stale` | analysis state | n/a | n/a | ✓ suppressed (`analysis_claim_not_current`) |
| F: "Yes, apply it" / "Go ahead and save" | consent | n/a | n/a | ✓ suppressed (`approval_not_transferable`); recall can never bind approval |
| S: fact still inside the window | salience | ✓ | ✓ | ✓ (duplicate) |
| R: turn-3 fact, then a deploy reseeds 20 text rows | restart | ✗ | ✗ | ✓ |

**Needed facts present:**
- A: 5 of 7
- B: 6 of 7
- C: 7 of 7

**Unreconciled user statements surfaced:** A 0 of 3, B 0 of 3, C 3 of 3.

**Truth checks for C:**
- 0 stale or conflicting figures in recall
- 0 cross-scenario items
- 0 approvals
- 0 analysis claims

### Performance

| | p50 | p95 | ≤300 ms | ≤400 ms |
|---|---|---|---|---|
| search, rerank **on** (n=20) | 335 ms | 639 ms | 3/20 | 15/20 |
| search, rerank **off** (n=20) | 275 ms | 334 ms | 17/20 | 20/20 |
| search in cases, rerank on (n=10) | 327 ms | 362 ms | 0/10 | 10/10 |
| add, `infer=false` (n=133; off the critical path) | 531 ms | 893 ms | | |

- **Added context:** +1,372 to +1,736 characters per turn (about 350–430 tokens), which is about 14–18% of the model input.
- **The 300 ms deadline** starts after the state read, which runs in parallel with recall. So the real hit rate is higher than the ≤300 ms column. That column assumes no overlap, which makes it a conservative lower bound.
- **Rerank:** measured here, it costs about 60 ms at p50 and about 300 ms at p95. Use rerank off.
- **Sent to Mem0:** 172 test messages, 47,408 characters, across 14 throwaway scenarios. All were deleted after the run.

### Mem0's own extraction (`infer=true`)
- **Latency:**
  - A 2-message probe was searchable after 13–20 s.
  - The B case gave 1 memory after 32 s.
  - The 13–14-message cases gave **0 memories within 120 s**, on two separate runs.

  At conversational cadence, what the user just said is not recallable on the next turn.
- **Corrections:** it did **not** supersede one. "Churn around 9%" and "churn is 7%" were both kept, scored 0.66 and 0.68.
- **Merging:** once it merged the correction and the stale figure into one paraphrase. The guard would have shown that as an unreconciled 9%. Paraphrases are now barred from the discrepancy channel (`paraphrase_conflict_unverifiable`).

  Verbatim storage is the only safe mode, and in that mode Mem0 is a hosted vector store with reranking.

### Verdict: **KILL Mem0**
The decision was taken on the context layer. The reply layer was not run, so no KEEP was possible.

**Pre-registered kill rule met: C fixes fewer than 2 of B's remaining failed probes.** B fails exactly one probe (R-restart), and C fixes that one. That one gap is not a memory problem. It is the Runtime defect already reported: after a deploy, `historyFromDurableTurns` reseeds text only and loses the typed-words and older-words maps. The fix is in-house, by rebuilding the older typed words from `readRecent(scenario, 1000)`.

**Diagnosis ceiling (`DIAGNOSIS.md`).** Of the 11 named failures in Paul's 27–29 Sep tests:
- none is directly reachable by recall;
- about 3 are partly reachable, and none at the root cause.

The failures are:
- 4 × user fact not captured canonically;
- 4 × analysis-state confusion;
- 2 × capability over-promise;
- 1 × consent loop;
- 1 × restart-loss mechanism.

**Other considerations:**
- Latency is borderline: rerank off only just fits the deadline.
- Extraction mode is unusable.
- It adds an external data-transfer dependency.

**Not ESCALATE TO COGNEE.** The remaining failures are canonical capture, consent and analysis-state truth, not relational memory. A graph-memory vendor would hit the same ceiling. The harness is kept, so any candidate can run the same 10 cases (`run-ab.ts`).

**What would overturn this:** a reply-level run where C beats B on at least 2 probes, with zero truth regressions. To run it:
```
set -a; . /root/.config/olumi-mem0.env; set +a; OPENAI_API_KEY=… MEM0_TELEMETRY=false pnpm exec tsx tools/mem0-spike/run-ab.ts --layer2 --n=3
```

### Keep: vendor-independent pieces to hand to their owners, not to merge from this branch
1. **Q→A pairing of older user words** (arm B, `history-store.ts`, flag `CEE_CONTEXT_INHOUSE_QA_PAIRING`).
   - Fixes P1 at zero latency, for about 136 characters.
   - Owner: AI Conversation / OpenAI Runtime.
2. **Durable reseed of older typed words** after a deploy. This closes the only gap that Mem0 filled.
   - Owner: OpenAI Runtime, alongside the tool-result-loss P0.
3. **The deterministic "unreconciled user statement" channel** (`memory-guard.ts`).
   - A figure or strength the user stated that the model does not hold, surfaced as "ask, never assume" only while the graph revision is unchanged.
   - It surfaced 3 of 3 not-captured facts (Paul classes #2, #4 and #8). It can run over the user's own durable words, with no vendor.
   - Owners: Canonical State / AI Experience.
