import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    password: text("password").notNull(),
    role: text("role").notNull(),
  },
  (t) => [uniqueIndex("uq_users_email").on(t["email"])],
);
export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    user_id: text("user_id").references(() => users["id"], {
      onDelete: "no action",
    }),
    expires: integer("expires"),
  },
  (t) => [],
);
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    token_hash: text("token_hash"),
    created_by: text("created_by"),
    expires: integer("expires"),
    used: integer("used").default(sql.raw("0")),
  },
  (t) => [uniqueIndex("uq_invitations_token_hash").on(t["token_hash"])],
);
export const resources = sqliteTable(
  "resources",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    domain: text("domain"),
    category: text("category"),
    tags: text("tags"),
    kind: text("kind"),
    url: text("url"),
    description: text("description"),
    owner_id: text("owner_id").references(() => users["id"], {
      onDelete: "no action",
    }),
    created_at: integer("created_at"),
    updated_at: integer("updated_at"),
    sample: integer("sample").default(sql.raw("0")),
    hidden: integer("hidden").default(sql.raw("0")),
    category_id: text("category_id"),
    tag_ids: text("tag_ids").notNull().default(sql.raw("'[]'")),
  },
  (t) => [],
);
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    resource_id: text("resource_id").references(() => resources["id"], {
      onDelete: "cascade",
    }),
    storage_key: text("storage_key"),
    name: text("name"),
    mime: text("mime"),
    size: integer("size"),
  },
  (t) => [],
);
export const favorites = sqliteTable(
  "favorites",
  {
    user_id: text("user_id").references(() => users["id"], {
      onDelete: "no action",
    }),
    resource_id: text("resource_id").references(() => resources["id"], {
      onDelete: "cascade",
    }),
  },
  (t) => [primaryKey({ columns: [t["user_id"], t["resource_id"]] })],
);
export const recent = sqliteTable(
  "recent",
  {
    user_id: text("user_id").references(() => users["id"], {
      onDelete: "no action",
    }),
    resource_id: text("resource_id").references(() => resources["id"], {
      onDelete: "cascade",
    }),
    viewed_at: integer("viewed_at"),
  },
  (t) => [primaryKey({ columns: [t["user_id"], t["resource_id"]] })],
);
export const roadmaps = sqliteTable(
  "roadmaps",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id")
      .notNull()
      .references(() => users["id"], { onDelete: "no action" }),
    draft: text("draft").notNull(),
    published: text("published"),
    version: integer("version").notNull().default(sql.raw("1")),
    hidden: integer("hidden").notNull().default(sql.raw("0")),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    published_at: integer("published_at"),
  },
  (t) => [index("roadmap_owner").on(t["owner_id"])],
);
export const roadmap_progress = sqliteTable(
  "roadmap_progress",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => users["id"], { onDelete: "no action" }),
    roadmap_id: text("roadmap_id")
      .notNull()
      .references(() => roadmaps["id"], { onDelete: "cascade" }),
    states: text("states").notNull().default(sql.raw("'{}'")),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t["user_id"], t["roadmap_id"]] })],
);
export const taxonomy_options = sqliteTable(
  "taxonomy_options",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    parent_id: text("parent_id").notNull().default(sql.raw("''")),
    name: text("name").notNull(),
    normalized: text("normalized").notNull(),
    position: integer("position").notNull().default(sql.raw("0")),
  },
  (t) => [
    uniqueIndex("uq_taxonomy_options_kind_parent_id_normalized").on(
      t["kind"],
      t["parent_id"],
      t["normalized"],
    ),
  ],
);
export const taxonomy_meta = sqliteTable(
  "taxonomy_meta",
  { id: integer("id").primaryKey(), revision: integer("revision").notNull() },
  (t) => [check("taxonomy_singleton", sql.raw("id=1"))],
);
export const taxonomy_aliases = sqliteTable(
  "taxonomy_aliases",
  {
    kind: text("kind"),
    parent_id: text("parent_id"),
    name: text("name"),
    target_id: text("target_id"),
  },
  (t) => [primaryKey({ columns: [t["kind"], t["parent_id"], t["name"]] })],
);
export const taxonomy_requests = sqliteTable(
  "taxonomy_requests",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users["id"], { onDelete: "no action" }),
    kind: text("kind").notNull(),
    parent_id: text("parent_id").notNull().default(sql.raw("''")),
    parent_name: text("parent_name").notNull().default(sql.raw("''")),
    name: text("name").notNull(),
    normalized: text("normalized").notNull(),
    reason: text("reason").notNull().default(sql.raw("''")),
    status: text("status").notNull().default(sql.raw("'pending'")),
    review_note: text("review_note").notNull().default(sql.raw("''")),
    reviewer_id: text("reviewer_id").references(() => users["id"], {
      onDelete: "no action",
    }),
    option_id: text("option_id"),
    created_at: integer("created_at").notNull(),
    reviewed_at: integer("reviewed_at"),
    version: integer("version").notNull().default(sql.raw("1")),
  },
  (t) => [
    index("taxonomy_request_queue").on(t["status"], t["created_at"]),
    uniqueIndex("taxonomy_request_pending")
      .on(t["user_id"], t["kind"], t["parent_id"], t["normalized"])
      .where(sql.raw("status='pending'")),
  ],
);
export const cloud_revision = sqliteTable(
  "cloud_revision",
  { id: integer("id").primaryKey(), revision: integer("revision").notNull() },
  (t) => [check("cloud_singleton", sql.raw("id=1"))],
);
export const cloud_auth_limits = sqliteTable(
  "cloud_auth_limits",
  {
    key: text("key").notNull(),
    window: integer("window").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.window] })],
);
