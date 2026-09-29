// Graph types for engine-compatible GraphV1 / GraphPatchV1.
//
// These are derived from the generated OpenAPI types and are type-only
// aliases, mirroring the approach used in `ceeTypes.ts`. This keeps the SDK
// aligned with the live OpenAPI contract without introducing a runtime
// dependency on the server bundle.

import type { components as OpenAPIComponents } from "../../../src/generated/openapi.d.ts" with { "resolution-mode": "require" };

export type GraphV1 = OpenAPIComponents["schemas"]["Graph"];
export type GraphPatchV1 = OpenAPIComponents["schemas"]["GraphPatch"];
