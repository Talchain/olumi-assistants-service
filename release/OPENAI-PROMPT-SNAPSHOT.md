# Exact candidate prompt snapshot

This release mode uses CEE's existing file prompt store. It is inactive unless
`PROMPTS_RELEASE_MANIFEST` points to a manifest committed in the exact CEE
candidate SHA. Do not enable it on staging while candidate selection is moving.

The Release Control packet supplies every prompt ID, task, selected version,
SHA-256 content hash, and both staging and production model settings used by
the tested journey. Add those pins to a JSON manifest in this directory:

```json
{
  "format": 1,
  "prompts": [
    {
      "id": "draft_graph",
      "taskId": "draft_graph",
      "version": 202,
      "contentHash": "<64 lowercase hex characters from the approved candidate>",
      "modelConfig": { "staging": "<approved model>", "production": "<approved model>" }
    }
  ]
}
```

Pin all managed prompts observed in the candidate journey, including aliases.
The example values above are illustrative and are not candidate approval.

Configure the production CEE service with `PROMPTS_RELEASE_MANIFEST` set to the
committed manifest path, `PROMPTS_STORE_TYPE=file`, `PROMPTS_STORE_PATH` set to
an ignored private path such as `.tmp/release-prompts.json`,
`PROMPTS_ENABLED=true`, `ADMIN_ROUTES_ENABLED=false`, and
`CEE_PROMPT_AUTO_MIGRATE=false`. Keep `PROMPTS_USE_STAGING` and
`PROMPTS_ENVIRONMENT` aligned with the witnessed candidate model route; the
snapshot points both selectors at the pinned version. Do not copy provider
secrets or prompt contents into Git.

During the Render build, CEE reads the selected rows from Supabase using its
existing service credentials. It verifies content hashes, task IDs, version
IDs, and model settings before writing the private file. Build failure stops
deployment. At startup, CEE verifies the file again and refuses to serve if
it is absent or mismatched. Managed pinned tasks cannot fall back to defaults.
Admin routes and automatic prompt migration stay disabled so the snapshot
cannot change through CEE during the test.

This mechanism does not establish provider identity by itself. Release Control
must still name the exact CEE SHA and attach per-call OpenAI-only proof and a
complete signed-in staging journey. Promotion must compare the packet to the
public production identities and candidate-relevant settings before changing
anything. The UI, PLoT and ISL versions remain separate release gates.
