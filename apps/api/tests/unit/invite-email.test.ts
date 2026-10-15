import "../setup";
import { describe, expect, test } from "bun:test";
import type { EmailMessage } from "@/clients/email/types";
import { createInviteEmailHandler } from "@/jobs/workers/invite-email";
import { generateOpaqueToken, hashOpaqueToken } from "@/modules/auth/auth.tokens";
import type { InviteEmailContext } from "@/modules/workspaces/invites.repo";

const INVITE_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";

function setup(context: Partial<InviteEmailContext> & Pick<InviteEmailContext, "tokenHash">) {
  const sent: EmailMessage[] = [];
  const handler = createInviteEmailHandler({
    loadInvite: async (id) =>
      id === INVITE_ID
        ? {
            email: "sam@example.com",
            acceptedAt: null,
            revokedAt: null,
            workspaceName: "Platform <Team>",
            inviterName: "Jane Doe",
            inviterEmail: "jane@example.com",
            ...context,
          }
        : undefined,
    sender: {
      send: async (message) => {
        sent.push(message);
      },
    },
    appUrl: "https://app.example.com/",
  });
  const run = (token: string) =>
    handler([{ id: "job-1", name: "invite-email", data: { inviteId: INVITE_ID, token } }]);
  return { sent, run };
}

describe("invite-email handler", () => {
  test("skips a token superseded by a resend", async () => {
    const { sent, run } = setup({ tokenHash: hashOpaqueToken(generateOpaqueToken()) });
    await run(generateOpaqueToken());
    expect(sent).toEqual([]);
  });

  test("skips an accepted invite", async () => {
    const token = generateOpaqueToken();
    const { sent, run } = setup({ tokenHash: hashOpaqueToken(token), acceptedAt: new Date() });
    await run(token);
    expect(sent).toEqual([]);
  });

  test("sends the accept link to the invited address", async () => {
    const token = generateOpaqueToken();
    const { sent, run } = setup({ tokenHash: hashOpaqueToken(token) });
    await run(token);

    const url = `https://app.example.com/invite/${token}`;
    expect(sent).toEqual([
      {
        to: "sam@example.com",
        subject: "Jane Doe invited you to Platform <Team> on Mockyard",
        text: `Jane Doe invited you to join Platform <Team> on Mockyard: ${url}`,
        html: `<p>Jane Doe invited you to join Platform &lt;Team&gt; on Mockyard. <a href="${url}">Accept the invite</a></p>`,
      },
    ]);
  });

  test("falls back to the inviter's email, then to Someone", async () => {
    const token = generateOpaqueToken();
    const byEmail = setup({ tokenHash: hashOpaqueToken(token), inviterName: null });
    await byEmail.run(token);
    expect(byEmail.sent[0]?.subject).toBe(
      "jane@example.com invited you to Platform <Team> on Mockyard",
    );

    const deleted = setup({
      tokenHash: hashOpaqueToken(token),
      inviterName: null,
      inviterEmail: null,
    });
    await deleted.run(token);
    expect(deleted.sent[0]?.subject).toBe("Someone invited you to Platform <Team> on Mockyard");
  });
});
