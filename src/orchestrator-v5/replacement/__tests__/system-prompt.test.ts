/**
 * The system prompt — pure composition, pinned by execution.
 *
 * Every case names the live failure whose recurrence it is meant to make
 * visible in a diff. A prompt regression is otherwise invisible: the product
 * keeps answering, just worse.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY, recordItem } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, openProposal, markStaleForRevision } from '../proposal-store.js';
import { SYSTEM_PROMPT_DOCTRINE, buildSystemPrompt, type SystemPromptInput } from '../system-prompt.js';

const T = '2026-09-20T12:00:00.000Z';

const base: SystemPromptInput = {
  memory: EMPTY_CONVERSATION_MEMORY,
  proposals: EMPTY_PROPOSAL_STORE,
  workspaceSummary: 'Four options, nine factors. No analysis has run yet.',
};

describe('the doctrine states the product this is, not the one it was', () => {
  it('frames the work as improving the reasoning, not editing the diagram', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('make their thinking better');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('Not to tidy the diagram');
  });

  it('requires disagreement where the reasoning is weak, and forbids manufactured objections', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('say what would change your mind');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('do not manufacture an objection');
  });

  it('forbids claiming a change happened — the "Updated Monthly Churn Rate" failure', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain("I've updated");
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('unless a tool result has told you');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('do not pick the reassuring answer');
  });

  it('says a statement is not an edit request — 9 of 26 live turns took the mutation branch', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('A STATEMENT IS NOT AN EDIT REQUEST');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('only when they have asked for a change');
  });

  /**
   * Found live: the remember tool was built, wired and unused. Across four
   * turns including a textbook user fact ("churn went from 3% to 4.4%") the
   * model never called it, because nothing told it to. A capability the
   * model does not know it has is the same as one that does not exist.
   */
  it('instructs the model to record what the user establishes, in the same turn', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('WRITE DOWN WHAT THEY ESTABLISH, IN THE SAME TURN');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('record it with the remember tool');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('Not later, and not only the ones that seem important');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('the clearest possible signal that you were not listening');
  });

  it('refuses to flatten a qualified option into its generic version', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('the qualifier IS the option');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('do not silently propose the flattened change');
  });

  it('requires the computed uncertainty to be reported, and a near-tie named as a finding', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('which single links in the model would flip the answer');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('A close result is a finding, not a failure');
  });

  /**
   * Both found by a live run, not by review. Shown an analysis covering two
   * of three options, the assistant guessed why the third was missing — in a
   * paragraph otherwise made of measured numbers. And it wrote the whole
   * reply in markdown, which the prompt already said not to do, loosely.
   */
  /**
   * Found by the third live scenario. Told "I don't buy the churn link, I
   * think you're overcomplicating this", it replied "Which churn link
   * specifically?" — reasonable on its face, and a complete dodge of the
   * accusation. A reasoning partner that cannot defend its own reasoning is
   * not one.
   */
  it('requires a challenge to be answered before anything is asked back', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('WHEN THEY CHALLENGE YOU, ANSWER THE CHALLENGE');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('Only then ask anything');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('is actually a dodge');
  });

  it('allows exactly one question per reply, and says why two lose one', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('AT MOST ONE question per reply');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('you will not know which');
  });

  /**
   * All three derived from the DEPLOYED UI build (fd992149, confirmed against
   * its own version.json), not from the source alone.
   *
   * The first is the dangerous one: MessageBubble returns null when the text
   * trips a non-conversational predicate AND blocks are empty. Blocks are
   * ALWAYS empty for this controller, so an apologetic opening makes the
   * whole message disappear with no error anywhere.
   */
  it('forbids the openings that make the interface delete the message', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('REMOVES THE MESSAGE ENTIRELY');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain("I received your message but couldn't");
  });

  it('requires amounts in full, because a letter suffix is split when displayed', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('"£2.4 million", not "£2.4m"');
  });

  it('forbids line openings that the renderer turns into list markers', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('Never begin a line with a hyphen, an asterisk, or a number followed by a full stop');
  });

  it('forbids explaining an absence it cannot explain', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('NEVER EXPLAIN AN ABSENCE YOU CANNOT EXPLAIN');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('Do not offer a likely reason');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('reads as another measured number');
  });

  it('bans markdown explicitly, not just headings', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('no markdown, no asterisks for emphasis');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('no bold');
  });

  it('bans internal vocabulary on screen — "the held change has lapsed"', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('no identifiers, no status names, no field names');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('no talk of things lapsing or being held');
  });

  it('bans advertising a capability it does not have, and the list-every-node non-answer', () => {
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('Never offer a capability you do not have');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('listing everything in the model');
  });

  it('carries none of the retired path\'s branch vocabulary', () => {
    // Contrast control: the words it SHOULD carry are present, so a prompt
    // that had simply gone empty could not pass this case.
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('PROPOSE');
    for (const retired of ['edit_graph', 'chip', 'stage_indicator', 'TurnClass', 'intent']) {
      expect(SYSTEM_PROMPT_DOCTRINE.toLowerCase()).not.toContain(retired.toLowerCase());
    }
  });
});

