import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postTurn } from '../../../tools/v5-journey-replay/client.js';
import { assertProductShape, assertDraftGraph, assertExplainLeader } from '../../../tools/v5-journey-replay/assertions.js';

interface MockedResponseInit {
  readonly status?: number;
  readonly text: string;
}

function stubFetchOnce(init: MockedResponseInit) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return {
        status: init.status ?? 200,
        json: async () => {
          // Real fetch.json() throws on non-JSON; mirror that here so
          // postTurn must rely on .text() + JSON.parse to know the body.
          throw new SyntaxError('Unexpected token in JSON');
        },
        text: async () => init.text,
      } as unknown as Response;
    }),
  );
}

describe('postTurn handles non-JSON / empty bodies as typed parse failures', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('200 with empty body → __body_parse_failed sentinel set', async () => {
    stubFetchOnce({ status: 200, text: '' });
    const result = await postTurn(
      'https://example.com',
      {
        kind: 'message',
        turn_id: 't',
        scenario_id: 's',
        stage: 'frame',
        message: 'm',
        turn_class: 'frame',
        source: 'composer',
      },
      1000,
    );
    expect(result.status).toBe(200);
    expect(result.body.__body_parse_failed).toBe(true);
    expect(result.body.__body_raw).toBe('');
  });

  it('200 with HTML proxy error page → __body_parse_failed sentinel set, raw text captured (truncated)', async () => {
    const htmlPage = '<!DOCTYPE html><html><body>502 Bad Gateway from CDN</body></html>';
    stubFetchOnce({ status: 200, text: htmlPage });
    const result = await postTurn(
      'https://example.com',
      {
        kind: 'message',
        turn_id: 't',
        scenario_id: 's',
        stage: 'frame',
        message: 'm',
        turn_class: 'frame',
        source: 'composer',
      },
      1000,
    );
    expect(result.body.__body_parse_failed).toBe(true);
    expect(result.body.__body_raw).toContain('502 Bad Gateway');
  });

  it('200 with valid JSON → no sentinel set', async () => {
    stubFetchOnce({
      status: 200,
      text: JSON.stringify({ response_version: 2, assistant_text: 'ok' }),
    });
    const result = await postTurn(
      'https://example.com',
      {
        kind: 'message',
        turn_id: 't',
        scenario_id: 's',
        stage: 'frame',
        message: 'm',
        turn_class: 'frame',
        source: 'composer',
      },
      1000,
    );
    expect(result.body.__body_parse_failed).toBeUndefined();
    expect(result.body.assistant_text).toBe('ok');
  });
});

describe('assertions reject parse failures and empty product-shape envelopes', () => {
  it('assertProductShape FAILS on body_parse_failed (200 with empty body)', () => {
    const r = assertProductShape({
      status: 200,
      body: { __body_parse_failed: true, __body_raw: '' },
      elapsed_ms: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/body_parse_failed/);
    }
  });

  it('assertProductShape FAILS on 200 with empty JSON `{}` (no text and no chips)', () => {
    const r = assertProductShape({ status: 200, body: {}, elapsed_ms: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/product_shape_empty/);
    }
  });

  it('assertProductShape PASSES on 200 with non-empty assistant_text', () => {
    const r = assertProductShape({
      status: 200,
      body: { assistant_text: 'hello world' },
      elapsed_ms: 1,
    });
    expect(r.ok).toBe(true);
  });

  it('assertProductShape PASSES on 200 with chips even if assistant_text is empty', () => {
    const r = assertProductShape({
      status: 200,
      body: {
        assistant_text: '',
        suggested_actions: [{ id: 'c', label: 'L', message: 'M' }],
      },
      elapsed_ms: 1,
    });
    expect(r.ok).toBe(true);
  });

  it('assertDraftGraph FAILS on body_parse_failed', () => {
    const r = assertDraftGraph({
      status: 200,
      body: { __body_parse_failed: true, __body_raw: '<html>err</html>' },
      elapsed_ms: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/body_parse_failed/);
    }
  });

  it('assertExplainLeader FAILS on body_parse_failed', () => {
    const r = assertExplainLeader({
      status: 200,
      body: { __body_parse_failed: true, __body_raw: '' },
      elapsed_ms: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/body_parse_failed/);
    }
  });
});
