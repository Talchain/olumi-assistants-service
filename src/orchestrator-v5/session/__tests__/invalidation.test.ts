import { describe, it, expect } from 'vitest';

import { describeScope, type InvalidationScope } from '../invalidation.js';

describe('describeScope', () => {
  it('renders factor scope with factorId', () => {
    const scope: InvalidationScope = { kind: 'factor', factorId: 'factor-nrr' };
    expect(describeScope(scope)).toBe('factor:factor-nrr');
  });

  it('renders edge scope with edgeId', () => {
    const scope: InvalidationScope = { kind: 'edge', edgeId: 'edge-42' };
    expect(describeScope(scope)).toBe('edge:edge-42');
  });

  it('renders structural scope as a bare string', () => {
    expect(describeScope({ kind: 'structural' })).toBe('structural');
  });
});
