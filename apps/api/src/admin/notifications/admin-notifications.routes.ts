import { createRoute, z } from "@hono/zod-openapi";
import {
  envelope,
  listEnvelope,
  type Notification,
  NotificationCreateSchema,
  NotificationScheduleSchema,
  NotificationSchema,
  NotificationUpdateSchema,
  notificationFields,
} from "@starter/schemas";
import type { notifications } from "@/db/schema";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { parseListQuery } from "@/lib/pagination";
import type { RequireAdmin } from "@/middleware/admin-auth";
import type { AdminNotificationsService } from "./admin-notifications.service";

type NotificationRow = typeof notifications.$inferSelect;

const IdParamsSchema = z.object({ id: z.uuid() });

const ListQueryDocSchema = z.object({
  page: z.string().optional().openapi({ example: "1" }),
  pageSize: z.string().optional().openapi({ example: "20", description: "Max 100" }),
  sort: z.string().optional().openapi({ example: "createdAt:desc" }),
});

const TestSendBodySchema = z.object({ userId: z.uuid() }).openapi("NotificationTestSend");

const TestSendResultSchema = z
  .object({
    sent: z.number().int().openapi({ example: 1 }),
    failed: z.number().int().openapi({ example: 0 }),
  })
  .openapi("NotificationTestSendResult");

const StatsSchema = z
  .object({
    targetedDevices: z.number().int().openapi({ example: 1250 }),
    sentCount: z.number().int().openapi({ example: 1230 }),
    failedCount: z.number().int().openapi({ example: 20 }),
    inboxCount: z.number().int().openapi({ example: 1100 }),
    readCount: z.number().int().openapi({ example: 460 }),
  })
  .openapi("NotificationStats");

function serializeNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    body: row.body,
    imageUrl: row.imageUrl,
    deepLink: row.deepLink,
    data: row.data,
    audience: row.audience,
    userIds: row.userIds,
    status: row.status,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    createdByAdminId: row.createdByAdminId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateAdminNotificationsRoutesDeps {
  service: AdminNotificationsService;
  requireAdmin: RequireAdmin;
}

