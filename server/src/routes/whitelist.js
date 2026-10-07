export default async function (fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    const clientIp = request.clientIp || request.ip;
    if (
      clientIp !== "127.0.0.1" &&
      clientIp !== "::1" &&
      clientIp !== "::ffff:127.0.0.1"
    ) {
      return reply.code(403).send({ error: "Only accessible from localhost" });
    }
  });

  fastify.get("/", async () => {
    const { rows } = await fastify.pg.query(
      "SELECT * FROM ip_whitelist ORDER BY cidr_range"
    );
    return rows;
  });

  fastify.post("/", async (request, reply) => {
    const { cidr_range, access_tier, description } = request.body || {};
    if (!cidr_range) {
      return reply.code(400).send({ error: "cidr_range is required" });
    }
    if (typeof cidr_range !== "string") {
      return reply.code(400).send({ error: "Invalid cidr_range" });
    }
    // Access tiers have no closed set; store any non-negative PostgreSQL integer.
    const tier = access_tier ?? 0;
    if (!Number.isInteger(tier) || tier < 0 || tier > 2147483647) {
      return reply.code(400).send({ error: "access_tier must be a non-negative integer" });
    }
    try {
      await fastify.pg.query("SELECT $1::cidr", [cidr_range]);
    } catch (error) {
      if (!String(error.code || "").startsWith("22")) throw error;
      return reply.code(400).send({ error: "Invalid cidr_range" });
    }
    const { rows } = await fastify.pg.query(
      "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, $2, $3) RETURNING *",
      [cidr_range, tier, description ?? null]
    );
    fastify.clearAuthCache?.();
    return reply.code(201).send(rows[0]);
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params;
    const parsedId = Number.parseInt(id, 10);
    if (!/^\d+$/.test(id) || !Number.isInteger(parsedId) || parsedId < 1 || parsedId > 2147483647) {
      return reply.code(400).send({ error: "Invalid whitelist id" });
    }
    const { rowCount } = await fastify.pg.query(
      "DELETE FROM ip_whitelist WHERE id = $1",
      [id]
    );
    if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
    fastify.clearAuthCache?.();
    return reply.code(204).send();
  });
}
