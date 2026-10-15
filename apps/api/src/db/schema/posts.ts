import { relations } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { users } from "./users";

// Valid values live here; wire-level validation uses PostStatusSchema from
// packages/schemas (same value set — the post-schemas test pins them together).
export const postStatus = pgEnum("post_status", ["draft", "published"]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  status: postStatus("status").notNull().default("draft"),
  content: text("content"),
  coverImageUrl: text("cover_image_url"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const postsRelations = relations(posts, ({ one }) => ({
  category: one(categories, {
    fields: [posts.categoryId],
    references: [categories.id],
  }),
}));

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
