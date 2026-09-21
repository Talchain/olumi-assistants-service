/**
 * HISTORIC CAPTURE — DO NOT EDIT TO MATCH A NEW HEAD.
 *
 * The finaliser's output for the fixed healthy-turn input in
 * `scripts/capture-finalised-healthy-turn.ts`, MEASURED ON THE PR BASE:
 * a separate fresh blobless clone at
 * `bacf35d56f1ef2e84e4e54eea1b4cd309cf4f783` (staging tip), pinned to
 * `@talchain/schemas` 0.44.0 — i.e. a tree containing NEITHER the vendor bump
 * NOR the emission. Produced by running that script there and normalising the
 * one non-deterministic member (`analysis_ready.computed_at`).
 *
 * WHY IT IS HERE. The claim the emission has to prove is "a consumer that
 * ignores `analysis_state` sees byte-identical behaviour". A fixture written
 * by the lane that wrote the code proves only that the two agree. This one was
 * measured on a tree that does not contain the change, which is the only place
 * the claim can be falsified. The comparator carries a positive control (a
 * one-character mutation of this object must FAIL the comparison) so a
 * degenerate deep-equal cannot pass by testing nothing.
 *
 * If a future change makes the head diverge from this object by anything other
 * than the single `analysis_state` key, that is a FINDING — the change is not
 * additive — not a reason to re-capture. Re-capture only when the BASE moves,
 * and record the new base sha here when you do.
 */
export const BASE_FINALISED_HEALTHY_TURN: Readonly<Record<string, unknown>> = {
  "response_version": 2,
  "assistant_text": "Hiring a tech lead scores highest on the modelled goal.",
  "stage_indicator": "analyse",
  "blocks": [
    {
      "type": "analysis_result",
      "summary": "Comparison complete",
      "leading_option_id": "opt_tech_lead",
      "enrichment": {
        "robustness": {
          "level": "high",
          "near_tie": {
            "is_tie": false,
            "gap": 0.19
          }
        }
      }
    }
  ],
  "suggested_actions": [],
  "insights": [],
  "analysis_ready": {
    "status": "ready",
    "goal_node_id": "goal_productivity",
    "options": [
      {
        "option_id": "opt_status_quo",
        "label": "Make No New Hire (Status Quo)",
        "status": "ready",
        "interventions": {
          "fac_role_type": 0,
          "fac_headcount": 0
        },
        "is_baseline": true
      },
      {
        "option_id": "opt_tech_lead",
        "label": "Hire a Tech Lead",
        "status": "ready",
        "interventions": {
          "fac_role_type": 1,
          "fac_headcount": 0.2
        }
      }
    ],
    "computed_at": "<normalised>",
    "freshness": "fresh",
    "freshness_reason": "graph_hash_match",
    "graph_hash_at_run": "abc123",
    "current_graph_hash": "abc123"
  },
  "graph_hash": "abc123"
};