describe('an absent section is omitted, never emitted empty', () => {
  it('says nothing about what was established when nothing has been', () => {
    const p = buildSystemPrompt(base);
    expect(p).not.toContain('WHAT THIS CONVERSATION HAS ESTABLISHED');
  });

  it('says nothing about pending offers when there are none', () => {
    expect(buildSystemPrompt(base)).not.toContain('WAITING ON THEM');
  });

  it('says nothing about unavailability when everything is available', () => {
    expect(buildSystemPrompt({ ...base, unavailable: [] })).not.toContain('NOT AVAILABLE');
  });

  it('describes an absent model as the start of the work, not as an empty one', () => {
    const p = buildSystemPrompt({ ...base, workspaceSummary: null });
    expect(p).toContain('There is no model yet');
    expect(p).toContain('before proposing anything');
  });
});

describe('the record reaches the model with each claim\'s standing intact', () => {
  it('keeps a user fact and an assistant suggestion distinguishable', () => {
    let m = recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'i1', kind: 'user_fact', text: 'Churn is 3% a month', source_turn_id: 't1', recorded_at: T,
    });
    m = recordItem(m, {
      id: 'i2', kind: 'ai_suggestion', text: 'Set the churn factor to 0.03', source_turn_id: 't1', recorded_at: T,
    });
    const p = buildSystemPrompt({ ...base, memory: m });
    expect(p).toContain('WHAT THIS CONVERSATION HAS ESTABLISHED');
    expect(p).toContain('THE USER STATED AS FACT');
    expect(p).toContain('YOU SUGGESTED (not agreed, not applied)');
    // The two must not be flattened into one undifferentiated list.
    expect(p.indexOf('THE USER STATED AS FACT')).toBeLessThan(p.indexOf('YOU SUGGESTED'));
  });
});

describe('a pending offer is present so "yes, go ahead" has something to attach to', () => {
  const withOffer = openProposal(EMPTY_PROPOSAL_STORE, {
    id: 'p1',
    operations: [{ kind: 'set_option_effect', summary: 'Set what Full Parity does to Churn to 0.4' }],
    model_revision: 'rev-a', proposed_at: T, proposed_in_turn: 't1',
  });

  it('names the offer and states plainly that nothing has been saved', () => {
    const p = buildSystemPrompt({ ...base, proposals: withOffer });
    expect(p).toContain('WAITING ON THEM');
    expect(p).toContain('Set what Full Parity does to Churn to 0.4');
    expect(p).toContain('Nothing here has been saved');
  });

  it('drops the offer once the model has moved — a stale offer must not be presented as live', () => {
    const p = buildSystemPrompt({ ...base, proposals: markStaleForRevision(withOffer, 'rev-b') });
    expect(p).not.toContain('WAITING ON THEM');
    expect(p).not.toContain('Full Parity');
  });
});

describe('what is unavailable is stated, not left to be invented', () => {
  it('lists it and tells the model to say so rather than attempt it', () => {
    const p = buildSystemPrompt({ ...base, unavailable: ['searching the web for external evidence'] });
    expect(p).toContain('NOT AVAILABLE ON THIS TURN');
    expect(p).toContain('searching the web for external evidence');
    expect(p).toContain('rather than attempting it or implying you did');
  });
});

describe('composition is deterministic', () => {
  it('the same input composes byte-identical prompts', () => {
    expect(buildSystemPrompt(base)).toBe(buildSystemPrompt(base));
  });

  it('the doctrine always leads — a rule the model reads last is a rule it weighs least', () => {
    expect(buildSystemPrompt(base).startsWith(SYSTEM_PROMPT_DOCTRINE)).toBe(true);
  });
});
