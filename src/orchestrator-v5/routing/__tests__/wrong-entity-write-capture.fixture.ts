/**
 * LIVE CAPTURE — deployed CEE staging `a606a99e`, 14 Sep 2026.
 *
 * ⚠ THIS IS A RECORD OF WHAT THE PRODUCT ACTUALLY DID, NOT A FIXTURE TO KEEP
 * CURRENT (CLAUDE.md trap 14b). It is append-only: add captures beside it,
 * never rewrite these bytes to match later behaviour. It is a PROJECTION of
 * the captured turn — nodes unrelated to the named option and factor were
 * dropped, and purely descriptive fields (`reasoning`, `display_value`,
 * `source_quote`, `uncertainty_drivers`, edge `origin`/`provenance_display`)
 * were pruned — but every field the predicates under test read is verbatim.
 *
 * THE TURN, end to end:
 *   scenario   fcacd799-20e7-486e-becd-9b240bd8809e
 *   message    "Change the Hold Price at £49 (Status Quo) option's Pro Plan Monthly Price to 79%"
 *   reply      "Updated edge from Hold Price at £49 (Status Quo) to Pro Plan Monthly Price"
 *   graph_hash 0965274d1b750b7d -> b3b0aef4e78983f6
 *
 * The user named an OPTION and asked for its effect on a FACTOR. What landed
 * was neither: edge `32b7e30c -> 6d9a37f3` had its
 * `exists_probability` moved 1 -> 0.79 — i.e. "this causal link exists with
 * 79% probability", a different claim from "this option's effect is 0.79" —
 * and `32b7e30c`.interventions[`6d9a37f3`] never moved
 * (0.49 before, 0.49 after). The reply reported success.
 */
