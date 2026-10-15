import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// No API writes devices any more; the admin push pipeline still reads existing
// rows, so the table and enum stay.
export const devicePlatform = pgEnum("device_platform", ["ios", "android"]);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // FCM registration token. Globally unique — re-registering an existing
    // token re-points the row to the new owner (device changed accounts).
    token: text("token").notNull(),
    platform: devicePlatform("platform").notNull(),
    // Opt-out flag: gates FCM delivery only, never the in-app inbox.
    pushEnabled: boolean("push_enabled").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("devices_token_idx").on(table.token),
    index("devices_user_id_idx").on(table.userId),
  ],
);

export type DeviceRow = typeof devices.$inferSelect;
export type NewDeviceRow = typeof devices.$inferInsert;
