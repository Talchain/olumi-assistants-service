# P0: the post-approval dead end (served CEE `21e3b38`, 25 Sep 2026, OpenAI only)
These are minimal fixtures cut from served `/agent/v1/turn` responses. The fields kept are `assistant_text`, `suggested_actions`, `analysis_ready`, `analysis_state`, `graph_hash`, and `_agent.tool_calls` name/ok/mutated plus `receipts`. **UUIDs are scrubbed.**

- **`dead-end.eng-hiring-2.approve.json`**: the approval of "Use as starting assumptions" has `authorise_change` **mutated: true**. The model stays `analysis_ready.status: blocked` with **`blockers: null`** and `structurally_analysable: false`. **`suggested_actions: []`**, so the user has nothing to do next.
  - The trigger is the constructor-added held option "Continue current staffing": `needs_user_mapping`, "No interventions extracted".
- **`control-ready.eng-hiring-1.approve.json`**: the same brief class. After approval the model is `ready`, and **"Run analysis" is offered**. A fix must keep this.

**Brief:** "Should we hire two senior engineers or four junior engineers to ship the new platform by Q3, while keeping annual salary spend under £400k?"

On the next turn (Run), the same scenario replied "No analysis could run because **Continue current staffing** has no stated effect on any factor…" and offered **"Suggest what it still needs"**.
Discussion: programme-docs #69 5826709499, and RC 5826744045 §2.
