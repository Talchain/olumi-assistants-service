# Runtime/Context restart recovery — 4 October 2026

Emergency WIP backup requested by Paul. No merge, deployment or release approval. All source and evidence are preserved in this branch; no dependency on temporary paths is required to recover authored work.

## Source and ownership

Current authored source commit: `22362b543ad39bebfcdcfa5da3a69cfe7690ad5f`, based on immutable CEE `3ddcea18fe54ec14fa9085171f1e4b3c08d53baa`. Four authored files carry selected-Run change facts into saved Agent context and add adversarial route/helper tests. The shared `runtime/agent-capabilities.ts` file is deliberately unchanged: DL owns that B3 seam. Its required 24-line integration is saved as `DL-agent-capabilities.patch`; do not claim the disjoint commit alone is the complete repair. `COMPOSED.patch` preserves the complete candidate, verified as tree `746a38dc855bf7c87cee22f18734d59a0b4e92f0`.

DL lease: https://github.com/Talchain/olumi-programme-docs/issues/87#issuecomment-5975511134
Verified author handback: https://github.com/Talchain/olumi-programme-docs/issues/87#issuecomment-5975622354
Executor chat: `01a0ff01-4aa4-7982-9f2e-891fac9475ab` (Implement Olumi AI Experience). This lane: `01a0fec3-e5d0-7812-b70e-8104427c501a` (B3 model fidelity delta).

## Evidence and limits

Actual baseline RED: 5 failures / 42 passes. Fully composed offline verification: 71 passes, zero failures, four files, one worker. Missing-carrier and stale-carry mutants each killed (4 failures / 44 passes). Focused lint and diff checks passed. These are stubbed route/unit observations, not browser, persistence, paid-provider, full gate, independent HIGH review or deployment evidence. Full gate and review remain required before normal publication/integration/release. Emergency WIP push saves work only.

Earlier L1 source was merged/served through PR2541, squash `880b6487b381ed0877656ca6a17a385c61a1440f`. Cost, quality, total calls and speed remain unknown pending matched Harness provider_trace evidence. Old2529 is closed as superseded; surviving selected-Run carrier fix is the current lane. No new L2 work is authorised by this save. Repair-served and demonstration remain separate milestones; constraint recurrence remains inconclusive without a matched isolated trial.

## Recovery

`runtime-context-evidence.tar.gz` contains the entire 151-file durable lane bank, including comprehensive CHECKPOINT.json, original L1 patches, review receipts, proof logs, source census, current delta configurations and overlays. `evidence-manifest.json` records every original bank file and SHA256. `lane-history.bundle` preserves every existing local lane branch and its reachable commit history. Readable current patches and handoffs are also beside this file. Original user brief and programme cursors are retained here.

Clone this GitHub WIP branch, extract the evidence archive into a durable working directory, and use the bundle to restore any historical lane branch if needed. Verification configurations contain original absolute paths; update those paths when relocating. Dependency caches/node_modules are excluded and can be recreated from the lockfile. No secret environment files are included. Consult programme #85/#87 for current ownership/slot before resuming; serving identities in old evidence are historical, not a claim of current readiness.

## Jobs and next action

Running lane jobs: none. Reviewer buddy is quiescent; overnight automation was already paused. Resume only through existing DL/Executor ownership: integrate the banked shared hunk, run required gates and independent reviews, then authorised mergegate/deployment and joined journey evidence. This restart operation starts no development, merges or deployments.
