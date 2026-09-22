TRUNCATE public.v5_turn_fence, public.v5_handler_facts, public.v5_conversation_turns, public.model_versions, public.scenarios CASCADE;
DELETE FROM auth.users;
SELECT setval(pg_get_serial_sequence('public.v5_turn_fence','generation'), 1, false);
