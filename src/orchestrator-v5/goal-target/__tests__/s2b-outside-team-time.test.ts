import { describe, expect, it } from 'vitest';
import { readTeamTime, TEAM_TIME } from '../team-share-write.js';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';

// Duration subspans are quoted verbatim; surrounding domain clauses are not team-time answers.
const outside = [
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:843 user brief
  "two months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1296 user brief
  "9 to 14 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1298 user brief
  "six months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1298 user brief
  "six weeks",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1317 user brief
  "Two years",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1317 user brief
  "four months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1320 user brief
  "twelve months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1834 user brief
  "three months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1837 user brief
  "3 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1838 user brief
  "6-12 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1842 user brief
  "9 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1843 user brief
  "4 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1845 user brief
  "6 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1872 user brief
  "2 weeks",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1911 user brief
  "8 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1920 user brief
  "12 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1920 user brief
  "3 weeks",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1920 user brief
  "about 5 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1943 user brief
  "18 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1943 user brief
  "about 14 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/captured-briefs.txt:1945 user brief
  "3-6 months",
  // Source: /Users/paulslee/Documents/GitHub/output/r3-successor-996ec64d/scratchpad-archive-20261001/reload-no-risk.json:1 /json/conversation_turns/2/user_message
  "about 4 months",
  // Source: /Users/paulslee/Documents/GitHub/output/mg-restart-20260929/scratchpad-full/pdocs/openai/prompt-bench/2026-09-22-heldout/NEXT_SCREEN_CASES_v0_1.json:65 /construction_cases/1/brief
  "nine months",
  // Source: /Users/paulslee/Documents/GitHub/output/r3-successor-996ec64d/f5/rt-2470/5ccc6630-rt-2470-stale/06-cold-s2.json:815 /json/conversation_turns/23/user_message
  "4 weeks",
];
const review = [
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "Probably 6 to 9 months",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "6-9 months?",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "6 to 10 months, I think",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "It'd take about 8 months",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "8 months with the current team",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "We think 6-10 months",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "about eight months",
  // Source: /Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/REVIEW-2762.md (Lens 2 P1-B)
  "1 year",
 ];
describe('outside team-duration corpus', () => {
  it('P1-B-OUTSIDE-CORPUS: at least twenty external duration phrasings', () => {
    expect(outside.length).toBeGreaterThanOrEqual(20);
    for (const phrase of outside) expect(readTeamTime(phrase), phrase).not.toBeNull();
  });
  it.each(review)('P1-B-REVIEW-ANSWERS: %s', phrase => {
    expect(readTeamTime(phrase)).not.toBeNull();
  });
  it.each(['6 months ago', 'hiring takes 6 months', 'deadline in 6 months', '6 developers', '6–10 months recruitment'])('P1-B-OUTSIDE-CORPUS control: %s', phrase => {
    expect(readTeamTime(phrase)).toBeNull();
  });
  it('L1-WEEKS-CURRENT-TEAM-BACKWARDS with ordered range control', () => {
    expect(readTeamTime('10–6 months with the current team')).toEqual({ low_months: 6, high_months: 10 });
    expect(readTeamTime('6–10 months')).toEqual({ low_months: 6, high_months: 10 });
    expect(readTeamTime('4 weeks')?.low_months).toBeCloseTo(4 * 7 * 12 / 365.25, 12);
    expect(readTeamTime('1 year')).toEqual({ low_months: 12, high_months: 12 });
  });
  it('P1-B-REGEX-SCALING: 20k to 160k whitespace growth', () => {
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793/#2800.
    const run = (s: string) => () => { TEAM_TIME.lastIndex = 0; return TEAM_TIME.test(s); };
    const m = scalingRatio(run(' '.repeat(20000)), run(' '.repeat(160000)));
    expect(m.ratio, m.detail).toBeLessThan(22);
    expect(readTeamTime(' '.repeat(20000))).toBeNull();
  });
});
