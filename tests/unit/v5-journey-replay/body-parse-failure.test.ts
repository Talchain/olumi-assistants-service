import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postTurn } from '../../../tools/v5-journey-replay/client.js';
import { assertProductShape, assertDraftGraph, assertExplainLeader } from '../../../tools/v5-journey-replay/assertions.js';

import { stubFetchOnce as stubFetchTyped } from './_test-helpers.js';

interface MockedResponseInit {
  readonly status?: number;
  readonly text: string;
  readonly contentType?: string;
}

function stubFetchOnce(init: MockedResponseInit) {
  return stubFetchTyped({ status: init.status, rawText: init.text, contentType: init.contentType });
}

describe('postTurn handles non-JSON / empty bodies as typed parse failures', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('200 with empty body → fingerprint set, no raw bytes captured', async () => {
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
    expect(result.body.__body_length).toBe(0);
    expect(result.body.__body_sha256_prefix).toMatch(/^[a-f0-9]{8}$/);
    // Privacy gate: no raw body field exists.
    const bodyAsRecord = result.body as Record<string, unknown>;
    expect(bodyAsRecord.__body_raw).toBeUndefined();
  });

  it('200 with HTML proxy error page → fingerprint set, raw bytes NOT echoed (privacy gate)', async () => {
    const htmlPage = '<!DOCTYPE html><html><body>502 Bad Gateway from CDN</body></html>';
    stubFetchOnce({ status: 200, text: htmlPage, contentType: 'text/html' });
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
    expect(result.body.__body_length).toBe(htmlPage.length);
    expect(result.body.__body_content_type).toBe('text/html');
    expect(result.body.__body_sha256_prefix).toMatch(/^[a-f0-9]{8}$/);
    // CRITICAL privacy invariant: the raw body string never appears in
    // the parsed envelope. This prevents proxy / runtime error pages
    // from echoing user input or other sensitive content into the
    // committed evidence markdown.
    const bodyAsRecord = result.body as Record<string, unknown>;
    expect(bodyAsRecord.__body_raw).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('502 Bad Gateway');
    expect(JSON.stringify(result.body)).not.toContain('CDN');
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
      body: { __body_parse_failed: true, __body_length: 0, __body_content_type: '', __body_sha256_prefix: 'e3b0c442' },
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
      body: { __body_parse_failed: true, __body_length: 16, __body_content_type: 'text/html', __body_sha256_prefix: '12345678' },
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
      body: { __body_parse_failed: true, __body_length: 0, __body_content_type: '', __body_sha256_prefix: 'e3b0c442' },
      elapsed_ms: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/body_parse_failed/);
    }
  });
});
