// Generated typed constants from the byte-identical policy beside this file.
// programme-docs @ 6c4fbffdb4a7f783de9efbfb9eb2f2a25a73079b.
// The acceptance suite asserts equality with the pinned source.
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
    "state_key_persistence": "Persist state_key as a SHA-256 hex prefix (12 chars) of the canonical JSON of its fields. Never persist raw values (coaching_state is content-free).",
    "cold_reload": "Guidance must round-trip through coaching_state: a pressed or dismissed row stays hidden after a cold reload with an unchanged state_key (#2388 two-load lesson).",
    "cooldown_scope": "Variant rows (RC-WIDEN): pick the first variant that holds, THEN apply cooldown to that pick; a row in cooldown does NOT fall through to its later variants (case A-WIDEN-SAME-KEY-HIDDEN: W1 dismissed, W2 also holds, RC-WIDEN stays hidden). Item rows (RC-STRENGTHEN-ITEM): cooldown is per item, so a cooled item falls through to the next candidate in pick order, and across variants (S1, then S2, S3L, S3V)."
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
            "id": "W2",
            "target": "options",
            "priority": "P1",
            "when": "len(model.non_sq_option_ids) <= 1"
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
      "priority": "per variant (W1, W2 = P1; W3-W6 = P3; W7 = P5)",
      "reasoning_question": {
        "W1": "None of these looks likely to stay within your limit. Is there another way to get there?",
        "W2": "Is it really just {option_label} or carry on as now? What other routes are there?",
        "W3": "These options all pull the same lever. Is there a different way to reach the goal?",
        "W4": "Would carrying on as now be a real option worth comparing against?",
        "W5": "These options come out about the same. Is there a hybrid that takes the best of each?",
        "W6": "What else could stop this working?",
        "W7": "What else really drives {goal_label}?"
      },
      "short_copy": {
        "W1": "Every option looks likely to break your limit. Worth finding another route?",
        "W2": "Only one real option on the table. Decisions go better with alternatives.",
        "W3": "These options all work through the same lever. A different mechanism?",
        "W4": "Comparing against 'carry on as now' shows what each change really adds.",
        "W5": "The options come out close. A hybrid might beat both.",
        "W6": "Only one risk is on the map. What else could go wrong?",
        "W7": "Few drivers are mapped for {goal_label}. What else moves it?"
      },
      "why_now": {
        "W1": "The analysis checked your limit and no option clears it.",
        "W2": "There is one option besides carrying on as now.",
        "W3": "Most of the options change the same factors.",
        "W4": "There is no 'carry on as now' option to compare with.",
        "W5": "The analysis could not separate the options.",
        "W6": "The model has at most one risk.",
        "W7": "Two or fewer factors lead to the goal."
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
        "note": "W2-W4 and W7 keys exclude withheld_reason, so a new limit verdict alone does not bring the row back. Options added through this method change the key; the row returns only while a variant still holds."
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
          "DSK-P-004 (opportunity cost prompting, elicit_options)",
          "DSK-B-007 (option-set size)"
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
        "A-TWO-LOAD-HIDDEN-AFTER-RELOAD"
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
          "run.leader_licensed == true",
          "run.decision_sensitivity.status == measured"
        ]
      },
      "required_typed_signals": [
        "run.kind",
        "run.leader_licensed",
        "run.decision_sensitivity",
        "turn.request"
      ],
      "forbidden_without": [
        "run.leader_licensed",
        "run.decision_sensitivity.status == measured"
      ],
      "silent_when": [
        "open.decision_point",
        "turn.request == run_result",
        "run.decision_sensitivity.status in [none_measurable, not_measured]",
        "run.kind != complete_current (stale, withheld or no run)",
        "run.leader_licensed != true",
        "guidance[RC-WHAT-CHANGES] pressed, dismissed or completed with an unchanged state_key"
      ],
      "priority": "P2",
      "reasoning_question": {
        "range_olumi_assumed": "Do you know {factor_label} more precisely? Within Olumi's assumed range it could change which option leads.",
        "range_yours_or_unknown": "Would {leader_label} still be the best choice if {factor_label} turned out different?"
      },
      "short_copy": "{factor_label} could change which option leads.",
      "why_now": "The analysis found that the answer is sensitive to {factor_label}.",
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
        ]
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
        "A-STALE-SILENT"
      ],
      "note": "Expect this row to fire rarely today: factor_evppi is structurally flat in additive lever models (P3C A2), and every served run read on 1 Oct had EVPPI empty or below resolution and every flip_thresholds row no_flip_in_range. Silence is the correct output there. It fires once identity kinds (product, stock-flow) make a factor interact with a lever."
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
        "S2": "{factor_label} is Olumi's estimate, and the answer is sensitive to it.",
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
          "item value or strength band (hashed)",
          "model.link_sizing(item) or model.value_authorship(item)"
        ],
        "scope": "per item: dismissing X does not block Y"
      },
      "cooldown_rule": "Default cooldown, per item. At most one RC-STRENGTHEN-ITEM offer per turn.",
      "reentry_rule": "Item X returns only if its value, strength or authorship changes, or it becomes S1/S2 after a new Run.",
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
        "explicit_request": "On user.explicit_request with a goal and at least one option, run it at any stage. With no current Run, use the qualitative protocol: no invented winner, probability or figure (SCI-09)."
      },
      "required_typed_signals": [
        "model.goal_horizon",
        "model.goal_present",
        "model.non_sq_option_ids",
        "model.risk_ids",
        "run.kind",
        "run.leader_licensed",
        "turn.request"
      ],
      "forbidden_without": [
        "model.goal_present",
        "a plan to stress: a licensed leader, or a single option with a risk on the map, or an explicit request"
      ],
      "silent_when": [
        "open.decision_point",
        "turn.request == run_result",
        "guidance[RC-PREMORTEM] completed with an unchanged state_key (never rerun without new cause, SCI-08)",
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
        "note": "Deliberately excludes the risk set. Risks added by the pre-mortem itself must not make it come back (SCI-08)."
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
          "DSK-P-001 (Pre-mortem exercise)"
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
          "sorted (entity_id, field, after-value hash) of uncoached edits"
        ]
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
    "label_case": "Option labels ({option_label}, {plan_label}, {leader_label}) are quoted in single curly quotes and keep their case: 'Imagine ‘Switch to GCP’ has failed.' Other mid-sentence labels lower-case their first letter unless the first word is an acronym or proper noun (second letter upper-case, e.g. 'GCP', 'AI'). A label that opens the sentence keeps its capital."
  },
  "method_turns": {
    "purpose": "What a method must produce when pressed. Every post_check is a DETERMINISTIC text rule with an id (Ticket 1 implements all of them in checkMethodTurn). Rules that need structured output are listed under structured_checks; they are AI HARNESS's (method-turn output format) and are NOT part of the text checker. If a text check fails, send the deterministic fallback instead.",
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
        "numbered_items": "items start on a new line with /^\\s*[1-9]\\.\\s/ ; an item runs until the next numbered line or the end",
        "bullet_items": "items start on a new line with /^\\s*-\\s/ ; the item NAME is the text before the first ':' on that line",
        "normalise": "lower-case, curly quotes to straight, strip punctuation and collapse whitespace",
        "label_match": "case-insensitive substring match of a supplied label after normalise, or a supplied ref (O1, F2, R1) as a whole word",
        "number_tokens": "/(?<![A-Za-z])[£$€]?\\d[\\d,]*(\\.\\d+)?\\s*(%|k|m|bn)?/i, ignoring list markers at the start of a line; a token is 'supplied' if its digits appear in the inputs, the brief or the user's messages"
      }
    },
    "RC-PREMORTEM": {
      "inputs": [
        "plan: option label + ref (leader if licensed, else the single user option)",
        "goal label, target and horizon if set",
        "risk nodes on the plan's path: label + ref",
        "links on the plan's path with link_sizing placeholder or olumi_estimate: from/to labels",
        "limits: label + verdict class (met | likely broken | not checked)",
        "figures the user stated (label + value)"
      ],
      "body": "2-3 failure stories told in the past tense ('It is a year later and ‘Switch to GCP’ went badly because…'). Each story: one or two sentences, names at least one supplied item, then 'Watch for:' one early warning sign and 'Mitigate:' one action.",
      "action": "'Add this as a risk' (a change card for one story's risk, nothing added without Apply) or 'Talk it through'.",
      "post_checks": [
        {
          "id": "PM-COUNT",
          "rule": "2 <= numbered_items <= 3"
        },
        {
          "id": "PM-GROUNDED",
          "rule": "every numbered item label_matches >= 1 supplied label or ref"
        },
        {
          "id": "PM-WATCH-MITIGATE",
          "rule": "every numbered item contains 'Watch for:' and 'Mitigate:'"
        },
        {
          "id": "PM-NO-PROB",
          "rule": "no '%' and no /\\b(likely|likelihood|chance|probability|probable|odds)\\b/i anywhere"
        },
        {
          "id": "PM-NO-PREDICTION",
          "rule": "no /\\b(will|is going to|are going to) fail\\b/i"
        },
        {
          "id": "PM-PLAN-ONLY",
          "rule": "no current option label other than the plan's label_matches"
        }
      ],
      "fallback": "Deterministic, no LLM: 'Imagine ‘{plan}’ has gone badly. Start with {first risk or Olumi-estimated link}: how would you notice it early, and what would you do?' plus the 'Talk it through' action.",
      "science": "Prospective hindsight (Mitchell, Russo & Pennington 1989; Klein 2007; DSK-P-001).",
      "format": "Insight line, then 2-3 stories as a numbered list; each story contains 'Watch for:' and 'Mitigate:'."
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
      "action": "Decision-point buttons: 'Add' per item, then 'Something else' (choose_1_of_3). Each Add lands as ONE change card.",
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
      "science": "Generating alternatives before evaluating; 'whether or not' framing fails more often (Nutt 1999; Keeney 1992; DSK-P-004, DSK-B-007).",
      "format": "Insight line, then 1-3 items as bullets '- {name}: {one line on what it changes}'.",
      "structured_checks": {
        "owner": "AI HARNESS (method-turn output format); NOT in Ticket 1's text checker",
        "why": "A materially different option usually works through a lever that is not in the model yet, so free text cannot be checked against model factors.",
        "requires": "the method turn returns items as {name, mechanism_kind: new_lever | hybrid | left_out_option | existing_factor, refs[]}",
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
          }
        ]
      }
    },
    "RC-WHAT-CHANGES": {
      "inputs": [
        "decision_sensitivity.most_sensitive: factor label + ref, current value + unit, whose figure (yours | Olumi's estimate), range source",
        "leader label (licensed only)",
        "other compared options: labels"
      ],
      "body": "One line on what the analysis varied ('Olumi varied {factor} within the range it assumed'). Then up to 3 bullets on what would have to be true about {factor} for a different option to come out ahead, said qualitatively. Then the question asking for the user's estimate.",
      "action": "'Give your estimate' (edit_inline on the factor) when the range is Olumi's; else 'Talk it through'.",
      "post_checks": [
        {
          "id": "WC-NAMES-FACTOR",
          "rule": "label_matches the supplied factor label"
        },
        {
          "id": "WC-NO-NEW-FIGURES",
          "rule": "every number_token is the factor's current value or a user figure"
        },
        {
          "id": "WC-NO-NOTHING",
          "rule": "no /nothing would change|no single (assumption|factor)/i"
        },
        {
          "id": "WC-BANNED",
          "rule": "no /\\b(EVPI|EVPPI|sensitivity score|elasticity)\\b/i and no '%'"
        }
      ],
      "fallback": "Deterministic: the row's reasoning_question with the 'Give your estimate' action.",
      "science": "Value of information: attention goes to the input that can change the choice (Howard 1966).",
      "format": "Insight line naming what was varied, up to 3 bullets on what would have to be true, then the question."
    },
    "RC-STRENGTHEN-ITEM": {
      "inputs": [
        "the item: link (from/to labels) or factor (label, current value + unit)",
        "whose figure (link_sizing / value_authorship)",
        "options whose goal figures depend on it"
      ],
      "body": "Up to 3 bullets: what the figure means in plain words; one cheap way to pin it down (a number the user may already have, a quick test, someone to ask); what the user's own estimate would change for the comparison.",
      "action": "'Give your estimate' (edit_inline), with 'Use Olumi's estimate' (confirm) as the secondary.",
      "post_checks": [
        {
          "id": "ST-NAMES-ITEM",
          "rule": "label_matches the item's label (both labels for a link)"
        },
        {
          "id": "ST-BANNED",
          "rule": "no /\\b(placeholder|edge|node|default strength)\\b/i"
        },
        {
          "id": "ST-NO-NEW-FIGURES",
          "rule": "every number_token is the item's current value or a user figure"
        }
      ],
      "fallback": "Deterministic: the row's reasoning_question with the inline edit.",
      "science": "Assumption-based planning (Dewar 2002).",
      "format": "Up to 3 bullets: what the figure means, one cheap way to pin it down, what the user's estimate would change."
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
          "rule": "no /\\b(the result (has )?changed|now leads|is now ahead|the answer is now)\\b/i"
        }
      ],
      "fallback": "Deterministic: 'You changed {edit list}. That changes {assumption}. ' + the stale line when stale.",
      "science": "Timely feedback on one's own change (Kahneman & Klein 2009); consider the implications (DSK-P-003).",
      "format": "Insight line, then up to 3 bullets (what changed, the assumption it touches, what may change), then the stale line only if stale."
    }
  }
} as const;

export const SPEC_SHA = "6c4fbffdb4a7f783de9efbfb9eb2f2a25a73079b";
