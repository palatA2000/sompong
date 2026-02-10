import { Kysely, sql } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("display_name", "varchar(255)")
    .addColumn("line_user_id", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("groups")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("line_group_id", "varchar(255)", (col) =>
      col.notNull().unique(),
    )
    .addColumn("group_name", "varchar(255)")
    .addColumn("picture_url", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("chats")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("conversation_id", "varchar(255)", (col) =>
      col.notNull().unique(),
    )
    .addColumn("source_type", "varchar(20)", (col) => col.notNull())
    .addColumn("source_id", "varchar(255)")
    .addColumn("group_id", "integer", (col) =>
      col.references("groups.id").onDelete("set null"),
    )
    .addColumn("last_message_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("chat_messages")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("chat_id", "integer", (col) =>
      col.notNull().references("chats.id").onDelete("cascade"),
    )
    .addColumn("user_id", "integer", (col) =>
      col.references("users.id").onDelete("set null"),
    )
    .addColumn("text", "text", (col) => col.notNull())
    .addColumn("sent_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("idx_chat_messages_chat_id_sent_at")
    .on("chat_messages")
    .columns(["chat_id", "sent_at"])
    .execute();

  await db.schema
    .createIndex("idx_chats_last_message_at")
    .on("chats")
    .column("last_message_at")
    .execute();

  await db.schema
    .createIndex("idx_chats_group_id")
    .on("chats")
    .column("group_id")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("idx_chat_messages_chat_id_sent_at").execute();
  await db.schema.dropIndex("idx_chats_last_message_at").execute();
  await db.schema.dropIndex("idx_chats_group_id").execute();
  await db.schema.dropTable("chat_messages").execute();
  await db.schema.dropTable("chats").execute();
  await db.schema.dropTable("groups").execute();
  await db.schema.dropTable("users").execute();
}
