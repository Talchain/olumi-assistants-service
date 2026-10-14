import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';

const ACK = 'The link was saved, but the scenario changed before its accepted estimate detail could be saved. Check the saved link and try accepting its estimate again.';
const CONFLICT = 'The scenario changed while I was saving, so nothing was saved. Try again.';
const UNCONFIRMED = 'The change was sent, but it could not be confirmed: Olumi could not read the model back afterwards. Ask me to check whether it was recorded.';

describe('partial drawn-link narration', () => {
  it('removes contradicting negative draft claims and retains the exact ACKed status', () => {
    const narration = narrateWriteOutcome(`Consider the capacity assumption. ${CONFLICT} ${UNCONFIRMED}`,
      [{ name: 'authorise_change' }], [{ ok: false, mutated: true, refusal: 'not_confirmed', outcome: 'link_saved_estimate_not_saved' }]);
    const output = withWriteOutcome(narration.text, narration.status);
    expect(narration.status).toBe(ACK);
    expect(createHash('sha256').update(narration.status!).digest('hex')).toBe('d8b3d2ba36e316f920bd383c7fc0f7a28d893c206b887a9acb866c660b7145d4');
    expect(output.split(ACK)).toHaveLength(2);
    expect(output).not.toContain(CONFLICT);
    expect(output).not.toContain('could not read the model back');
    expect(output).toContain('Consider the capacity assumption.');
  });

  it.each([
    'Olumi could not read the model back afterwards.',
    'The scenario changed; nothing was saved.',
  ])('also strips an isolated contradicting claim: %s', draft => {
    const narration = narrateWriteOutcome(`Consider capacity. ${draft}`, [{ name: 'authorise_change' }],
      [{ ok: false, mutated: true, refusal: 'not_confirmed', outcome: 'link_saved_estimate_not_saved' }]);
    expect(withWriteOutcome(narration.text, narration.status)).toBe(`Consider capacity.\n\n${ACK}`);
  });

  it('preserves ordinary revision-conflict refusal words when nothing mutated', () => {
    const narration = narrateWriteOutcome(CONFLICT, [{ name: 'authorise_change' }],
      [{ ok: false, mutated: false, refusal: 'revision_conflict' }]);
    expect(withWriteOutcome(narration.text, narration.status)).toContain(CONFLICT);
    expect(narration.stripped).toEqual([]);
  });
});
