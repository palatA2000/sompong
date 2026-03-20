import { Kysely, sql } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable("users")
    .addColumn("score", "integer", (col) =>
      col.notNull().defaultTo(0).ifNotExists(),
    )
    .execute();

  await db.schema
    .createTable("quiz_questions")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("emoji", "text", (col) => col.notNull())
    .addColumn("question_text", "text", (col) => col.notNull())
    .addColumn("generated_at", "timestamptz", (col) =>
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
    .createTable("quiz_choices")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("question_id", "integer", (col) =>
      col.notNull().references("quiz_questions.id").onDelete("cascade"),
    )
    .addColumn("choice_text", "text", (col) => col.notNull())
    .addColumn("choice_order", "integer", (col) => col.notNull())
    .addColumn("is_correct", "boolean", (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createTable("quiz_attempts")
    .ifNotExists()
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("question_id", "integer", (col) =>
      col.notNull().references("quiz_questions.id").onDelete("cascade"),
    )
    .addColumn("user_id", "integer", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("group_id", "integer", (col) =>
      col.notNull().references("groups.id").onDelete("cascade"),
    )
    .addColumn("choice_id", "integer", (col) =>
      col.notNull().references("quiz_choices.id").onDelete("cascade"),
    )
    .addColumn("is_correct", "boolean", (col) => col.notNull())
    .addColumn("answered_at", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("quiz_attempts_unique", [
      "question_id",
      "user_id",
      "group_id",
    ])
    .execute();

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

  await db.schema
    .createIndex("quiz_choices_question_id_idx")
    .ifNotExists()
    .on("quiz_choices")
    .column("question_id")
    .execute();

  await db.schema
    .createIndex("quiz_attempts_question_id_idx")
    .ifNotExists()
    .on("quiz_attempts")
    .column("question_id")
    .execute();

  await db.schema
    .createIndex("quiz_attempts_user_id_idx")
    .ifNotExists()
    .on("quiz_attempts")
    .column("user_id")
    .execute();

  await db.schema
    .createIndex("quiz_attempts_group_id_idx")
    .ifNotExists()
    .on("quiz_attempts")
    .column("group_id")
    .execute();

  await db.schema
    .createIndex("quiz_sends_question_id_idx")
    .ifNotExists()
    .on("quiz_sends")
    .column("question_id")
    .execute();

  await db.schema
    .createIndex("quiz_sends_group_id_idx")
    .ifNotExists()
    .on("quiz_sends")
    .column("group_id")
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex("quiz_sends_group_id_idx").execute();
  await db.schema.dropIndex("quiz_sends_question_id_idx").execute();
  await db.schema.dropIndex("quiz_attempts_group_id_idx").execute();
  await db.schema.dropIndex("quiz_attempts_user_id_idx").execute();
  await db.schema.dropIndex("quiz_attempts_question_id_idx").execute();
  await db.schema.dropIndex("quiz_choices_question_id_idx").execute();
  await db.schema.dropTable("quiz_sends").execute();
  await db.schema.dropTable("quiz_attempts").execute();
  await db.schema.dropTable("quiz_choices").execute();
  await db.schema.dropTable("quiz_questions").execute();
  await db.schema.alterTable("users").dropColumn("score").execute();
}
