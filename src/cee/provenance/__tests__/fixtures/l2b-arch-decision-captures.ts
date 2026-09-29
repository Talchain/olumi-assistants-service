/**
 * OUTSIDE CORPUS — 26 fresh guest sessions captured from DEPLOYED STAGING
 * (CEE `8e3ad91`, 11 August 2026), the raw evidence behind
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/L2B-VARIANCE.md`
 * §3.1. NOT AUTHORED HERE (CLAUDE.md trap 16-inverse: a fixture you wrote
 * yourself is not evidence about the wire; trap 22: a corpus drawn from the
 * author's head cannot see the class the author did not imagine).
 *
 * Three arms over three briefs (A = control ×12, D1 = +one benefit fact ×8,
 * D2 = +one licence fact ×6). 23 of the 26 sessions produced a draft; the
 * three that did not are kept with `drafted: false` because a corpus that
 * silently drops its failures is a corpus that cannot report a draft-failure
 * rate.
 *
 * ⚠ APPEND-ONLY (CLAUDE.md trap 14b). These rows are a RECORD OF WHAT THE
 * DEPLOYED BUILD ACTUALLY EMITTED on a dated build. Rows may be added; no row
 * may be edited to match a later behaviour. If the product changes, that is a
 * finding to report, not an edit to make here.
 *
 * Reduced to the fields the money invariant reads — factor
 * `observed_state` verbatim (including `cap`) and each option's
 * intervention LEVELS — plus the brief text each was drafted from.
 */

export interface CapturedFactor {
  readonly id: string;
  readonly label: string;
  readonly observed_state: Record<string, unknown> | null;
}

export interface CapturedOption {
  readonly id: string;
  readonly label: string;
  readonly interventions: Record<string, number>;
}

export interface CapturedRun {
  readonly arm: string;
  readonly run: string;
  readonly brief: string;
  readonly drafted: boolean;
  readonly factors?: readonly CapturedFactor[];
  readonly options?: readonly CapturedOption[];
}

