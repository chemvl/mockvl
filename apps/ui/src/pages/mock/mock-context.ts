import { useOutletContext } from "react-router";
import type { MockDetail, Workspace } from "@/lib/api/types";

export type MockNotice = { kind: "info" | "error"; text: string };
/** router state passed to the detail page, e.g. after create or an endpoint save. */
export type MockLocationState = { notice?: string; openKey?: string };
export type MockOutletContext = { workspace: Workspace; mock: MockDetail };

export function useMockContext(): MockOutletContext {
  return useOutletContext<MockOutletContext>();
}
