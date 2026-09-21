# W3-A live witness — SDL state spine

- generated (UTC): 2026-09-21T23:05:29.788Z
- base URL: https://cee-staging.onrender.com
- served build (recorded per step): bd35cc9
- served graph_cas: `{"app_mode":"observe","rpc_mode":"enforce","enforcing":true,"requires_expected_hash":true}`
- repo HEAD asserted: e717e19d05542a80254ea056aa95a59c2cde4053
- scenario_id: `ee26ba7c-0006-47e6-8bc1-9c8cc269c681`
- identity hash A: `bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd`
- identity hash B: `8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806`

## Steps

### seed.turn1 — 2026-09-21T22:55:01.624Z

```json
{
  "step": "seed.turn1",
  "at_utc": "2026-09-21T22:55:01.624Z",
  "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
  "status": 200,
  "ms": 51338,
  "carried_graph": false,
  "build_sha": null,
  "receipt": null
}
```

### seed.turn2 — 2026-09-21T22:55:10.143Z

```json
{
  "step": "seed.turn2",
  "at_utc": "2026-09-21T22:55:10.143Z",
  "turn_id": "69c003bb-6664-4458-8156-afffc6b33361",
  "status": 200,
  "ms": 8517,
  "carried_graph": false,
  "build_sha": null,
  "receipt": null
}
```

### seed.assert — 2026-09-21T22:55:10.853Z

```json
{
  "step": "seed.assert",
  "at_utc": "2026-09-21T22:55:10.853Z",
  "scenario_id": "ee26ba7c-0006-47e6-8bc1-9c8cc269c681",
  "graph_identity_hash_A": "bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd",
  "graph_identity_hash_non_null": true,
  "user_id": null,
  "committing_turn_id": null,
  "option_node_ids": null,
  "head_mover_node_id": null,
  "spine": {
    "at_utc": "2026-09-21T22:55:10.853Z",
    "scenarios": [
      {
        "id": "ee26ba7c-0006-47e6-8bc1-9c8cc269c681",
        "user_id": null,
        "graph_identity_hash": "bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd",
        "current_model_version_id": null,
        "updated_at": "2026-09-21T22:55:02.480791+00:00",
        "event_seq": 0
      }
    ],
    "model_versions": [],
    "v5_conversation_turns": [
      {
        "id": "60beee4e-f259-4552-ad9c-781fc125e274",
        "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
        "turn_class": "direct_answer",
        "handler_id": null,
        "model_version_mutation_id": "64fb167b-d230-52a7-a637-9022cc24989f",
        "model_version_created": false,
        "created_at": "2026-09-21T22:55:00.236344+00:00"
      },
      {
        "id": "393fec03-7f5c-481e-ab81-1f93b618c3d0",
        "turn_id": "36a12764-484b-48d7-a0d1-eeb0dfcd4c79",
        "turn_class": "clarify",
        "handler_id": null,
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:55:10.161978+00:00"
      }
    ],
    "v5_handler_facts": {
      "__error": "HTTP 400",
      "__detail": "{\"code\":\"42703\",\"details\":null,\"hint\":null,\"message\":\"column v5_handler_facts.turn_id does not exist\"}"
    },
    "v5_turn_fence": [
      {
        "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
        "generation": 24367,
        "stopped_at": null,
        "created_at": "2026-09-21T22:54:10.98059+00:00"
      },
      {
        "turn_id": "69c003bb-6664-4458-8156-afffc6b33361",
        "generation": 24368,
        "stopped_at": null,
        "created_at": "2026-09-21T22:55:02.117027+00:00"
      }
    ]
  }
}
```

### mutate — 2026-09-21T22:57:22.957Z

