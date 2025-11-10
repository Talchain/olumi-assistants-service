#!/usr/bin/env bash
#
# v1.3.0 Release Validation Script
#
# Validates all v1.3.0 features and requirements:
# - Task E: Graph guards (stable IDs, DAG, sorting)
# - Task G: Per-key auth and quotas
# - Task H: Legacy SSE flag
# - Task I: CI coverage gates (90%+ coverage)
#
# Usage:
#   ./scripts/validate-v1.3.sh

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0

function banner() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

function success() {
  echo -e "${GREEN}✅ $1${NC}"
}

function error() {
  echo -e "${RED}❌ $1${NC}"
  ERRORS=$((ERRORS + 1))
}

function info() {
  echo -e "${YELLOW}ℹ️  $1${NC}"
}

banner "v1.3.0 Release Validation"
echo "Validating: Graph guards, per-key auth, legacy SSE flag, CI coverage"
echo ""

# ============================================================================
# 1. Version Check
# ============================================================================
banner "1. Version Check"

PKG_VERSION=$(cat package.json | grep '"version"' | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "package.json version: $PKG_VERSION"

if [ "$PKG_VERSION" != "1.3.0" ]; then
  error "package.json version should be 1.3.0, got: $PKG_VERSION"
else
  success "package.json version is 1.3.0"
fi

# ============================================================================
# 2. Build
# ============================================================================
banner "2. Build"

if pnpm build > /tmp/v1.3-build.log 2>&1; then
  success "Build succeeded"
else
  error "Build failed (see /tmp/v1.3-build.log)"
  cat /tmp/v1.3-build.log
fi

# ============================================================================
# 3. Lint & Typecheck
# ============================================================================
banner "3. Lint & Typecheck"

if pnpm lint > /tmp/v1.3-lint.log 2>&1; then
  success "Lint passed"
else
  error "Lint failed (see /tmp/v1.3-lint.log)"
  cat /tmp/v1.3-lint.log
fi

if pnpm typecheck > /tmp/v1.3-typecheck.log 2>&1; then
  success "Typecheck passed"
else
  error "Typecheck failed (see /tmp/v1.3-typecheck.log)"
  cat /tmp/v1.3-typecheck.log
fi

# ============================================================================
# 4. Tests with Coverage Thresholds
# ============================================================================
banner "4. Tests with Coverage (v1.3.0 gates: 90%+ lines/functions/statements, 85%+ branches)"

# Run tests with coverage thresholds (matching CI config)
if pnpm test --coverage \
  --coverage.threshold.lines=90 \
  --coverage.threshold.functions=90 \
  --coverage.threshold.branches=85 \
  --coverage.threshold.statements=90 \
  > /tmp/v1.3-test.log 2>&1; then
  success "Tests passed with coverage thresholds met"

  # Show coverage summary
  if [ -f coverage/coverage-summary.json ]; then
    echo ""
    info "Coverage Summary:"
    cat coverage/coverage-summary.json | jq '.total | {lines: .lines.pct, statements: .statements.pct, functions: .functions.pct, branches: .branches.pct}'
  fi
else
  error "Tests failed or coverage thresholds not met (see /tmp/v1.3-test.log)"
  tail -n 50 /tmp/v1.3-test.log
fi

# ============================================================================
# 5. OpenAPI Validation
# ============================================================================
banner "5. OpenAPI Validation"

if pnpm openapi:validate > /tmp/v1.3-openapi.log 2>&1; then
  success "OpenAPI spec is valid"
else
  error "OpenAPI validation failed (see /tmp/v1.3-openapi.log)"
  cat /tmp/v1.3-openapi.log
fi

# Check OpenAPI version
OPENAPI_VERSION=$(grep -A 3 "^info:" openapi.yaml | grep "version:" | sed 's/.*version: //')
echo "openapi.yaml version: $OPENAPI_VERSION"

if [ "$OPENAPI_VERSION" != "1.3.0" ]; then
  error "openapi.yaml version should be 1.3.0, got: $OPENAPI_VERSION"
else
  success "openapi.yaml version is 1.3.0"
fi

# ============================================================================
# 6. v1.3.0 Feature Validation
# ============================================================================
banner "6. v1.3.0 Feature File Checks"

# Check that key files exist
declare -a REQUIRED_FILES=(
  "src/utils/graphGuards.ts"
  "tests/unit/graph.guards.test.ts"
  "src/plugins/auth.ts"
  "tests/integration/auth.multi-key.test.ts"
  "tests/integration/sse-legacy-flag.test.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    success "Found: $file"
  else
    error "Missing required file: $file"
  fi
done

# Check that graph guards are integrated in orchestrator
if grep -q "enforceGraphCompliance" src/orchestrator/index.ts; then
  success "Graph guards integrated in orchestrator"
else
  error "Graph guards not found in orchestrator"
fi

# Check that auth plugin is registered in server
if grep -q "authPlugin" src/server.ts; then
  success "Auth plugin registered in server"
else
  error "Auth plugin not registered in server"
fi

# Check that legacy SSE flag is implemented
if grep -q "ENABLE_LEGACY_SSE" src/routes/assist.draft-graph.ts; then
  success "Legacy SSE flag implemented"
else
  error "Legacy SSE flag not found in routes"
fi

# ============================================================================
# 7. Security Audit
# ============================================================================
banner "7. Security Audit (high severity only)"

# Run audit but don't fail on warnings (matching CI behavior)
if pnpm audit --audit-level=high > /tmp/v1.3-audit.log 2>&1; then
  success "No high/critical security vulnerabilities"
else
  info "Security audit found issues (see /tmp/v1.3-audit.log)"
  # Show summary but don't fail
  grep -E "vulnerabilities|severity" /tmp/v1.3-audit.log || true
fi

# ============================================================================
# 8. Documentation Check
# ============================================================================
banner "8. Documentation Check"

# Check CHANGELOG has v1.3.0 entry
if grep -q "## \[1.3.0\]" CHANGELOG.md; then
  success "CHANGELOG.md has v1.3.0 entry"
else
  error "CHANGELOG.md missing v1.3.0 entry"
fi

# Check operator runbook updated
if grep -q "v1.3.0" Docs/operator-runbook.md; then
  success "Operator runbook updated for v1.3.0"
else
  error "Operator runbook not updated for v1.3.0"
fi

# ============================================================================
# Summary
# ============================================================================
banner "Validation Summary"

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ ALL CHECKS PASSED${NC}"
  echo ""
  echo "v1.3.0 is ready for:"
  echo "  - Commit and push"
  echo "  - PR creation"
  echo "  - Code review"
  echo "  - Deployment"
  echo ""
  exit 0
else
  echo -e "${RED}❌ VALIDATION FAILED${NC}"
  echo ""
  echo "Errors found: $ERRORS"
  echo ""
  echo "Please fix the issues above before proceeding with v1.3.0 release."
  echo ""
  exit 1
fi
