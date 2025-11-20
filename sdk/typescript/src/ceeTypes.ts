// CEE v1 request/response type aliases derived from the OpenAPI generator.
// These are type-only and erased at runtime. We import the generated
// `components` type with an explicit resolution mode so that TS 5.9 is happy
// in CommonJS builds, while still avoiding any runtime dependency on the
// service bundle.

import type { components as OpenAPIComponents } from "../../../src/generated/openapi.d.ts" with { "resolution-mode": "require" };

export type CEETraceMeta = OpenAPIComponents["schemas"]["CEETraceMeta"];
export type CEEQualityMeta = OpenAPIComponents["schemas"]["CEEQualityMeta"];
export type CEEValidationIssue = OpenAPIComponents["schemas"]["CEEValidationIssue"];
export type CEEErrorResponseV1 = OpenAPIComponents["schemas"]["CEEErrorResponseV1"];

export type CEEDraftGraphRequestV1 = OpenAPIComponents["schemas"]["CEEDraftGraphRequestV1"];
export type CEEDraftGraphResponseV1 = OpenAPIComponents["schemas"]["CEEDraftGraphResponseV1"];

export type CEEExplainGraphRequestV1 = OpenAPIComponents["schemas"]["CEEExplainGraphRequestV1"];
export type CEEExplainGraphResponseV1 = OpenAPIComponents["schemas"]["CEEExplainGraphResponseV1"];

export type CEEEvidenceHelperRequestV1 = OpenAPIComponents["schemas"]["CEEEvidenceHelperRequestV1"];
export type CEEEvidenceHelperResponseV1 = OpenAPIComponents["schemas"]["CEEEvidenceHelperResponseV1"];

export type CEEOptionsRequestV1 = OpenAPIComponents["schemas"]["CEEOptionsRequestV1"];
export type CEEOptionsResponseV1 = OpenAPIComponents["schemas"]["CEEOptionsResponseV1"];

export type CEEBiasCheckRequestV1 = OpenAPIComponents["schemas"]["CEEBiasCheckRequestV1"];
export type CEEBiasCheckResponseV1 = OpenAPIComponents["schemas"]["CEEBiasCheckResponseV1"];

export type CEESensitivityCoachRequestV1 = OpenAPIComponents["schemas"]["CEESensitivityCoachRequestV1"];
export type CEESensitivityCoachResponseV1 = OpenAPIComponents["schemas"]["CEESensitivityCoachResponseV1"];

export type CEETeamPerspectivesRequestV1 = OpenAPIComponents["schemas"]["CEETeamPerspectivesRequestV1"];
export type CEETeamPerspectivesResponseV1 = OpenAPIComponents["schemas"]["CEETeamPerspectivesResponseV1"];
