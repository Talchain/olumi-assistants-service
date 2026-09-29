# Engine Coordination Status Report

**Generated:** 2025-01-07T12:11:00Z
**Status:** ⏭️ SKIPPED

## Summary

- **Engine Validation:** SKIPPED
- **Reason:** No running assistants service or engine instance available for validation
- **Impact:** Non-blocking - can be validated during staging deployment

## Configuration Required

To run engine validation, the following services must be running:

1. **Assistants Service**: http://localhost:3101 (or set ASSISTANTS_BASE_URL)
2. **PLoT Engine**: http://localhost:33108 (or set ENGINE_BASE_URL)

## How to Run Validation

Once services are deployed to staging:

```bash
# Set environment variables
export ASSISTANTS_BASE_URL=https://staging.olumi-assistants-service.onrender.com
export ENGINE_BASE_URL=<engine-staging-url>
export LLM_PROVIDER=fixtures

# Run validation script
pnpm exec tsx scripts/validate-with-engine.ts
```

## Expected Outcomes

The validation script will:
- Generate 50 draft graphs using the assistants service
- Validate each graph against the PLoT engine's /v1/validate endpoint
- Track first-pass validation success rate
- Target: ≥90% validation success rate

## Validation During Staging Burn-In

This validation will be performed as part of the staging burn-in process documented in [Docs/staging-burnin.md](../staging-burnin.md).

## Recommendations

- ✅ Validation script is implemented and ready to use
- ✅ Script can be run during staging deployment
- ⚠️  Requires both services to be deployed and accessible
- 📋 Include in staging burn-in checklist (section 10)

---

**Next Steps:**
1. Deploy to staging environment
2. Run validation script with both services available
3. Update this report with actual validation results
4. Verify ≥90% success rate before production deployment
