/**
 * ⭐ A REFUSAL THE USER CAN SETTLE BY CHOOSING (Paul's order #4; interface MG #85 5933547779, agreed by AI HARNESS 5934163980).
 *
 * Today a refusal like "say whether the risk would raise or lower Revenue" makes the user type the exact words. When the
 * tool already holds the typed candidates, it offers them instead, as ≤3 choices, and the user presses one.
 *
 *   tool → host:  `choices: [{ id, label, field, value }]` built from the tool's OWN typed candidates (here: a link's two
 *                 directions, bound to the node id) — the host never interprets words.
 *   host → chip:  `id = agent-choice:<tool>:<field>:<value>`; the click carries no free text the tool reads. The tool name
 *                 and the value hold no ':'; `field` may, so a parser takes the first and last segments around it.
 *   chip → tool:  the next turn's context carries `chosen: { tool, field, value }`, parsed from the chip id ONLY (HARNESS's
 *                 host side). The tool accepts `chosen.value` as the user's answer for `field` only when `chosen.tool` is
 *                 itself AND the value is one it would offer NOW, re-derived from the graph by the caller. Anything else
 *                 is ignored, so the same refusal comes back.
 *
 * No process memory: the press is re-judged against the model as it is, so it survives a restart and a moved graph.
 */

/** One button a refusal offers. `value` is a typed candidate, never words. */
export interface RefusalChoice {
  readonly id: string;
  readonly label: string;
  readonly field: string;
  readonly value: string;
}

/** The user's press, as the host parses it from the chip id (never model output). */
export interface ChosenAnswer {
  readonly tool: string;
  readonly field: string;
  readonly value: string;
}

export const AGENT_CHOICE_PREFIX = 'agent-choice';
/** A refusal offers at most this many choices; more than that is a question to ask, not buttons to press. */
export const MAX_REFUSAL_CHOICES = 3;

export function refusalChoiceId(tool: string, field: string, value: string): string {
  return `${AGENT_CHOICE_PREFIX}:${tool}:${field}:${value}`;
}

/** The choices for one field, or `undefined` when there are none or more than `MAX_REFUSAL_CHOICES`. */
export function refusalChoices(
  tool: string,
  field: string,
  options: readonly { readonly value: string; readonly label: string }[],
): RefusalChoice[] | undefined {
  if (options.length === 0 || options.length > MAX_REFUSAL_CHOICES) return undefined;
  return options.map((o) => ({ id: refusalChoiceId(tool, field, o.value), label: o.label, field, value: o.value }));
}

/**
 * The user's pressed answer for THIS tool's `field`, accepted only when it is one of `offeredNow` — the values the tool
 * would offer for that field on the graph it holds now (the caller re-derives them). Otherwise `null`.
 */
export function pressedValue(
  chosen: ChosenAnswer | undefined,
  tool: string,
  field: string,
  offeredNow: readonly string[],
): string | null {
  if (chosen === undefined || chosen.tool !== tool || chosen.field !== field) return null;
  return offeredNow.includes(chosen.value) ? chosen.value : null;
}

export type LinkDirection = 'positive' | 'negative';
const DIRECTIONS: readonly LinkDirection[] = ['negative', 'positive'];

/** The field a new node's ONE link direction is asked on: the role and the OTHER end's node id (never a label). */
export const directionField = (role: 'affects' | 'caused_by', nodeId: string): string => `${role}/${nodeId}/direction`;

/** The direction the user pressed for that link, if they pressed one for exactly this tool and node. */
export function pressedDirection(
  chosen: ChosenAnswer | undefined,
  tool: string,
  role: 'affects' | 'caused_by',
  nodeId: string,
): LinkDirection | null {
  return pressedValue(chosen, tool, directionField(role, nodeId), DIRECTIONS) as LinkDirection | null;
}

/** The two direction buttons, in the words the refusal asks the question in. */
export function directionChoices(
  tool: string,
  role: 'affects' | 'caused_by',
  nodeId: string,
  words: { readonly positive: string; readonly negative: string },
): RefusalChoice[] {
  return refusalChoices(tool, directionField(role, nodeId), [
    { value: 'negative', label: words.negative },
    { value: 'positive', label: words.positive },
  ])!;
}
