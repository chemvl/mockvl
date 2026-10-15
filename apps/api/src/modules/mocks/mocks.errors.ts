import { AppError } from "@/lib/errors";

// One factory per spec error code. Messages are user-facing and rendered
// verbatim by the UI — copy changes must update the spec table too.
export const mockErrors = {
  schemaTooLarge: (label: string) =>
    new AppError("SCHEMA_TOO_LARGE", 400, `${label} is larger than 5 MB.`),
  schemaUrlInvalid: () =>
    new AppError("SCHEMA_URL_INVALID", 400, "Enter a full URL starting with https://."),
  schemaUrlBlocked: () =>
    new AppError(
      "SCHEMA_URL_BLOCKED",
      400,
      "This URL points to a private network. Use a publicly reachable URL.",
    ),
  schemaUrlHttpStatus: (status: number) =>
    new AppError(
      "SCHEMA_URL_UNREACHABLE",
      400,
      `Couldn't download the schema (HTTP ${status}). Check the URL and try again.`,
    ),
  schemaUrlUnreachable: (host: string) =>
    new AppError(
      "SCHEMA_URL_UNREACHABLE",
      400,
      `Couldn't reach ${host}. Check the URL and try again.`,
    ),
  schemaParseFailed: (label: string) =>
    new AppError("SCHEMA_PARSE_FAILED", 400, `${label} isn't valid JSON or YAML.`),
  schemaUnsupported: () =>
    new AppError(
      "SCHEMA_UNSUPPORTED",
      400,
      "Only OpenAPI 3.x and Postman collection v2 are supported.",
    ),
  schemaExternalRef: () =>
    new AppError(
      "SCHEMA_EXTERNAL_REF",
      400,
      "External $ref values aren't supported. Bundle the schema into one file.",
    ),
  schemaNoPaths: () => new AppError("SCHEMA_NO_PATHS", 400, "No paths were found in this file."),
  schemaTooManyOperations: () =>
    new AppError("SCHEMA_TOO_MANY_OPERATIONS", 400, "This schema has more than 1000 endpoints."),
  slugTaken: (slug: string, workspaceName: string) =>
    new AppError("SLUG_TAKEN", 409, `${slug} is already taken in ${workspaceName}.`),
  slugInvalid: () =>
    new AppError("SLUG_INVALID", 400, "Use lowercase letters, numbers and hyphens (max 40)."),
  mockLimitReached: () =>
    new AppError(
      "MOCK_LIMIT_REACHED",
      409,
      "This workspace already has 50 mocks. Delete one to create another.",
    ),
  notUrlSource: () =>
    new AppError("NOT_URL_SOURCE", 409, "Only mocks created from a URL can be re-synced."),
  overrideTargetUnknown: (key: { method: string; path: string; code: number }) =>
    new AppError(
      "OVERRIDE_TARGET_UNKNOWN",
      400,
      `${key.method.toUpperCase()} ${key.path} has no ${key.code} response in the live schema.`,
    ),
  overrideTooLarge: () =>
    new AppError("OVERRIDE_TOO_LARGE", 400, "The response is larger than 256 KB."),
  overrideInvalidJson: () =>
    new AppError("OVERRIDE_INVALID_JSON", 400, "The response isn't valid JSON."),
  endpointPathInvalid: (message: string) => new AppError("ENDPOINT_PATH_INVALID", 400, message),
  endpointExists: (method: string, path: string) =>
    new AppError("ENDPOINT_EXISTS", 409, `${method.toUpperCase()} ${path} already exists.`),
  responseStatusInvalid: (message: string) => new AppError("RESPONSE_STATUS_INVALID", 400, message),
  responseInvalidJson: (status: number) =>
    new AppError("RESPONSE_INVALID_JSON", 400, `The ${status} response isn't valid JSON.`),
  responseTooLarge: (status: number) =>
    new AppError("RESPONSE_TOO_LARGE", 400, `The ${status} response is larger than 256 KB.`),
  responseHeaderInvalid: (message: string) => new AppError("RESPONSE_HEADER_INVALID", 400, message),
  mockNotImported: () =>
    new AppError("MOCK_NOT_IMPORTED", 409, "Custom mocks don't have a schema to replace."),
  customMockSetting: () =>
    new AppError(
      "CUSTOM_MOCK_SETTING",
      400,
      "Custom mocks always serve saved responses without request validation.",
    ),
  mockNotCustom: () =>
    new AppError("MOCK_NOT_CUSTOM", 409, "Only custom mocks have editable endpoints."),
  endpointNotFound: (method: string, path: string) =>
    new AppError(
      "ENDPOINT_NOT_FOUND",
      404,
      `${method.toUpperCase()} ${path} doesn't exist in this mock.`,
    ),
  versionConflict: () =>
    new AppError(
      "VERSION_CONFLICT",
      409,
      "This mock changed since you opened it. Reload to see the latest endpoints.",
    ),
  overrideNoBodyStatus: (code: number) =>
    new AppError("OVERRIDE_NO_BODY_STATUS", 400, `A ${code} response can't have a body.`),
};
