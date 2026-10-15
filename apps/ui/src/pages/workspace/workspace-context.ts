import { useOutletContext } from "react-router";
import type { Workspace } from "@/lib/api/types";

export type WorkspaceOutletContext = { workspace: Workspace };

export function useWorkspace(): Workspace {
  return useOutletContext<WorkspaceOutletContext>().workspace;
}
