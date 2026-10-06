# MC: a unitless end's own label supplies its stated-size unit

1. Keep the existing typed-size validation, sentence uniqueness, sign and consent doors.
2. Add one source-located label-head reader shared by construction and chat.
3. The head is the last noun before a label preposition; hyphenated no-shows stays one noun.
4. Match case and singular/plural only; no stems, aliases or the other end's noun.
5. A figure must count that head immediately after it, or follow that end's head
   through movement/hedge words ("cut monthly cancellations by about 40").
6. Keep the stated period: "monthly cancellations" means cancellations/month;
   "150 days a year" means days/year. Conflicting periods never bind.
7. Currency is literal, locally attached to the end's own head ("£40k a year
   of losses"); preserve its period and base pounds, never read it as points.
8. A counting determiner locates one source noun (appointments, not rescheduled).
9. A duration different from the label head (hours versus response time) refuses.
10. A percent is never a count; U3's bare-percent question remains unchanged.
11. U1 blocks adoption when the end has a unit, any stored level (including zero),
    or another sized link whose endpoint unit differs. Reject conflicting readings.
12. Construction starts at `bindStatedLinkSizes` in `stated-size-binding.ts`:
    propose label readings, validate prospective tuples through `stated-effect.ts`,
    then write only readings belonging to uniquely bound sentences.
13. Admission adopts into `unitById` and NodeV3 `unit_reading`, before final sizing;
    it does not infer a level, frame, value, sign or uncertainty.
14. The #2673 answer door (`linkEffectTheUserStated`) uses the same located reading;
    `prepareLinkEffectUnitReadings` supplies the existing consent carrier.
15. Chat writes through `applyLinkEffectEdit`, which rechecks U1 and the quoted
    reading and stores `node.unit_reading` plus `provenance.natural_effect` atomically.
16. Readers: construction's magnitudeNodeFor, sizeLink and final node projection;
    chat's ownUnitsOf, linkEffectEndUnits, withLinkEffectUnitReadings, reading token,
    refusal/card text and writer; magnitudeNodes/frame-defaulted-links and P5;
    heldLinkOf, analysis graph hash, serialisation/compact and frame refitting
    read the resulting natural-effect units via the existing canonical machinery.
17. Add new rows over banked mealkit-14, consult-12, dental-4 and bakery-6 graphs,
    with explicit base-RED expectations, all MUST NOT controls and mutation targets.
18. Keep existing tests/patterns unless this rule requires a re-pin; list all re-pins.
19. Edits only: no vitest, build, commits or live calls; the DL runs verification.
