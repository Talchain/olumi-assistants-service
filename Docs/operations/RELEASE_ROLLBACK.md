# Release Rollback (v1.3.0 baseline)

**When to use**: Production instability or failed smoke tests.

## Steps

1. Tag current head for audit:
   ```bash
   git tag rollback-pre-v1.3.0-$(date +%Y%m%d-%H%M%S)
   git push --tags
   ```

2. In Render, open the service → Deploys → Rollback → select the previous green deploy.

3. Verify production with:
   ```bash
   node qa-smoke.mjs --base-url https://olumi-assistants-service.onrender.com --timeout 60
   ```

4. Open an incident note (timestamps, impact, which A-test failed) and start a hotfix branch.

## Notes

Do not rotate or expose ASSIST_API_KEY. Use existing CI workflows to re-validate after rollback.