```json
{
  "step": "mutate",
  "at_utc": "2026-09-21T22:57:22.957Z",
  "turn_id": "fc74bb6f-1e92-42ac-a8bd-b850f412d7cd",
  "status": 200,
  "ms": 30973,
  "build_sha": null,
  "model_version_receipt": null,
  "head_before": "bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd",
  "head_after": "bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd",
  "head_moved": false,
  "error": null,
  "spine_after": {
    "at_utc": "2026-09-21T22:57:22.956Z",
    "scenarios": [
      {
        "id": "ee26ba7c-0006-47e6-8bc1-9c8cc269c681",
        "user_id": null,
        "graph_identity_hash": "bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd",
        "current_model_version_id": null,
        "updated_at": "2026-09-21T22:55:38.95948+00:00",
        "event_seq": 0
      }
    ],
    "model_versions": [],
    "v5_conversation_turns": [
      {
        "id": "60beee4e-f259-4552-ad9c-781fc125e274",
        "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
        "turn_class": "direct_answer",
        "handler_id": null,
        "model_version_mutation_id": "64fb167b-d230-52a7-a637-9022cc24989f",
        "model_version_created": false,
        "created_at": "2026-09-21T22:55:00.236344+00:00"
      },
      {
        "id": "393fec03-7f5c-481e-ab81-1f93b618c3d0",
        "turn_id": "36a12764-484b-48d7-a0d1-eeb0dfcd4c79",
        "turn_class": "clarify",
        "handler_id": null,
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:55:10.161978+00:00"
      },
      {
        "id": "19c71b99-4be8-48b5-aa7f-f2084d964edc",
        "turn_id": "2bd4aaea-7bc8-4f71-85a5-1a150f10f694",
        "turn_class": "handler",
        "handler_id": "run_analysis",
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:55:36.545578+00:00"
      },
      {
        "id": "3459398d-693e-4a8a-bed2-db5347d8d6a5",
        "turn_id": "fc74bb6f-1e92-42ac-a8bd-b850f412d7cd",
        "turn_class": "direct_answer",
        "handler_id": null,
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:57:20.964207+00:00"
      }
    ],
    "v5_handler_facts": {
      "__error": "HTTP 400",
      "__detail": "{\"code\":\"42703\",\"details\":null,\"hint\":null,\"message\":\"column v5_handler_facts.turn_id does not exist\"}"
    },
    "v5_turn_fence": [
      {
        "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
        "generation": 24367,
        "stopped_at": null,
        "created_at": "2026-09-21T22:54:10.98059+00:00"
      },
      {
        "turn_id": "69c003bb-6664-4458-8156-afffc6b33361",
        "generation": 24368,
        "stopped_at": null,
        "created_at": "2026-09-21T22:55:02.117027+00:00"
      },
      {
        "turn_id": "fc74bb6f-1e92-42ac-a8bd-b850f412d7cd",
        "generation": 24373,
        "stopped_at": null,
        "created_at": "2026-09-21T22:56:51.755362+00:00"
      }
    ]
  }
}
```

### move_head — 2026-09-21T22:57:51.667Z

