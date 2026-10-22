export default async function (fastify) {
  fastify.get("/check-access", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      tier: request.accessTier,
      description: request.accessDescription,
      username: request.user.username,
      id: request.user.id,
      profile_picture: request.user.profile_picture || "fine",
    };
  });
}
