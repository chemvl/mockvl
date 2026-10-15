import "../setup";
import { describe, expect, test } from "bun:test";
import type { Workspace, WorkspaceRole } from "@starter/schemas";
import type { User } from "@/db/schema";
import { DomainNotAllowedError, NotFoundError } from "@/lib/errors";
import type { WorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import {
  createWorkspacesService,
  personalSlugCandidate,
} from "@/modules/workspaces/workspaces.service";

function makeUser(email: string, options: { verified?: boolean; name?: string } = {}): User {
  return {
    id: crypto.randomUUID(),
    email,
    name: options.name ?? null,
    avatarUrl: null,
    passwordHash: null,
    googleSub: null,
    emailVerifiedAt: (options.verified ?? true) ? new Date() : null,
    lastWorkspaceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function uniqueViolation(): Error {
  return new Error("duplicate key", { cause: { code: "23505" } });
}

interface FakeWorkspace {
  id: string;
  slug: string;
  name: string;
  domain: string;
  personalOwnerId: string | null;
  domainJoinEnabled: boolean;
  members: Map<string, WorkspaceRole>;
  // Users who left or were removed (workspace_member_exits).
  exits: Set<string>;
}

function view(ws: FakeWorkspace, userId: string): Workspace | undefined {
  const role = ws.members.get(userId);
  if (!role) return undefined;
  return {
    id: ws.id,
    slug: ws.slug,
    name: ws.name,
    role,
    personal: ws.personalOwnerId !== null,
    mockCount: 0,
    memberCount: ws.members.size,
    domain: ws.domain,
    domainJoinAvailable: true,
    domainJoinEnabled: ws.domainJoinEnabled,
    defaultValidate: true,
    defaultCors: true,
  };
}

function createFakes(options: { takenSlugs?: string[]; raceOnce?: boolean } = {}) {
  const workspaces: FakeWorkspace[] = [];
  const taken = new Set(options.takenSlugs ?? []);
  let raceArmed = options.raceOnce ?? false;
  const inserts: string[] = [];
  const touches: string[] = [];

  function addWorkspace(input: Partial<FakeWorkspace> & { slug: string }): FakeWorkspace {
    const ws: FakeWorkspace = {
      id: crypto.randomUUID(),
      name: input.slug,
      domain: "example.com",
      personalOwnerId: null,
      domainJoinEnabled: false,
      members: new Map(),
      exits: new Set(),
      ...input,
    };
    workspaces.push(ws);
    return ws;
  }

  const memberOf = (userId: string) =>
    workspaces.flatMap((ws) => {
      const workspace = view(ws, userId);
      return workspace ? [workspace] : [];
    });

  const repo: WorkspacesRepo = {
    async listForUser(userId) {
      return memberOf(userId);
    },
    async findMembership(slug, userId) {
      return memberOf(userId).find((ws) => ws.slug === slug);
    },
    async findPersonal(userId) {
      const ws = workspaces.find((row) => row.personalOwnerId === userId);
      return ws && view(ws, userId);
    },
    async countActiveMemberships(userId) {
      return memberOf(userId).length;
    },
    async touchMembership(workspaceId, userId) {
      touches.push(`${workspaceId}:${userId}`);
    },
    async slugTaken(slug) {
      return taken.has(slug) || workspaces.some((ws) => ws.slug === slug);
    },
    async insertWorkspace({ slug, name, ownerId, domain, personal }) {
      inserts.push(slug);
      if (raceArmed) {
        // A concurrent request for the same user won the insert.
        raceArmed = false;
        addWorkspace({
          slug: `${slug}-winner`,
          name,
          domain,
          personalOwnerId: ownerId,
          members: new Map([[ownerId, "owner"]]),
        });
        throw uniqueViolation();
      }
      const ws = addWorkspace({
        slug,
        name,
        domain,
        personalOwnerId: personal ? ownerId : null,
        members: new Map([[ownerId, "owner"]]),
      });
      const workspace = view(ws, ownerId);
      if (!workspace) throw new Error("owner membership missing");
      return workspace;
    },
    async domainJoinCandidates(domain, userId) {
      return workspaces
        .filter(
          (ws) =>
            ws.domainJoinEnabled &&
            ws.domain === domain &&
            !ws.members.has(userId) &&
            !ws.exits.has(userId),
        )
        .map((ws) => ws.id);
    },
    async addMember(workspaceId, userId, role) {
      const ws = workspaces.find((row) => row.id === workspaceId);
      if (!ws || ws.members.has(userId)) return false;
      ws.members.set(userId, role);
      return true;
    },
    // Management writes are covered end to end against Postgres
    // (tests/e2e/workspace-management-e2e.test.ts).
    findMember: notExercised,
    updateWorkspace: notExercised,
    softDelete: notExercised,
    transferOwnership: notExercised,
    leave: notExercised,
    purgeDeleted: notExercised,
  };
  return { repo, workspaces, inserts, touches, addWorkspace };
}

async function notExercised(): Promise<never> {
  throw new Error("not exercised by these unit tests");
}

function serviceFor(user: User, repo: WorkspacesRepo, allowedHd?: string) {
  const lastWorkspaceWrites: string[] = [];
  const service = createWorkspacesService({
    workspacesRepo: repo,
    userRepo: {
      findById: async (id) => (id === user.id ? user : undefined),
      setLastWorkspace: async (_userId, workspaceId) => {
        lastWorkspaceWrites.push(workspaceId);
        user.lastWorkspaceId = workspaceId;
      },
    },
    invalidate: async () => {},
    ...(allowedHd === undefined ? {} : { allowedHd }),
  });
  return { service, lastWorkspaceWrites };
}

describe("personalSlugCandidate", () => {
  test("first attempt is the base; later ones append -n within 32 chars", () => {
    expect(personalSlugCandidate("jane", 1)).toBe("jane");
    expect(personalSlugCandidate("jane", 3)).toBe("jane-3");
    const long = "a".repeat(32);
    expect(personalSlugCandidate(long, 2)).toBe(`${"a".repeat(30)}-2`);
    expect(personalSlugCandidate(`${"a".repeat(29)}-bc`, 2)).toBe(`${"a".repeat(29)}-2`);
  });
});

describe("listForUser (personal workspace)", () => {
  test("creates the personal workspace once from the email local-part", async () => {
    const user = makeUser("Jane.Doe@example.com");
    const { repo, inserts } = createFakes();
    const { service } = serviceFor(user, repo);

    const first = await service.listForUser(user.id);
    expect(first).toHaveLength(1);
    expect(first[0]?.slug).toBe("janedoe");
    expect(first[0]?.name).toBe("Jane.Doe (personal)");
    expect(first[0]).toMatchObject({ role: "owner", personal: true, domain: "example.com" });

    await service.listForUser(user.id);
    expect(inserts).toEqual(["janedoe"]);
  });

  test("names it after the Google display name when there is one", async () => {
    const user = makeUser("jane@example.com", { name: "  Jane Doe " });
    const { repo } = createFakes();
    const [workspace] = await serviceFor(user, repo).service.listForUser(user.id);
    expect(workspace?.name).toBe("Jane Doe (personal)");
  });

  test("skips reserved and taken slugs with -2, -3, …", async () => {
    const admin = makeUser("admin@example.com");
    const reserved = createFakes();
    const [adminWs] = await serviceFor(admin, reserved.repo).service.listForUser(admin.id);
    expect(adminWs?.slug).toBe("admin-2");

    const jane = makeUser("jane@example.com");
    const taken = createFakes({ takenSlugs: ["jane", "jane-2"] });
    const [janeWs] = await serviceFor(jane, taken.repo).service.listForUser(jane.id);
    expect(janeWs?.slug).toBe("jane-3");
  });

  test("drops leading digits and falls back to 'workspace' when nothing valid is left", async () => {
    const digits = makeUser("42ops@example.com");
    const a = createFakes();
    expect((await serviceFor(digits, a.repo).service.listForUser(digits.id))[0]?.slug).toBe("ops");

    const symbols = makeUser("___@example.com");
    const b = createFakes();
    expect((await serviceFor(symbols, b.repo).service.listForUser(symbols.id))[0]?.slug).toBe(
      "workspace",
    );
  });

  test("a lost insert race returns the winner's workspace", async () => {
    const user = makeUser("racer@example.com");
    const { repo, workspaces } = createFakes({ raceOnce: true });
    const result = await serviceFor(user, repo).service.listForUser(user.id);
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("racer-winner");
    expect(workspaces).toHaveLength(1);
  });

  test("does not create one for a user who already belongs to a workspace", async () => {
    const user = makeUser("member@example.com");
    const { repo, inserts, addWorkspace } = createFakes();
    addWorkspace({ slug: "team", members: new Map([[user.id, "editor"]]) });
    const result = await serviceFor(user, repo).service.listForUser(user.id);
    expect(result.map((ws) => ws.slug)).toEqual(["team"]);
    expect(inserts).toEqual([]);
  });
});

describe("domain restriction", () => {
  test("rejects off-domain and unverified accounts with DOMAIN_NOT_ALLOWED", async () => {
    const outsider = makeUser("x@gmail.com");
    const unverified = makeUser("y@company.com", { verified: false });
    const { repo, inserts } = createFakes();
    await expect(
      serviceFor(outsider, repo, "company.com").service.listForUser(outsider.id),
    ).rejects.toThrow(DomainNotAllowedError);
    await expect(
      serviceFor(unverified, repo, "company.com").service.requireMembership(unverified.id, "y"),
    ).rejects.toThrow(DomainNotAllowedError);
    expect(inserts).toEqual([]);
  });

  test("admits verified accounts of the domain (case-insensitive)", async () => {
    const insider = makeUser("Z@Company.com");
    const { repo } = createFakes();
    const { service } = serviceFor(insider, repo, "company.com");
    expect(await service.listForUser(insider.id)).toHaveLength(1);
  });
});

describe("requireMembership", () => {
  test("returns the workspace for a member and 404s otherwise", async () => {
    const user = makeUser("member@example.com");
    const { repo } = createFakes();
    const { service } = serviceFor(user, repo);
    const [workspace] = await service.listForUser(user.id);
    expect(await service.requireMembership(user.id, workspace?.slug ?? "")).toEqual(
      workspace as Workspace,
    );
    await expect(service.requireMembership(user.id, "someone-else")).rejects.toThrow(NotFoundError);
    await expect(service.requireMembership(crypto.randomUUID(), "x")).rejects.toThrow(
      NotFoundError,
    );
  });

  test("records activity and saves the last-used workspace only when it changes", async () => {
    const user = makeUser("member@example.com");
    const { repo, touches, addWorkspace } = createFakes();
    const a = addWorkspace({ slug: "alpha", members: new Map([[user.id, "viewer"]]) });
    const b = addWorkspace({ slug: "bravo", members: new Map([[user.id, "editor"]]) });
    const { service, lastWorkspaceWrites } = serviceFor(user, repo);

    await service.requireMembership(user.id, "alpha");
    await service.requireMembership(user.id, "alpha");
    await service.requireMembership(user.id, "bravo");

    expect(touches).toEqual([`${a.id}:${user.id}`, `${a.id}:${user.id}`, `${b.id}:${user.id}`]);
    expect(lastWorkspaceWrites).toEqual([a.id, b.id]);
  });
});

describe("onGoogleSignIn (domain join)", () => {
  test("joins matching domain-join workspaces as Viewer", async () => {
    const user = makeUser("new@acme.test");
    const { repo, addWorkspace } = createFakes();
    addWorkspace({ slug: "mine", members: new Map([[user.id, "owner"]]) });
    const acme = addWorkspace({ slug: "acme", domain: "acme.test", domainJoinEnabled: true });
    addWorkspace({ slug: "closed", domain: "acme.test" });
    addWorkspace({ slug: "other", domain: "other.test", domainJoinEnabled: true });

    await serviceFor(user, repo).service.onGoogleSignIn({ userId: user.id, hd: "ACME.test" });

    expect(acme.members.get(user.id)).toBe("viewer");
    const slugs = (await repo.listForUser(user.id, null)).map((ws) => ws.slug);
    expect(slugs).toEqual(["mine", "acme"]);
  });

  test("never re-adds a user who left or was removed", async () => {
    const user = makeUser("gone@acme.test");
    const { repo, addWorkspace } = createFakes();
    addWorkspace({ slug: "mine", members: new Map([[user.id, "owner"]]) });
    const acme = addWorkspace({
      slug: "acme",
      domain: "acme.test",
      domainJoinEnabled: true,
      exits: new Set([user.id]),
    });

    await serviceFor(user, repo).service.onGoogleSignIn({ userId: user.id, hd: "acme.test" });

    expect(acme.members.has(user.id)).toBe(false);
  });

  test("provisions the personal workspace before joining for a user with none", async () => {
    const user = makeUser("first@acme.test");
    const { repo, inserts, addWorkspace } = createFakes();
    const acme = addWorkspace({ slug: "acme", domain: "acme.test", domainJoinEnabled: true });

    await serviceFor(user, repo).service.onGoogleSignIn({ userId: user.id, hd: "acme.test" });

    expect(inserts).toEqual(["first"]);
    expect(acme.members.get(user.id)).toBe("viewer");
  });

  test("without an hd claim only the personal workspace is ensured", async () => {
    const user = makeUser("consumer@gmail.com");
    const { repo, inserts, addWorkspace } = createFakes();
    const open = addWorkspace({ slug: "gmail", domain: "gmail.com", domainJoinEnabled: true });

    await serviceFor(user, repo).service.onGoogleSignIn({ userId: user.id, hd: undefined });

    expect(inserts).toEqual(["consumer"]);
    expect(open.members.has(user.id)).toBe(false);
  });
});
