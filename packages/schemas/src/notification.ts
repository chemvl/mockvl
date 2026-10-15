import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

export const NOTIFICATION_SOURCES = ["admin", "system"] as const;
export const NotificationSourceSchema = z.enum(NOTIFICATION_SOURCES).openapi("NotificationSource");
export type NotificationSource = z.infer<typeof NotificationSourceSchema>;

export const NOTIFICATION_AUDIENCES = ["all", "users"] as const;
export const NotificationAudienceSchema = z
  .enum(NOTIFICATION_AUDIENCES)
  .openapi("NotificationAudience");
export type NotificationAudience = z.infer<typeof NotificationAudienceSchema>;

export const NOTIFICATION_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "canceled",
] as const;
export const NotificationStatusSchema = z.enum(NOTIFICATION_STATUSES).openapi("NotificationStatus");
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

// Hard cap on explicit targeting; larger sends should use audience = "all".
export const NOTIFICATION_MAX_TARGET_USERS = 10_000;

// String→string map merged into the FCM data payload.
const NotificationDataSchema = z.record(z.string().min(1).max(100), z.string().max(1000));

const NotificationTargetingSchema = z.object({
  audience: NotificationAudienceSchema,
  userIds: z.array(z.uuid()).max(NOTIFICATION_MAX_TARGET_USERS).nullable(),
});

const requireUserIdsForUsersAudience = (
  value: { audience: NotificationAudience; userIds: string[] | null },
  ctx: z.RefinementCtx,
) => {
  if (value.audience === "users" && (!value.userIds || value.userIds.length === 0)) {
    ctx.addIssue({
      code: "custom",
      path: ["userIds"],
      message: 'userIds is required and must be non-empty when audience is "users"',
    });
  }
  if (value.audience === "all" && value.userIds && value.userIds.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["userIds"],
      message: 'userIds must be omitted when audience is "all"',
    });
  }
};

export const NotificationCreateSchema = NotificationTargetingSchema.extend({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  imageUrl: z.url().nullable().default(null),
  deepLink: z.string().max(500).nullable().default(null),
  data: NotificationDataSchema.default({}),
  audience: NotificationAudienceSchema.default("all"),
  userIds: NotificationTargetingSchema.shape.userIds.default(null),
})
  .superRefine(requireUserIdsForUsersAudience)
  .openapi("NotificationCreate");

export const NotificationUpdateSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(1000),
    imageUrl: z.url().nullable(),
    deepLink: z.string().max(500).nullable(),
    data: NotificationDataSchema,
    audience: NotificationAudienceSchema,
    userIds: NotificationTargetingSchema.shape.userIds,
  })
  .partial()
  .openapi("NotificationUpdate");

export const NotificationScheduleSchema = z
  .object({
    scheduledAt: z.iso.datetime().openapi({ example: "2026-08-01T09:00:00.000Z" }),
  })
  .openapi("NotificationSchedule");

// Public wire shape — dates cross as ISO strings.
export const NotificationSchema = z
  .object({
    id: z.uuid().openapi({ example: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f" }),
    source: NotificationSourceSchema,
    title: z.string(),
    body: z.string(),
    imageUrl: z.url().nullable(),
    deepLink: z.string().nullable(),
    data: z.record(z.string(), z.string()),
    audience: NotificationAudienceSchema,
    userIds: z.array(z.uuid()).nullable(),
    status: NotificationStatusSchema,
    scheduledAt: z.iso.datetime().nullable(),
    sentAt: z.iso.datetime().nullable(),
    sentCount: z.number().int(),
    failedCount: z.number().int(),
    createdByAdminId: z.uuid().nullable(),
    createdAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
    updatedAt: z.iso.datetime().openapi({ example: "2026-07-06T00:00:00.000Z" }),
  })
  .openapi("Notification");

export type NotificationCreate = z.infer<typeof NotificationCreateSchema>;
export type NotificationUpdate = z.infer<typeof NotificationUpdateSchema>;
export type NotificationSchedule = z.infer<typeof NotificationScheduleSchema>;
export type Notification = z.infer<typeof NotificationSchema>;

// What the ADMIN notifications list endpoint accepts (consumed by
// apps/api/src/admin/notifications).
export const notificationFields: ResourceField[] = [
  { name: "title", type: "string", label: "Title", required: true, searchable: true },
  {
    name: "status",
    type: "enum",
    label: "Status",
    options: [...NOTIFICATION_STATUSES],
    filterable: true,
  },
  {
    name: "source",
    type: "enum",
    label: "Source",
    options: [...NOTIFICATION_SOURCES],
    filterable: true,
  },
  {
    name: "audience",
    type: "enum",
    label: "Audience",
    options: [...NOTIFICATION_AUDIENCES],
    filterable: true,
  },
  { name: "scheduledAt", type: "date", label: "Scheduled", sortable: true },
  { name: "sentAt", type: "date", label: "Sent", sortable: true },
  { name: "createdAt", type: "date", label: "Created", sortable: true },
];
