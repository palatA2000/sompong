import { Kysely } from "kysely";
import type { Database } from "../types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  // Drop unique constraint that includes group_id
  await db.schema
    .alterTable("quiz_attempts")
    .dropConstraint("quiz_attempts_unique")
    .execute();

  // Drop index on group_id
  await db.schema.dropIndex("quiz_attempts_group_id_idx").ifExists().execute();

  // Drop group_id column
  await db.schema
    .alterTable("quiz_attempts")
    .dropColumn("group_id")
    .execute();

  // Re-add unique constraint without group_id
  await db.schema
    .alterTable("quiz_attempts")
    .addUniqueConstraint("quiz_attempts_unique", ["question_id", "user_id"])
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  // Drop new unique constraint
  await db.schema
    .alterTable("quiz_attempts")
    .dropConstraint("quiz_attempts_unique")
    .execute();

  // Re-add group_id column
  await db.schema
    .alterTable("quiz_attempts")
    .addColumn("group_id", "integer", (col) =>
      col.notNull().references("groups.id").onDelete("cascade"),
    )
    .execute();

  // Re-add index on group_id
  await db.schema
    .createIndex("quiz_attempts_group_id_idx")
    .on("quiz_attempts")
    .column("group_id")
    .execute();

  // Re-add original unique constraint with group_id
  await db.schema
    .alterTable("quiz_attempts")
    .addUniqueConstraint("quiz_attempts_unique", [
      "question_id",
      "user_id",
      "group_id",
    ])
    .execute();
}
