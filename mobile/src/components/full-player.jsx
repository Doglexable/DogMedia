import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { mediaStreamUrl, mediaThumbnailUrl } from "../api";
import { colors, radii, shadow, spacing } from "../theme";
import { formatDuration, getArtistLabel } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { LyricsView } from "./lyrics-view";
import { PlayerIconButton, PlayerTransportControls } from "./player-controls";

function VideoSurface({ mediaId, shouldPlay }) {
  const player = useVideoPlayer({ uri: mediaStreamUrl(mediaId) }, (videoPlayer) => {
    videoPlayer.play();
  });

  useEffect(() => {
    if (shouldPlay) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, shouldPlay]);

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
    />
  );
}

function getLoopIcon(loopMode) {
  if (loopMode === "queue") return "sync";
  return loopMode === "media" ? "repeat-outline" : "repeat";
}

function getLastFolderName(media) {
  const folder = media?.category_path || media?.category_name;
  const parts = String(folder || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) || "Library";
}

export function FullPlayer({ navigation }) {
  const player = usePlayer();
  const [progressWidth, setProgressWidth] = useState(1);
  const media = player.currentMedia;

  const closePlayer = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Tabs", { screen: "Home" });
  };

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
  const isLiked = player.isLiked(media.id);
  const muted = player.muted || player.volume <= 0;

  if (!isAudio) {
    return (
      <View style={styles.visualShell}>
        <PlayerIconButton
          accessibilityLabel="Close player"
          icon="chevron-down"
          onPress={closePlayer}
          style={styles.close}
        />
        {isVideo && (
          <VideoSurface key={media.id} mediaId={media.id} shouldPlay={!player.paused} />
        )}
        {isImage && <Image source={{ uri: mediaStreamUrl(media.id) }} style={styles.image} resizeMode="contain" />}
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.bg} blurRadius={34} />
      <View style={styles.dim} />
      <PlayerIconButton
        accessibilityLabel="Close player"
        icon="chevron-down"
        onPress={closePlayer}
        style={styles.close}
      />

      <View style={styles.top}>
        <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.cover} />
        <Text style={styles.album} numberOfLines={1}>{getLastFolderName(media)}</Text>
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
        <PlayerIconButton
          accessibilityLabel={player.shuffleEnabled ? "Disable shuffle" : "Enable shuffle"}
          active={player.shuffleEnabled}
          icon="shuffle"
          onPress={() => player.setShuffleEnabled((value) => !value)}
        />
        <PlayerTransportControls
          player={player}
          playButtonStyle={styles.play}
          playIconColor={colors.black}
          playIconSize={30}
          style={styles.transportControls}
          transportIconSize={24}
        />
        <PlayerIconButton
          accessibilityLabel={player.loopMode === "none" ? "Enable repeat" : `Repeat ${player.loopMode} enabled`}
          active={player.loopMode !== "none"}
          icon={getLoopIcon(player.loopMode)}
          onPress={player.toggleLoop}
        />
      </View>

      <View style={styles.actionRow}>
        <PlayerIconButton
          accessibilityLabel={isLiked ? "Remove from favorites" : "Add to favorites"}
          active={isLiked}
          icon={isLiked ? "bookmark" : "bookmark-outline"}
          onPress={() => player.toggleLike(media)}
        />
        <PlayerIconButton
          accessibilityLabel="Add to queue"
          icon="list"
          onPress={() => player.addToQueue(media)}
        />
        <PlayerIconButton
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          icon={muted ? "volume-mute" : "volume-high"}
          onPress={player.toggleMute}
        />
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
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  play: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.white,
  },
  transportControls: {
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
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
