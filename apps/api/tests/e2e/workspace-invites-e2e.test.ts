import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import {
  type InviteLookup,
  type InviteResult,
  type Workspace,
  type WorkspaceInvite,
  WorkspaceSchema,
} from "@starter/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import type { InviteEmailJob } from "@/jobs/types";
import { createTestUser } from "../helpers/app-user";
import { createMockvlServices } from "../helpers/mockvl";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const userIds: string[] = [];
const workspaceIds: string[] = [];

const enqueued: InviteEmailJob[] = [];
const services = createMockvlServices(db, {
  enqueue: async (_name, data) => {
    enqueued.push(data as InviteEmailJob);
    return null;
  },
});
const app = createApp({
  workspacesService: services.workspacesService,
  membersService: services.membersService,
  invitesService: services.invitesService,
  mocksService: services.mocksService,
  rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
});

afterAll(async () => {
  // Audit rows have no FK, so they outlive the cascade from users.
  if (workspaceIds.length > 0) {
    await db
      .delete(schema.workspaceAuditEvents)
      .where(inArray(schema.workspaceAuditEvents.workspaceId, workspaceIds));
  }
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

async function newUser(email?: string) {
  const created = await createTestUser(db, email === undefined ? {} : { email });
  userIds.push(created.user.id);
  return created;
}

const freshEmail = (domain = "x.test") => `inv-${crypto.randomUUID().slice(0, 8)}@${domain}`;

function call(token: string, method: string, path: string, body?: unknown) {
  return app.request(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createWorkspace(token: string): Promise<Workspace> {
  const slug = `iv-${crypto.randomUUID().slice(0, 8)}`;
  const res = await call(token, "POST", "/workspaces", { name: "Platform Team", slug });
  expect(res.status).toBe(201);
  const workspace = WorkspaceSchema.parse(((await res.json()) as { data: unknown }).data);
  workspaceIds.push(workspace.id);
  return workspace;
}

async function addMember(workspaceId: string, userId: string, role: "admin" | "editor" | "viewer") {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

async function invite(
  token: string,
  slug: string,
  emails: string[],
  role: "admin" | "editor" | "viewer" = "editor",
): Promise<InviteResult[]> {
  const res = await call(token, "POST", `/workspaces/${slug}/invites`, { emails, role });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: InviteResult[] }).data;
}

async function pending(token: string, slug: string): Promise<WorkspaceInvite[]> {
  const res = await call(token, "GET", `/workspaces/${slug}/invites`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: WorkspaceInvite[] }).data;
}

// The raw token of the latest email enqueued for `email`'s pending invite.
async function latestToken(ownerToken: string, slug: string, email: string): Promise<string> {
  const open = (await pending(ownerToken, slug)).find((row) => row.email === email);
  if (!open) throw new Error(`no pending invite for ${email}`);
  const job = enqueued.findLast((entry) => entry.inviteId === open.id);
  if (!job) throw new Error(`no invite email enqueued for ${email}`);
  return job.token;
}

async function lookup(token: string, inviteToken: string) {
  return call(token, "GET", `/invites/by-token/${inviteToken}`);
}

async function lookupState(token: string, inviteToken: string): Promise<InviteLookup["state"]> {
  const res = await lookup(token, inviteToken);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: InviteLookup }).data.state;
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

function exitRows(workspaceId: string, userId: string) {
  return db
    .select()
    .from(schema.workspaceMemberExits)
    .where(
      and(
        eq(schema.workspaceMemberExits.workspaceId, workspaceId),
        eq(schema.workspaceMemberExits.userId, userId),
      ),
    );
}

async function roleOf(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    );
  return row?.role;
}

describe("POST /workspaces/{ws}/invites", () => {
  test("classifies a mixed batch in input order and drops duplicates", async () => {
    const owner = await newUser();
    const member = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, member.user.id, "viewer");
    const local = freshEmail();
    const mixed = local.replace(/^inv/, "Inv");

    const results = await invite(owner.accessToken, workspace.slug, [
      mixed,
      "bad",
      member.user.email,
      local,
    ]);
    expect(results).toEqual([
      { email: local, status: "sent", message: null },
      { email: "bad", status: "invalid", message: "bad isn't a valid email address." },
      {
        email: member.user.email,
        status: "already_member",
        message: `${member.user.email} is already a member.`,
      },
    ]);

    const open = await pending(owner.accessToken, workspace.slug);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ email: local, role: "editor", expired: false });
    const audit = await db
      .select({ details: schema.workspaceAuditEvents.details })
      .from(schema.workspaceAuditEvents)
      .where(
        and(
          eq(schema.workspaceAuditEvents.workspaceId, workspace.id),
          eq(schema.workspaceAuditEvents.action, "invite_sent"),
        ),
      );
    expect(audit).toEqual([{ details: { email: local, role: "editor" } }]);
  });

  test("re-inviting resends with a new token; the old one stops resolving", async () => {
    const owner = await newUser();
    const email = freshEmail();
    const invitee = await newUser(email);
    const workspace = await createWorkspace(owner.accessToken);

    await invite(owner.accessToken, workspace.slug, [email]);
    const oldToken = await latestToken(owner.accessToken, workspace.slug, email);
    const again = await invite(owner.accessToken, workspace.slug, [email], "admin");
    expect(again).toEqual([{ email, status: "resent", message: null }]);
    const newToken = await latestToken(owner.accessToken, workspace.slug, email);
    expect(newToken).not.toBe(oldToken);

    expect((await lookup(invitee.accessToken, oldToken)).status).toBe(404);
    const res = await lookup(invitee.accessToken, newToken);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: InviteLookup }).data).toEqual({
      state: "valid",
      email,
      signedInEmail: email,
      role: "admin",
      workspace: { name: "Platform Team", slug: workspace.slug, mockCount: 0 },
      inviter: { name: null, email: owner.user.email },
    });
  });

  test("viewers can't invite; more than 100 emails is rejected", async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, viewer.user.id, "viewer");

    const denied = await call(viewer.accessToken, "POST", `/workspaces/${workspace.slug}/invites`, {
      emails: [freshEmail()],
      role: "viewer",
    });
    expect(denied.status).toBe(403);

    const emails = Array.from({ length: 101 }, () => freshEmail());
    const tooMany = await call(owner.accessToken, "POST", `/workspaces/${workspace.slug}/invites`, {
      emails,
      role: "viewer",
    });
    expect(tooMany.status).toBe(400);
    expect(await errorCode(tooMany)).toBe("INVITE_BATCH_TOO_LARGE");
  });
});

