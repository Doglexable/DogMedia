export default async function (fastify) {
  fastify.get("/", async () => {
    const { rows } = await fastify.pg.query(
      "SELECT * FROM ip_whitelist ORDER BY cidr_range"
    );
    return rows;
  });

  fastify.post("/", async (request, reply) => {
    const { cidr_range, access_tier, description } = request.body;
    if (!cidr_range) {
      return reply.code(400).send({ error: "cidr_range is required" });
    }
    const { rows } = await fastify.pg.query(
      "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, $2, $3) RETURNING *",
      [cidr_range, access_tier ?? 0, description ?? null]
    );
    return reply.code(201).send(rows[0]);
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.pg.query(
      "DELETE FROM ip_whitelist WHERE id = $1",
      [id]
    );
    if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
