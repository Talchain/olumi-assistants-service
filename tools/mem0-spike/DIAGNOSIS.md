# Mem0 spike — diagnosis of Paul's staging/production tests (27–29 Sep 2026)

Question: which of the observed failures could a supplementary recall layer (in-house pairing or Mem0) actually reach?

**Evidence base.** Sources used:
- #72 pages 1–23 and #70 pages 19–22, searched by keyword and read in full where relevant;
- the agent-lane test fixtures and tests that cite Paul's transcripts.

Limits of that evidence:
- **No full transcript of Paul's 29 Sep session is on GitHub.** The Programme Lead summarised it in #72 5892260029: "repeated context loss, contradictory run/admission behaviour, over-fragmented approvals, capability proposals the product cannot faithfully represent, implementation details leaking."
- **Most verbatim evidence is from 27–28 Sep:**
  - 27 Sep exports 17d1cd3a, 90b8f080 and 08bf9a1f;
  - 28 Sep staging export b1bffd43 (scenario 5106b21b);
  - 28 Sep production exports 9ede200a and 64c5eccc (scenario 657e63ef).
- **Several 29 Sep items are replays** of Paul's brief, not Paul's own session.

## Failure classification

| # | Failure (short) | Source | Class | Reachable by recall? |
|---|---|---|---|---|
| 1 | Eight link strengths approved conversationally ("I'm aligned… please make these updates" → "Yep, I can confirm" → "I've already given you permission…"). Five turns and four permissions recorded **one** of eight; the four "moderate" links never landed. | #72 5871256746, 5871575628, 5871594233; `agent-capabilities.ts:2604-2610` | consent / approval loop | **No.** It is a Runtime consent-policy and one-change-per-approval design issue. Recall must never carry approval authority (case F), so this is out of Mem0's reach by construction. |
| 2 | "Price sensitivity is very high" refused twice as not a band word; four turns for one action | #70 5854941415; `propose-my-reading.test.ts` | user fact not captured canonically | **No.** The words were in the current turn; this is a vocabulary-mapping and capability issue. |
| 3 | Offered to add "competitive response" as a risk, then: "I cannot add it faithfully" | #70 5854941415 | capability over-promise | **No.** Capability awareness is canonical. |
| 4 | Budget raised to £30k, then "I can't update that budget constraint"; the split was re-asked twice | #70 5854981570, 5855034050 | user fact not captured canonically, plus capability | **Partly.** The re-asking of an already-given split is a recall symptom. The root cause is that the writer was unreachable (canonical). Recall can surface "you said £30k; the model holds £20k" as unreconciled. |
| 5 | The turn carried `projection_empty` / fallback while the stored read said `complete_current`; "Results may be outdated" shown over a matching hash | #72 5871228357, 5871450817, 5871654382 | analysis-state confusion | **No.** Analysis state is canonical-only by rule. |
| 6 | The engine deleted 3 of 10 links and invented 2 | #72 5871699334 | analysis-state / model integrity | **No.** |
| 7 | "Set one yourself, then run again", while a near tie still blocked the result | #72 5871699334 | capability over-promise | **No.** |
| 8 | "$40–50k vs $10k/yr" stored as `cee_hypothesis`; cards read "est." | #72 5871256746 | user fact not captured canonically | **Partly.** Recall of the user's own figure, matching the model, adds "the user stated this" provenance. Relabelling is canonical work. |
| 9 | "Every £1 loses ~50 subscribers" dropped; Olumi re-asked for a band (replay, not Paul) | #72 5883636858 | recent turn ignored / not captured | **No.** The fact was in the **current** message. |
| 10 | Replies contradicted the stored run (replays) | #72 5890129280, 5890704395 | analysis-state confusion | **No.** |
| 11 | After a deploy or restart, history is reseeded as text only: no tool calls, results or receipts, and the older-words map is lost. cee-staging redeploys on every merge. | `history-store.ts:445-481`; #72 5896081535 | tool-result loss (mechanism; no Paul turn attributed) | **User words only.** Mem0 persists across restarts, so it can restore what the user **said**. It must not restore tool results or receipts, which is the Runtime P0. |

**The "moderate" wording.** No Paul message was found where the user called an effect "moderate" and was then asked again. The moderate bands in 64c5eccc were Olumi's proposals, which Paul approved conversationally. That is failure #1, a consent-loop failure.

## What this means for the experiment
- **Classes in the named evidence:**
  - 4 × user fact not captured canonically (#2, #4, #8, #9);
  - 4 × analysis-state confusion (#5, #6, #10, plus the stale-banner part of #5);
  - 2 × capability over-promise (#3, #7);
  - 1 × consent loop (#1);
  - 1 × tool-result-loss mechanism (#11).
- **Old-history loss and recent-turn-ignored beyond the window:** 0 named instances. They appear only in the 29 Sep summary ("repeated context loss"), with no examples on GitHub.
- **Directly reachable by recall:** about 0 of 11 named failures. Partly reachable: 3 (#4, #8, #11), and only for the user's own words.
- **Upper bound for any recall layer:** about 3 of 11 (27%) of the named failures, and none of them at the root cause. The rest belong to Canonical State (capture and relabelling), Runtime consent (#1), Model Generation (#6) and analysis-state truth (#5, #10).
- **The benchmark still runs:**
  - on Paul's real stored graph (`paul-cbd15f83`), to measure recall quality, safety, latency and restart persistence;
  - on the A–F cases, to establish that recall is safe.

  A KEEP now needs recall to fix a failure class that actually occurs. The diagnosis says that class is small.
