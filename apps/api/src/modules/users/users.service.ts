import { UnauthorizedError } from "@/lib/errors";
import type { UserRepo } from "./users.repo";

export interface UsersServiceDeps {
  userRepo: UserRepo;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export function createUsersService(deps: UsersServiceDeps) {
  const { userRepo } = deps;

  return {
    async getMe(userId: string): Promise<PublicUser> {
      const user = await userRepo.findById(userId);
      if (!user) {
        // A valid token for a deleted account is still not a session.
        throw new UnauthorizedError("Account no longer exists");
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      };
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
