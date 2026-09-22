
  SELECT jsonb_build_object(
    'claimed',        mine.generation IS NOT NULL,
    'stopped',        mine.stopped_at IS NOT NULL,
    'generation',     mine.generation,
    'max_generation', newest.max_generation
  )
  FROM (SELECT MAX(generation) AS max_generation
          FROM public.v5_turn_fence
         WHERE scenario_id = p_scenario_id) AS newest
  LEFT JOIN LATERAL (
    SELECT generation, stopped_at
      FROM public.v5_turn_fence
     WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) AS mine ON true;