describe("invite tokens", () => {
  test("only the invited account can accept; accepting adds the invited role", async () => {
    const owner = await newUser();
    const email = freshEmail();
    const invitee = await newUser(email);
    const stranger = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await invite(owner.accessToken, workspace.slug, [email], "viewer");
    const token = await latestToken(owner.accessToken, workspace.slug, email);

    expect(await lookupState(stranger.accessToken, token)).toBe("email_mismatch");
    const mismatch = await call(stranger.accessToken, "POST", `/invites/by-token/${token}/accept`);
    expect(mismatch.status).toBe(403);
    expect(await errorCode(mismatch)).toBe("INVITE_EMAIL_MISMATCH");

    const accepted = await call(invitee.accessToken, "POST", `/invites/by-token/${token}/accept`);
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { data: unknown }).data).toEqual({
      slug: workspace.slug,
      name: "Platform Team",
    });
    expect(await roleOf(workspace.id, invitee.user.id)).toBe("viewer");
    expect(await pending(owner.accessToken, workspace.slug)).toEqual([]);
    expect(await lookupState(invitee.accessToken, token)).toBe("already_member");
  });

  test("a declined invite is no longer valid", async () => {
    const owner = await newUser();
    const email = freshEmail();
    const invitee = await newUser(email);
    const workspace = await createWorkspace(owner.accessToken);
    await invite(owner.accessToken, workspace.slug, [email]);
    const token = await latestToken(owner.accessToken, workspace.slug, email);

    const declined = await call(invitee.accessToken, "POST", `/invites/by-token/${token}/decline`);
    expect(declined.status).toBe(204);
    expect(await lookupState(invitee.accessToken, token)).toBe("invalid");
    expect(await pending(owner.accessToken, workspace.slug)).toEqual([]);
  });

  test("an expired invite can't be accepted", async () => {
    const owner = await newUser();
    const email = freshEmail();
    const invitee = await newUser(email);
    const workspace = await createWorkspace(owner.accessToken);
    await invite(owner.accessToken, workspace.slug, [email]);
    const token = await latestToken(owner.accessToken, workspace.slug, email);
    await db
      .update(schema.workspaceInvites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.workspaceInvites.workspaceId, workspace.id));

    expect(await lookupState(invitee.accessToken, token)).toBe("expired");
    const res = await call(invitee.accessToken, "POST", `/invites/by-token/${token}/accept`);
    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe("INVITE_EXPIRED");
    expect((await pending(owner.accessToken, workspace.slug))[0]?.expired).toBe(true);
  });
});

describe("domain join and exits", () => {
  test("a removed user isn't re-added by domain join until they accept an invite", async () => {
    const domain = `acme-${crypto.randomUUID().slice(0, 8)}.test`;
    const owner = await newUser();
    const joiner = await newUser(freshEmail(domain));
    const workspace = await createWorkspace(owner.accessToken);
    await db
      .update(schema.workspaces)
      .set({ domain, domainJoinEnabled: true })
      .where(eq(schema.workspaces.id, workspace.id));

    await services.workspacesService.onGoogleSignIn({ userId: joiner.user.id, hd: domain });
    expect(await roleOf(workspace.id, joiner.user.id)).toBe("viewer");

    const removed = await call(
      owner.accessToken,
      "DELETE",
      `/workspaces/${workspace.slug}/members/${joiner.user.id}`,
    );
    expect(removed.status).toBe(204);
    await services.workspacesService.onGoogleSignIn({ userId: joiner.user.id, hd: domain });
    expect(await roleOf(workspace.id, joiner.user.id)).toBeUndefined();
    expect(await exitRows(workspace.id, joiner.user.id)).toHaveLength(1);

    await invite(owner.accessToken, workspace.slug, [joiner.user.email], "editor");
    const token = await latestToken(owner.accessToken, workspace.slug, joiner.user.email);
    const accepted = await call(joiner.accessToken, "POST", `/invites/by-token/${token}/accept`);
    expect(accepted.status).toBe(200);
    expect(await roleOf(workspace.id, joiner.user.id)).toBe("editor");
    expect(await exitRows(workspace.id, joiner.user.id)).toEqual([]);
  });
});
