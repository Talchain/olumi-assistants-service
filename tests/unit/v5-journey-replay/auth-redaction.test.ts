import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postTurn, getHealthz, preflightAuth } from '../../../tools/v5-journey-replay/client.js';
import { renderEvidencePack } from '../../../tools/v5-journey-replay/evidence-writer.js';
import { createRedactor } from '../../../tools/v5-journey-replay/redact.js';
import type { EvidenceRow, HealthzResult } from '../../../tools/v5-journey-replay/types.js';

const SENTINEL = 'SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123';

function buildHealthz(build = '66d1adb'): HealthzResult {
  return {
    status: 200,
    elapsed_ms: 42,
    body: { ok: true, build, version: '0.0.1', service: 'assistants', degraded: false },
  };
}

interface MockedFetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

type FetchMock = ReturnType<
  typeof vi.fn<(input: string | URL, init?: MockedFetchInit) => Promise<Response>>
>;

function mockFetchOnce(
  response: Partial<Response> & { jsonValue?: unknown } | Error,
): FetchMock {
  const fn: FetchMock = vi.fn(async (_input: string | URL, _init?: MockedFetchInit) => {
    if (response instanceof Error) throw response;
    const jsonBody = response.jsonValue ?? {};
    return {
      status: response.status ?? 200,
      json: async () => jsonBody,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('auth header injection', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends X-Olumi-Assist-Key header when apiKey is provided', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      jsonValue: { response_version: 2, assistant_text: 'ok' },
    });
    await postTurn(
      'https://example.com',
      {
        turn_id: 't',
        scenario_id: 's',
        message: 'm',
        turn_class: 'frame',
        stage: 'frame',
      },
      1000,
      SENTINEL,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-olumi-assist-key']).toBe(SENTINEL);
    expect(headers['content-type']).toBe('application/json');
  });

  it('omits the auth header when apiKey is undefined (localhost case)', async () => {
    const fetchMock = mockFetchOnce({ status: 200, jsonValue: {} });
    await postTurn(
      'http://localhost:3000',
      {
        turn_id: 't',
        scenario_id: 's',
        message: 'm',
        turn_class: 'frame',
        stage: 'frame',
      },
      1000,
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-olumi-assist-key']).toBeUndefined();
  });
});

describe('secret never leaks across observable surfaces', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetch rejection error.message does not contain secret', async () => {
    mockFetchOnce(new Error(`fetch failed with header x-olumi-assist-key=${SENTINEL}`));
    await expect(
      postTurn(
        'https://example.com',
        { turn_id: 't', scenario_id: 's', message: 'm', turn_class: 'frame', stage: 'frame' },
        1000,
        SENTINEL,
      ),
    ).rejects.toThrow();
    try {
      await postTurn(
        'https://example.com',
        { turn_id: 't', scenario_id: 's', message: 'm', turn_class: 'frame', stage: 'frame' },
        1000,
        SENTINEL,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const e = err as Error;
      expect(e.message).not.toContain(SENTINEL);
      expect(e.message).toContain('[REDACTED]');
      expect(e.stack ?? '').not.toContain(SENTINEL);
    }
  });

  it('fetch rejection preserves AbortError name (transport classification)', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    mockFetchOnce(abort);
    try {
      await postTurn(
        'https://example.com',
        { turn_id: 't', scenario_id: 's', message: 'm', turn_class: 'frame', stage: 'frame' },
        1000,
        SENTINEL,
      );
      expect.fail('expected throw');
    } catch (err) {
      const e = err as Error;
      expect(e.name).toBe('AbortError');
      expect(e.message).not.toContain(SENTINEL);
    }
  });

  it('preflight response never causes secret to appear in evidence markdown', () => {
    const redact = createRedactor(SENTINEL);
    const rows: EvidenceRow[] = [
      {
        step: '1_draft_graph',
        status: 'failed',
        evidence: `auth rejected: header=${SENTINEL}`,
        failing_contract: `auth 401 — value was ${SENTINEL}`,
        outcome_class: 'harness-auth-blocker',
        http_status: 401,
      },
    ];
    // Note: rows should already be redacted before calling the writer in
    // the real harness, but the writer applies a final pass as defense.
    const markdown = renderEvidencePack(
      {
        branch: 'claude/v5-replay-proof',
        commit_sha: 'abc123',
        base_url: 'https://cee-staging.onrender.com',
        started_at: new Date().toISOString(),
        prompt_version: 'v38.2',
        prompt_hash: '2e25001a025e288c',
        healthz: buildHealthz(),
        preflight: { status: 401, note: `auth rejected, raw=${SENTINEL}` },
        auth_mode: 'authenticated',
      },
      rows,
      redact,
    );
    expect(markdown).not.toContain(SENTINEL);
    // But the redaction should still leave recognisable traces.
    expect(markdown).toContain('[REDACTED]');
  });

  it('successful response row with secret-contaminated evidence is still redacted', () => {
    const redact = createRedactor(SENTINEL);
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: '2026-04-25T00:00:00Z',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz(),
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [
        {
          step: '1_draft_graph',
          status: 'passed',
          evidence: `chip_count=3 debug=${SENTINEL}`,
          outcome_class: 'v5-runtime',
          http_status: 200,
        },
      ],
      redact,
    );
    expect(markdown).not.toContain(SENTINEL);
  });
});

