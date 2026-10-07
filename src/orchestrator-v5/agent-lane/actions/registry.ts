/**
 * ⭐ S-B ACTION SYSTEM — THE ONE DISPATCH REGISTRY (CEE half; lane ACTION-BAR-CEE under the S-B owner github-a2;
 * ACTION-SYSTEM-DRAFT §C1 + PL/DL rulings §D; AIE amendment #87 6036471065; github-a2 contract amendments 1–11).
 *
 * WHAT IT IS: the closed list of the PoC's ten actions, each with what the bar shows (label ≤2 words, icon key, menu
 * group), the chip id a press sends, and the visible user line. It is the authority on DISPATCH only. Every entry names
 * the existing authority for everything else (AIE 6036471065): RC owns eligibility, priority and method-turn state (the
 * guidance selector), Science/DSK owns applicability and badges, Canonical owns quantities, dates and provenance (the
 * readers it names), CEE owns dispatch and the proposal lifecycle, DGAI owns presentation.
 *
 * WIRE (D.1): labels, icons and press ids ride the `action_bar` sidecar, so DGAI treats `action_id` and `icon` as opaque
 * strings (github-a2 amendment 4). Existing press ids are kept, so stored chips and request hashes stay valid; new ones
 * are `act:<action_id>` (DL ruling 2). `user_line` is the visible press message; WIDEN’s risks door also matches its canonical message.
 *
 * SLICE 1 = the actions whose typed handler is complete today (ACTION-SYSTEM-DRAFT §E.4, binding): review, what_changes,
 * pre_mortem, more_options, test_link, and strengthen in its S1 scope only. SLICE 2a adds the canonical standing gaps
 * (frame_brief, set_goal, set_deadline) and S-C WIDEN's risks door. check_estimates (S-D EDIT-PANEL) and further methods join when their
 * owner supplies a TOTAL typed handler; adding the id makes `tsc` demand its `HANDLERS` entry. Outside view, trade-offs,
 * bias review and the anchoring check stay held (AIE 6036471065 item 2). An id that is not here is never emitted.
 */

import { SUGGEST_RISKS_CHIP, widenTargetOf } from '../method-turn/widen-turn.js';

export const ACTION_IDS = ['review', 'what_changes', 'strengthen', 'pre_mortem', 'more_options', 'test_link', 'frame_brief', 'set_goal', 'set_deadline', 'more_risks'] as const;
export type ActionId = (typeof ACTION_IDS)[number];

/** The four standard actions, in their FIXED bar positions (D.3: users learn their places). */
export const STANDARD_ACTIONS = ['review', 'what_changes', 'strengthen', 'pre_mortem'] as const satisfies readonly ActionId[];

/** The ⋯ menu group (github-a2 amendment 2): position is the array, never the group. */
export type ActionGroup = 'gap' | 'method' | 'review';

/** The prefix of every NEW press id (DL ruling 2). Any `act:` id is an action press, known or not (D.5). */
export const ACTION_PRESS_PREFIX = 'act:';
/** The existing "Test without this link" press (`structural-challenge-turn.ts`), one id per link. */
export const TEST_LINK_PRESS_PREFIX = 'agent-test-without-link:';

export type Authority = 'RC' | 'DSK' | 'Canonical' | 'CEE';
export interface ActionAuthorities {
  /** Who decides when the action is relevant and how it ranks. */
  readonly eligibility: Authority;
  /** Who decides the method's applicability and any badge; null = no science claim is made. */
  readonly science: 'DSK' | null;
  /** Who owns the quantities, dates and provenance the action reads or proposes; null = none read. */
  readonly quantities: 'Canonical' | null;
}

export interface ActionEntry {
  readonly label: string;
  /** A lucide-react 0.344.0 icon name (DGAI's installed library; each name checked present in its dist). */
  readonly icon: string;
  readonly group: ActionGroup;
  /** The chip id a press sends; `per_link` = the existing per-link id, built from the offer's target. */
  readonly press: { readonly kind: 'fixed'; readonly id: string } | { readonly kind: 'per_link' };
  readonly user_line: string;
  readonly authorities: ActionAuthorities;
  /**
   * What a press delivers today, said plainly (AIE 2: registry presence is not method completeness):
   * `typed_method` = one checked model call under RC's method contract; `typed_reply` = a deterministic reply with no
   * model call; `typed_card` = a held proposal for explicit approval.
   */
  readonly contract: 'typed_method' | 'typed_reply' | 'typed_card';
  /** The bar offer depends on the selected Run (§E.1: its identity then binds `run_key`). */
  readonly run_dependent: boolean;
}

