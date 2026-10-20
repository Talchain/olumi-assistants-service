1. Source loss: draft-tool.ts's L13 verifier returns one UNKNOWN without identifying its failed conjunct; L26 lacks the internal ACK/read pair.
2. Smallest change: annotate those existing exits with a bounded discriminated diagnostic, preserving check order, decisions and all effect calls.
3. Reuse: ToolOutcome -> traceRow -> existing _agent.tool_calls carrier (#3513); use symbol metadata so SDK outcome JSON remains byte-identical.
4. Retire: replace the opaque compound verifier with the same ordered checks, each owning its diagnostic; no duplicate verification authority.
5. Alternative rejected: logs/new store/new SDK tracing path or serializable result fields would add plumbing or change the AI's input.
6. Class proof: real /agent/v1/turn with scripted SDK/drafter and internal-route faults on two synthetic briefs; exact outcomes/replies and existing negatives.
7. Bounds: fixed check/field enums, HTTP status, hash prefixes (12 hex chars or null), <=8 top-level postimage keys; no raw errors, content, reconstructed receipt or provider call.
8. Lease: draft-tool.ts plus its own tools carrier/specs; SDK bridge drops the new field and is outside scope. BLOCKED-LEASE sdk-turn.ts; forwarding-only hook supplied for DL, no A code change.
