import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");
const connString = process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5432/pfs";

async function migrate() {
  const client = new pg.Client(connString);
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      run_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
    if (rows.length > 0) {
      console.log(`Skipping ${file} (already run)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Running ${file}...`);
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    console.log(`Done ${file}`);
  }

  await client.end();
  console.log("All migrations complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
