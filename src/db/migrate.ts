import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely";
import { db } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(__dirname, "migrations"),
  }),
});

const { error, results } = await migrator.migrateToLatest();

for (const migration of results ?? []) {
  console.log(`${migration.migrationName}: ${migration.status}`);
}

await db.destroy();

if (error) {
  console.error("Migration failed", error);
  process.exit(1);
}

console.log("Migrations completed");
