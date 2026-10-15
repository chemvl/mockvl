import type { PgBoss, Queue, WorkOptions } from "pg-boss";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { DELETED_WORKSPACE_RETENTION_DAYS } from "@/modules/workspaces/workspaces.constants";
import type { WorkspacesRepo } from "@/modules/workspaces/workspaces.repo";

// Hard-deletes workspaces soft-deleted more than DELETED_WORKSPACE_RETENTION_DAYS
// ago (their mocks, members, invites and slug history cascade) and releases
// slug reservations of the same age.

export const PURGE_DELETED_WORKSPACES_QUEUE = "purge-deleted-workspaces";
// Daily, off-peak.
export const PURGE_DELETED_WORKSPACES_CRON = "17 3 * * *";

// stately: at most one queued and one active tick. No retries: the next
// day's run picks up whatever this one missed.
export const PURGE_DELETED_WORKSPACES_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  policy: "stately",
  retryLimit: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeDeletedWorkspacesDeps {
  workspacesRepo: Pick<WorkspacesRepo, "purgeDeleted">;
  now?: () => Date;
  log?: Logger;
}

export function createPurgeDeletedWorkspacesHandler(deps: PurgeDeletedWorkspacesDeps) {
  const { workspacesRepo, now = () => new Date(), log = defaultLogger } = deps;
  return async (): Promise<number> => {
    const cutoff = new Date(now().getTime() - DELETED_WORKSPACE_RETENTION_DAYS * DAY_MS);
    const purged = await workspacesRepo.purgeDeleted(cutoff);
    log.info(
      { code: "DELETED_WORKSPACES_PURGED", purged, cutoff: cutoff.toISOString() },
      "purged deleted workspaces",
    );
    return purged;
  };
}

export interface RegisterPurgeDeletedWorkspacesWorkerOptions {
  queueOptions?: Omit<Queue, "name">;
  workOptions?: WorkOptions;
}

export async function registerPurgeDeletedWorkspacesWorker(
  boss: PgBoss,
  deps: PurgeDeletedWorkspacesDeps,
  options: RegisterPurgeDeletedWorkspacesWorkerOptions = {},
): Promise<void> {
  const { queueOptions = PURGE_DELETED_WORKSPACES_QUEUE_OPTIONS, workOptions = {} } = options;
  await boss.createQueue(PURGE_DELETED_WORKSPACES_QUEUE, queueOptions);
  await boss.work(
    PURGE_DELETED_WORKSPACES_QUEUE,
    workOptions,
    createPurgeDeletedWorkspacesHandler(deps),
  );
}

// schedule() upserts by queue name: every API pod and the worker process may
// re-assert it on boot.
export async function schedulePurgeDeletedWorkspaces(boss: PgBoss): Promise<void> {
  await boss.schedule(PURGE_DELETED_WORKSPACES_QUEUE, PURGE_DELETED_WORKSPACES_CRON, {});
}