export function createAdminNotificationsRoutes({
  service,
  requireAdmin,
}: CreateAdminNotificationsRoutesDeps) {
  const router = createRouter();
  const adminErrors = {
    401: errorResponse("Admin session required"),
    403: errorResponse("Insufficient admin role"),
  };

  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["admin/notifications"],
      summary: "List notifications",
      description:
        "Query convention: `page`, `pageSize` (max 100), `sort=createdAt:desc`, " +
        "`filter[status][eq]=...`, `filter[source][eq]=...`, `filter[title][like]=...`.",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("viewer")] as const,
      request: { query: ListQueryDocSchema },
      responses: {
        200: jsonContent(listEnvelope(NotificationSchema), "A page of notifications"),
        400: errorResponse("Invalid list query"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const query = parseListQuery(c.req.query(), notificationFields);
      const { rows, total } = await service.list(query);
      return c.json(
        {
          data: rows.map(serializeNotification),
          meta: { page: query.page, pageSize: query.pageSize, total },
        },
        200,
      );
    },
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["admin/notifications"],
      summary: "Create a draft notification",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: jsonBody(NotificationCreateSchema),
      responses: {
        201: jsonContent(envelope(NotificationSchema), "The created draft"),
        400: errorResponse("Invalid request body"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const created = await service.create(c.req.valid("json"), c.get("adminUser").id);
      return c.json({ data: serializeNotification(created) }, 201);
    },
  );

  // Action routes are registered before the generic /{id} matchers on purpose
  // (Hono matches in registration order).
  router.openapi(
    createRoute({
      method: "post",
      path: "/{id}/send",
      tags: ["admin/notifications"],
      summary: "Send now",
      description: "Allowed from draft or scheduled. Delivery is asynchronous (202).",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: { params: IdParamsSchema },
      responses: {
        202: jsonContent(envelope(NotificationSchema), "Now sending"),
        400: errorResponse("Invalid id"),
        404: errorResponse("No notification with that id"),
        409: errorResponse("Status does not allow sending"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const sent = await service.send(c.req.valid("param").id);
      return c.json({ data: serializeNotification(sent) }, 202);
    },
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/{id}/schedule",
      tags: ["admin/notifications"],
      summary: "Schedule for a future time",
      description: "Allowed from draft or scheduled (re-schedule replaces the queued job).",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: { params: IdParamsSchema, ...jsonBody(NotificationScheduleSchema) },
      responses: {
        200: jsonContent(envelope(NotificationSchema), "Scheduled"),
        400: errorResponse("Invalid request"),
        404: errorResponse("No notification with that id"),
        409: errorResponse("Status does not allow scheduling"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const scheduled = await service.schedule(
        c.req.valid("param").id,
        c.req.valid("json").scheduledAt,
      );
      return c.json({ data: serializeNotification(scheduled) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/{id}/cancel",
      tags: ["admin/notifications"],
      summary: "Cancel a scheduled send",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: { params: IdParamsSchema },
      responses: {
        200: jsonContent(envelope(NotificationSchema), "Canceled"),
        400: errorResponse("Invalid id"),
        404: errorResponse("No notification with that id"),
        409: errorResponse("Only scheduled notifications can be canceled"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const canceled = await service.cancel(c.req.valid("param").id);
      return c.json({ data: serializeNotification(canceled) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/{id}/test-send",
      tags: ["admin/notifications"],
      summary: "Test-send to one user's devices",
      description: "Direct FCM delivery preview: writes no inbox rows and changes no counters.",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: { params: IdParamsSchema, ...jsonBody(TestSendBodySchema) },
      responses: {
        200: jsonContent(envelope(TestSendResultSchema), "Per-device delivery outcome"),
        400: errorResponse("Invalid request"),
        404: errorResponse("No notification with that id"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const result = await service.testSend(c.req.valid("param").id, c.req.valid("json").userId);
      return c.json({ data: result }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/{id}/stats",
      tags: ["admin/notifications"],
      summary: "Delivery stats",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("viewer")] as const,
      request: { params: IdParamsSchema },
      responses: {
        200: jsonContent(envelope(StatsSchema), "Targeting, delivery, and read counts"),
        400: errorResponse("Invalid id"),
        404: errorResponse("No notification with that id"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const stats = await service.stats(c.req.valid("param").id);
      return c.json({ data: stats }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["admin/notifications"],
      summary: "Get one notification",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("viewer")] as const,
      request: { params: IdParamsSchema },
      responses: {
        200: jsonContent(envelope(NotificationSchema), "The notification"),
        400: errorResponse("Invalid id"),
        404: errorResponse("No notification with that id"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const notification = await service.getById(c.req.valid("param").id);
      return c.json({ data: serializeNotification(notification) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "patch",
      path: "/{id}",
      tags: ["admin/notifications"],
      summary: "Edit a draft or scheduled notification",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: { params: IdParamsSchema, ...jsonBody(NotificationUpdateSchema) },
      responses: {
        200: jsonContent(envelope(NotificationSchema), "The updated notification"),
        400: errorResponse("Invalid request"),
        404: errorResponse("No notification with that id"),
        409: errorResponse("Status does not allow editing"),
        ...adminErrors,
      },
    }),
    async (c) => {
      const updated = await service.update(c.req.valid("param").id, c.req.valid("json"));
      return c.json({ data: serializeNotification(updated) }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["admin/notifications"],
      summary: "Delete a draft, canceled, or failed notification",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("editor")] as const,
      request: { params: IdParamsSchema },
      responses: {
        204: { description: "Deleted" },
        400: errorResponse("Invalid id"),
        404: errorResponse("No notification with that id"),
        409: errorResponse("Status does not allow deleting"),
        ...adminErrors,
      },
    }),
    async (c) => {
      await service.remove(c.req.valid("param").id);
      return c.body(null, 204);
    },
  );

  return router;
}
