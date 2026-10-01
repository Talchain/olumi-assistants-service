/**
 * Render reads a JSON log line's `level` as a label only: pino's numeric 50 was shown as `info`, so an error search
 * missed every leak event (DL 380e54 programme-docs#85 5932495794 item 3). The service logger writes the label.
 */
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLoggerConfig } from '../logger-config.js';

function capture(): { logger: pino.Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      for (const l of String(chunk).split('\n')) if (l.trim().length > 0) lines.push(JSON.parse(l) as Record<string, unknown>);
      done();
    },
  });
  return { logger: pino(createLoggerConfig('info'), sink), lines };
}

describe('the service logger writes the level as a label Render can read', () => {
  it('RED: log.error writes level "error" (was 50, shown by Render as info)', () => {
    const { logger, lines } = capture();
    logger.error({ event: 'agent_lane.leader_claim_residual_removed', enforced: true }, 'removed');
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('error');
    expect(lines[0].event).toBe('agent_lane.leader_claim_residual_removed');
  });

  it('CONTROL: warn and info keep their own labels; the level threshold still filters', () => {
    const { logger, lines } = capture();
    logger.warn({ event: 'w' }, 'w');
    logger.info({ event: 'i' }, 'i');
    logger.debug({ event: 'd' }, 'd');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'info']);
  });

  it('CONTROL: redaction is unchanged', () => {
    const { logger, lines } = capture();
    logger.info({ headers: { authorization: 'Bearer secret-token-value' } }, 'r');
    expect(JSON.stringify(lines[0])).not.toContain('secret-token-value');
  });
});
