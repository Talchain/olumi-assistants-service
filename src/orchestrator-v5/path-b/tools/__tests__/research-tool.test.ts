import { describe, expect, it } from 'vitest';
import { offerResearch } from '../research-tool.js';

describe('core offer_public_research (the legacy offer, ported for the core lane; #3522 review BLOCK, 21 Oct)', () => {
  it('a sendable query is offered, and nothing is searched', async () => {
    expect(await offerResearch({}, { query: '  public benchmark for weekly bakery output  ' }))
      .toMatchObject({ status: 'ok', mutated: false, data: { offered_query: 'public benchmark for weekly bakery output' } });
  });
  it('CONTROLS: an unsendable query, a gate that refuses, and a gate that throws all refuse; no query is offered', async () => {
    expect(await offerResearch({}, { query: 'x'.repeat(201) })).toMatchObject({ status: 'refused', reason: 'query_not_sendable' });
    expect(await offerResearch({ researchShowable: async () => false }, { query: 'is option A better' })).toMatchObject({ status: 'refused', reason: 'query_cannot_be_shown' });
    expect(await offerResearch({ researchShowable: async () => { throw new Error('read failed'); } }, { query: 'neutral question' }))
      .toMatchObject({ status: 'refused', reason: 'query_cannot_be_shown' });
  });
});
