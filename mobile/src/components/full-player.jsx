import { Video, ResizeMode } from "expo-av";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { mediaStreamUrl, mediaThumbnailUrl } from "../api";
import { colors, radii, shadow, spacing } from "../theme";
import { formatDuration, getArtistLabel, getMediaFolderName } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { LyricsView } from "./lyrics-view";

export function FullPlayer({ navigation }) {
  const player = usePlayer();
  const [progressWidth, setProgressWidth] = useState(1);
  const media = player.currentMedia;

  if (!media) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Choose media from Home to start playback.</Text>
      </View>
    );
  }

  const isAudio = media.mime_type?.startsWith("audio/");
  const isVideo = media.mime_type?.startsWith("video/");
  const isImage = media.mime_type?.startsWith("image/");
  const remaining = Math.max((player.duration || media.duration || 0) - player.position, 0);

  if (!isAudio) {
    return (
      <View style={styles.visualShell}>
        <Pressable style={styles.close} onPress={() => navigation.navigate("Home")}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        {isVideo && (
          <Video
            source={{ uri: mediaStreamUrl(media.id) }}
            style={styles.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={!player.paused}
          />
        )}
        {isImage && <Image source={{ uri: mediaStreamUrl(media.id) }} style={styles.image} resizeMode="contain" />}
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.bg} blurRadius={34} />
      <View style={styles.dim} />
      <Pressable style={styles.close} onPress={() => navigation.navigate("Home")}>
        <Text style={styles.closeText}>×</Text>
      </Pressable>

      <View style={styles.top}>
        <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.cover} />
        <Text style={styles.album} numberOfLines={1}>{getMediaFolderName(media)}</Text>
        <Text style={styles.title} numberOfLines={2}>{media.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{getArtistLabel(media.artists)}</Text>
      </View>

      <View style={styles.progressBlock}>
        <Pressable style={styles.progressTrack} onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)} onPress={(event) => {
          const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / Math.max(progressWidth, 1)));
          player.seek(ratio * (player.duration || media.duration || 1));
        }}>
          <View style={[styles.progressFill, { width: `${Math.min(100, ((player.position || 0) / Math.max(player.duration || media.duration || 1, 1)) * 100)}%` }]} />
        </Pressable>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatDuration(player.position)}</Text>
          <Text style={styles.time}>-{formatDuration(remaining)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => player.setShuffleEnabled((value) => !value)}><Text style={[styles.control, player.shuffleEnabled && styles.active]}>Shuffle</Text></Pressable>
        <Pressable disabled={!player.hasPrev} onPress={() => player.advance("prev")}><Text style={[styles.transport, !player.hasPrev && styles.disabled]}>Prev</Text></Pressable>
        <Pressable style={styles.play} onPress={player.togglePlayback}><Text style={styles.playText}>{player.paused ? "Play" : "Pause"}</Text></Pressable>
        <Pressable disabled={!player.hasNext} onPress={() => player.advance("next")}><Text style={[styles.transport, !player.hasNext && styles.disabled]}>Next</Text></Pressable>
        <Pressable onPress={player.toggleLoop}><Text style={[styles.control, player.loopMode !== "none" && styles.active]}>{player.loopMode === "none" ? "Repeat" : player.loopMode}</Text></Pressable>
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={() => player.toggleLike(media)}><Text style={[styles.action, player.isLiked(media.id) && styles.active]}>Favorite</Text></Pressable>
        <Pressable onPress={() => player.addToQueue(media)}><Text style={styles.action}>Queue</Text></Pressable>
        <Pressable onPress={player.toggleMute}><Text style={styles.action}>{player.muted ? "Unmute" : "Mute"}</Text></Pressable>
      </View>

      <LyricsView mediaId={media.id} position={player.position} onSeek={player.seek} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.black,
    padding: spacing.lg,
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.52,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  close: {
    position: "absolute",
    top: 52,
    left: spacing.lg,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  closeText: {
    color: colors.white,
    fontSize: 26,
    lineHeight: 28,
  },
  top: {
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 92,
  },
  cover: {
    width: 250,
    height: 250,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
    ...shadow.soft,
  },
  album: {
    color: "rgba(255,255,255,0.64)",
    fontWeight: "800",
  },
  title: {
    color: colors.white,
    textAlign: "center",
    fontSize: 27,
    lineHeight: 31,
    fontWeight: "900",
  },
  artist: {
    color: "rgba(255,255,255,0.7)",
    fontWeight: "800",
  },
  progressBlock: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.white,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "800",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  control: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    fontWeight: "900",
  },
  transport: {
    color: colors.white,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.28,
  },
  active: {
    color: colors.primary,
  },
  play: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.white,
  },
  playText: {
    color: colors.black,
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  action: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "900",
    fontSize: 12,
  },
  visualShell: {
    flex: 1,
    backgroundColor: colors.black,
    justifyContent: "center",
  },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  image: {
    width: "100%",
    height: "82%",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.muted,
    fontWeight: "900",
    textAlign: "center",
  },
});