describe('getHealthz / preflightAuth basic contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getHealthz does not send auth header', async () => {
    const fetchMock = mockFetchOnce({
      status: 200,
      jsonValue: { ok: true, build: '66d1adb', version: '1', service: 'assistants' },
    });
    const result = await getHealthz('https://cee-staging.onrender.com');
    expect(result.status).toBe(200);
    expect(result.body?.build).toBe('66d1adb');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('GET');
    const headers = init?.headers;
    if (headers) {
      expect(headers['x-olumi-assist-key']).toBeUndefined();
    }
  });

  it('preflightAuth sends the auth header and returns status', async () => {
    const fetchMock = mockFetchOnce({
      status: 400,
      jsonValue: { error: 'INVALID_REQUEST', code: 'BAD_BODY' },
    });
    const result = await preflightAuth('https://cee-staging.onrender.com', SENTINEL);
    expect(result.status).toBe(400);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-olumi-assist-key']).toBe(SENTINEL);
  });

  it('preflightAuth exception is redacted', async () => {
    mockFetchOnce(new Error(`transport: header=${SENTINEL}`));
    try {
      await preflightAuth('https://cee-staging.onrender.com', SENTINEL);
      expect.fail('expected throw');
    } catch (err) {
      const e = err as Error;
      expect(e.message).not.toContain(SENTINEL);
    }
  });
});

describe('evidence pack structural assertions (outcome class + exec summary)', () => {
  it('executive summary flags reached_orchestrator=yes when any row is v5-runtime', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz(),
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [
        {
          step: '1_draft_graph',
          status: 'passed',
          evidence: 'e',
          outcome_class: 'v5-runtime',
          http_status: 200,
        },
      ],
    );
    expect(markdown).toMatch(/Replay reached orchestrator \| yes/);
  });

  it('executive summary flags reached_orchestrator=no for auth-blocker-only rows', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz(),
        preflight: { status: 401, note: 'halted' },
        auth_mode: 'authenticated',
      },
      [
        {
          step: '1_draft_graph',
          status: 'failed',
          evidence: 'e',
          outcome_class: 'harness-auth-blocker',
          http_status: 401,
        },
      ],
    );
    expect(markdown).toMatch(/Replay reached orchestrator \| no/);
  });

  it('v38.2 startup confirmed=yes when healthz build matches 66d1adb', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz('66d1adb'),
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [],
    );
    expect(markdown).toMatch(/v38\.2 confirmed \(startup \/ healthz build\) \| yes/);
  });

  it('v38.2 startup confirmed=unverifiable when healthz has no build field', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: { status: 200, elapsed_ms: 10, body: { ok: true } },
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [],
    );
    expect(markdown).toMatch(/v38\.2 confirmed \(startup \/ healthz build\) \| unverifiable/);
  });

  it('v38.2 startup confirmed=no when healthz build is different', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz('deadbee'),
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [],
    );
    expect(markdown).toMatch(/v38\.2 confirmed \(startup \/ healthz build\) \| no/);
    expect(markdown).toMatch(/Deploy MISMATCH/);
  });

  it('per-turn prompt evidence always reports "not capturable"', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz(),
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [],
    );
    expect(markdown).toMatch(/v38\.2 confirmed \(per-turn\) \| not capturable/);
  });

  it('table includes outcome class column', () => {
    const markdown = renderEvidencePack(
      {
        branch: 'b',
        commit_sha: 'c',
        base_url: 'https://example.com',
        started_at: 'x',
        prompt_version: 'v38.2',
        prompt_hash: 'h',
        healthz: buildHealthz(),
        preflight: { status: 400, note: 'ok' },
        auth_mode: 'authenticated',
      },
      [
        {
          step: '1_draft_graph',
          status: 'passed',
          evidence: 'e',
          outcome_class: 'v5-runtime',
          http_status: 200,
        },
      ],
    );
    expect(markdown).toMatch(/\| step \| status \| outcome class \| http \| evidence \| failing_contract \|/);
    expect(markdown).toContain('v5-runtime');
  });
});
