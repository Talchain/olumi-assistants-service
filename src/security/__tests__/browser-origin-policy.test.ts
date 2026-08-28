import { describe, expect, it } from "vitest";

import {
  isAllowedBrowserOrigin,
  OLUMI_STAGING_ORIGIN,
} from "../browser-origin-policy.js";

describe("isAllowedBrowserOrigin", () => {
  const configured = new Set([OLUMI_STAGING_ORIGIN]);

  it("allows an explicitly configured origin", () => {
    expect(isAllowedBrowserOrigin(OLUMI_STAGING_ORIGIN, configured)).toBe(true);
  });

  it("allows an exact immutable Olumi Netlify deploy origin", () => {
    expect(
      isAllowedBrowserOrigin(
        "https://6a91550f3af620000895d1e5--olumi.netlify.app",
        configured,
      ),
    ).toBe(true);
  });

  it.each([
    "http://6a91550f3af620000895d1e5--olumi.netlify.app",
    "https://6a91550f3af620000895d1e5--olumi.netlify.app.evil.example",
    "https://6a91550f3af620000895d1e5--other.netlify.app",
    "https://6A91550F3AF620000895D1E5--olumi.netlify.app",
    "https://deploy-preview-42--olumi.netlify.app",
    "https://branch-name--olumi.netlify.app",
  ])("rejects a lookalike or mutable preview origin: %s", (origin) => {
    expect(isAllowedBrowserOrigin(origin, configured)).toBe(false);
  });

  it("does not enable immutable deploy origins without the staging alias", () => {
    expect(
      isAllowedBrowserOrigin(
        "https://6a91550f3af620000895d1e5--olumi.netlify.app",
        new Set(),
      ),
    ).toBe(false);
  });
});