export const ACTION_REGISTRY: Readonly<Record<ActionId, ActionEntry>> = {
  review: {
    label: 'Review', icon: 'ListChecks', group: 'review',
    press: { kind: 'fixed', id: 'agent-next-review-decision' },
    user_line: 'Review this decision: what should I check before relying on it?',
    authorities: { eligibility: 'CEE', science: null, quantities: 'Canonical' }, contract: 'typed_reply', run_dependent: true,
  },
  what_changes: {
    label: 'What changes', icon: 'SlidersHorizontal', group: 'method',
    press: { kind: 'fixed', id: 'agent-next-what-would-change' },
    user_line: 'What would most likely change this result?',
    authorities: { eligibility: 'RC', science: null, quantities: 'Canonical' }, contract: 'typed_reply', run_dependent: true,
  },
  strengthen: {
    label: 'Strengthen', icon: 'ShieldCheck', group: 'review',
    press: { kind: 'fixed', id: 'agent-next-strengthen' },
    user_line: 'What would most strengthen this model?',
    authorities: { eligibility: 'RC', science: null, quantities: 'Canonical' }, contract: 'typed_card', run_dependent: true,
  },
  pre_mortem: {
    label: 'Pre-mortem', icon: 'ClipboardList', group: 'method',
    press: { kind: 'fixed', id: 'agent-next-pre-mortem' },
    user_line: 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?',
    authorities: { eligibility: 'RC', science: 'DSK', quantities: null }, contract: 'typed_method', run_dependent: false,
  },
  more_options: {
    label: 'More options', icon: 'GitFork', group: 'gap',
    press: { kind: 'fixed', id: 'agent-next-widen' },
    user_line: 'Suggest options I haven’t considered.',
    authorities: { eligibility: 'RC', science: 'DSK', quantities: null }, contract: 'typed_card', run_dependent: false,
  },
  test_link: {
    label: 'Test link', icon: 'Unlink', group: 'method',
    press: { kind: 'per_link' },
    user_line: 'Test without this link',
    authorities: { eligibility: 'CEE', science: null, quantities: 'Canonical' }, contract: 'typed_reply', run_dependent: true,
  },
  frame_brief: {
    label: 'Frame brief', icon: 'FileText', group: 'gap',
    press: { kind: 'fixed', id: 'act:frame_brief' },
    user_line: 'Help me frame my brief: what is missing from it?',
    authorities: { eligibility: 'Canonical', science: null, quantities: 'Canonical' }, contract: 'typed_reply', run_dependent: false,
  },
  set_goal: {
    label: 'Set target', icon: 'Target', group: 'gap',
    press: { kind: 'fixed', id: 'act:set_goal' },
    user_line: 'Help me set a target for my goal.',
    authorities: { eligibility: 'Canonical', science: null, quantities: 'Canonical' }, contract: 'typed_reply', run_dependent: false,
  },
  set_deadline: {
    label: 'Set deadline', icon: 'CalendarClock', group: 'gap',
    press: { kind: 'fixed', id: 'act:set_deadline' },
    user_line: 'Help me set the deadline for my goal.',
    authorities: { eligibility: 'Canonical', science: null, quantities: 'Canonical' }, contract: 'typed_reply', run_dependent: false,
  },
  more_risks: {
    label: 'More risks', icon: 'ShieldAlert', group: 'gap',
    press: { kind: 'fixed', id: SUGGEST_RISKS_CHIP.id },
    user_line: SUGGEST_RISKS_CHIP.message,
    authorities: { eligibility: 'RC', science: 'DSK', quantities: null }, contract: 'typed_method', run_dependent: false,
  },
};

/** The fixed press ids, reversed. Built once from the registry: the registry is the only mapper. */
const BY_PRESS_ID: ReadonlyMap<string, ActionId> = new Map(ACTION_IDS.flatMap((id) => {
  const press = ACTION_REGISTRY[id].press;
  return press.kind === 'fixed' ? [[press.id, id] as const] : [];
}));

/** The registry action a chip id presses, or undefined for any other chip (approvals, plan picks, `ask:*`, …). */
export function actionOfPress(chipId: unknown, message?: unknown): ActionId | undefined {
  if (typeof chipId !== 'string') return undefined;
  const fixed = BY_PRESS_ID.get(chipId);
  // WIDEN's risks chip id is shared: the pre-mortem worksheet's "Add this as a risk" carries the SAME id with its own
  // message and must stay an ordinary Agent turn (SR-5). So the press is More risks only when WIDEN's own predicate
  // reads it as its risks door (`widenTargetOf`, which matches the message), never on the id alone.
  if (fixed === 'more_risks') return widenTargetOf(chipId, message) === 'risks' ? fixed : undefined;
  if (fixed !== undefined) return fixed;
  if (chipId.startsWith(TEST_LINK_PRESS_PREFIX)) return 'test_link';
  return undefined;
}

/** An `act:` press whose id the registry does not hold (D.5: never an ordinary Agent turn). */
export function isUnknownActionPress(chipId: unknown): boolean {
  return typeof chipId === 'string' && chipId.startsWith(ACTION_PRESS_PREFIX) && !BY_PRESS_ID.has(chipId);
}
