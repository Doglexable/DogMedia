const ACCESSIBLE_CATEGORY_TREE_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT
      c.id,
      c.parent_id,
      c.min_access_tier
    FROM categories c
    WHERE c.parent_id IS NULL
      AND c.min_access_tier <= $1
    UNION ALL
    SELECT
      c.id,
      c.parent_id,
      c.min_access_tier
    FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  )
`;

function queueKeys(request) {
  const ip = request.clientIp || request.ip;
  return {
    key: `queue:${ip}`,
    idxKey: `queue:index:${ip}`,
  };
}

function normalizeStartId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = value.map(normalizeStartId);
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) return null;
  return ids;
}

async function accessibleMediaIds(fastify, accessTier, ids) {
  if (ids.length === 0) return [];
  const { rows } = await fastify.pg.query(
    `${ACCESSIBLE_CATEGORY_TREE_SQL}
     SELECT m.id FROM media_assets m
     JOIN accessible_categories ac ON ac.id = m.category_id
     WHERE m.id = ANY($2::int[])`,
    [accessTier, ids]
  );
  return rows.map((row) => Number(row.id));
}

async function readQueueState(redis, key, idxKey) {
  const [storedQueue, storedIndex] = await Promise.all([
    redis.lrange(key, 0, -1),
    redis.get(idxKey),
  ]);
  const queue = (storedQueue || []).map(Number);
  const parsedIndex = Number.parseInt(storedIndex || "0", 10);
  const currentIndex = queue.length === 0
    ? 0
    : Math.min(Math.max(Number.isInteger(parsedIndex) ? parsedIndex : 0, 0), queue.length - 1);
  return { queue, currentIndex, currentMediaId: queue[currentIndex] ?? null };
}

function mutationResult(queue, currentIndex, activeRemoved = false) {
  return { queue, currentIndex, activeRemoved };
}

async function replaceQueue(redis, key, idxKey, ids, startId) {
  const startIndex = Math.max(startId === null ? 0 : ids.indexOf(startId), 0);
  const multi = redis.multi();
  multi.del(key);
  multi.del(idxKey);

  if (ids.length > 0) {
    multi.rpush(key, ...ids);
    multi.set(idxKey, startIndex);
  }

  await multi.exec();
  return startIndex;
}

function shuffled(ids) {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export default async function (fastify) {
  fastify.post("/items/next", async (request, reply) => {
    const mediaId = normalizeStartId(request.body?.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "mediaId is required" });

    const accessible = await accessibleMediaIds(fastify, request.accessTier, [mediaId]);
    if (accessible.length === 0) return reply.code(404).send({ error: "Media not found" });

    const { key, idxKey } = queueKeys(request);
    const state = await readQueueState(fastify.redis, key, idxKey);
    if (state.currentMediaId === mediaId) {
      return mutationResult(state.queue, state.currentIndex);
    }

    const nextQueue = state.queue.filter((id) => id !== mediaId);
    const currentIndex = state.currentMediaId === null
      ? -1
      : nextQueue.indexOf(state.currentMediaId);
    nextQueue.splice(currentIndex + 1, 0, mediaId);

    const nextIndex = await replaceQueue(
      fastify.redis,
      key,
      idxKey,
      nextQueue,
      state.currentMediaId
    );
    return mutationResult(nextQueue, nextIndex);
  });

  fastify.post("/items", async (request, reply) => {
    const mediaId = normalizeStartId(request.body?.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "mediaId is required" });

    const accessible = await accessibleMediaIds(fastify, request.accessTier, [mediaId]);
    if (accessible.length === 0) return reply.code(404).send({ error: "Media not found" });

    const { key, idxKey } = queueKeys(request);
    const queue = await fastify.redis.eval(
      `local items = redis.call('LRANGE', KEYS[1], 0, -1)
       for _, item in ipairs(items) do
         if item == ARGV[1] then return items end
       end
       redis.call('RPUSH', KEYS[1], ARGV[1])
       if #items == 0 then redis.call('SET', KEYS[2], 0) end
       table.insert(items, ARGV[1])
       return items`,
      2,
      key,
      idxKey,
      String(mediaId)
    );
    const storedIndex = Number.parseInt((await fastify.redis.get(idxKey)) || "0", 10);
    return mutationResult(queue.map(Number), Number.isInteger(storedIndex) ? storedIndex : 0);
  });

  fastify.put("/order", async (request, reply) => {
    const mediaIds = normalizeIds(request.body?.mediaIds);
    if (mediaIds === null) {
      return reply.code(400).send({ error: "mediaIds must be a unique array of IDs" });
    }

    const { key, idxKey } = queueKeys(request);
    const state = await readQueueState(fastify.redis, key, idxKey);
    const sameMembers = mediaIds.length === state.queue.length
      && mediaIds.every((id) => state.queue.includes(id));
    if (!sameMembers) return reply.code(409).send({ error: "Queue changed; refresh and try again" });

    const accessible = await accessibleMediaIds(fastify, request.accessTier, mediaIds);
    if (accessible.length !== mediaIds.length) {
      return reply.code(403).send({ error: "Queue contains inaccessible media" });
    }

    const nextIndex = state.currentMediaId === null ? 0 : mediaIds.indexOf(state.currentMediaId);
    await replaceQueue(fastify.redis, key, idxKey, mediaIds, state.currentMediaId);
    return mutationResult(mediaIds, Math.max(nextIndex, 0));
  });

  fastify.delete("/items/:mediaId", async (request, reply) => {
    const mediaId = normalizeStartId(request.params.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "Invalid media ID" });

    const { key, idxKey } = queueKeys(request);
    const state = await readQueueState(fastify.redis, key, idxKey);
    const removeIndex = state.queue.indexOf(mediaId);
    if (removeIndex < 0) return mutationResult(state.queue, state.currentIndex);

    const activeRemoved = state.currentMediaId === mediaId;
    const nextQueue = state.queue.filter((id) => id !== mediaId);
    let nextIndex = state.currentIndex;
    if (removeIndex < state.currentIndex) nextIndex -= 1;
    nextIndex = nextQueue.length === 0 ? 0 : Math.min(Math.max(nextIndex, 0), nextQueue.length - 1);

    const multi = fastify.redis.multi();
    multi.del(key);
    multi.del(idxKey);
    if (nextQueue.length > 0) {
      multi.rpush(key, ...nextQueue);
      multi.set(idxKey, nextIndex);
    }
    await multi.exec();
    return mutationResult(nextQueue, nextIndex, activeRemoved);
  });

  fastify.delete("/", async (request) => {
    const { key, idxKey } = queueKeys(request);
    const state = await readQueueState(fastify.redis, key, idxKey);
    await fastify.redis.del(key, idxKey);
    return mutationResult([], 0, state.currentMediaId !== null);
  });

  fastify.post("/auto/:categoryId", async (request, reply) => {
    const { categoryId } = request.params;
    const startId = normalizeStartId(request.query.start);

    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       , selected_categories AS (
         SELECT id FROM accessible_categories WHERE id = $2
         UNION ALL
         SELECT c.id
         FROM categories c
         JOIN selected_categories sc ON c.parent_id = sc.id
         JOIN accessible_categories ac ON ac.id = c.id
       )
       SELECT m.id FROM media_assets m
       JOIN selected_categories sc ON sc.id = m.category_id
       ORDER BY m.title, m.id`,
      [request.accessTier, categoryId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: "No media in this category" });
    }

    const ids = rows.map((r) => r.id);
    const { key, idxKey } = queueKeys(request);
    const currentIndex = await replaceQueue(fastify.redis, key, idxKey, ids, startId);

    return { queue: ids, currentIndex };
  });

  fastify.post("/auto", async (request, reply) => {
    const startId = normalizeStartId(request.query.start);
    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       SELECT m.id FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       ORDER BY m.title, m.id`,
      [request.accessTier]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: "No media available" });
    }

    const ids = rows.map((r) => r.id);
    const { key, idxKey } = queueKeys(request);
    const currentIndex = await replaceQueue(fastify.redis, key, idxKey, ids, startId);

    return { queue: ids, currentIndex };
  });

  fastify.post("/next", async (request, reply) => {
    const { key, idxKey } = queueKeys(request);

    const len = await fastify.redis.llen(key);
    if (len === 0) return { mediaId: null };

    let idx = parseInt((await fastify.redis.get(idxKey)) || "0", 10);
    if (!Number.isInteger(idx) || idx < 0) idx = 0;
    idx = Math.min(idx + 1, len - 1);
    await fastify.redis.set(idxKey, idx);

    const mediaId = await fastify.redis.lindex(key, idx);
    return { mediaId: mediaId ? parseInt(mediaId, 10) : null };
  });

  fastify.post("/prev", async (request, reply) => {
    const { key, idxKey } = queueKeys(request);

    let idx = parseInt((await fastify.redis.get(idxKey)) || "0", 10);
    if (!Number.isInteger(idx) || idx < 0) idx = 0;
    if (idx <= 0) return { mediaId: null };

    idx -= 1;
    await fastify.redis.set(idxKey, idx);

    const mediaId = await fastify.redis.lindex(key, idx);
    return { mediaId: mediaId ? parseInt(mediaId, 10) : null };
  });

  fastify.post("/select", async (request, reply) => {
    const selectedId = normalizeStartId(request.body?.mediaId);
    if (selectedId === null) return reply.code(400).send({ error: "mediaId is required" });

    const { key, idxKey } = queueKeys(request);
    const queue = (await fastify.redis.lrange(key, 0, -1)).map(Number);
    const idx = queue.indexOf(selectedId);

    if (idx < 0) {
      return reply.code(404).send({ error: "Media is not in the current queue" });
    }

    await fastify.redis.set(idxKey, idx);
    return { mediaId: selectedId, currentIndex: idx, queue };
  });

  fastify.post("/shuffle", async (request) => {
    const { key, idxKey } = queueKeys(request);
    const [storedQueue, storedIndex] = await Promise.all([
      fastify.redis.lrange(key, 0, -1),
      fastify.redis.get(idxKey),
    ]);
    const queue = (storedQueue || []).map(Number);

    if (queue.length <= 1) {
      return { queue, currentIndex: 0 };
    }

    const parsedIndex = Number.parseInt(storedIndex || "0", 10);
    const currentIndex = Number.isInteger(parsedIndex)
      ? Math.min(Math.max(parsedIndex, 0), queue.length - 1)
      : 0;
    const currentMediaId = queue[currentIndex];
    const nextQueue = [
      currentMediaId,
      ...shuffled(queue.filter((_, index) => index !== currentIndex)),
    ];

    await replaceQueue(fastify.redis, key, idxKey, nextQueue, currentMediaId);
    return { queue: nextQueue, currentIndex: 0 };
  });

  fastify.get("/", async (request) => {
    const { key, idxKey } = queueKeys(request);
    const state = await readQueueState(fastify.redis, key, idxKey);
    return { queue: state.queue, currentIndex: state.currentIndex };
  });
}
