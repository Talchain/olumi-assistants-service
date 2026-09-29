/**
 * ⛔ SERVED CEE `5668902` (Paul's brief, research click, scenario 05bb536c): the reply carried a bullet reading "- [2]".
 * The wire drop removed a cited bullet's two ranking sentences and kept the lone citation unit the splitter had cut off.
 * The served bullet's own words are not captured (the wire dropped them); the shape — a bold lead and a body, both
 * ranking, then " [2]" — is the one that reproduces the served line exactly.
 */
import { describe, it, expect } from 'vitest';
import { dropRankingSentences } from '../withheld-leader-fail-closed.js';

const KEPT_1 = '- **No universal figure.** Evidence is thin and mostly vendor data. [1]';
const MATH = '- **Decision-useful math:** revenue holds until price-driven loss exceeds 16.7%.';
const RANKING_BULLET = '- **Raising the price is the better option.** It beats holding the price for most SaaS firms. [2]';
const reply = (middle: string): string => ['I searched the web for “churn after a 20% price rise”.', '', KEPT_1, '', middle, '', MATH].join('\n');

describe('a dropped cited bullet leaves no bare citation behind', () => {
  it('RED (served "- [2]"): the bullet goes whole; the other bullets and their markers are untouched', () => {
    const out = dropRankingSentences(reply(RANKING_BULLET));
    expect(out.droppedSentences).toBeGreaterThan(0);
    expect(out.text).not.toMatch(/^\s*[-*•]?\s*(?:\[\d+\]\s*)+$/m);
    expect(out.text).toBe(['I searched the web for “churn after a 20% price rise”.', '', KEPT_1, '', MATH].join('\n'));
  });

  it('CONTRAST: a cited bullet that keeps a sentence keeps its marker', () => {
    const out = dropRankingSentences(reply('- **Thin evidence.** Raising the price is the better option for most SaaS firms. [2]'));
    expect(out.droppedSentences).toBeGreaterThan(0);
    expect(out.text).toMatch(/^- \*\*Thin evidence\.\*\* ?\[2\]$/m);
  });

  it('CONTRAST: nothing dropped → the reply is byte-identical, markers and all', () => {
    const text = reply('- **Mixed findings.** Studies disagree on the size of the effect. [2]');
    expect(dropRankingSentences(text)).toEqual({ text, droppedSentences: 0 });
  });
});
