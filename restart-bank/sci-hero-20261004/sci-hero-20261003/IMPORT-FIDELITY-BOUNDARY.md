# SCI-HERO import fidelity boundary — source evidence only

Exact served UI: 622ac23570690d0056a45bbc152c49e44d2b262d.

B1 identified the existing model-title menu → Import scenario (.olumi.json), appending a new UUID record rather than deleting the old model. This candidate has not been exercised by SCI-HERO. Paid calls remain 0/11; no import, graph edit or Run occurred.

## Decisive source finding

`src/canvas/store/scenarios.ts::importScenarioFromFile` lines 480–528 passes name, nodes, edges and template provenance into `createScenario`, but omits the supplied `graph.goal_constraints`. `createScenario` lines 296–343 already accepts `goalConstraints`; omission is in this import caller. `loadScenario` lines 6748–6757 in the canvas store then restores `readPersistedGoalConstraints(scenario.graph)` and explicitly clears absent limits.

The unchanged positive seed has 14 nodes/24 edges and its two hard limits only at `graph.goal_constraints`: six_month_decision_spend <= 20000 GBP and monthly_churn <= 4 %. Ordinary import therefore drops those supplied limits. This is a source-proven loading fidelity gap, not an observed science or served acceptance failure.

`scenarios.ts::reseedIds` lines 142–166 also replaces node IDs and edge endpoints without rewriting node.data. Actual original UI export stores option `interventions`, `interventionKeys` and nested `target_match.node_id` inside node.data. Those embedded references would remain old IDs. Their ultimate effect on current science remains untraced; do not claim a paid scientific failure from this finding.

Source copies supplied by B1: /private/tmp/semantic-spine-served-ui-5.tsx (scenarios) and /private/tmp/semantic-spine-served-ui-6.tsx (canvas store). No new converter/IDs/API envelope or historical analysis result was invented. Source-supported existing normalisePersistedGraph is the GraphV3-to-canvas loader, but conversion alone cannot repair the importer losses above.

## Delivery boundary

The 895 witness pin remains RELEASED. Existing Delivery Executor retains Shared Data+B1 join/release control. SCI-HERO does not create another UI writer or block that train while validating setup. Need one source-validated faithful loading door, or an existing-owner repair/restoration that retains both hard limits and option/factor references, before spending the bounded paid witness. Any legitimate explicit UI restoration must be captured and compared with the supplied model before Run.

Morning remains PARTIAL; no dedicated positive/control canonical URL and no JOURNEY-WITNESSED claim. Fresh selected Run factor, threshold, direction and unit govern actual editing; 55.76/56 are conditional original positive expectations, never injected historical gold.
