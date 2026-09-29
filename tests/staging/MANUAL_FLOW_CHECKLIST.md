# A.8 Manual flow verification

Run against: https://staging--olumi.netlify.app
CEE: https://cee-staging.onrender.com
PLoT: https://plot-lite-service-staging.onrender.com

## Pre-flight
- [ ] All three staging services return 200 on health endpoints
- [ ] Browser devtools open (Network tab + Console)

## Flow 1: Framing → Draft
- [ ] Type: "I need to decide whether to raise prices or expand the product line"
- [ ] AI responds with framing questions or draft graph
- [ ] If graph drafted: nodes and edges appear on canvas
- [ ] If clarification: respond, then graph should appear on follow-up

## Flow 2: Accept patch
- [ ] GraphPatchBlock visible in conversation with Accept/Dismiss buttons
- [ ] Click Accept → graph updates on canvas
- [ ] Patch block transitions to "applied" state
- [ ] No errors in console
- [ ] Network tab: system_event with event_type "patch_accepted" sent

## Flow 3: Dismiss patch
- [ ] Dismiss a patch suggestion
- [ ] Block shows dismissed state
- [ ] No errors in console
- [ ] Network tab: system_event with event_type "patch_dismissed" sent

## Flow 4: Direct canvas edit
- [ ] Add a new factor node on canvas
- [ ] Edit its label
- [ ] Wait 2+ seconds (debounce)
- [ ] Network tab: system_event with event_type "direct_graph_edit" sent
- [ ] Guidance items clear on first edit (if any were showing)

## Flow 5: Run analysis (Play button)
- [ ] Click Play button
- [ ] Results panel populates with four-signal view
- [ ] Conversation shows analysis blocks (FactBlocks)
- [ ] Network tab: direct PLoT /v2/run call fires
- [ ] Network tab: system_event with event_type "direct_analysis_run" fires after
- [ ] Results panel shows updated data; check devtools for resultsSource value

## Flow 6: Run analysis (chat)
- [ ] Type: "run the analysis"
- [ ] Results panel updates from envelope
- [ ] Conversation shows analysis blocks

## Flow 7: Explain results
- [ ] Type: "explain the results" or "what matters most?"
- [ ] CommentaryBlock appears with narrative text
- [ ] Check block data in devtools for supporting_refs / citations

## Flow 8: Feedback
- [ ] Thumbs up on an AI response → button highlights, disabled after click
- [ ] Thumbs down on another → same behaviour
- [ ] Network tab: feedback_submitted events sent, no errors

## Flow 9: Inspector guidance
- [ ] Click a node on canvas to open inspector
- [ ] If guidance items target this node: guidance section visible in inspector
- [ ] Hover a guidance item → canvas node pulses (if pulse highlight active)

## Flow 10: Error resilience
- [ ] Open devtools → Network → block requests to CEE domain
- [ ] Click Play → results panel still populates (direct PLoT path works independently)
- [ ] Unblock CEE domain → next chat message works normally

## Result
- [ ] All flows pass: A.8 APPROVED for production
- [ ] Failures: log with screenshots, network traces, console errors
