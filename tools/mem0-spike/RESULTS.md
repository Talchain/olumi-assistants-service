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
_(filled in after the run)_
