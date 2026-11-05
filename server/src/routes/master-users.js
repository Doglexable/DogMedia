import { randomBytes } from "node:crypto";
import { hashPassword } from "../password.js";

function requireAdmin(request, reply) {
  if (request.accessTier < 100) {
    reply.code(403).send({ error: "Admin access required" });
    return false;
  }
  return true;
}

export default async function masterUsersRoutes(fastify) {
  fastify.get("/", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { rows } = await fastify.pg.query(`
      SELECT id, username, access_tier, profile_picture, created_at
      FROM users
      WHERE password_hash <> 'disabled'
      ORDER BY created_at DESC, id DESC
    `);
    return rows;
  });

  fastify.patch("/:id/tier", async (request, reply) => {
    if (request.accessTier < 999) return reply.code(403).send({ error: "Administrator access required" });
    const id = Number(request.params.id);
    const tier = request.body?.tier;
    if (!Number.isSafeInteger(id) || id < 1 || ![0, 100].includes(tier)) {
      return reply.code(400).send({ error: "Choose a valid user and tier" });
    }
    if (id === Number(request.user.id)) return reply.code(400).send({ error: "Cannot change your own tier" });
    const client = await fastify.pg.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      // Serialize role changes so two concurrent downgrades cannot each observe two admins.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('pfs-user-role-change'))");
      const { rows: targetRows } = await client.query(`
        SELECT id, access_tier FROM users
        WHERE id = $1 AND access_tier < 999 AND password_hash <> 'disabled'
        FOR UPDATE
      `, [id]);
      if (!targetRows.length) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return reply.code(404).send({ error: "User not found or protected" });
      }

      if (tier < 100 && Number(targetRows[0].access_tier) >= 100) {
        const { rows: countRows } = await client.query(`
          SELECT COUNT(*)::int AS admin_count FROM users
          WHERE access_tier >= 100 AND password_hash <> 'disabled'
        `);
        if (!countRows.length || Number(countRows[0].admin_count) <= 1) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return reply.code(409).send({ error: "At least one admin must remain" });
        }
      }

      const { rows } = await client.query(`
        UPDATE users SET access_tier = $1, session_version = session_version + 1
        WHERE id = $2
        RETURNING id, username, access_tier, profile_picture, created_at
      `, [tier, id]);
      await client.query("COMMIT");
      transactionOpen = false;
      return rows[0];
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  fastify.post("/:id/reset-password", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ error: "Choose a valid user" });
    }
    if (id === Number(request.user.id)) {
      return reply.code(400).send({ error: "Change your own password in Profile" });
    }

    const temporaryPassword = randomBytes(24).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    const { rows } = await fastify.pg.query(`
      UPDATE users
      SET password_hash = $1, session_version = session_version + 1
      WHERE id = $2 AND access_tier < $3 AND password_hash <> 'disabled'
      RETURNING id, username
    `, [passwordHash, id, request.accessTier]);
    if (!rows.length) return reply.code(404).send({ error: "User not found or protected" });

    reply.header("Cache-Control", "no-store");
    return { id: rows[0].id, username: rows[0].username, temporaryPassword };
  });
}
