
  INSERT INTO public.v5_turn_fence (scenario_id, turn_id)
  VALUES (p_scenario_id, p_turn_id)
  ON CONFLICT (scenario_id, turn_id) DO UPDATE
    SET scenario_id = public.v5_turn_fence.scenario_id
  RETURNING generation;
