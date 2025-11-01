import { env } from "node:process";
import Fastify from "fastify";
import cors from "@fastify/cors";
import draftRoute from "./routes/assist.draft-graph.js";
import suggestRoute from "./routes/assist.suggest-options.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [/^http:\/\/localhost:\d+$/]
});

app.get("/healthz", async () => ({
  ok: true,
  service: "assistants",
  limits_source: env.ENGINE_BASE_URL ? "engine" : "config"
}));

await draftRoute(app);
await suggestRoute(app);

const port = Number(env.PORT || 3101);

app
  .listen({ port, host: "0.0.0.0" })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
