# AI Experience fast PoC spike — manual test

**Branch:** `spike/ai-experience-fast-20260929`  
**Base:** CEE staging `0497e52e0fe17ee942d19a1859a5bb3aec2eec9d`  
**Purpose:** deliberately fast/manual comparison only. No production default change.

## What changed

Two independent switches:

1. `CEE_AI_EXPERIENCE_SPIKE_MODEL`
   - unset / `gpt-5.6-terra` = current model
   - `gpt-6-luna`
   - `gpt-6-sol`

2. `CEE_AI_EXPERIENCE_SPIKE_COACHING=true`
   - keeps the full existing Agent safety/tool instructions
   - adds a short reasoning-enhancement posture:
     - implication first;
     - consequential assumption/uncertainty;
     - one genuinely different challenge/alternative when useful;
     - one concrete next reasoning move;
     - no winner/recommendation unless deterministic state licenses it;
     - concise by default.

The spike does **not** relax canonical state, permissions, write approval, provenance, arithmetic, currentness or tool validation.

## Four useful manual arms

| Arm | Model | Coaching override |
|---|---|---|
| Baseline | Terra | off |
| A | Terra | on |
| B | Luna | off |
| C | Luna | on |

Optional hard-synthesis arm: Sol + coaching override.

## Five-turn smoke

Use the same scenario and wording for every arm.

1. **Direct reasoning question:** “Given what we know so far, how should I think about this decision?”
2. **Missing evidence:** “I don’t know those numbers. What should I do next?”
3. **Challenge:** “What assumption am I most at risk of getting wrong?”
4. **Alternative generation:** “What are we missing? Give me genuinely different options or perspectives.”
5. **Tool/action control:** make one explicit supported model edit / analysis request and verify the correct tool path still executes.

After analysis, also ask:
> “What does this actually tell me, and what could change the conclusion?”

## Score manually

1–5 each:
- feels like Olumi rather than generic chat;
- challenge quality;
- non-obvious/useful alternatives;
- uncertainty honesty;
- actionability;
- concision;
- tool/action correctness;
- latency.

**Immediate reject:** wrong tool/action, invented fact/number, user evidence lost, unsupported recommendation, or false claim that a write happened.

## Decision rule

This is a PoC spike.

If one arm feels materially better with no obvious truth/action regression, use that configuration for a longer manual-test branch immediately.

Do not wait for production-grade statistical confidence.
