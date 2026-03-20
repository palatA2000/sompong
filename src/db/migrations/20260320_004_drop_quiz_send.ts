import { Kysely, sql } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.dropTable("quiz_sends").ifExists().execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable("quiz_sends")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("question_id", "integer", (col) =>
      col.notNull().references("quiz_questions.id").onDelete("cascade"),
    )
    .addColumn("group_id", "integer", (col) =>
      col.notNull().references("groups.id").onDelete("cascade"),
    )
    .addColumn("sent_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("quiz_sends_unique", ["question_id", "group_id"])
    .execute();
}
