import { describe, it } from 'vitest';
import * as target from '../target-testability.js';
import { sayGoalChange } from '../../agent-lane/limit-frame.js';
import { changeTargetFrameRows } from './change-target-frame-verdict.rows.js';

describe('W6b: a change target is tested in its stated frame', () => {
  for (const row of changeTargetFrameRows) it(row.name, () => row.check({ ...target, sayGoalChange }));
});
