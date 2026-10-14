/** Route-unit identity transport. Owner facts still flow through the production hook. */
import type { FastifyInstance } from 'fastify';

type Identity = { mode: string; userId?: string; reason?: string };
export async function installOwnershipHarness(app: FastifyInstance, identity?: () => Promise<Identity> | Identity) {
  if (identity) app.addHook('onRequest', async req => {
    const value = await identity();
    if (value.mode === 'verified' || value.mode === 'refused') {
      req.headers.authorization = `Bearer fixture.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`;
    } else delete req.headers.authorization;
  });
  const { scenarioOwnershipPlugin } = await import('../../src/plugins/scenario-ownership.js');
  await app.register(scenarioOwnershipPlugin);
  app.addHook('preHandler', async (req, reply) => {
    if (req.scenarioAccess) reply.header('x-ownership-caller', req.scenarioAccess.callerUserId ?? '');
  });
}
/** Only the verifier's identity port is faked; never an ownership verdict. */
export async function verifyFixtureIdentity(token: string) {
  const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Identity;
  return value.mode === 'verified' ? { ok: true as const, userId: value.userId! }
    : { ok: false as const, reason: value.reason ?? 'invalid_token' };
}
