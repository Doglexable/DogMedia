export default async function (fastify) {
  fastify.get("/check-access", async (request) => {
    return {
      tier: request.accessTier,
      description: request.accessDescription || null,
      firstRun: request.firstRun || false,
      ip: request.clientIp || request.ip,
    };
  });
}
