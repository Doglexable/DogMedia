export const MUSIC_REEL_STREAM = "music:reel-render";
export const MUSIC_REEL_GROUP = "music-reel-renderers";

export async function enqueueMusicReel(redis, reelId) {
  await redis.xadd(MUSIC_REEL_STREAM, "*", "reelId", String(reelId));
}
