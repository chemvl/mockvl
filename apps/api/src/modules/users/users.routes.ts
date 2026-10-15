import { createRoute } from "@hono/zod-openapi";
import { envelope, UserSchema } from "@starter/schemas";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";
import { serializeUser } from "@/lib/serialize";
import { authMiddleware } from "@/middleware/auth";
import type { UsersService } from "./users.service";

const meRoute = createRoute({
  method: "get",
  path: "/me",
  operationId: "getMe",
  tags: ["users"],
  summary: "Get the authenticated user",
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonContent(envelope(UserSchema), "The user behind the access token"),
    401: errorResponse("Missing, invalid, or expired access token"),
  },
});

export function createUsersRoutes(service: UsersService) {
  const router = createRouter();

  router.use(authMiddleware());

  router.openapi(meRoute, async (c) => {
    const user = await service.getMe(c.get("userId"));
    return c.json({ data: serializeUser(user) }, 200);
  });

  return router;
}
