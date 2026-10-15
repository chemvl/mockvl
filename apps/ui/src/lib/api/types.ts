// View types derived from generated responses (named by operationId), so they
// follow the API contract without depending on component schema names.
import type {
  CreateMockData,
  CreatePersonalAccessTokenData,
  GetCustomEndpointResponse,
  GetMockResponse,
  GetWorkspaceUsageResponse,
  InspectSchemaData,
  InspectSchemaResponse,
  ListCustomEndpointsResponse,
  ListMockOperationsResponse,
  ListMocksData,
  ListMocksResponse,
  ListPersonalAccessTokensResponse,
  ListMockVersionsResponse,
  ListWorkspaceInvitesResponse,
  ListWorkspaceMembersResponse,
  ListWorkspacesResponse,
  UpdateMockData,
} from "@/client/types.gen";

export type Workspace = ListWorkspacesResponse["data"][number];
export type WorkspaceRole = Workspace["role"];
export type WorkspaceMember = ListWorkspaceMembersResponse["data"][number];
export type WorkspaceInvite = ListWorkspaceInvitesResponse["data"][number];
export type InviteRole = WorkspaceInvite["role"];
export type MockListItem = ListMocksResponse["data"][number];
export type MockDetail = GetMockResponse["data"];
export type OperationSummary = MockDetail["operations"][number];
export type MockVersion = ListMockVersionsResponse["data"][number];
export type OperationRequest = ListMockOperationsResponse["data"][number];
export type OperationParameter = OperationRequest["parameters"]["query"][number];
export type UsageReport = GetWorkspaceUsageResponse["data"];
export type SchemaInspection = InspectSchemaResponse["data"];
export type SchemaSource = InspectSchemaData["body"]["source"];
export type CreateMockSource = CreateMockData["body"]["source"];
export type CustomEndpoint = GetCustomEndpointResponse["data"]["endpoint"];
export type CustomResponse = CustomEndpoint["responses"][number];
export type CustomEndpointSummary = ListCustomEndpointsResponse["data"]["endpoints"][number];
export type UpdateMockBody = NonNullable<UpdateMockData["body"]>;
export type ListMocksQuery = NonNullable<ListMocksData["query"]>;
export type PersonalAccessToken = ListPersonalAccessTokensResponse["data"][number];
export type PersonalAccessTokenScope = PersonalAccessToken["scope"];
export type TokenExpiryDays = CreatePersonalAccessTokenData["body"]["expiresInDays"];
