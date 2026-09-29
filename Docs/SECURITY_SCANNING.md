# Security Scanning Setup

This document explains the automated security scanning infrastructure for the Olumi Assistants Service.

## Overview

The service uses three layers of automated security scanning:

1. **GitHub CodeQL** - Static analysis for code vulnerabilities
2. **Snyk** - Dependency and code vulnerability scanning
3. **Dependency Review** - License and security review for new dependencies

All scans run automatically on:
- Every push to `main` or `staging` branches
- Every pull request
- Weekly on Mondays at 9 AM UTC (scheduled scan)
- Manual workflow dispatch

## Setup Instructions

### 1. GitHub CodeQL (Already Configured)

CodeQL is free for public repositories and requires no additional setup. It automatically:
- Scans TypeScript/JavaScript code for security vulnerabilities
- Runs security and quality queries
- Uploads results to GitHub Security tab
- Blocks PRs with high-severity findings

**Configuration**: [.github/workflows/security-scanning.yml](.github/workflows/security-scanning.yml)

**View Results**:
- Navigate to **Security** → **Code scanning** in GitHub repository

### 2. Snyk Security Scanning (Requires Token)

Snyk provides comprehensive dependency and code scanning. To enable:

#### Step 1: Create Snyk Account
1. Go to [https://snyk.io/](https://snyk.io/)
2. Sign up with your GitHub account
3. Import the `olumi-assistants-service` repository

#### Step 2: Get Snyk API Token
1. Go to **Account Settings** → **General**
2. Copy your **API Token**
3. Add to GitHub repository secrets:
   - Navigate to **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `SNYK_TOKEN`
   - Value: `<your-api-token>`

#### Step 3: Verify Setup
1. Trigger the workflow manually: **Actions** → **Security Scanning** → **Run workflow**
2. Check that Snyk job completes successfully
3. View results in **Security** → **Code scanning**

**Severity Threshold**: High (only fails on high/critical vulnerabilities)

### 3. Dependency Review (Automatic)

Dependency Review runs automatically on all pull requests and:
- Checks for known vulnerabilities in new dependencies
- Reviews dependency licenses (denies GPL-2.0, GPL-3.0)
- Fails on moderate or higher severity vulnerabilities

**No setup required** - works out of the box for public repositories.

## Security Scan Results

### On Pull Requests

Security scans post an automated comment with results:

```
## 🛡️ Security Scan Results

| Scan | Status |
|------|--------|
| CodeQL Static Analysis | ✅ success |
| Snyk Vulnerability Scan | ✅ success |
| Dependency Review | ✅ success |

✅ All security scans passed!
```

### On Main/Staging Branches

Results are uploaded to:
- **GitHub Security Tab**: Detailed vulnerability reports
- **Pull Request Checks**: Pass/fail status
- **Workflow Logs**: Full scan output

## Interpreting Results

### CodeQL Findings

**Severity Levels**:
- **Error**: High/Critical - Must fix before merge
- **Warning**: Medium - Should fix soon
- **Note**: Low - Fix when convenient

**Common Findings**:
- SQL Injection
- Cross-Site Scripting (XSS)
- Command Injection
- Path Traversal
- Hardcoded Credentials

### Snyk Findings

**Vulnerability Types**:
- **Known CVEs**: Published security vulnerabilities
- **License Issues**: Incompatible open-source licenses
- **Code Quality**: Best practice violations

**Remediation**:
1. Click on finding for details
2. Review suggested fix (upgrade version, code change)
3. Apply fix and re-run scan
4. If false positive, mark as "Ignored" in Snyk dashboard

### Dependency Review Findings

**Check Results**:
- **Allowed**: Dependency passes all checks
- **Denied**: License or security issue detected
- **Warning**: Non-blocking issue (informational)

**Remediation**:
1. Remove denied dependency
2. Find alternative with compatible license
3. If security vulnerability, upgrade to fixed version

## Maintenance

### Weekly Scans

Scheduled scans run every Monday to catch:
- New CVEs disclosed during the week
- Transitive dependency vulnerabilities
- Code changes merged since last scan

### Manual Scans

Trigger manual scan:
1. Go to **Actions** → **Security Scanning**
2. Click **Run workflow**
3. Select branch
4. Click **Run workflow**

### Updating Workflow

To modify security scanning behavior, edit:
```
.github/workflows/security-scanning.yml
```

**Common Customizations**:
- Change severity threshold (high → critical)
- Add/remove excluded paths
- Adjust scan frequency
- Modify auto-comment format

## Troubleshooting

### CodeQL Fails to Build

**Symptom**: CodeQL autobuild fails

**Solution**:
```yaml
- name: Manual Build
  run: |
    pnpm install --frozen-lockfile
    pnpm build
```

Replace `autobuild` step with manual build commands.

### Snyk Token Invalid

**Symptom**: "Invalid Snyk token" error

**Solution**:
1. Regenerate token in Snyk dashboard
2. Update `SNYK_TOKEN` secret in GitHub
3. Re-run workflow

### Too Many False Positives

**Symptom**: Scan reports non-issues

**Solution**:
1. Review findings in detail
2. Mark false positives as "Ignored" in dashboard
3. Add suppression rules to workflow:
   ```yaml
   with:
     args: --severity-threshold=high --exclude=CVE-2023-12345
   ```

### Dependency Review Blocks PR

**Symptom**: PR blocked by license violation

**Solution**:
1. Check denied license: `GPL-2.0`, `GPL-3.0`
2. Remove dependency or find alternative
3. If must use, add exception to workflow:
   ```yaml
   with:
     allow-licenses: GPL-2.0
   ```

## Best Practices

1. **Fix High/Critical Immediately**: Don't merge PRs with high-severity findings
2. **Review Weekly Scan Results**: Check scheduled scans every Monday
3. **Keep Tokens Secure**: Never commit Snyk tokens to code
4. **Test Fixes Locally**: Run `pnpm audit` before pushing
5. **Document Exceptions**: If ignoring findings, document why
6. **Update Dependencies**: Keep dependencies current to avoid stale vulnerabilities

## Security Badge

Add to README.md:

```markdown
[![Security Scanning](https://github.com/Talchain/olumi-assistants-service/actions/workflows/security-scanning.yml/badge.svg)](https://github.com/Talchain/olumi-assistants-service/actions/workflows/security-scanning.yml)
```

## Related Documentation

- [Dependabot Configuration](../.github/dependabot.yml)
- [Security Policy](../SECURITY.md) (if exists)
- [CI/CD Pipeline](ci.yml)
- [Development Plan](DEVELOPMENT_PLAN.md)

## Support

For security concerns or questions:
- Open an issue in GitHub
- Contact the security team
- Report vulnerabilities privately via GitHub Security Advisories