export const L2B_CAPTURED_RUNS: readonly CapturedRun[] = [
  {
    "arm": "A",
    "run": "r1",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "User Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 35,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 24000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_switch_cost": 0.75,
          "fac_training_cost": 0.6,
          "fac_crm_capability": 0.8
        }
      },
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Core Sales Team",
        "interventions": {
          "fac_switch_cost": 0.35,
          "fac_training_cost": 0.25,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r10",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Capability Level",
        "observed_state": {
          "value": 0.35,
          "unit": "%",
          "source": "cee_inference",
          "raw_value": 35,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 24000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate in 6 Months",
        "interventions": {
          "fac_switch_cost": 0.25,
          "fac_training_cost": 0.1,
          "fac_crm_capability": 0.45
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.75,
          "fac_training_cost": 0.6,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r11",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_annual_licence",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.35,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate in 6 Months",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_crm_capability": 0.55
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r12",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "Sales Team Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.35,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 24000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate in 6 Months",
        "interventions": {
          "fac_switch_cost": 0.25,
          "fac_training_cost": 0.15,
          "fac_crm_capability": 0.45
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.75,
          "fac_training_cost": 0.6,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r2",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "Team Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_platform_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Core Sales Team First",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_platform_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_platform_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_platform_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r3",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "Sales Team Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate in 6 Months",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_crm_capability": 0.55
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r4",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_annual_licence",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_platform_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Core Sales Team First",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_platform_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_platform_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_platform_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r5",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.35,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 24000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Sales Sub-Team First",
        "interventions": {
          "fac_switch_cost": 0.35,
          "fac_training_cost": 0.25,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.75,
          "fac_training_cost": 0.6,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r6",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 35,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Sales Sub-Team First",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r7",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "Team Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Sales Pod First",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r8",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.35,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer Switch — Evaluate Over 6 Months",
        "interventions": {
          "fac_switch_cost": 0.18,
          "fac_training_cost": 0.06,
          "fac_crm_capability": 0.5
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "A",
    "run": "r9",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_annual_licence",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.35,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.35,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_adoption",
        "label": "Team Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 6000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate in 6 Months",
        "interventions": {
          "fac_switch_cost": 0.36,
          "fac_training_cost": 0.12,
          "fac_crm_capability": 0.55
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.35
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D1",
    "run": "r1",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 24000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Core Sales Team First",
        "interventions": {
          "fac_switch_cost": 0.35,
          "fac_training_cost": 0.3,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.75,
          "fac_training_cost": 0.6,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D1",
    "run": "r2",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": false
  },
  {
    "arm": "D1",
    "run": "r3",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "User Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_annual_licence",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_indicator",
        "label": "CRM Platform Switch",
        "observed_state": {
          "value": 0,
          "source": "cee_inference",
          "extractionType": "inferred",
          "factor_type": "other",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 24000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_investment",
        "label": "Training Investment",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 6000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate Over Two Quarters",
        "interventions": {
          "fac_switch_indicator": 0,
          "fac_switching_cost": 0.25,
          "fac_training_investment": 0.2
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_indicator": 0,
          "fac_switching_cost": 0,
          "fac_training_investment": 0
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_indicator": 1,
          "fac_switching_cost": 0.75,
          "fac_training_investment": 1
        }
      }
    ]
  },
  {
    "arm": "D1",
    "run": "r4",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "Team Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer Switch: Pilot HubSpot for One Team",
        "interventions": {
          "fac_switch_cost": 0.2,
          "fac_training_cost": 0.08,
          "fac_crm_capability": 0.55
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 0.72,
          "fac_training_cost": 0.24,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D1",
    "run": "r5",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": false
  },
  {
    "arm": "D1",
    "run": "r6",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": false
  },
  {
    "arm": "D1",
    "run": "r7",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "Team Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 18000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 6000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_phased",
        "label": "Pilot HubSpot with Subset of Team First",
        "interventions": {
          "fac_switching_cost": 0.5,
          "fac_training_cost": 0.5,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switching_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switching_cost": 1,
          "fac_training_cost": 1,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D1",
    "run": "r8",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. Our own benchmarking says HubSpot would lift sales productivity by about 12% in the first year.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "Team Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_crm_licence",
        "label": "Annual CRM Licence Cost",
        "observed_state": null
      },
      {
        "id": "fac_productivity_lift",
        "label": "Sales Productivity Uplift",
        "observed_state": {
          "value": 0,
          "unit": "scale",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 1,
          "extractionType": "explicit",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switch_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0.6,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 18000,
          "cap": 30000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_training_cost",
        "label": "Training Cost",
        "observed_state": {
          "value": 0.2,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 6000,
          "cap": 30000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_pilot",
        "label": "Pilot HubSpot with Sub-Team First",
        "interventions": {
          "fac_switch_cost": 0.35,
          "fac_training_cost": 0.35,
          "fac_productivity_lift": 0.3
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_switch_cost": 0,
          "fac_training_cost": 0,
          "fac_productivity_lift": 0
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot Next Quarter",
        "interventions": {
          "fac_switch_cost": 1,
          "fac_training_cost": 1,
          "fac_productivity_lift": 0.72
        }
      }
    ]
  },
  {
    "arm": "D2",
    "run": "r1",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. HubSpot's annual licence for our team would be £46,000, against our current £30,000.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_rate",
        "label": "Team Adoption Rate",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 40,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_crm_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": {
          "value": 0.5,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 30000,
          "cap": 60000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_market_competition",
        "label": "Competitive Sales Environment",
        "observed_state": null
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_training_investment",
        "label": "Training Investment",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_negotiate_current",
        "label": "Negotiate Current CRM Contract",
        "interventions": {
          "fac_crm_licence_cost": 0.22,
          "fac_switching_cost": 0,
          "fac_training_investment": 0,
          "fac_crm_capability": 0.45
        }
      },
      {
        "id": "opt_pilot_hubspot",
        "label": "Pilot HubSpot with Subset of Team",
        "interventions": {
          "fac_crm_licence_cost": 0.35,
          "fac_switching_cost": 0.06,
          "fac_training_investment": 0.02,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_crm_licence_cost": 0.3,
          "fac_switching_cost": 0,
          "fac_training_investment": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_crm_licence_cost": 0.46,
          "fac_switching_cost": 0.18,
          "fac_training_investment": 0.06,
          "fac_crm_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D2",
    "run": "r2",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. HubSpot's annual licence for our team would be £46,000, against our current £30,000.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "Adoption and Disruption Risk",
        "observed_state": null
      },
      {
        "id": "fac_crm_annual_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": {
          "value": 0.6,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 30000,
          "cap": 50000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_platform_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 40,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching and Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 50000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      }
    ],
    "options": [
      {
        "id": "opt_negotiate_current",
        "label": "Negotiate Current CRM Contract",
        "interventions": {
          "fac_crm_annual_cost": 0.44,
          "fac_switching_cost": 0,
          "fac_platform_capability": 0.45
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_crm_annual_cost": 0.6,
          "fac_switching_cost": 0,
          "fac_platform_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_crm_annual_cost": 0.92,
          "fac_switching_cost": 0.48,
          "fac_platform_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D2",
    "run": "r3",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. HubSpot's annual licence for our team would be £46,000, against our current £30,000.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "Adoption & Change Resistance",
        "observed_state": null
      },
      {
        "id": "fac_crm_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": {
          "value": 0.5,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 30000,
          "cap": 60000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_platform_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 0.4,
          "cap": 1,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_investment",
        "label": "Training Investment",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_negotiate_current",
        "label": "Negotiate Current CRM Contract",
        "interventions": {
          "fac_crm_licence_cost": 0.22,
          "fac_switching_cost": 0,
          "fac_training_investment": 0,
          "fac_platform_capability": 0.45
        }
      },
      {
        "id": "opt_pilot_hubspot",
        "label": "Pilot HubSpot with Core Team First",
        "interventions": {
          "fac_crm_licence_cost": 0.18,
          "fac_switching_cost": 0.07,
          "fac_training_investment": 0.03,
          "fac_platform_capability": 0.65
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_crm_licence_cost": 0.3,
          "fac_switching_cost": 0,
          "fac_training_investment": 0,
          "fac_platform_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_crm_licence_cost": 0.46,
          "fac_switching_cost": 0.18,
          "fac_training_investment": 0.06,
          "fac_platform_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D2",
    "run": "r4",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. HubSpot's annual licence for our team would be £46,000, against our current £30,000.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "Staff Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": {
          "value": 0.5,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 30000,
          "cap": 60000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_platform_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 40,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 25000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_investment",
        "label": "Training Investment",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 10000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_negotiate_current",
        "label": "Negotiate Current CRM Contract",
        "interventions": {
          "fac_crm_licence_cost": 0.22,
          "fac_switching_cost": 0,
          "fac_training_investment": 0,
          "fac_platform_capability": 0.45
        }
      },
      {
        "id": "opt_phased_pilot",
        "label": "Pilot HubSpot with Core Sales Team First",
        "interventions": {
          "fac_crm_licence_cost": 0.36,
          "fac_switching_cost": 0.08,
          "fac_training_investment": 0.03,
          "fac_platform_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_crm_licence_cost": 0.3,
          "fac_switching_cost": 0,
          "fac_training_investment": 0,
          "fac_platform_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_crm_licence_cost": 0.46,
          "fac_switching_cost": 0.18,
          "fac_training_investment": 0.06,
          "fac_platform_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D2",
    "run": "r5",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. HubSpot's annual licence for our team would be £46,000, against our current £30,000.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "User Adoption Risk",
        "observed_state": null
      },
      {
        "id": "fac_crm_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": {
          "value": 0.3,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 30000,
          "cap": 100000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_platform_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "source": "cee_inference",
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Current CRM capability not benchmarked",
            "HubSpot fit for B2B sales workflow unconfirmed"
          ]
        }
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 100000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Staff Training Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 100000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_defer_evaluate",
        "label": "Defer and Evaluate Alternatives",
        "interventions": {
          "fac_crm_licence_cost": 0.3,
          "fac_switching_cost": 0,
          "fac_training_cost": 0.02,
          "fac_platform_capability": 0.5
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_crm_licence_cost": 0.3,
          "fac_switching_cost": 0,
          "fac_training_cost": 0,
          "fac_platform_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_crm_licence_cost": 0.46,
          "fac_switching_cost": 0.18,
          "fac_training_cost": 0.06,
          "fac_platform_capability": 0.8
        }
      }
    ]
  },
  {
    "arm": "D2",
    "run": "r6",
    "brief": "Should we replace our current CRM with HubSpot next quarter, or keep what we have? We are a 34-person B2B sales team. The annual CRM licence cost is about £30,000 and switching would cost roughly £18,000 one-off, plus around £6,000 of training. The goal is higher sales productivity without blowing the budget. HubSpot's annual licence for our team would be £46,000, against our current £30,000.",
    "drafted": true,
    "factors": [
      {
        "id": "fac_adoption_risk",
        "label": "CRM Adoption Uncertainty",
        "observed_state": null
      },
      {
        "id": "fac_crm_capability",
        "label": "CRM Platform Capability",
        "observed_state": {
          "value": 0.4,
          "unit": "scale",
          "source": "cee_inference",
          "raw_value": 40,
          "cap": 100,
          "extractionType": "inferred",
          "factor_type": "quality",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_crm_licence_cost",
        "label": "Annual CRM Licence Cost",
        "observed_state": {
          "value": 0.3,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 30000,
          "cap": 100000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_switching_cost",
        "label": "One-Off Switching Cost",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 100000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      },
      {
        "id": "fac_team_size",
        "label": "Sales Team Size",
        "observed_state": null
      },
      {
        "id": "fac_training_cost",
        "label": "Training Investment",
        "observed_state": {
          "value": 0,
          "unit": "£",
          "source": "brief_extraction",
          "raw_value": 0,
          "cap": 100000,
          "extractionType": "explicit",
          "factor_type": "cost",
          "uncertainty_drivers": [
            "Not provided"
          ]
        }
      }
    ],
    "options": [
      {
        "id": "opt_negotiate_current",
        "label": "Negotiate Current CRM Contract",
        "interventions": {
          "fac_crm_licence_cost": 0.22,
          "fac_switching_cost": 0,
          "fac_training_cost": 0.02,
          "fac_crm_capability": 0.5
        }
      },
      {
        "id": "opt_phased_pilot",
        "label": "HubSpot Pilot (Small Team First)",
        "interventions": {
          "fac_crm_licence_cost": 0.36,
          "fac_switching_cost": 0.07,
          "fac_training_cost": 0.03,
          "fac_crm_capability": 0.6
        }
      },
      {
        "id": "opt_status_quo",
        "label": "Keep Current CRM (Status Quo)",
        "interventions": {
          "fac_crm_licence_cost": 0.3,
          "fac_switching_cost": 0,
          "fac_training_cost": 0,
          "fac_crm_capability": 0.4
        }
      },
      {
        "id": "opt_switch_hubspot",
        "label": "Switch to HubSpot",
        "interventions": {
          "fac_crm_licence_cost": 0.46,
          "fac_switching_cost": 0.18,
          "fac_training_cost": 0.06,
          "fac_crm_capability": 0.8
        }
      }
    ]
  }
];
