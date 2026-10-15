import "../setup";

import { describe, expect, test } from "bun:test";
import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_SOURCES,
  NOTIFICATION_STATUSES,
  NotificationCreateSchema,
  NotificationSchema,
  NotificationUpdateSchema,
  notificationFields,
  ResourceFieldSchema,
} from "@starter/schemas";
import { notificationAudience, notificationSource, notificationStatus } from "@/db/schema";

const USER_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";

describe("notification schemas", () => {
  test("wire enums pin the pgEnum value sets (no drift)", () => {
    expect([...NOTIFICATION_SOURCES]).toEqual([...notificationSource.enumValues]);
    expect([...NOTIFICATION_AUDIENCES]).toEqual([...notificationAudience.enumValues]);
    expect([...NOTIFICATION_STATUSES]).toEqual([...notificationStatus.enumValues]);
  });

  test("NotificationCreateSchema accepts a minimal broadcast", () => {
    const parsed = NotificationCreateSchema.parse({ title: "Hello", body: "World" });
    expect(parsed.audience).toBe("all");
    expect(parsed.userIds).toBeNull();
    expect(parsed.data).toEqual({});
    expect(parsed.imageUrl).toBeNull();
  });

  test('NotificationCreateSchema requires userIds when audience is "users"', () => {
    expect(() =>
      NotificationCreateSchema.parse({ title: "Hi", body: "There", audience: "users" }),
    ).toThrow();
    expect(() =>
      NotificationCreateSchema.parse({
        title: "Hi",
        body: "There",
        audience: "users",
        userIds: [],
      }),
    ).toThrow();
    const parsed = NotificationCreateSchema.parse({
      title: "Hi",
      body: "There",
      audience: "users",
      userIds: [USER_ID],
    });
    expect(parsed.userIds).toEqual([USER_ID]);
  });

  test('NotificationCreateSchema rejects userIds with audience "all"', () => {
    expect(() =>
      NotificationCreateSchema.parse({
        title: "Hi",
        body: "There",
        audience: "all",
        userIds: [USER_ID],
      }),
    ).toThrow();
  });

  test("NotificationUpdateSchema accepts a partial update", () => {
    expect(NotificationUpdateSchema.parse({ title: "New" })).toEqual({ title: "New" });
  });

  test("NotificationSchema describes the wire shape", () => {
    const notification = NotificationSchema.parse({
      id: "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f",
      source: "admin",
      title: "Hello",
      body: "World",
      imageUrl: null,
      deepLink: "/posts/1",
      data: { campaign: "july" },
      audience: "all",
      userIds: null,
      status: "draft",
      scheduledAt: null,
      sentAt: null,
      sentCount: 0,
      failedCount: 0,
      createdByAdminId: null,
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });
    expect(notification.status).toBe("draft");
  });

  test("notificationFields are valid ResourceFields naming NotificationSchema properties", () => {
    const outputKeys = Object.keys(NotificationSchema.shape);
    for (const field of notificationFields) {
      ResourceFieldSchema.parse(field);
      expect(outputKeys).toContain(field.name);
    }
  });
});
