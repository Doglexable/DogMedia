export const RESUME_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.PLAYBACK_RESUME_TTL_SECONDS || "900", 10) || 900
);

const resumeKey = (clientIp, mediaId) => `playback:resume:${clientIp}:${mediaId}`;

export async function readResumePosition(redis, clientIp, mediaId, log) {
  const key = resumeKey(clientIp, mediaId);
  const raw = await redis.get(key);
  if (!raw) return { position: null };
  try { return JSON.parse(raw); }
  catch {
    log?.warn({ key }, "corrupted resume entry in Redis, treating as cache miss");
    return { position: null };
  }
}

export async function saveResumePosition(redis, clientIp, mediaId, position = 0, duration = 0) {
  const resume = {
    position: Math.floor(position || 0),
    duration: Math.floor(duration || 0),
    timestamp: new Date().toISOString(),
  };
  const key = resumeKey(clientIp, mediaId);
  if (resume.duration && resume.position >= resume.duration - 3) {
    await redis.del(key);
  } else {
    await redis.set(key, JSON.stringify(resume), "EX", RESUME_TTL_SECONDS);
  }
  return { ok: true };
}