```json
{
  "step": "move_head",
  "at_utc": "2026-09-21T22:57:51.667Z",
  "deleted_node_id": "27a94e3e",
  "base_graph_hash_sent": "e84b17ac0d3cae40",
  "status": 200,
  "wire_error": null,
  "head_before": "bc8fc135a50835642310f72275a497df2d902f5e20bd1cb1042114aa89bbf3cd",
  "head_after": "8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806",
  "head_moved": true,
  "spine_after": {
    "at_utc": "2026-09-21T22:57:51.666Z",
    "scenarios": [
      {
        "id": "ee26ba7c-0006-47e6-8bc1-9c8cc269c681",
        "user_id": null,
        "graph_identity_hash": "8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806",
        "current_model_version_id": null,
        "updated_at": "2026-09-21T22:57:51.391152+00:00",
        "event_seq": 0
      }
    ],
    "model_versions": [],
    "v5_conversation_turns": [
      {
        "id": "60beee4e-f259-4552-ad9c-781fc125e274",
        "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
        "turn_class": "direct_answer",
        "handler_id": null,
        "model_version_mutation_id": "64fb167b-d230-52a7-a637-9022cc24989f",
        "model_version_created": false,
        "created_at": "2026-09-21T22:55:00.236344+00:00"
      },
      {
        "id": "393fec03-7f5c-481e-ab81-1f93b618c3d0",
        "turn_id": "36a12764-484b-48d7-a0d1-eeb0dfcd4c79",
        "turn_class": "clarify",
        "handler_id": null,
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:55:10.161978+00:00"
      },
      {
        "id": "19c71b99-4be8-48b5-aa7f-f2084d964edc",
        "turn_id": "2bd4aaea-7bc8-4f71-85a5-1a150f10f694",
        "turn_class": "handler",
        "handler_id": "run_analysis",
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:55:36.545578+00:00"
      },
      {
        "id": "3459398d-693e-4a8a-bed2-db5347d8d6a5",
        "turn_id": "fc74bb6f-1e92-42ac-a8bd-b850f412d7cd",
        "turn_class": "direct_answer",
        "handler_id": null,
        "model_version_mutation_id": null,
        "model_version_created": null,
        "created_at": "2026-09-21T22:57:20.964207+00:00"
      },
      {
        "id": "754d8e97-9239-4b5e-bf39-9701e9d5a607",
        "turn_id": "234220ee-b072-4b11-b5f9-42625f0b58dd",
        "turn_class": "direct_answer",
        "handler_id": null,
        "model_version_mutation_id": "5fd1dc62-4572-54de-ab8a-35fbca409478",
        "model_version_created": false,
        "created_at": "2026-09-21T22:57:51.391152+00:00"
      }
    ],
    "v5_handler_facts": {
      "__error": "HTTP 400",
      "__detail": "{\"code\":\"42703\",\"details\":null,\"hint\":null,\"message\":\"column v5_handler_facts.turn_id does not exist\"}"
    },
    "v5_turn_fence": [
      {
        "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
        "generation": 24367,
        "stopped_at": null,
        "created_at": "2026-09-21T22:54:10.98059+00:00"
      },
      {
        "turn_id": "69c003bb-6664-4458-8156-afffc6b33361",
        "generation": 24368,
        "stopped_at": null,
        "created_at": "2026-09-21T22:55:02.117027+00:00"
      },
      {
        "turn_id": "fc74bb6f-1e92-42ac-a8bd-b850f412d7cd",
        "generation": 24373,
        "stopped_at": null,
        "created_at": "2026-09-21T22:56:51.755362+00:00"
      },
      {
        "turn_id": "dfcac2eb-a91d-4a92-ba8a-f254ed189973",
        "generation": 24377,
        "stopped_at": null,
        "created_at": "2026-09-21T22:57:50.073002+00:00"
      },
      {
        "turn_id": "234220ee-b072-4b11-b5f9-42625f0b58dd",
        "generation": 24378,
        "stopped_at": null,
        "created_at": "2026-09-21T22:57:50.736902+00:00"
      }
    ]
  }
}
```

### replay — 2026-09-21T22:58:22.218Z

```json
{
  "step": "replay",
  "at_utc": "2026-09-21T22:58:22.218Z",
  "replayed_turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
  "byte_identical": true,
  "request_sha_note": "bytes replayed verbatim from the state file",
  "status": 200,
  "ms": 10498,
  "build_sha": null,
  "wire_error": null,
  "wire_error_code": null,
  "conflict_category": null,
  "expected_base_graph_hash": null,
  "model_version_receipt": null,
  "carried_graph": false,
  "head_before": "8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806",
  "head_after": "8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806",
  "original_turn_row_before": {
    "id": "60beee4e-f259-4552-ad9c-781fc125e274",
    "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
    "turn_class": "direct_answer",
    "handler_id": null,
    "model_version_mutation_id": "64fb167b-d230-52a7-a637-9022cc24989f",
    "model_version_created": false,
    "created_at": "2026-09-21T22:55:00.236344+00:00"
  },
  "original_turn_row_after": {
    "id": "60beee4e-f259-4552-ad9c-781fc125e274",
    "turn_id": "b5d96e17-8384-42f9-90cd-d4bb8cceacd1",
    "turn_class": "direct_answer",
    "handler_id": null,
    "model_version_mutation_id": "64fb167b-d230-52a7-a637-9022cc24989f",
    "model_version_created": false,
    "created_at": "2026-09-21T22:55:00.236344+00:00"
  },
  "body_keys": [
    "response_version",
    "assistant_text",
    "blocks",
    "suggested_actions",
    "insights",
    "stage_indicator",
    "analysis_ready",
    "graph_hash",
    "analysis_state",
    "_diagnostic_trace"
  ],
  "body_excerpt": "{\"response_version\":2,\"assistant_text\":\"The model already exists for this decision, but it's not ready to analyse yet: \\\"Keep Supplier Alpha (Status Quo)\\\" still needs its own values set (what it changes and by how much) before it can be compared against the other options.\",\"blocks\":[],\"suggested_actions\":[{\"id\":\"chip_prompt_configure_option\",\"label\":\"Configure Keep Supplier Alpha (Status Quo)\",\"message\":\"Help me configure Keep Supplier Alpha (Status Quo).\"}],\"insights\":[],\"stage_indicator\":\"frame\",\"analysis_ready\":{\"options\":[{\"option_id\":\"699effec\",\"label\":\"Keep Supplier Alpha\",\"status\":\"ready\",\"interventions\":{\"18653591\":0.9,\"5232fd29\":0.05,\"bc734525\":0.72},\"is_baseline\":true,\"intervention_details\":{\"18653591\":{\"display_value\":\"£18k\",\"normalised_value\":0.9,\"raw_value\":18000,\"unit\":\"£\"},\"5232fd29\":{\"display_value\":\"5%\",\"normalised_value\":0.05,\"raw_value\":5,\"unit\":\"%\"},\"bc734525\":{\"display_value\":\"72%\",\"normalised_value\":0.72,\"raw_value\":72,\"unit\":\"%\"}},\"raw_interventions\":{\"18653591\":18000,\"5232fd29\":0.05,\"bc734525\":0.72},\"status_reason\":\"3 intervention(s) ready for analysis\"},{\"option_id\":\"94f899fa\",\"label\":\"Keep Supplier Alpha (Status Quo)\",\"status\":\"needs_user_mapping\",\"interv"
}
```

