const TYPES = new Set(["music", "video", "photo"]);
const STATUSES = new Set(["pending", "added", "rejected"]);

export default async function mediaRequestsRoutes(fastify) {
  fastify.get("/", async (request) => {
    const admin = request.accessTier >= 100;
    const { rows } = await fastify.pg.query(`
      SELECT r.id, r.user_id, u.username, r.title, r.media_type, r.details,
             r.status, r.created_at, r.updated_at
      FROM media_requests r
      JOIN users u ON u.id = r.user_id
      WHERE ($1::boolean OR r.user_id = $2)
      ORDER BY r.created_at DESC, r.id DESC
    `, [admin, request.user.id]);
    return rows;
  });

  fastify.post("/", async (request, reply) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    const mediaType = request.body?.mediaType;
    const details = typeof request.body?.details === "string" ? request.body.details.trim() : "";
    if (!title || title.length > 200 || !TYPES.has(mediaType) || details.length > 2000) {
      return reply.code(400).send({ error: "Enter a title (up to 200 characters), type, and optional details (up to 2000 characters)" });
    }
    const { rows } = await fastify.pg.query(`
      INSERT INTO media_requests (user_id, title, media_type, details)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, title, media_type, details, status, created_at, updated_at
    `, [request.user.id, title, mediaType, details]);
    return reply.code(201).send({ ...rows[0], username: request.user.username });
  });

  fastify.patch("/:id/status", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Admin access required" });
    const id = Number(request.params.id);
    const status = request.body?.status;
    if (!Number.isSafeInteger(id) || id < 1 || !STATUSES.has(status)) {
      return reply.code(400).send({ error: "Choose a valid request and status" });
    }
    const { rows } = await fastify.pg.query(`
      UPDATE media_requests SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, user_id, title, media_type, details, status, created_at, updated_at
    `, [status, id]);
    if (!rows.length) return reply.code(404).send({ error: "Request not found" });
    return rows[0];
  });
}
