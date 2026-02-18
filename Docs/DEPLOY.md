## Deployment: CEE (olumi-assistants-service)

### Environments

| Environment | URL | Branch | Render service |
|-------------|-----|--------|----------------|
| Staging | cee-staging.onrender.com | staging | olumi-cee-staging |
| Production | cee.onrender.com | main | olumi-cee |

### Required environment variables

NODE_ENV must be `production` — the Zod config schema rejects any other value including `staging`. This has caused crashes. Render staging environment must still use NODE_ENV=production.

Other required vars: OPENAI_API_KEY, ANTHROPIC_API_KEY, DRAFT_REQUEST_BUDGET_MS (default 90000), LLM_POST_PROCESSING_HEADROOM_MS (default 10000).

### Deploy steps

1. `git checkout staging && git pull origin staging`
2. `bash scripts/pre-push-validate.sh`
3. `git push origin staging` (triggers Render auto-deploy)

### Post-deploy verification

`curl -s https://cee-staging.onrender.com/health | jq .`

Check Render dashboard for deploy status. If it shows "Live" but behaviour seems old, check the commit hash in the health endpoint matches your push.

### Known failure patterns

1. **NODE_ENV rejection:** Service crashes on startup with Zod validation error. Fix: set NODE_ENV=production.
2. **GitHub Packages auth:** @talchain/schemas requires GITHUB_TOKEN in Render env vars. Without it, install fails during build.
3. **Stale build on Render:** Shows "deployed" but code is old. Fix: manual redeploy in Render dashboard.
