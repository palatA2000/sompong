import { Kysely, sql } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("scheduled_messages")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("chat_id", "integer", (col) =>
      col.notNull().references("chats.id").onDelete("cascade"),
    )
    .addColumn("created_by_user_id", "integer", (col) =>
      col.references("users.id").onDelete("set null"),
    )
    .addColumn("message_text", "text", (col) => col.notNull())
    .addColumn("message_type", "varchar(20)", (col) => col.notNull())
    .addColumn("timezone", "varchar(64)", (col) => col.notNull())
    .addColumn("start_at", "timestamptz", (col) => col.notNull())
    .addColumn("end_at", "timestamptz")
    .addColumn("frequency_type", "varchar(20)", (col) => col.notNull())
    .addColumn("frequency_interval", "integer")
    .addColumn("days_of_week", "varchar(64)")
    .addColumn("day_of_month", "integer")
    .addColumn("time_of_day", "varchar(16)")
    .addColumn("cron_expression", "text")
    .addColumn("is_active", "boolean", (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn("next_run_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("idx_scheduled_messages_chat_id")
    .on("scheduled_messages")
    .column("chat_id")
    .execute();

  await db.schema
    .createIndex("idx_scheduled_messages_next_run_at")
    .on("scheduled_messages")
    .column("next_run_at")
    .execute();

  await db.schema
    .createIndex("idx_scheduled_messages_is_active")
    .on("scheduled_messages")
    .column("is_active")
    .execute();

  await db.schema
    .createTable("scheduled_message_substitutions")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("scheduled_message_id", "integer", (col) =>
      col.notNull().references("scheduled_messages.id").onDelete("cascade"),
    )
    .addColumn("key", "varchar(100)", (col) => col.notNull())
    .addColumn("type", "varchar(20)", (col) => col.notNull())
    .addColumn("mentionee_type", "varchar(20)")
    .addColumn("user_id", "integer", (col) =>
      col.references("users.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("idx_scheduled_message_substitutions_scheduled_message_id")
    .on("scheduled_message_substitutions")
    .column("scheduled_message_id")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .dropIndex("idx_scheduled_message_substitutions_scheduled_message_id")
    .execute();
  await db.schema.dropTable("scheduled_message_substitutions").execute();
  await db.schema.dropIndex("idx_scheduled_messages_is_active").execute();
  await db.schema.dropIndex("idx_scheduled_messages_next_run_at").execute();
  await db.schema.dropIndex("idx_scheduled_messages_chat_id").execute();
  await db.schema.dropTable("scheduled_messages").execute();
}
