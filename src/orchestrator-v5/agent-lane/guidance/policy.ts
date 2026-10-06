// Typed constants from the adjacent policy. Base programme-docs @ 712625a1c484943ad330214504634121a44216e7.
// SCI-HERO amendment: Paul-approved tipping-point plan, board #85 5963520834.
// Acceptance pins both source bytes and these constants; older fixtures remain unchanged.
export const POLICY = {
  "selection": {
    "attach_to": [
      "narration",
      "turn"
    ],
    "never_attach_to": [
      "run_result"
    ],
    "run_result_rule": "Request 1 carries only the typed result and the 'Explain this result' chip (agent-explain-run:<run_key>). No coaching row is offered on request 1.",
    "explain_this_result": "A continuation of the Run, not a coaching intervention. It never counts against the budget below.",
    "suppression": "If open.decision_point is true, offer NO coaching row and no RC-COACH-EDITS pill. The decision comes first.",
    "budget": {
      "slot_1": "The single highest-priority eligible row among RC-WIDEN, RC-WHAT-CHANGES, RC-STRENGTHEN-ITEM, RC-PREMORTEM.",
      "slot_2": "RC-COACH-EDITS, only when eligible. It is user-initiated, so it may sit beside slot 1.",
      "max_chips": 2
    },
    "priority_order": [
      "P1",
      "P2",
      "P3",
      "P4",
      "P5"
    ],
    "tie_break": [
      "Same priority and the SAME item (e.g. RC-WHAT-CHANGES and RC-STRENGTHEN-ITEM both name factor X): offer RC-WHAT-CHANGES only. Reasoning framing wins over the model action.",
      "Otherwise by row order: RC-WIDEN, RC-WHAT-CHANGES, RC-STRENGTHEN-ITEM, RC-PREMORTEM."
    ],
    "method_turn_rule": "On a 'method' turn, offer no other method. Offer only that method's own follow-up actions.",
    "cooldown_default": "A row (or item) with guidance status pressed, dismissed or completed is not offered while its current state_key_hash equals the recorded one. user.explicit_request bypasses this.",
    "state_key_persistence": "On disk (coaching_state, CEE #2459 agent_guidance envelope) an entry is {status, state_key_hash, turn_id}. state_key_hash = computeResponseHash(fields) (CEE utils/response-hash.ts; identical to #2459 stateKeyHash): sha256(JSON.stringify(canonical(fields))) first 12 hex, canonical = object keys sorted, ARRAY ORDER KEPT. Never persist raw values (coaching_state is content-free).",
    "cold_reload": "Guidance must round-trip through coaching_state: a pressed or dismissed row stays hidden after a cold reload with an unchanged state_key (#2388 two-load lesson).",
    "cooldown_scope": "Variant rows (RC-WIDEN): pick the first variant that holds, THEN apply cooldown to that pick; a row in cooldown does NOT fall through to its later variants (case A-WIDEN-SAME-KEY-HIDDEN: W1 dismissed, W2 also holds, RC-WIDEN stays hidden). Item rows (RC-STRENGTHEN-ITEM): cooldown is per item, so a cooled item falls through to the next candidate in pick order, and across variants (S1, then S2, S3L, S3V).",
    "state_key_rule": "Each row's state_key.shape gives the exact fields. Build them with arrays in the stated order (ids sorted ascending; edits sorted by entity_id, then field) and OMIT any null or absent field (JS canonical keeps null, so a null would change the hash). The selector compares stateKeyHash(current fields) with the entry's state_key_hash. Verified: tools/select_ref.state_key_hash equals #2459 stateKeyHash on all 18 case entries + a non-ASCII control (RC, 1 Oct 14:3xZ).",
    "reference": "tools/select_ref.py is the reference selector. build-cases.py refuses to write the cases if any case disagrees with it, or if any of its MUTANTS survives every case.",
    "entry_key": "The policy id, or for a per-item row `RC-STRENGTHEN-ITEM:` + stateKeyHash({item_id}). Never the raw item id: node ids carry the user's words, and '->' in a link id fails the envelope KEY pattern /^[A-Za-z0-9_.:-]{1,128}$/, so a raw link key would be dropped on read and the item's cooldown lost after reload."
  },
  "rows": [
    {
      "policy_id": "RC-WIDEN",
      "name": "Widen the options",
      "action_type": "reasoning_method",
      "targets": [
        "options",
        "risks",
        "factors"
      ],
      "trigger_predicate": {
        "all": [
          "turn.request in [narration, turn]",
          "model.goal_present"
        ],
        "variants": [
          {
            "id": "W1",
            "target": "options",
            "priority": "P1",
            "when": "run.kind == complete_current AND run.withheld_reason in [no_option_meets_limit, every_option_likely_breaks_limit]"
          },
          {
            "id": "W2Z",
            "target": "options",
            "priority": "P1",
            "when": "len(model.non_sq_option_ids) == 0"
          },
          {
            "id": "W2",
            "target": "options",
            "priority": "P1",
            "when": "len(model.non_sq_option_ids) == 1"
          },
          {
            "id": "W3",
            "target": "options",
            "priority": "P3",
            "when": "model.same_lever == true",
            "bias_cue": "narrow_framing"
          },
          {
            "id": "W4",
            "target": "options",
            "priority": "P3",
            "when": "len(model.non_sq_option_ids) == 2 AND model.status_quo_option_id == null",
            "bias_cue": "status_quo"
          },
          {
            "id": "W5",
            "target": "options",
            "priority": "P3",
            "when": "run.kind == complete_current AND run.withheld_reason == options_do_not_separate"
          },
          {
            "id": "W6",
            "target": "risks",
            "priority": "P3",
            "when": "len(model.risk_ids) <= 1 AND len(model.non_sq_option_ids) >= 1"
          },
          {
            "id": "W7",
            "target": "factors",
            "priority": "P5",
            "when": "len(model.goal_path_factor_ids) <= 2"
          }
        ],
        "pick": "The first variant that holds, in the order listed."
      },
      "required_typed_signals": [
        "model.goal_present",
        "model.goal_label",
        "model.non_sq_option_ids",
        "model.status_quo_option_id",
        "model.same_lever",
        "model.risk_ids",
        "model.goal_path_factor_ids",
        "run.kind",
        "run.withheld_reason",
        "turn.request"
      ],
      "forbidden_without": [
        "model.goal_present"
      ],
      "silent_when": [
        "open.decision_point",
        "turn.request == run_result",
        "guidance[RC-WIDEN] is pressed, dismissed or completed with an unchanged state_key",
        "the only reason would be to reach a count; never add items for their own sake"
      ],
      "priority": "per variant (W1, W2Z, W2 = P1; W3-W6 = P3; W7 = P5)",
      "reasoning_question": {
        "W1": "None of these looks likely to stay within your limit. Is there another way to get there?",
        "W2": "Is it really just {option_label} or carry on as now? What other routes are there?",
        "W3": "These options all pull the same lever. Is there a different way to reach the goal?",
        "W4": "Would carrying on as now be a real option worth comparing against?",
        "W5": "These options come out about the same. Is there a hybrid that combines the strengths of each?",
        "W6": "What else could stop this working?",
        "W7": "What else really drives {goal_label}?",
        "W2Z": "What could you actually do about {goal_label}? Name the routes you are weighing."
      },
      "short_copy": {
        "W1": "Every option looks likely to break your limit. Worth finding another route?",
        "W2": "Only one real option on the table. Decisions go better with alternatives.",
        "W3": "These options all work through the same lever. A different mechanism?",
        "W4": "Comparing against 'carry on as now' shows what each change really adds.",
        "W5": "The options come out close. A hybrid might combine the strengths of both.",
        "W6": "Only one risk is on the map. What else could go wrong?",
        "W7": "Few drivers are mapped for {goal_label}. What else moves it?",
        "W2Z": "No options on the table yet. What could you do?"
      },
      "why_now": {
        "W1": "The analysis checked your limit and no option clears it.",
        "W2": "There is one option besides carrying on as now.",
        "W3": "Most of the options change the same factors.",
        "W4": "There is no 'carry on as now' option to compare with.",
        "W5": "The analysis could not separate the options.",
        "W6": "The model has at most one risk.",
        "W7": "Two or fewer factors lead to the goal.",
        "W2Z": "The model has a goal but no option besides carrying on as now."
      },
      "primary_action": {
        "label": {
          "options": "Suggest options",
          "risks": "Suggest risks",
          "factors": "Suggest drivers"
        },
        "action_kind": "choose_1_of_3",
        "behaviour": "Olumi proposes up to 3 materially distinct items, each grounded in the brief or the model, starting with any Olumi-proposed option already left out of the comparison. They are shown as decision-point buttons ('Add' per item, plus 'Something else'). Nothing is added until the user chooses.",
        "intent": {
          "options": "elicit_options",
          "risks": "elicit_risks",
          "factors": null
        }
      },
      "secondary_actions": [
        {
          "label": "Talk it through",
          "action_kind": "discuss"
        },
        {
          "label": "Not now",
          "action_kind": "dismiss"
        }
      ],
      "progressive_detail": "Why: one line on the variant's why_now, with its source (Grammar §3 coaching pattern). Detail on click: the science basis in one sentence.",
      "bias_cue": {
        "narrow_framing": "These options all work through the same lever, which can hide better routes.",
        "status_quo": "Without a 'carry on as now' option it is hard to see what each change really adds."
      },
      "state_key": {
        "fields": [
          "variant_id",
          "target",
          "sorted(model.non_sq_option_ids)",
          "run.withheld_reason (W1 and W5 only)",
          "sorted(model.risk_ids) (target risks only)"
        ],
        "note": "W2-W4 and W7 keys exclude withheld_reason, so a new limit verdict alone does not bring the row back. Options added through this method change the key; the row returns only while a variant still holds.",
        "shape": "{variant_id, target, non_sq_option_ids (sorted)} + withheld_reason for W1/W5 + risk_ids (sorted) for target risks"
      },
      "cooldown_rule": "Default cooldown (selection.cooldown_default).",
      "reentry_rule": "Returns only when the option set (or risk set for W6) or withheld_reason changes AND a variant still holds.",
      "completion_rule": "Completed when the user adds at least one proposed item, or chooses 'Something else' / says none apply.",
      "truth_dependencies": [
        "run.withheld_reason (F1b)",
        "model option set (F1)",
        "option_status once 0.69.0 is pinned"
      ],
      "human_control_rule": "Never adds an option, risk or factor without the user's choice. Each accepted item lands as ONE change card (before, after, Apply, Edit, Undo).",
      "science_basis": {
        "summary": "Decisions framed with a single alternative ('whether or not') fail more often than ones with real alternatives; generating options before evaluating is a core decision-quality step.",
        "refs": [
          "Nutt (1999, 2002) on 'whether or not' decisions",
          "Keeney (1992) value-focused thinking",
          "Samuelson & Zeckhauser (1988) status quo bias"
        ],
        "dsk": [
          "DSK-B-007 (option-set size)",
          "DSK-P-004 (opportunity cost prompting, elicit_options): frame|ideate only, never for go/no-go; badge only via MethodScienceContext (method_turns.shared.dsk_provenance)"
        ]
      },
      "replaces": [
        "METHOD_CATALOGUE.different_option"
      ],
      "signal_status": "available",
      "acceptance_example_ids": [
        "A-D2-RUN2-WIDEN-P1",
        "A-WIDEN-SAME-KEY-HIDDEN",
        "A-WIDEN-REENTERS-ON-NEW-OPTION-SET",
        "A-WHAT-CHANGES-NONE-MEASURABLE-SILENT",
        "A-DECISION-POINT-SUPPRESSES",
        "A-TWO-LOAD-HIDDEN-AFTER-RELOAD",
        "A-WIDEN-NO-OPTIONS"
      ]
    },
    {
      "policy_id": "RC-WHAT-CHANGES",
      "name": "What would change the decision?",
      "action_type": "reasoning_method",
      "trigger_predicate": {
        "all": [
          "turn.request in [narration, turn]",
          "run.kind == complete_current",
          "run.tipping_point.status == found OR run.leader_licensed == true",
          "run.tipping_point.status == found OR run.decision_sensitivity.status == measured",
          "run.tipping_point.status != found OR run.run_key is present"
        ]
      },
      "required_typed_signals": [
        "run.kind",
        "run.tipping_point OR run.decision_sensitivity",
        "turn.request",
        "run.run_key (required for a tipping_point)"
      ],
      "forbidden_without": [
        "complete_current Run and a grounded tipping_point with existing bound run.run_key OR licensed measured decision_sensitivity"
      ],
      "silent_when": [
        "open.decision_point",
        "turn.request == run_result",
        "run.tipping_point.status != found AND run.decision_sensitivity.status in [none_measurable, not_measured]",
        "run.kind != complete_current (stale, withheld or no run)",
        "run.tipping_point.status != found AND run.leader_licensed != true",
        "guidance[RC-WHAT-CHANGES] pressed, dismissed or completed with an unchanged state_key"
      ],
      "priority": "P2",
      "reasoning_question": {
        "range_olumi_assumed": "Do you know {factor_label} more precisely? Within Olumi's assumed range it could change how the options compare.",
        "range_yours_or_unknown": "Would {leader_label} still score highest in this model if {factor_label} changed?"
      },
      "short_copy": "{factor_label} could change how the options compare.",
      "why_now": "In this model, which option scores highest is sensitive to {factor_label}.",
      "primary_action": {
        "when_range_olumi_assumed": {
          "label": "Give your estimate",
          "action_kind": "edit_inline",
          "target": "most_sensitive.factor_id"
        },
        "otherwise": {
          "label": "Talk it through",
          "action_kind": "discuss"
        }
      },
      "secondary_actions": [
        {
          "label": "Show me on the map",
          "action_kind": "examine",
          "target": "most_sensitive.factor_id"
        },
        {
          "label": "Talk it through",
          "action_kind": "discuss"
        }
      ],
      "progressive_detail": "Click reveals: which figure it is, whose figure it is (yours / Olumi's estimate), and one line on what the analysis varied. No numbers from never_coach.",
      "state_key": {
        "fields": [
          "run.run_key",
          "run.decision_sensitivity.most_sensitive.factor_id",
          "run.decision_sensitivity.most_sensitive.range"
        ],
        "shape": "{run_key, factor_id, range}"
      },
      "cooldown_rule": "Default cooldown.",
      "reentry_rule": "Returns after a new Run whose most sensitive factor differs, or after that factor's value or authorship changed.",
      "completion_rule": "Completed when the user gives an estimate for the factor, or the method turn answers (discussed).",
      "truth_dependencies": [
        "leader licence (F1b)",
        "decision_sensitivity from factor_evppi (CEE)"
      ],
      "human_control_rule": "Never changes the value. An estimate the user gives goes through the normal inline edit and is recorded as theirs.",
      "never_say": [
        "a win probability or 'chance it wins'",
        "EVPI, EVPPI, elasticity, sensitivity score, 'strongest driver'",
        "'No single assumption measurably changes which option leads' or any claim that nothing would change the answer (factor_evppi is structurally flat in additive lever models, P3C A2)",
        "'assumption' when only factor values were varied; say 'this figure'"
      ],
      "science_basis": {
        "summary": "Expected value of partial perfect information ranks which uncertain input could change the choice. Attention goes to the input that matters to the decision, not the one with the biggest structural weight.",
        "refs": [
          "Howard (1966) information value theory",
          "Oakley & O'Hagan (2004) EVPPI"
        ],
        "dsk": []
      },
      "replaces": [
        "agent-next-what-would-change"
      ],
      "signal_status": "available",
      "acceptance_example_ids": [
        "A-WHAT-CHANGES-MEASURED",
        "A-WHAT-CHANGES-NONE-MEASURABLE-SILENT",
        "A-D2-RUN2-WIDEN-P1",
        "A-STALE-SILENT",
        "A-WHAT-CHANGES-ASKED-HONEST-LIMIT"
      ],
      "note": "Expect this row to fire rarely today: factor_evppi is structurally flat in additive lever models (P3C A2), and every served run read on 1 Oct had EVPPI empty or below resolution and every flip_thresholds row no_flip_in_range. Silence is the correct output there. It fires once identity kinds (product, stock-flow) make a factor interact with a lever.",
      "tipping_point_copy": {
        "title": "{factor_label} could change this.",
        "why": "tipping_point.say verbatim, including the supplied display threshold and unit",
        "question": "Would you like to refine {factor_label}?",
        "primary_action": "Talk it through; factor refinement uses the existing ID-bound path, with no automatic edit/rerun."
      }
    },
    {
      "policy_id": "RC-STRENGTHEN-ITEM",
      "name": "Strengthen this assumption or link",
      "action_type": "model_action",
      "item_scoped": true,
      "trigger_predicate": {
        "all": [
          "turn.request in [narration, turn]"
        ],
        "variants": [
          {
            "id": "S1",
            "priority": "P1",
            "when": "a link L in model.placeholder_goal_links AND no open decision point is about L",
            "item": "link"
          },
          {
            "id": "S2",
            "priority": "P2",
            "when": "run.decision_sensitivity.status == measured AND model.goal_path_factors[most_sensitive.factor_id].value_authorship in [olumi_estimate, olumi_accepted]",
            "item": "factor"
          },
          {
            "id": "S3L",
            "priority": "P5",
            "when": "a link in model.goal_path_links with link_sizing in [placeholder, olumi_estimate]",
            "item": "link"
          },
          {
            "id": "S3V",
            "priority": "P5",
            "when": "a factor in model.goal_path_factors whose value_authorship is olumi_estimate",
            "item": "factor"
          }
        ],
        "pick": "The first variant that holds. Within a variant: smallest goal_distance (fewest edges from the link's target node, or from the factor, to the goal), then lexicographic id. `item_one_of` in a case lists every candidate in this order; `item` is the pick."
      },
      "required_typed_signals": [
        "model.placeholder_goal_links",
        "model.goal_path_links",
        "model.goal_path_factors",
        "run.decision_sensitivity",
        "open.decision_point",
        "turn.request"
      ],
      "forbidden_without": [
        "a named item (link or factor id)"
      ],
      "silent_when": [
        "open.decision_point (the F1b B2 [Accept starting strength][Edit] IS this action for a placeholder link)",
        "turn.request == run_result",
        "no item qualifies: never offer a generic 'Strengthen the model'",
        "the item is user-sized (link_sizing == user) or the value is yours",
        "guidance[RC-STRENGTHEN-ITEM, item] pressed, dismissed or completed with an unchanged state_key"
      ],
      "priority": "per variant (S1 = P1, S2 = P2, S3L/S3V = P5; S3L before S3V)",
      "reasoning_question": {
        "S1": "How much does {from_label} really change {to_label}? The comparison turns on it.",
        "S2": "Do you know {factor_label} more precisely? It's Olumi's estimate and the comparison is sensitive to it.",
        "S3L": "Does {from_label} really move {to_label} as much as Olumi assumed?",
        "S3V": "What figure would you use for {factor_label}?"
      },
      "short_copy": {
        "S1": "The comparison rests on a link nobody has sized yet.",
        "S2": "This model's result turns on {factor_label}, Olumi's estimate.",
        "S3L": "The effect of {from_label} is Olumi's guess.",
        "S3V": "{factor_label} is Olumi's estimate, not yours."
      },
      "why_now": {
        "S1": "Until it is sized, Olumi can't compare the options on your goal.",
        "S2": "The analysis found this figure matters to the choice.",
        "S3L": "It sits on the path to your goal.",
        "S3V": "It feeds your goal."
      },
      "primary_action": {
        "label": "Give your estimate",
        "action_kind": "edit_inline",
        "target": "item"
      },
      "secondary_actions": [
        {
          "label": "Use Olumi's estimate",
          "action_kind": "confirm",
          "target": "item",
          "note": "For a link this is F1b's accept path (link becomes olumi_accepted). Still Olumi's figure; earns no authorship credit."
        },
        {
          "label": "Talk it through",
          "action_kind": "discuss"
        },
        {
          "label": "Show me on the map",
          "action_kind": "examine",
          "target": "item"
        }
      ],
      "progressive_detail": "Click reveals: whose figure it is, which option or conclusion depends on it, and what the user's own number would change. One level of disclosure.",
      "state_key": {
        "fields": [
          "item_id",
          "link_sizing (links) | value_authorship (factors)",
          "value_hash"
        ],
        "shape": "{item_id, link_sizing, value_hash} for a link; {item_id, value_authorship, value_hash} for a factor (exact JSON, as acceptance-cases records it)",
        "scope": "per item: dismissing X does not block Y",
        "note": "Content-free: value_hash is computeResponseHash of the STORED value (link {strength, exists_probability, effect_direction}; factor observed_state {value, raw_value, unit, baseline, cap}), never the value itself. A user edit makes the item yours, which ends its eligibility; a changed Olumi estimate brings a dismissed item back (RC ruling for AI HARNESS 5936122586)."
      },
      "cooldown_rule": "Default cooldown, per item. At most one RC-STRENGTHEN-ITEM offer per turn.",
      "reentry_rule": "Item X returns only if its sizing, authorship or stored value (value_hash) changes, or it becomes S1/S2 after a new Run.",
      "completion_rule": "Completed when X's authorship changes (user or olumi_accepted) or the method turn answers.",
      "truth_dependencies": [
        "linkSizing (F1b, #2446)",
        "placeholderGoalPaths (F1b)",
        "observedValueAuthorship (F1)",
        "decision_sensitivity (CEE)"
      ],
      "human_control_rule": "Never sizes or changes a link or value itself. Every change goes through an inline edit or a change card the user applies.",
      "never_say": [
        "'Strengthen the model' with no named item",
        "placeholder, edge, node, default strength",
        "a percentage chance attached to the link"
      ],
      "science_basis": {
        "summary": "Assumption-based planning: name the load-bearing assumption, test it, and replace a guessed number with the decision-maker's own judgement where the choice depends on it.",
        "refs": [
          "Dewar (2002) assumption-based planning",
          "Spetzler & Staël von Holstein (1975) probability encoding"
        ],
        "dsk": []
      },
      "replaces": [
        "agent-next-strengthen"
      ],
      "signal_status": "available",
      "acceptance_example_ids": [
        "A-STRENGTHEN-PLACEHOLDER-P1",
        "A-STRENGTHEN-B2-SUPPRESSES",
        "A-NO-GENERIC-STRENGTHEN",
        "A-WIDEN-SAME-KEY-HIDDEN",
        "A-STRENGTHEN-ITEM-FALLS-THROUGH"
      ]
    },
    {
      "policy_id": "RC-PREMORTEM",
      "name": "Pre-mortem",
      "action_type": "reasoning_method",
      "trigger_predicate": {
        "all": [
          "turn.request in [narration, turn]",
          "model.goal_present",
          "run.kind == complete_current"
        ],
        "any": [
          "run.leader_licensed == true",
          "len(model.non_sq_option_ids) == 1 AND len(model.risk_ids) >= 1"
        ],
        "explicit_request": "On user.explicit_request with a goal and at least one option, run it at any stage. The METHOD plan is the licensed leader, else the user's explicit pick. A generic press naming no option, with no licensed leader, no pick and 2+ own options, runs a decision-level pre-mortem (mode decision_plan); otherwise no plan means choose_plan. With no current Run, use the qualitative protocol: no invented winner, probability or figure (SCI-09).",
        "none": [
          "run.withheld_reason in [no_option_meets_limit, every_option_likely_breaks_limit]"
        ]
      },
      "required_typed_signals": [
        "model.goal_horizon",
        "model.goal_present",
        "model.non_sq_option_ids",
        "model.risk_ids",
        "run.kind",
        "run.leader_licensed",
        "turn.request",
        "user.selected_option_id"
      ],
      "forbidden_without": [
        "model.goal_present",
        "a plan to stress: a licensed leader, or a single option with a risk on the map, or an explicit request"
      ],
      "silent_when": [
        "open.decision_point",
        "turn.request == run_result",
        "guidance[RC-PREMORTEM] completed with an unchanged state_key (never rerun without new cause, SCI-08)",
        "run.withheld_reason in [no_option_meets_limit, every_option_likely_breaks_limit]: the analysis already shows every option likely misses a limit, so there is no plan to stress (DSK-P-001 needs an identified winning option); RC-WIDEN W1 is the move",
        "pre-structure: no goal or no option"
      ],
      "priority": "P4",
      "reasoning_question": {
        "dated": "Imagine it's {horizon} and {plan_label} has gone badly. What most likely went wrong?",
        "undated": "Imagine {plan_label} has gone badly. What most likely went wrong?"
      },
      "short_copy": "Imagine {plan_label} has failed. What went wrong?",
      "why_now": "There is a plan to stress-test now: {plan_label}.",
      "primary_action": {
        "label": "Run a pre-mortem",
        "action_kind": "discuss",
        "intent": "pre_mortem",
        "behaviour": "Olumi writes 2-3 plausible failure stories. Each one must name at least one model item: a risk node, an Olumi-estimated link on the plan's path, or a limit at risk. For each: one warning sign to watch and one mitigation. Presented as stories, never as predictions."
      },
      "secondary_actions": [
        {
          "label": "Add this as a risk",
          "action_kind": "confirm",
          "note": "A change card; nothing is added without Apply."
        },
        {
          "label": "Not now",
          "action_kind": "dismiss"
        }
      ],
      "progressive_detail": "Stories first; warning signs and mitigations behind 'Show more'.",
      "state_key": {
        "fields": [
          "leader option id if licensed else the single option id",
          "sorted(model.non_sq_option_ids)"
        ],
        "note": "Deliberately excludes the risk set. Risks added by the pre-mortem itself must not make it come back (SCI-08).",
        "shape": "{plan_option_id, non_sq_option_ids (sorted)}"
      },
      "cooldown_rule": "Default cooldown.",
      "reentry_rule": "Returns only when the plan under test (the leader) or the option set changes.",
      "completion_rule": "Completed once the stories are shown (the method turn answered).",
      "truth_dependencies": [
        "leader licence (F1b)",
        "risk nodes (F1)",
        "linkSizing for the Olumi-estimated links it may cite (F1b)"
      ],
      "human_control_rule": "Stories are prompts for the user's judgement. Any risk or mitigation enters the model only through a change card the user applies.",
      "never_say": [
        "'this will fail'",
        "a probability of failure",
        "a winner when no leader is licensed"
      ],
      "horizon_rule": "Use model.goal_horizon: {months: n} -> '{n} months from now' ('a month from now' for 1); {deadline} -> the date as '2 November'. Absent or pending -> the undated question. Never default to a year.",
      "science_basis": {
        "summary": "Prospective hindsight (imagining the failure has already happened) surfaces more and more specific reasons for failure than asking what might go wrong.",
        "refs": [
          "Mitchell, Russo & Pennington (1989) prospective hindsight",
          "Klein (2007) Performing a project premortem, HBR"
        ],
        "dsk": [
          "DSK-P-001 (Pre-mortem exercise): evaluate|decide, not with one option and no meaningful alternatives; badge only via MethodScienceContext",
          "DSK-TR-001 (re-grounded; see dsk_trigger_map)",
          "DSK-T-001"
        ]
      },
      "replaces": [
        "agent-next-pre-mortem",
        "METHOD_CATALOGUE.pre_mortem"
      ],
      "signal_status": "available",
      "acceptance_example_ids": [
        "A-PREMORTEM-LICENSED",
        "A-PREMORTEM-COMPLETED-HIDDEN",
        "A-PREMORTEM-RISK-ADDED-STAYS-HIDDEN",
        "A-EXPLICIT-REQUEST-BYPASSES-COOLDOWN",
        "A-D3-S4-AFTER-WIDEN-DISMISSED",
        "A-PREMORTEM-DATED-HORIZON"
      ]
    },
    {
      "policy_id": "RC-COACH-EDITS",
      "name": "Coach my edits",
      "action_type": "reasoning_method",
      "offered_only": true,
      "trigger_predicate": {
        "all": [
          "turn.request in [narration, turn]",
          "len(since_run.goal_path_user_edits) >= 1",
          "guidance[RC-COACH-EDITS].state_key_hash != hash(current uncoached edit set)"
        ]
      },
      "required_typed_signals": [
        "since_run.goal_path_user_edits",
        "guidance",
        "turn.request"
      ],
      "forbidden_without": [
        "since_run.goal_path_user_edits"
      ],
      "silent_when": [
        "open.decision_point",
        "turn.request == run_result",
        "only rename, position or label edits",
        "the same edit set was already coached",
        "since_run.goal_path_user_edits is pending (today): silent, never inferred from chat text"
      ],
      "priority": "slot_2 (offered beside slot 1; never auto-run)",
      "reasoning_question": "You changed {edit_summary}. What does that do to the choice?",
      "short_copy": "Coach my edits",
      "why_now": "You changed {edit_count} thing(s) that feed the goal since the last run.",
      "primary_action": {
        "label": "Coach my edits",
        "action_kind": "discuss",
        "behaviour": "One-line insight, then at most 3 bullets: (1) what changed, before and after; (2) which assumption or trade-off that touches; (3) which conclusion may now change. Last line: if run.kind == complete_stale, 'The analysis is out of date' (F1/F1b own that fact) and offer a rerun only if the model may run."
      },
      "secondary_actions": [],
      "progressive_detail": "Each bullet expands to the specific item (O1 / F2 numbering) on click.",
      "state_key": {
        "fields": [
          "edits: the uncoached goal-path edits, each {kind, entity_id, field, after_hash}"
        ],
        "shape": "{edits: [...]} compared as a set"
      },
      "cooldown_rule": "Default cooldown; a new edit makes a new key.",
      "reentry_rule": "Returns when there is at least one goal-path edit not in the last coached set.",
      "completion_rule": "Completed when the method turn answers.",
      "truth_dependencies": [
        "since_run (AI HARNESS)",
        "run.kind stale/current (F1/F1b)",
        "run_delta.input_changes after a rerun"
      ],
      "human_control_rule": "Never auto-runs, never auto-approves, never changes the graph.",
      "science_basis": {
        "summary": "Prompt reflection on the consequences of one's own change gives the timely feedback that judgement needs; considering what the change implies counters taking it at face value.",
        "refs": [
          "Kahneman & Klein (2009) conditions for intuitive expertise",
          "Lord, Lepper & Preston (1984) consider the opposite"
        ],
        "dsk": [
          "DSK-P-003 (Disconfirmation)"
        ]
      },
      "replaces": [],
      "signal_status": "pending:AI HARNESS since_run slice (F2-4)",
      "acceptance_example_ids": [
        "A-COACH-EDITS-OFFERED",
        "A-COACH-EDITS-PENDING-SILENT",
        "A-COACH-EDITS-SAME-SET-HIDDEN",
        "A-REQUEST1-NO-COACHING"
      ]
    }
  ],
  "copy_rules": {
    "max_chars": {
      "short_copy": 90,
      "waiting_line": 90,
      "why_now": 120,
      "reasoning_question": 140
    },
    "label_fill": "Fill {placeholders} from typed labels only; truncate a label to 40 characters with an ellipsis.",
    "voice": "British English, sentence case, no em dashes, no all caps, no error codes (DS v5 §29).",
    "banned_words": [
      "edge",
      "node",
      "placeholder",
      "elasticity",
      "EVPI",
      "EVPPI",
      "sensitivity score",
      "win probability",
      "the model was saved"
    ],
    "provenance_vocabulary": [
      "yours",
      "Olumi's estimate",
      "Olumi's suggestion"
    ],
    "response_shape": "One-line insight, then at most 3 bullets, then one action or question; details collapsed (Grammar §3).",
    "label_case": "Option labels ({option_label}, {plan_label}, {leader_label}) are quoted in single curly quotes and keep their case: 'Imagine ‘Switch to GCP’ has failed.' Other mid-sentence labels lower-case their first letter unless the first word is an acronym or proper noun (second letter upper-case, e.g. 'GCP', 'AI'). A label that opens the sentence keeps its capital.",
    "served_label_scan": "RC 1 Oct 19:2xZ: every row variant rendered by the real renderCopy over 292 served graphs (CEE staging fixtures), 19,366 renders: 0 throws; only S2 short_copy overflowed (96 > 90 with a 40-char label) -> rewritten with 46 fixed chars. Fixed chars + 40 per label must stay within max_chars."
  },
  "method_turns": {
    "purpose": "What a method must produce when pressed. Every post_check is a DETERMINISTIC text rule with an id (Ticket 1 implements all of them in checkMethodTurn). Rules that need structured output are listed under structured_checks; they are AI HARNESS's (method-turn output format) and are NOT part of the text checker. The runtime checks the draft BEFORE it is sent (shared.runtime); if any check fails, it sends the deterministic fallback instead.",
    "shared": {
      "shape": "One-line insight, then the method's body, then ONE action (Grammar §3). Details collapsed.",
      "grounding": "Only the typed inputs listed per method plus the user's own words. Every specific claim names a supplied item by its label or ref (O1, F2, R1).",
      "never": [
        "a probability, percentage or win share unless the user stated it",
        "a leading option when run.leader_licensed is false",
        "'the model was saved', implementation detail, internal ids",
        "EVPI, elasticity, sensitivity score, placeholder, edge, node"
      ],
      "max_words": 180,
      "parsing": {
        "numbered_items": "items start on a new line with /^\\s*[1-9]\\.\\s/ ; an item runs until the next numbered line, an 'Outside the model:' line, or the end",
        "bullet_items": "items start on a new line with /^\\s*-\\s/ ; the item NAME is the text before the first ':' on that line",
        "normalise": "lower-case, curly quotes to straight, strip punctuation and collapse whitespace",
        "label_match": "case-insensitive substring match of a supplied label after normalise, or a supplied ref (O1, F2, R1) as a whole word",
        "number_tokens": "/(?<![A-Za-z])[£$€]?\\d[\\d,]*(\\.\\d+)?\\s*(%|k|m|bn)?/i, ignoring list markers at the start of a line; a token is 'supplied' if its digits appear in the inputs, the brief or the user's messages",
        "blindspot_line": "a line matching /^\\s*Outside the model:\\s/ ; it is never part of a numbered item",
        "item_match": "a supplied item {id, labels[], ref?} matches a text when its ref appears as a whole word, or when EVERY one of its labels label_matches (a link carries its two end labels, so the text must name both ends)",
        "target": "per numbered item: the id of the FIRST supplied item, in supplied order, that matches it; null when none does"
      },
      "runtime": {
        "rule": "The runtime calls checkMethodTurn on the draft reply BEFORE sending it. Any failed id: send the row's deterministic fallback instead. Never repair and resend, never a second LLM call, never a post-hoc score in place of the check.",
        "never": [
          "a method turn on request 1 of the two-request Run",
          "an extra LLM call inside a Run"
        ],
        "source": "PTL 5933036532 #6, PTL 5933069264 #11-12"
      },
      "action_target": {
        "rule": "Every grounded failure story (RC-PREMORTEM) or option gap (RC-WIDEN) carries the id of the node, link or option it rests on. The turn ends in ONE existing typed change card on one of those ids: confirm, the Run goes stale, rerun, then the Changes delta (RERUN-EXPLANATION states a cause only for C1_attributable). With no target the turn is discussion only, and it does not count as the investor moment.",
        "cards": "The agent lane's propose_* card tools (src/orchestrator-v5/agent-lane/runtime/agent-tools.ts @ e3fb5090): propose_link_strengths (Olumi's band for the user to accept or edit; NEVER the singular propose_link_strength at :366, which is user-authored and refuses a band the user did not state, PTL 5933901307), propose_assumptions (:231, sets a factor to a stated assumption), propose_new_risk (:450), propose_new_option (:278; with a stored Olumi option's exact label it offers adoption, i.e. adopt_olumi_option), propose_new_factor (:484), propose_limit_change (:506). RC names the card; AI HARNESS composes it through the existing door. Nothing changes without Apply. Changing a limit to fit the plan is never a coaching action.",
        "pass_condition": "Investor moment (DL 5933063973 addition 2): the user acted on the challenge and saw the consequence, in R3's same F5 capture (D2, D3). The PM-*/WD-* pass rate is secondary.",
        "source": "DL 5933063973 additions 1-2",
        "grounded_inputs_shape": "supplied_items = SCIENCE/DSK MethodScienceContext.grounded_inputs, passed unchanged: {id, kind: link|factor|risk|limit, labels[] (a link carries its two end labels), ref?, card} in ACTION-PRIORITY order. Labels and classes only, never a value. The reply names items by label; the checker returns the ids; an id never appears in the text."
      },
      "dsk_provenance": {
        "rule": "RC never asserts a DSK badge. A method turn shows DSK provenance only when SCIENCE/DSK's MethodScienceContext returns an applicable protocol id (one canonical lifecycle stage + every contraindication). No canonical stage, no citation. run.kind is currentness, never a stage. Without a badge the method still runs as product coaching.",
        "known_at_bundle_v1_0_0": [
          {
            "row": "RC-WIDEN W1/W5 after a Run (D2 run 2)",
            "dsk": "none",
            "why": "DSK-P-004 applies at frame|ideate only (DL 5933063973 (a))"
          },
          {
            "row": "RC-WIDEN W2/W2Z (one option, or none, against the status quo)",
            "dsk": "none at any stage",
            "why": "DSK-P-004 contraindication: 'Do not run for binary go/no-go decisions'"
          },
          {
            "row": "RC-PREMORTEM with one non-status-quo option",
            "dsk": "none",
            "why": "DSK-P-001 contraindication: only one option and no meaningful alternatives (PTL 5933036532 #3)"
          },
          {
            "row": "RC-PREMORTEM on an explicit request before evaluate",
            "dsk": "none",
            "why": "DSK-P-001 applies at evaluate|decide only"
          }
        ],
        "owner": "SCIENCE/DSK owns applicability and the badge; RC owns the method shape, checks and fallback; AI HARNESS composes (PTL 5933036532 owner split)."
      },
      "label_masking": {
        "rule": "Every text BAN (a pattern a reply must NOT contain) runs on the reply with the user's own labels blanked, PER BAN: a ban blanks only the labels in which that same ban matches (they are the user's words: 'Enterprise prospect signing likelihood' for PM-NO-PROB, 'Qualified leads per month' for RX-NO-LEADER-UNLICENSED), never a label it does not match (an unrelated label 'Will' must not hide 'This plan will fail'), and never a label that is nothing but banned words ('Odds', 'Leads': the check fails closed). Blanking is case-insensitive, curly quotes folded, longest label first, WHOLE TOKENS ONLY (a label is blanked only where no letter, digit or '_' touches either end; label matching is whole-token too). The candidate labels are model_labels (EVERY node label in the current model: goal, options, factors, risks, outcomes) plus the method's own labels: RC-PREMORTEM supplied_items + plan_label + current_option_labels; RERUN-EXPLANATION change_labels + current_option_labels; RC-WHAT-CHANGES factor_label; RC-STRENGTHEN-ITEM item_labels; RC-COACH-EDITS edited_labels.",
        "why": "A label the user wrote is grounding, not a claim. Served D1 (the investor decision) has the factor 'Enterprise prospect signing likelihood': without masking every grounded pre-mortem failed PM-NO-PROB and fell back (SCIENCE/DSK 5938372911). RC served-label scan (CEE staging fixtures, 1,440 labels / 305 graphs): goal labels with '%' ('Cut Burn Rate by 30%'), factor labels with 'leads' ('Qualified leads per month'), risk labels with '%' ('Churn above 4%'): none of them supplied items, so the mask set is every model label. PER BAN (CODEX_CLI_OVERFLOW on CEE #2480 P1 #4): blanking every label let a common-word label ('Will') erase Olumi's own 'will fail'. Re-scan at per-ban (1,074 labels / 359 CEE fixture graphs): 17 labels carry a ban hit (11 '%'/probability words, 5 'leads', 1 'significant'), all multi-word and still blanked; 0 are wholly a ban token, so failing closed costs no served label.",
        "never": "Mask Olumi's own words: only labels the inputs supply, only for a ban the label itself trips, only as whole tokens (option 'A' must never blank the 'a' in 'probability', HARNESS #2478 P1; label 'Will' must never blank 'will fail', #2480 P1 #4).",
        "reference": "tools/check_method_turn.py banned() + masked(); fixtures MT-PREMORTEM-D1-OWN-LABEL-GOOD / -BAD-CLAIM, MT-RERUN-MODEL-LABEL-GOOD / -BAD-LEADER, MT-PREMORTEM-SHORT-LABEL-GOOD / -BAD, MT-PREMORTEM-COMMON-WORD-LABEL-BAD, MT-RERUN-BARE-BAN-LABEL-BAD",
        "input": "model_labels: string[] = every node label of the current model (the caller has the graph)."
      },
      "internal_value_terms": {
        "rule": "An explanation never mentions an internal or normalised value. Term set (case-insensitive, on the reply with per-ban label masking, shared.label_masking): /\\b(internal scale|normali[sz]ed (value|values|scale|figures?)|unit interval)\\b/i.",
        "helper": "internalValueTerms(text, labels) -> string[]: the terms hit (lower-cased, unique, in order), after per-ban label masking (a user label such as 'Internal scale-up plan' is the user's word). It REPORTS and never edits.",
        "consumer": "AI HARNESS first-run explanation guard (agent.interpret): on ANY hit, replace the WHOLE explanation with the deterministic code line + next step and log explain.internal_value_fallback. Backstop only: the primary fix is input-side (no per-option normalised values or declared_scale on a withheld-leader turn), so the fallback count measures whether that input fix holds.",
        "why": "Served step 1 (CEE d0e566fc, guest 6452c258): 'its results are on an internal scale, not revenue units' is jargon to the user; driven by the coach template's 'label it explicitly as an internal scale' + normalised unit_interval values (RC #85 5945450369; HARNESS 5945457931).",
        "reference": "tools/check_method_turn.py internal_value_terms(); shared.internal_value_terms.cases (checked against the reference by build-cases.py)",
        "scope": "NOT a RERUN-EXPLANATION post-check (AI HARNESS CR on CEE #2505: RERUN-EXPLANATION checks are LIVE on the served M2 path, composeRerunExplanation drops sentences and rerunViewFailures hides the view). It joins a checker only in HARNESS's morning PR, measured on paired explain calls.",
        "cases": [
          {
            "text": "Continue Current Plan holds today’s recorded values; its results are on an internal scale, not revenue units.",
            "labels": [],
            "expect_terms": [
              "internal scale"
            ],
            "source": "served step 1, CEE d0e566fc guest 6452c258"
          },
          {
            "text": "Only normalised values exist, on the unit interval.",
            "labels": [],
            "expect_terms": [
              "normalised values",
              "unit interval"
            ]
          },
          {
            "text": "Internal scale-up plan rose.",
            "labels": [
              "Internal scale-up plan"
            ],
            "expect_terms": [],
            "note": "a user label carrying the term is the user's word"
          },
          {
            "text": "Internal scale is low.",
            "labels": [
              "Internal scale"
            ],
            "expect_terms": [
              "internal scale"
            ],
            "note": "a label that IS the term fails closed"
          },
          {
            "text": "Quarterly revenue figures are not available yet.",
            "labels": [],
            "expect_terms": [],
            "note": "contrast"
          }
        ]
      }
    },
    "RC-PREMORTEM": {
      "inputs": [
        "plan: option label (leader if licensed, else the user's explicit pick), or the whole decision in decision_plan mode with no option id; NOT a supplied item, so naming it alone is not grounding",
        "goal label, target and horizon if set",
        "supplied_items (shared.action_target.grounded_inputs_shape) in ACTION-PRIORITY order: (1) links on the plan's path with link_sizing placeholder or olumi_estimate, nearest the goal first (card propose_link_strengths); (2) goal-path factors whose value authorship is olumi_estimate, label + class only (card propose_assumptions); (3) risks on the plan's path (card propose_new_risk); (4) limits: label + verdict class (card propose_new_risk, a new risk into the limit)",
        "figures the user stated (label + value)"
      ],
      "body": "2 failure stories (at most 3) told in the past tense ('It is a year later and ‘Switch to GCP’ went badly because…'). Each story: one or two sentences, rests on at least one supplied item, then 'Watch for:' one early warning sign and 'Mitigate:' one action. Then ONE line 'Outside the model: …?': a blind spot the model does not capture (DSK-P-001 step 2), asked as a question, never asserted, never numbered.",
      "action": "ONE change card on action_target, the story target with the lowest supplied index, using that item's card: propose_link_strengths (Olumi's current band to accept or edit, the same door as M1's S1 card) for a link, propose_assumptions (the S3V card) for a factor, propose_new_risk ('Add this as a risk': a new risk linked into the target, label proposed from the story and editable on the card) for a risk or limit. Secondary: 'Talk it through'. Nothing is added without Apply.",
      "post_checks": [
        {
          "id": "PM-COUNT",
          "rule": "2 <= numbered_items <= 3"
        },
        {
          "id": "PM-GROUNDED",
          "rule": "every numbered item has a target (matches >= 1 supplied item); the plan label alone does not count"
        },
        {
          "id": "PM-WATCH-MITIGATE",
          "rule": "every numbered item contains 'Watch for:' and 'Mitigate:'"
        },
        {
          "id": "PM-NO-PROB",
          "rule": "no '%' and no /\\b(likely|likelihood|chance|probability|probable|odds)\\b/i anywhere (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "PM-NO-PREDICTION",
          "rule": "no /\\b(will|is going to|are going to) fail\\b/i (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "PM-PLAN-ONLY",
          "rule": "option plan: no current option label other than the plan's label_matches; decision_plan: each numbered story names at most one current option"
        },
        {
          "id": "PM-NO-WINNER",
          "rule": "decision_plan only: no winner, winning, recommend (including inflections), 'best option/choice/bet/path/plan', 'comes out ahead' or bare 'lead(s)' (not 'leads to') claim in Olumi's own text; ordinary prose such as quick wins, in the best case or the months ahead is allowed (shared.label_masking)"
        },
        {
          "id": "PM-BLINDSPOT",
          "rule": "exactly one blindspot_line; it ends with '?'; every numbered line comes before it"
        }
      ],
      "fallback": "Deterministic, no LLM: 'Imagine ‘{plan}’ has gone badly. Start with {first supplied item}: how would you notice it early, and what would you do?' with that item's card, plus 'Talk it through'.",
      "science": "Prospective hindsight (Mitchell, Russo & Pennington 1989; Klein 2007). DSK-P-001 provenance only through MethodScienceContext (shared.dsk_provenance).",
      "format": "Insight line, then 2-3 stories as a numbered list (each contains 'Watch for:' and 'Mitigate:'), then one 'Outside the model: …?' line.",
      "targets": "checkMethodTurn returns targets[]: one per numbered item (parsing.target). The harness picks action_target from them.",
      "wording_owner": "REASONING COACH owns the 'Outside the model: …?' wording and PM-BLINDSPOT (PTL 5933600218); PTL/DL may challenge.",
      "decision_plan": {
        "when": "user.explicit_request == RC-PREMORTEM AND the press is generic (static chip or menu, naming no option) AND run.leader_licensed == false AND no user.selected_option_id AND len(model.non_sq_option_ids) >= 2",
        "rule": "Stress-test the whole decision, with no single option id. Each story names at most one option; grounded items are the union of own (non-status-quo) option paths in the existing action-priority order. Never name a winner, best option or recommendation. Keep every existing pre-mortem gate and the Watch for: / Mitigate: / Outside the model: ...? shape."
      },
      "choose_plan": {
        "when": "user.explicit_request == RC-PREMORTEM AND the METHOD plan is unknown AND len(model.non_sq_option_ids) >= 1 AND decision_plan does not apply",
        "copy": "Which option do you want to stress-test?",
        "action_kind": "choose_1_of_3",
        "choices": "one button per model.non_sq_option_ids label (curly quotes, case kept), then 'Talk it through'",
        "never": "pick a plan for the user, or name a leader the Run did not license",
        "why": "A single own option is never auto-selected; an invalid option-naming press asks again rather than silently switching subject.",
        "then": "The press sets user.selected_option_id; the next method turn runs on that option (no second ask). METHOD plan = licensed leader > user.selected_option_id (still in non_sq). It is never auto-named (PTL 5933036532 #5, merged in SCIENCE/DSK #2466; SCIENCE/DSK 5937084931).",
        "row_press_is_a_pick": "Pressing the RC-PREMORTEM ROW whose copy names the user's single option ('Imagine ‘Switch to GCP’ has failed…') IS the explicit pick: HARNESS sets user.selected_option_id to that option, so there is no one-button question. A GENERIC press with one own option still gets choose_plan; with 2+ own options and no licensed leader or pick it gets decision_plan.",
        "row_subject": "The ROW's subject (copy + cooldown key) may name the single user option: that is not a leader claim. The METHOD plan sent to SCIENCE/DSK follows the precedence above."
      }
    },
    "RC-WIDEN": {
      "inputs": [
        "goal label and target",
        "current user options: label + ref + the factors each one changes",
        "Olumi-proposed options left out of the comparison: label + ref",
        "limits: label + verdict class",
        "variant (W1-W7) and target (options | risks | factors)",
        "the brief, verbatim"
      ],
      "body": "Up to 3 items that work through a materially DIFFERENT mechanism from the current ones (options), or name a different way the plan could fail (risks), or a different driver of the goal (factors). Each item: a name of 6 words or fewer, then one line saying what it changes and why it might do better. Start with any Olumi-proposed option already left out of the comparison.",
      "action": "Decision-point buttons: 'Add' per item, then 'Something else' (choose_1_of_3). Each Add lands as ONE change card on the item's refs: propose_new_option (a left-out Olumi option by its exact label = adoption; a new lever via its new_factors) for target options; propose_new_risk for risks; propose_new_factor for factors.",
      "post_checks": [
        {
          "id": "WD-COUNT",
          "rule": "1 <= bullet_items <= 3"
        },
        {
          "id": "WD-NO-DUP",
          "rule": "no bullet NAME equals (after normalise) a CURRENT user option, risk or factor label; supplied left-out Olumi option labels are exempt"
        },
        {
          "id": "WD-NO-NEW-FIGURES",
          "rule": "every number_token in the reply is supplied"
        },
        {
          "id": "WD-W1-NO-MEETS",
          "rule": "variant W1 only: no bullet matches /\\b(meets?|clears?|stays? (within|under)|within)\\b[^.]{0,40}\\blimit\\b/i"
        }
      ],
      "fallback": "Deterministic: list the Olumi-proposed options left out (if any) as Add buttons; else 'What other way could you reach {goal}? For example, a different lever, a smaller first step, or a mix of these options.' with 'Talk it through'.",
      "science": "Generating alternatives before evaluating; 'whether or not' framing fails more often (Nutt 1999; Keeney 1992; DSK-B-007). DSK-P-004 provenance only through MethodScienceContext (shared.dsk_provenance): never after a Run, never for go/no-go.",
      "format": "Insight line, then 1-3 items as bullets '- {name}: {one line on what it changes}'.",
      "structured_checks": {
        "owner": "AI HARNESS (method-turn output format); NOT in Ticket 1's text checker",
        "why": "A materially different option usually works through a lever that is not in the model yet, so free text cannot be checked against model factors.",
        "requires": "the method turn returns items as {name, mechanism_kind: new_lever | hybrid | left_out_option | existing_factor, refs[]}; refs are supplied ids (option, limit, shared-lever factor, risk or goal) that the gap rests on",
        "checks": [
          {
            "id": "WD-S-HYBRID",
            "rule": "mechanism_kind hybrid: refs include >= 2 current option refs"
          },
          {
            "id": "WD-S-EXISTING",
            "rule": "mechanism_kind existing_factor: the factor ref is not in the current options' shared lever set"
          },
          {
            "id": "WD-S-LEFTOUT",
            "rule": "mechanism_kind left_out_option: name equals a supplied left-out option label"
          },
          {
            "id": "WD-S-NEWLEVER",
            "rule": "mechanism_kind new_lever: name and lever do not normalise-equal any shared-lever factor label"
          },
          {
            "id": "WD-S-TARGET",
            "rule": "every item has >= 1 ref and every ref is a supplied id (the gap it rests on; DL 5933063973 addition 1)"
          }
        ]
      }
    },
    "RC-WHAT-CHANGES": {
      "inputs": [
        "Current tipping_point: factor_id, label, current_value, threshold, direction, unit and code-owned say, on the selected canonical Run; no leader or EVPPI prerequisite",
        "decision_sensitivity.most_sensitive: factor label + ref, current value + unit, whose figure (yours | Olumi's estimate), range source",
        "leader label (licensed only)",
        "other compared options: labels"
      ],
      "body": "With a current tipping_point, begin with tipping_point.say verbatim. Optional short elaboration may add no figures, crossing assertions, probabilities or winner language. Otherwise retain the existing qualitative sensitivity method. One line on what the analysis varied ('Olumi varied {factor} within the range it assumed'). Then up to 3 bullets on what would have to be true about {factor} for more runs to support a different option, said qualitatively. Then the question asking for the user's estimate.",
      "action": "'Give your estimate' (edit_inline on the factor) when the range is Olumi's; else 'Talk it through'.",
      "post_checks": [
        {
          "id": "WC-NAMES-FACTOR",
          "rule": "label_matches the supplied factor label"
        },
        {
          "id": "WC-NO-NEW-FIGURES",
          "rule": "Legacy: every number_token is the current value or a user figure. With a typed tipping_point, all figures and units come from its exact code-owned say; optional elaboration contains no figures. No rounding, decimal-shift or additional threshold is accepted."
        },
        {
          "id": "WC-NO-NOTHING",
          "rule": "no /nothing would change|no single (assumption|factor)/i (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "WC-BANNED",
          "rule": "No EVPI/EVPPI/sensitivity score/elasticity. Existing qualitative method forbids %. Tipping-point units may contain % only in the exact code-owned sentence; elaboration may contain no %, probability, odds or chance claim."
        },
        {
          "id": "WC-TIPPING-FACT",
          "rule": "When tipping_point is supplied: run.kind == complete_current; factor_label equals its label; reply begins with its exact code-owned say. Elaboration adds no figures, crossing/direction assertion or winner/ranking claim."
        }
      ],
      "fallback": "With a current tipping_point, its code-owned say verbatim. Otherwise: Deterministic: the row's reasoning_question with the 'Give your estimate' action.",
      "science": "Value of information: attention goes to the input that can change the choice (Howard 1966).",
      "format": "Insight line naming what was varied, up to 3 bullets on what would have to be true, then the question.",
      "honest_limit": {
        "when": "No current grounded tipping_point, and: The user explicitly asks (menu, chip or user.explicit_request) AND run.decision_sensitivity.status in [none_measurable, not_measured]. The row is never OFFERED in this state; this is how the method answers when asked.",
        "text": "Olumi can't yet measure what would change this choice in this model. The most useful thing to check meanwhile is {item_label}: it is Olumi's estimate and it sits on the path to your goal.",
        "item": "The RC-STRENGTHEN-ITEM pick (S1, then S3L, then S3V). With no Olumi estimate on a goal path, drop the second sentence.",
        "action": {
          "label": "Give your estimate",
          "action_kind": "edit_inline",
          "target": "item"
        },
        "deterministic": "Fixed text: no LLM call. This is DL moment (b) 'or an honest limit', handing over to moment (a).",
        "never": [
          "'No single assumption measurably changes which option leads' or any rewording of it (AIQ P3C A2)",
          "any claim that the choice is robust, safe or settled"
        ],
        "wording_owner": "REASONING COACH owns this copy (PTL 5933600218: AIQ is not a live lane); PTL/DL may challenge.",
        "item_label": "link → 'how much {from} affects {to}'; factor → 'the figure for {label}' (label case rule applies)"
      }
    },
    "RC-STRENGTHEN-ITEM": {
      "inputs": [
        "the item: link (from/to labels) or factor (label, current value + unit)",
        "whose figure (link_sizing / value_authorship)",
        "options whose goal figures depend on it"
      ],
      "body": "Up to 3 bullets: what the figure means in plain words; one cheap way to pin it down (a number the user may already have, a quick test, someone to ask); what the user's own estimate would change for the comparison.",
      "action": "ONE card per card_first (opens with the reply, no LLM): 'Give your estimate' (edit) with 'Use Olumi's estimate' (accept) as the secondary.",
      "post_checks": [
        {
          "id": "ST-NAMES-ITEM",
          "rule": "label_matches the item's label (both labels for a link)"
        },
        {
          "id": "ST-BANNED",
          "rule": "no /\\b(placeholder|edge|node|default strength)\\b/i (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "ST-NO-NEW-FIGURES",
          "rule": "every number_token is the item's current value or a user figure"
        }
      ],
      "fallback": "Deterministic: the row's reasoning_question with the inline edit.",
      "science": "Assumption-based planning (Dewar 2002).",
      "format": "Up to 3 bullets: what the figure means, one cheap way to pin it down, what the user's estimate would change.",
      "card_first": {
        "rule": "Pressing the row opens ONE card for the item at once, deterministically, with no LLM call: the reply is the row's fixed copy (title + reasoning_question) plus the card. An LLM body (below) is optional, may follow, and never gates or delays the card.",
        "card_by_variant": {
          "S1 (placeholder link on the CURRENT Run's analysed options)": "HARNESS calls the existing propose_link_strengths door with ONE link, its current band and no from_words; the existing model-proposed/CAS/approval/readback logic owns the card. 'Edit the strength' (the amend chip) is a first-class choice (DL 5933793238 #3)."
        },
        "then": "Apply → Run goes stale → rerun → Changes delta + RERUN-EXPLANATION (a cause only for C1_attributable).",
        "why": "R3 5933558156 (D1, CEE 62730d66): the static 'Strengthen the model' gave a GOOD grounded challenge but no card, so no typed action, a C0_identical rerun and 37.1 s. M1 must be actionable and fast (PTL 5933452605).",
        "owner": "AI HARNESS composes the card through the existing door (T2/T3); RC owns this rule.",
        "served_status": "UI for the S1 one-click is NOT served (DGAI #2408 open). The propose_link_strengths approval card renders today through the existing approval chips (agent-approve-proposal / agent-amend-proposal).",
        "scope": "FAST PATH = S1 ONLY (PTL 5933844703 #2). S3L/S3V are still selected and offered, but their press runs the ordinary method turn: an Olumi-estimated link is not writable as a no-change accept through today's propose_link_strengths, and propose_assumptions keep:true needs the user to have said the estimate is right.",
        "authorship": "Apply on accept records Olumi's estimate, accepted by you (olumi_accepted); never user_stated (DL 5933793238 #2). An edited strength is the user's.",
        "pass_bar": "R3's investor row passes only if the rerun's Changes delta shows a moved or un-withheld figure (the R2 withhold lifts once the link is sized), not a provenance-only change (DL 5933793238 #3, 5933799344 #3).",
        "one_picker": "The S1 target comes from ONE pure helper that T1's selector also imports (DL #1, PTL #1/#5). The fast path never re-implements the pick.",
        "ui_path": "When T4 (PANEL) renders the RC-STRENGTHEN-ITEM row, its ONE action may invoke the SERVED Reasoning-tab controls for the row's item instead of a chat card: 'Accept Olumi's estimate' = #2408 proposeEdgeStrengthConfirmation, 'Edit the strength' = openEdgeStrengthEditor (first-class). Same authority, same olumi_accepted result, 0 LLM, no CEE press branch needed. The row (title + reasoning_question) is still required: it is M1's 'Olumi surfaced the challenge'; the option-row 'N links not sized yet' is a status control, not the challenge (DL script 5937131361)."
      }
    },
    "RC-COACH-EDITS": {
      "inputs": [
        "uncoached goal-path edits: label, field, before, after",
        "options whose path the edited item sits on",
        "run.kind (current | stale)"
      ],
      "body": "One-line insight. Then at most 3 bullets: (1) what changed, before and after; (2) the assumption or trade-off it touches; (3) which conclusion may now change. Last line, only if run.kind is complete_stale: 'The analysis is out of date.' and offer a rerun.",
      "action": "'Rerun' only when stale and the model may run; else none (coaching only).",
      "post_checks": [
        {
          "id": "CE-NAMES-EDITS",
          "rule": "label_matches every edited item's label (up to 3)"
        },
        {
          "id": "CE-STALE-IFF",
          "rule": "/out of date/i present if and only if run.kind == complete_stale"
        },
        {
          "id": "CE-NO-RESULT-CLAIM",
          "rule": "no /\\b(the result (has )?changed|now leads|is now ahead|the answer is now)\\b/i (on the label-masked reply, shared.label_masking)"
        }
      ],
      "fallback": "Deterministic: 'You changed {edit list}. That changes {assumption}. ' + the stale line when stale.",
      "science": "Timely feedback on one's own change (Kahneman & Klein 2009); consider the implications (DSK-P-003).",
      "format": "Insight line, then up to 3 bullets (what changed, the assumption it touches, what may change), then the stale line only if stale."
    },
    "RERUN-EXPLANATION": {
      "purpose": "DL moment (c): revise → rerun → explain the difference. The narration of a RERUN (request 2) follows this; owner AI HARNESS (narration), signals from run_delta (CEE, strict schema).",
      "inputs": [
        "run_delta.attribution_case: C0_identical | C1_attributable | C2_unpaired",
        "run_delta.input_changes[]: label, field, before, after",
        "run_delta.input_coverage",
        "run_delta.leader.changed + noise_verdict",
        "run.leader_licensed",
        "no_matched_figures: run_delta.win_probabilities is empty (AVAILABLE today: 'no comparable pair', any cause)",
        "prior_withheld: run_delta.win_probabilities_unavailable == 'prior_withheld' (schemas 0.70.0, emitted by CEE; 52f8cd 5937207590)."
      ],
      "body": {
        "C0_identical": "Same inputs as the last run; say the result is unchanged, nothing more.",
        "C1_attributable": "Name each change (up to 3, before → after). Say what moved in the comparison. A cause may be stated, because the pair isolates the edit.",
        "C2_unpaired": "Name each change. Say the two runs differ in more than your edit (a new draw), so Olumi can't attribute the difference to the edit alone. State no cause.",
        "UNWITHHELD": "Only when prior_withheld is TRUE (typed; never inferred from an empty array): name each change and say that Olumi can now compare the options. Say the change is what held the comparison back ONLY when attribution_case is C1_attributable; otherwise give the case line instead (C2 / C3–C5) and never credit the edit (an engine-drift pair can un-withhold beside an unrelated edit; 52f8cd + Codex on CEE 864e915c). Never describe a movement: the earlier run held its comparison figures back. Name a leader only if run.leader_licensed (with its caveat).",
        "NO_MATCHED_FIGURES": "When no_matched_figures and prior_withheld is not true: name each change and describe no movement; say only what the run now shows (CANVAS's interim pill: 'This pair has no matched figures to compare.')."
      },
      "format": "One-line insight, then up to 3 bullets (one per change), then one line on what moved.",
      "post_checks": [
        {
          "id": "RX-NAMES-CHANGES",
          "rule": "label_matches every input_changes label (up to 3)"
        },
        {
          "id": "RX-NO-CAUSE-UNPAIRED",
          "rule": "if attribution_case != C1_attributable: no /\\b(because (you|of your)|caused|due to your|as a result of your|led to|held (the|its) comparison back)\\b/i (on the label-masked reply, shared.label_masking)",
          "source": "; + 'held the comparison back' (the contract's own UNWITHHELD template; 52f8cd 2 Oct)"
        },
        {
          "id": "RX-NO-LEADER-UNLICENSED",
          "rule": "if run.leader_licensed is false: no current option label appears together with /\\b(leads|ahead|best|wins|now first)\\b/i in the same sentence (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "RX-NOISE",
          "rule": "if leader.noise_verdict is not_noise_qualified: no /\\b(significant|meaningful(ly)? (better|worse)|clearly (better|worse))\\b/i (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "RX-NO-MOVEMENT-WITHOUT-PRIOR",
          "rule": "if prior_withheld OR no_matched_figures: no /\\b(rose|fell|moved|increased|decreased|went (up|down)|up from|down from|jumped|dropped|climbed)\\b/i (on the label-masked reply, shared.label_masking)"
        },
        {
          "id": "RX-NO-CONTRARY-SAME",
          "rule": "if change_labels is non-empty (changes are recorded): no claim that nothing or no input changed, the WHOLE class: /\\b(nothing('s| has| had)? changed|nothing (was|has been|had been) changed|nothing in (your|the) model('s| has| had)? changed|same inputs?|inputs?( values)? (were|was|are|is|stayed|remained|have stayed|have remained) (unchanged|the same)|unchanged inputs?|(no|none of the) inputs? (were |was |have been |has been )?changed|no changes? (were|was|have been|has been) made|(didn'?t|did not|haven't|have not|hasn't|has not) changed? anything)\\b/i (on the label-masked reply, shared.label_masking). 'Nothing else changed.' is the honest control and passes.",
          "source": "MG 5939414835; class widened per CODEX CEE BUDDY 5940259670 (seven forms passed the two-phrase ban); MG 5940298428 ('No changes were made.')"
        },
        {
          "id": "RX-UNWITHHELD-LINE",
          "rule": "if prior_withheld: the reply carries 'can now compare the options' (whole-token label_matches), the UNWITHHELD line",
          "source": "MG 5939414835"
        }
      ],
      "fallback": "Deterministic: 'You changed {changes}. ' + (UNWITHHELD + C1: 'That was what held the comparison back, so Olumi can now compare the options.' | UNWITHHELD otherwise: 'Olumi can now compare the options.' + the case line | C2: 'Olumi can’t confirm both runs used the same draw, so the difference can’t be put down to your edit alone.' | C3/C4 (recorded difference): 'Other things also differed between these two runs, so the difference can’t be put down to your edit alone.' | partial coverage or C5_unattributed: 'Olumi can’t confirm nothing else differed between these two runs, so the difference can’t be put down to your edit alone.' | C1: 'The comparison was rerun on the same draw.' | C0: 'Nothing else changed.')",
      "change_label_templates": {
        "accept_olumi_estimate": {
          "when": "run_delta.input_changes[] row with field 'sizing', before 'placeholder', after 'olumi_accepted'",
          "label": "You accepted Olumi's estimate for how much {from} changes {to}."
        },
        "user_estimate": {
          "when": "run_delta.input_changes[] row with field 'sizing', after 'user' (linkSizing literal, CEE src/cee/magnitude/link-sizing.ts:30 @8ee43f7a; the 'Edit the strength' path)",
          "label": "You gave your own estimate for how much {from} changes {to}."
        },
        "source": "@talchain/schemas 0.70.0 (additive; 52f8cd 5937207590 + 5937225976): snapshot links[].sizing + links[].band, RunInputField 'sizing' (raw linkSizing classes) and 'strength' (raw band words); a mean move inside one band and one sizing stays partial with no row. CEE emits only once the UI vendors 0.70.",
        "why": "A provenance-only Accept or edit must still be named as a change (R3 5936613334; DL 5936679883 owner chain: 52f8cd producer, CANVAS words).",
        "strength": {
          "when": "run_delta.input_changes[] row with field 'strength' (band word before → after; 52f8cd addendum 5937225976)",
          "label": "You changed how much {from} changes {to}: {before} → {after}."
        },
        "one_sentence_per_link": {
          "rule": "A 'sizing' row and a 'strength' row for the SAME link (same label) are ONE change: one sentence, one bullet, and one entry in the up-to-3 count.",
          "label": "You gave your own estimate for how much {from} changes {to}: {before} → {after}.",
          "why": "'Edit the strength' writes both rows (sizing placeholder → user, band moved); two bullets for one edit reads as two edits."
        }
      },
      "investor_moment": "M2 on the ruled seed (eeeff8b4): Accept both unsized links → Run → the comparison appears for the first time (R3 5936720411: provisional leader + win shares). This is the UNWITHHELD transition.",
      "change_labels_reading": "change_labels (RX-NAMES-CHANGES) = the RENDERED change_label_templates sentence per change (a link row has no label of its own; sizing + strength on one link = ONE sentence; a non-link row = \"You changed {label}: {before} → {after}.\"). The Agent is handed these exact sentences; a reply that does not carry each one falls back. Agreed with MG 5939033153.",
      "attribution_case_mapping": "Wire C3/C4/C5 (other differences, e.g. engine drift) are checked as C2_unpaired (no cause allowed).",
      "fallback_variants": {
        "sentences": "When change_labels are sentences, {changes} = those sentences joined, then the case line (never 'You changed You accepted…').",
        "C2_unpaired": "Olumi can’t confirm both runs used the same draw, so the difference can’t be put down to your edit alone.",
        "why": "'a new draw' is false for engine drift (MG 5939033153), and C2 is assigned whenever the draw is NOT shown equal, including an unrecorded draw structure, so C2 says Olumi can't confirm the same draw. 'Other things also differed' is only for RECORDED differences (C3, C4); partial coverage and C5_unattributed say Olumi can't confirm nothing else differed (52f8cd HIGH PR, Codex round 3, MG/DL wording).",
        "C3_C4_recorded": "Other things also differed between these two runs, so the difference can’t be put down to your edit alone.",
        "unverified": "Olumi can’t confirm nothing else differed between these two runs, so the difference can’t be put down to your edit alone."
      }
    }
  }
} as const;

export const SPEC_SHA = "712625a1c484943ad330214504634121a44216e7";
