/**
 * V5 TURN FENCE — the ingress coverage CLAIM, derived from the route table.
 *
 * The fence's whole coverage argument is "every graph-writing lane reaches
 * `POST /orchestrate/v2/turn`, and that route claims the fence". The first half
 * is a property of the codebase (`/proxy/v5/turn`, `/proxy/v5/turn/stream` and
 * `/orchestrate/v2/turn/stream` all `app.inject()` into it, and `app.inject()`
 * runs the target route's hooks). The second half is a single line at the route
 * registration, and a single line is exactly what gets dropped in a refactor —
 * with a symptom that is invisible in every other test, because a turn with no
 * fence handle commits perfectly.
 *
 * So it is read off the REGISTERED ROUTE rather than asserted about the source
 * text: an `onRoute` hook captures the options Fastify actually received.
 * A grep for the hook's name would pass on a commented-out line (CLAUDE.md
 * trap 16 — a symbol grep proves presence-in-repo, never presence-on-the-path).
 *
 * No request is sent: this is about registration, and the turn pipeline's env
 * requirements are not part of the claim.
 */

import { describe, it, expect } from 'vitest';
import Fastify, { type RouteOptions } from 'fastify';

import { ceeOrchestratorRouteV2 } from '../route-v2.js';
import { turnFencePreHandler } from '../turn-fence-prehandler.js';

function hooksFor(route: RouteOptions | undefined): unknown[] {
  if (route === undefined) return [];
  const hook = route.preHandler;
  if (hook === undefined) return [];
  return Array.isArray(hook) ? hook : [hook];
}

describe('POST /orchestrate/v2/turn carries the turn-fence preHandler', () => {
  it('registers turnFencePreHandler on the single graph-writing ingress', async () => {
    const app = Fastify();
    const routes: RouteOptions[] = [];
    app.addHook('onRoute', (route) => {
      routes.push(route);
    });
    await ceeOrchestratorRouteV2(app);
    await app.ready();

    const turnRoute = routes.find(
      (r) => r.url === '/orchestrate/v2/turn' && r.method === 'POST',
    );
    expect(turnRoute, 'the turn route must be registered').toBeDefined();
    expect(hooksFor(turnRoute)).toContain(turnFencePreHandler);

    // The service-key stop sibling exists. It is NOT optional: the UI derives
    // its stop URL as `<buffered endpoint>/stop`, and on any deployment that
    // does not bake VITE_V5_ENDPOINT the buffered endpoint is the Netlify edge
    // rung (`/bff/orchestrate/v2/turn`), which the edge function rewrites onto
    // this route. Without it that rung 404s and the UI can never confirm a Stop.
    const stopRoute = routes.find(
      (r) => r.url === '/orchestrate/v2/turn/stop' && r.method === 'POST',
    );
    expect(stopRoute, 'the /orchestrate stop sibling must be registered').toBeDefined();
    // And it must NOT be fenced — a stop request is not a turn and must never
    // claim a generation of its own (which would supersede the turn it stops).
    expect(hooksFor(stopRoute)).not.toContain(turnFencePreHandler);

    await app.close();
  });
});