### sysevent_w3a — 2026-09-21T23:02:28.613Z

```json
{
  "step": "sysevent_w3a",
  "at_utc": "2026-09-21T23:02:28.613Z",
  "d1_turn_id": "638b1ece-a2ab-41c9-9569-60fb68e7d452",
  "d1_node": "699effec",
  "d1_status": 200,
  "d1_error": null,
  "d1_base_hash_sent": "a8a0ab22f7f2d828",
  "d2_turn_id": "3941a9f0-9cb3-49de-9cba-68a727f13f8f",
  "d2_node": "94f899fa",
  "d2_status": 200,
  "d2_error": null,
  "d2_base_hash_sent": "3d9f4321ce174064",
  "head_h0": "8140894a85fd8ee7e6f831458f4beaa1a77ee43e59c107ad8e3d682f66fff806",
  "head_h1": "d1a330cdea332c898d38b8902379d310b72d676dce8618a0dee848e1bbf8c4e3",
  "head_h2": "64e08264a5f09825fead39e91061de3e2e97a7173cff847b2d0c248fd130e41b",
  "head_h3": "64e08264a5f09825fead39e91061de3e2e97a7173cff847b2d0c248fd130e41b",
  "replay_byte_identical": true,
  "replay_status": 409,
  "replay_error": "GRAPH_DIVERGED",
  "replay_conflict_category": "BASE_HASH_DIVERGED",
  "replay_expected_base_graph_hash": "65a7257368165f88",
  "replay_body_excerpt": "{\"error\":\"GRAPH_DIVERGED\",\"boundary\":\"B1\",\"direction\":\"egress\",\"validator\":\"turn_commit\",\"details\":{\"retryable\":false,\"reason\":\"graph_write_conflict\",\"failure_type\":\"GRAPH_DIVERGED\",\"event_kind\":\"structural_delete\",\"recovery_action\":\"refresh_and_reconfirm\",\"conflict_category\":\"BASE_HASH_DIVERGED\",\"expected_base_graph_hash\":\"65a7257368165f88\",\"stage\":\"analyse\"},\"request_id\":\"88b95ab5-e7d1-421d-aef9-f950e90ae39b\",\"retryable\":false}",
  "d1_row_before": {
    "id": "3ae0d73f-2c07-4c3a-9b37-7a6ca89f4964",
    "turn_id": "638b1ece-a2ab-41c9-9569-60fb68e7d452",
    "turn_class": "direct_answer",
    "handler_id": null,
    "model_version_mutation_id": "1d549076-fef3-512c-a4f7-36ea60d51ea5",
    "model_version_created": false,
    "created_at": "2026-09-21T23:02:24.835109+00:00"
  },
  "d1_row_after": {
    "id": "3ae0d73f-2c07-4c3a-9b37-7a6ca89f4964",
    "turn_id": "638b1ece-a2ab-41c9-9569-60fb68e7d452",
    "turn_class": "direct_answer",
    "handler_id": null,
    "model_version_mutation_id": "1d549076-fef3-512c-a4f7-36ea60d51ea5",
    "model_version_created": false,
    "created_at": "2026-09-21T23:02:24.835109+00:00"
  },
  "d1_row_unchanged": true
}
```
