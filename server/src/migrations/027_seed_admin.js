import { hashPassword } from "../password.js";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,40}$/;

export async function up(client, env = process.env) {
  const { rows } = await client.query("SELECT EXISTS(SELECT 1 FROM users WHERE access_tier >= 100) AS has_admin");
  if (rows[0].has_admin) return;

  const username = env.PFS_ADMIN_USERNAME || "admin";
  const password = env.PFS_ADMIN_PASSWORD;
  if (!USERNAME_RE.test(username)) {
    throw new Error("PFS_ADMIN_USERNAME must be 3–40 letters, numbers, dots, underscores or hyphens");
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("PFS_ADMIN_PASSWORD must contain 12–256 characters before running migrations");
  }

  await client.query(
    "INSERT INTO users (username, password_hash, access_tier) VALUES ($1, $2, 999)",
    [username, await hashPassword(password)]
  );
}
