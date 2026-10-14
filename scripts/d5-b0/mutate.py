#!/usr/bin/env python3
"""B0 mutants of D5-B-MIGRATION.sql. Each replaces ONE exact fragment; a fragment that is not found
exactly once is a harness error (exit 2), never a silently unmutated copy."""
import sys

UPDATE_BLOCK = (
    "  UPDATE public.scenarios\n"
    "     SET events     = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),\n"
    "         event_seq  = v_seq,\n"
    "         updated_at = now()\n"
    "   WHERE id = p_scenario_id;\n"
)
LATEST_MOVED = (
    "    IF jsonb_typeof(v_receipt) = 'object' AND v_receipt->>'status' = 'latest_moved' THEN\n"
    "      RETURN v_receipt;\n"
    "    END IF;\n"
)

MUTANTS = {
    # M1: remove the inline append (B1 must go red)
    "m1": [(UPDATE_BLOCK, "")],
    # M2: append when the answer row already existed (B2 replay must go red)
    "m2": [(
        "  IF v_existing IS NOT NULL THEN\n"
        "    RETURN v_receipt || jsonb_build_object('construction_event_id', NULL);\n"
        "  END IF;\n", "")],
    # M3: append before the latest_moved return (B4 must go red)
    "m3": [(LATEST_MOVED,
        "    IF jsonb_typeof(v_receipt) = 'object' AND v_receipt->>'status' = 'latest_moved' THEN\n"
        "      UPDATE public.scenarios SET events = COALESCE(events, '[]'::jsonb) || jsonb_build_array(jsonb_build_object("
        "'event_id', 'construction_questions_' || p_turn_id, 'event_type', 'construction_questions', 'turn_id', p_turn_id, "
        "'details', p_construction_questions)), event_seq = event_seq + 1 WHERE id = p_scenario_id;\n"
        "      RETURN v_receipt;\n"
        "    END IF;\n")],
    # M4: drop the answer-row identity re-check (B14b must go red)
    "m4": [(
        "  IF NOT FOUND THEN\n"
        "    RAISE EXCEPTION 'construction questions append: answer row % not found; nothing is kept', v_receipt->>'id';\n"
        "  END IF;\n", "")],
    # M5: drop the guest/owner rule (B5 other-user must go red)
    "m5": [("  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM p_caller_user_id THEN\n", "  IF FALSE THEN\n")],
    # M6: leave anon/authenticated EXECUTE in place (the migration's own postcondition must refuse the apply)
    "m6": [(") FROM PUBLIC, anon, authenticated;\n", ") FROM PUBLIC;\n")],
    # M7: swallow an event-append failure (F1 must go red: answer kept without its record)
    "m7": [(UPDATE_BLOCK, "  BEGIN\n" + UPDATE_BLOCK + "  EXCEPTION WHEN OTHERS THEN NULL;\n  END;\n")],
    # M8: envelope shape check off (MAL top_target_id must go red)
    "m8": [("    RAISE EXCEPTION 'construction questions append: invalid record envelope' USING ERRCODE = '22023';\n", "    NULL;\n")],
    # M9: question shape check off (MAL q_source_x must go red)
    "m9": [("      RAISE EXCEPTION 'construction questions append: invalid question %', v_i USING ERRCODE = '22023';\n", "      NULL;\n")],
}


def main() -> int:
    name, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    text = open(src, encoding="utf-8").read()
    for old, new in MUTANTS[name]:
        n = text.count(old)
        if n != 1:
            print(f"mutate.py: {name}: fragment found {n} times (expected 1)", file=sys.stderr)
            return 2
        text = text.replace(old, new)
    open(dst, "w", encoding="utf-8").write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
