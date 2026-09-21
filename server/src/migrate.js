import { readdirSync, readFileSync, realpathSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = join(__dirname, "migrations");
const connString = process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5432/pfs";

export async function runMigrations(client, migrationsDir = defaultMigrationsDir) {
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
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Done ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
}

export async function migrate(connectionString = connString, migrationsDir = defaultMigrationsDir) {
  const client = new pg.Client(connectionString);
  await client.connect();
  try {
    await runMigrations(client, migrationsDir);
  } finally {
    await client.end();
  }
  console.log("All migrations complete.");
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = fileURLToPath(import.meta.url);
    return resolve(process.argv[1]) === scriptPath || realpathSync(process.argv[1]) === realpathSync(scriptPath);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
