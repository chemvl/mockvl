import { AppError, NotFoundError } from "@/lib/errors";
import { MAX_ACTIVE_PATS_PER_WORKSPACE } from "./personal-access-tokens.constants";

// Messages are user-facing and rendered verbatim by the UI.
export const patErrors = {
  limitReached: () =>
    new AppError(
      "TOKEN_LIMIT_REACHED",
      409,
      `You can have at most ${MAX_ACTIVE_PATS_PER_WORKSPACE} active tokens in this workspace. Revoke one first.`,
    ),
  notFound: () => new NotFoundError("Token not found"),
};
