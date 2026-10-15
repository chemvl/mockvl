import type {
  CustomEndpoint,
  CustomEndpointSummary,
  MockDetail,
  MockListItem,
  MockOverride,
  MockVersion,
  UserRef,
} from "@starter/schemas";
import type { MockDetailRecord, MockListRecord, MockVersionRecord, UserRefRow } from "./mocks.repo";
import type { OverrideRecord } from "./overrides.repo";

export function mockUrl(publicBaseUrl: string, wsSlug: string, mockSlug: string): string {
  return `${publicBaseUrl}/${wsSlug}/${mockSlug}`;
}

// List view of a custom endpoint: no bodies (up to 256 KB each).
export function toCustomEndpointSummary(endpoint: CustomEndpoint): CustomEndpointSummary {
  return {
    kind: endpoint.kind,
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? null,
    responses: endpoint.responses.map((response) => ({
      status: response.status,
      headerNames: Object.keys(response.headers),
      hasBody: response.body !== null,
    })),
  };
}

function toUserRef(row: UserRefRow | null): UserRef | null {
  return row && { id: row.id, name: row.name, email: row.email };
}

export function toMockListItem(record: MockListRecord, url: string): MockListItem {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    url,
    status: record.status,
    endpointCount: record.endpointCount,
    requests24h: record.requests24h,
    updatedAt: record.updatedAt.toISOString(),
    updatedBy: toUserRef(record.updatedBy),
  };
}

export function toMockDetail(record: MockDetailRecord, url: string): MockDetail {
  const live = record.liveVersion;
  return {
    ...toMockListItem(record, url),
    responseMode: record.responseMode,
    validateRequests: record.validateRequests,
    cors: record.cors,
    sourceType: record.sourceType,
    sourceUrl: record.sourceUrl,
    liveVersion: {
      number: live.number,
      format: live.format,
      specVersion: live.specVersion,
      sourceLabel: live.sourceLabel,
      createdAt: live.createdAt.toISOString(),
      exampleCount: live.exampleCount,
      sizeBytes: live.sizeBytes,
    },
    versionCount: record.versionCount,
    operations: live.operations,
    createdAt: record.createdAt.toISOString(),
    createdBy: toUserRef(record.createdBy),
  };
}

export function toMockVersion(record: MockVersionRecord, liveVersionId: string): MockVersion {
  return {
    number: record.number,
    action: record.action,
    sourceLabel: record.sourceLabel,
    restoredFrom: record.restoredFrom,
    diff: record.diff,
    endpointCount: record.endpointCount,
    createdAt: record.createdAt.toISOString(),
    createdBy: toUserRef(record.createdBy),
    live: record.id === liveVersionId,
  };
}

export function toMockOverride(record: OverrideRecord): MockOverride {
  return {
    method: record.method,
    path: record.path,
    code: record.code,
    updatedAt: record.updatedAt.toISOString(),
    updatedBy: toUserRef(record.updatedBy),
  };
}