export const WRONG_ENTITY_WRITE_CAPTURE = {
  "provenance": {
    "source": "live capture, CEE staging a606a99e, 2026-09-14",
    "scenario_id": "fcacd799-20e7-486e-becd-9b240bd8809e",
    "turn_message": "Change the Hold Price at £49 (Status Quo) option's Pro Plan Monthly Price to 79%",
    "option_id": "32b7e30c",
    "option_label": "Hold Price at £49 (Status Quo)",
    "factor_id": "6d9a37f3",
    "factor_label": "Pro Plan Monthly Price",
    "assistant_text": "Updated edge from Hold Price at £49 (Status Quo) to Pro Plan Monthly Price",
    "pre_graph_hash": "0965274d1b750b7d",
    "post_graph_hash": "b3b0aef4e78983f6"
  },
  "before": {
    "nodes": [
      {
        "id": "32b7e30c",
        "kind": "option",
        "label": "Hold Price at £49 (Status Quo)",
        "interventions": {
          "6d9a37f3": {
            "value": 0.49,
            "raw_value": 49,
            "unit": "£",
            "source": "brief_extraction",
            "target_match": {
              "node_id": "6d9a37f3",
              "match_type": "exact_id",
              "confidence": "high"
            },
            "value_confidence": "high"
          },
          "a9f8b0b7": {
            "value": 0.5,
            "raw_value": 5,
            "source": "cee_hypothesis",
            "target_match": {
              "node_id": "a9f8b0b7",
              "match_type": "exact_id",
              "confidence": "high"
            },
            "value_confidence": "low"
          }
        },
        "is_baseline": true,
        "provenance": "ai_inferred"
      },
      {
        "id": "6d9a37f3",
        "kind": "factor",
        "label": "Pro Plan Monthly Price",
        "observed_state": {
          "value": 0.49,
          "baseline": 49,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 49,
          "cap": 100,
          "extractionType": "explicit",
          "factor_type": "price"
        },
        "category": "controllable",
        "scale_frame": 100,
        "prior": {
          "distribution": "uniform",
          "range_min": 0,
          "range_max": 1,
          "prior_is_unquantified": true
        },
        "provenance": "ai_inferred"
      },
      {
        "id": "94fa174b",
        "kind": "outcome",
        "label": "Monthly Recurring Revenue",
        "provenance": "ai_inferred"
      },
      {
        "id": "e05f0bdb",
        "kind": "decision",
        "label": "Question",
        "provenance": "ai_inferred",
        "label_placeholder": true
      },
      {
        "id": "ed0b40c7",
        "kind": "goal",
        "label": "Increase Revenue",
        "provenance": "from_brief",
        "label_authored": true
      }
    ],
    "edges": [
      {
        "from": "32b7e30c",
        "to": "6d9a37f3",
        "strength": {
          "mean": 1,
          "std": 0.01
        },
        "exists_probability": 1,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        }
      },
      {
        "from": "6d9a37f3",
        "to": "94fa174b",
        "strength": {
          "mean": 0.40714285714285714,
          "std": 0.0977142857142857
        },
        "exists_probability": 0.8,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        },
        "validation": {
          "status": "agreed",
          "contested_reasons": [],
          "pass1": {
            "strength_mean": 0.40714285714285714,
            "strength_std": 0,
            "exists_probability": 0
          },
          "pass2": {
            "strength_mean": 0.2,
            "strength_std": 0.1,
            "exists_probability": 0.99,
            "basis": "structural_inference",
            "needs_user_input": false,
            "lint_corrected": false
          },
          "pass2_adjusted": {
            "strength_mean": 0.31000000000000005,
            "strength_std": 0.2,
            "exists_probability": 0.84
          },
          "bias_correction": {
            "strength_mean_offset": 0.11000000000000004,
            "strength_std_offset": 0.1,
            "exists_probability_offset": -0.15000000000000002
          },
          "max_divergence": 0.6666666666666666,
          "distance_to_goal": 1,
          "sign_unstable": false,
          "pass1_missing": false,
          "pass2_missing": false,
          "evoi_rank": null,
          "evoi_impact": null,
          "was_shown": false,
          "user_action": "pending",
          "resolved_value": null,
          "resolved_by": "default",
          "validation_lint_log": []
        }
      },
      {
        "from": "94fa174b",
        "to": "ed0b40c7",
        "strength": {
          "mean": 0.9,
          "std": 0.21599999999999997
        },
        "exists_probability": 0.8,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        },
        "validation": {
          "status": "contested",
          "contested_reasons": [
            "raw_magnitude"
          ],
          "pass1": {
            "strength_mean": 0.9,
            "strength_std": 0,
            "exists_probability": 0
          },
          "pass2": {
            "strength_mean": 0.5625,
            "strength_std": 0.05,
            "exists_probability": 0.99,
            "basis": "structural_inference",
            "needs_user_input": false,
            "lint_corrected": true
          },
          "pass2_adjusted": {
            "strength_mean": 0.6725000000000001,
            "strength_std": 0.15000000000000002,
            "exists_probability": 0.84
          },
          "bias_correction": {
            "strength_mean_offset": 0.11000000000000004,
            "strength_std_offset": 0.1,
            "exists_probability_offset": -0.15000000000000002
          },
          "max_divergence": 0.6666666666666666,
          "distance_to_goal": 0,
          "sign_unstable": false,
          "pass1_missing": false,
          "pass2_missing": false,
          "evoi_rank": null,
          "evoi_impact": null,
          "was_shown": false,
          "user_action": "pending",
          "resolved_value": null,
          "resolved_by": "default",
          "validation_lint_log": [
            {
              "code": "LINT_BUDGET_RESCALE",
              "edge_key": "94fa174b->ed0b40c7",
              "before": 0.9,
              "after": 0.5625
            }
          ]
        }
      },
      {
        "from": "e05f0bdb",
        "to": "32b7e30c",
        "strength": {
          "mean": 1,
          "std": 0.01
        },
        "exists_probability": 1,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        }
      }
    ]
  },
  "after": {
    "nodes": [
      {
        "id": "32b7e30c",
        "kind": "option",
        "label": "Hold Price at £49 (Status Quo)",
        "interventions": {
          "6d9a37f3": {
            "unit": "£",
            "value": 0.49,
            "source": "brief_extraction",
            "raw_value": 49,
            "target_match": {
              "node_id": "6d9a37f3",
              "confidence": "high",
              "match_type": "exact_id"
            },
            "value_confidence": "high"
          },
          "a9f8b0b7": {
            "value": 0.5,
            "source": "cee_hypothesis",
            "raw_value": 5,
            "target_match": {
              "node_id": "a9f8b0b7",
              "confidence": "high",
              "match_type": "exact_id"
            },
            "value_confidence": "low"
          }
        },
        "is_baseline": true,
        "provenance": "ai_inferred"
      },
      {
        "id": "6d9a37f3",
        "kind": "factor",
        "label": "Pro Plan Monthly Price",
        "observed_state": {
          "value": 0.49,
          "baseline": 49,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 49,
          "cap": 100,
          "extractionType": "explicit",
          "factor_type": "price"
        },
        "category": "controllable",
        "scale_frame": 100,
        "prior": {
          "distribution": "uniform",
          "range_min": 0,
          "range_max": 1,
          "prior_is_unquantified": true
        },
        "provenance": "ai_inferred"
      },
      {
        "id": "94fa174b",
        "kind": "outcome",
        "label": "Monthly Recurring Revenue",
        "provenance": "ai_inferred"
      },
      {
        "id": "e05f0bdb",
        "kind": "decision",
        "label": "Question",
        "provenance": "ai_inferred",
        "label_placeholder": true
      },
      {
        "id": "ed0b40c7",
        "kind": "goal",
        "label": "Increase Revenue",
        "provenance": "from_brief",
        "label_authored": true
      }
    ],
    "edges": [
      {
        "from": "32b7e30c",
        "to": "6d9a37f3",
        "strength": {
          "mean": 1,
          "std": 0.01
        },
        "exists_probability": 0.79,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        }
      },
      {
        "from": "6d9a37f3",
        "to": "94fa174b",
        "strength": {
          "mean": 0.40714285714285714,
          "std": 0.0977142857142857
        },
        "exists_probability": 0.8,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        },
        "validation": {
          "pass1": {
            "strength_std": 0,
            "strength_mean": 0.40714285714285714,
            "exists_probability": 0
          },
          "pass2": {
            "basis": "structural_inference",
            "strength_std": 0.1,
            "strength_mean": 0.2,
            "lint_corrected": false,
            "needs_user_input": false,
            "exists_probability": 0.99
          },
          "status": "agreed",
          "evoi_rank": null,
          "was_shown": false,
          "evoi_impact": null,
          "resolved_by": "default",
          "user_action": "pending",
          "pass1_missing": false,
          "pass2_missing": false,
          "sign_unstable": false,
          "max_divergence": 0.6666666666666666,
          "pass2_adjusted": {
            "strength_std": 0.2,
            "strength_mean": 0.31000000000000005,
            "exists_probability": 0.84
          },
          "resolved_value": null,
          "bias_correction": {
            "strength_std_offset": 0.1,
            "strength_mean_offset": 0.11000000000000004,
            "exists_probability_offset": -0.15000000000000002
          },
          "distance_to_goal": 1,
          "contested_reasons": [],
          "validation_lint_log": []
        }
      },
      {
        "from": "94fa174b",
        "to": "ed0b40c7",
        "strength": {
          "mean": 0.9,
          "std": 0.21599999999999997
        },
        "exists_probability": 0.8,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        },
        "validation": {
          "pass1": {
            "strength_std": 0,
            "strength_mean": 0.9,
            "exists_probability": 0
          },
          "pass2": {
            "basis": "structural_inference",
            "strength_std": 0.05,
            "strength_mean": 0.5625,
            "lint_corrected": true,
            "needs_user_input": false,
            "exists_probability": 0.99
          },
          "status": "contested",
          "evoi_rank": null,
          "was_shown": false,
          "evoi_impact": null,
          "resolved_by": "default",
          "user_action": "pending",
          "pass1_missing": false,
          "pass2_missing": false,
          "sign_unstable": false,
          "max_divergence": 0.6666666666666666,
          "pass2_adjusted": {
            "strength_std": 0.15000000000000002,
            "strength_mean": 0.6725000000000001,
            "exists_probability": 0.84
          },
          "resolved_value": null,
          "bias_correction": {
            "strength_std_offset": 0.1,
            "strength_mean_offset": 0.11000000000000004,
            "exists_probability_offset": -0.15000000000000002
          },
          "distance_to_goal": 0,
          "contested_reasons": [
            "raw_magnitude"
          ],
          "validation_lint_log": [
            {
              "code": "LINT_BUDGET_RESCALE",
              "after": 0.5625,
              "before": 0.9,
              "edge_key": "94fa174b->ed0b40c7"
            }
          ]
        }
      },
      {
        "from": "e05f0bdb",
        "to": "32b7e30c",
        "strength": {
          "mean": 1,
          "std": 0.01
        },
        "exists_probability": 1,
        "effect_direction": "positive",
        "provenance": {
          "source": "cee_hypothesis"
        }
      }
    ]
  }
} as const;
