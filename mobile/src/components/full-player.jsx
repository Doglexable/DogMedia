import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetView } from "@gorhom/bottom-sheet";
import DraggableFlatList, { ScaleDecorator } from "react-native-draggable-flatlist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaStreamUrl, mediaThumbnailUrl } from "../api";
import { alpha, radii, shadow, spacing, useTheme } from "../theme";
import { formatDuration, getArtistLabel, getMediaLabel } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { LyricsView } from "./lyrics-view";
import { PlayerIconButton, PlayerTransportControls } from "./player-controls";

function VideoSurface({ mediaId, playerState, shouldPlay, styles }) {
  const player = useVideoPlayer({ uri: mediaStreamUrl(mediaId) });

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    playerState.reportVideoPlaying(isPlaying);
  });
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    playerState.reportVideoProgress(currentTime, player.duration);
  });
  useEventListener(player, "sourceLoad", ({ duration }) => {
    playerState.reportVideoProgress(player.currentTime, duration);
  });
  useEventListener(player, "playToEnd", () => {
    playerState.reportVideoEnded();
  });

  useEffect(() => {
    player.timeUpdateEventInterval = 0.5;
    return playerState.registerVideoController({
      pause: () => player.pause(),
      play: () => player.play(),
      seek: (seconds) => {
        player.currentTime = seconds;
      },
      setLoop: (enabled) => {
        player.loop = enabled;
      },
      setVolume: (nextVolume) => {
        player.volume = nextVolume;
      },
    });
  }, [player, playerState.registerVideoController]);

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

function ResumePrompt({ onResume, position, style, styles }) {
  if (position == null) return null;
  return (
    <Pressable accessibilityRole="button" onPress={onResume} style={[styles.resumePrompt, style]}>
      <Ionicons name="play-circle" size={18} color="#fff" />
      <Text style={styles.resumeText}>Resume from {formatDuration(position)}</Text>
    </Pressable>
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

function resolveCurrentIndex(items, currentIndex, currentMedia) {
  if (
    Number.isInteger(currentIndex)
    && currentIndex >= 0
    && currentIndex < items.length
    && (!currentMedia || Number(items[currentIndex]?.id) === Number(currentMedia.id))
  ) {
    return currentIndex;
  }
  return items.findIndex((item) => Number(item.id) === Number(currentMedia?.id));
}

function QueueActionButton({ accessibilityLabel, colors, disabled = false, icon, onPress, styles }) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={[styles.queueActionButton, disabled && styles.queueActionDisabled]}
    >
      <Ionicons name={icon} size={17} color={disabled ? colors.subtle : colors.muted} />
    </Pressable>
  );
}

function QueueSkeleton({ colors, styles }) {
  return (
    <View style={styles.queueSkeleton}>
      <ActivityIndicator color={colors.primary} />
      {Array.from({ length: 3 }, (_, index) => (
        <View key={index} style={styles.queueSkeletonRow}>
          <View style={styles.queueSkeletonIcon} />
          <View style={styles.queueSkeletonCopy}>
            <View style={styles.queueSkeletonTitle} />
            <View style={styles.queueSkeletonMeta} />
          </View>
        </View>
      ))}
    </View>
  );
}

function QueueItem({ active = false, colors, drag, dragging = false, draggable = false, item, onRemove, onSelect, styles }) {
  const meta = active ? "Now Playing · Locked" : `${getMediaLabel(item.mime_type)} · ${item.mime_type || "Unknown MIME type"}`;

  return (
    <View style={[styles.queueItem, active && styles.queueItemActive, dragging && styles.queueItemDragging]}>
      <View style={styles.queueIcon}>
        <Ionicons name="musical-notes" size={17} color={active ? colors.primary : colors.muted} />
      </View>
      <Pressable
        accessibilityLabel={active ? `${item.title} is now playing` : `Play ${item.title}`}
        accessibilityRole="button"
        disabled={active}
        onPress={() => onSelect(item)}
        style={styles.queueSelect}
      >
        <Text style={styles.queueItemTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.queueItemMeta} numberOfLines={1}>{meta}</Text>
      </Pressable>
      <Text style={styles.queueDuration}>{item.duration ? formatDuration(item.duration) : ""}</Text>
      {draggable && (
        <Pressable
          accessibilityLabel={`Drag ${item.title}`}
          accessibilityRole="button"
          disabled={dragging}
          hitSlop={8}
          onLongPress={drag}
          style={styles.queueDragHandle}
        >
          <Ionicons name="reorder-three" size={20} color={colors.muted} />
        </Pressable>
      )}
      <QueueActionButton accessibilityLabel={`Remove ${item.title}`} colors={colors} icon="trash" onPress={() => onRemove(item.id)} styles={styles} />
    </View>
  );
}

function QueueContent({ colors, currentMedia, error, items, loading, onClear, onMove, onRefresh, onRemove, onSelect, queueIndex, styles }) {
  const pinnedIndex = resolveCurrentIndex(items, queueIndex, currentMedia);
  const hasPinnedItem = pinnedIndex > -1;
  const pinnedItem = hasPinnedItem ? items[pinnedIndex] : null;
  const previousItems = hasPinnedItem ? items.slice(0, pinnedIndex) : [];
  const upcomingItems = hasPinnedItem ? items.slice(pinnedIndex + 1) : items;
  const displayedTotal = loading ? items.length : (hasPinnedItem ? upcomingItems.length + 1 : items.length);

  const reorderUpcomingItems = (reorderedUpcoming) => {
    const nextItems = hasPinnedItem ? [...previousItems, pinnedItem, ...reorderedUpcoming] : reorderedUpcoming;
    onMove(nextItems.map((entry) => Number(entry.id)));
  };

  const renderQueueItem = ({ drag, isActive, item }) => (
    <ScaleDecorator>
      <QueueItem
        colors={colors}
        drag={drag}
        draggable
        dragging={isActive}
        item={item}
        onRemove={onRemove}
        onSelect={onSelect}
        styles={styles}
      />
    </ScaleDecorator>
  );

  return (
    <View style={styles.queueContent}>
      <View style={styles.queueHeader}>
        <View>
          <Text style={styles.queueTitle}>Queue</Text>
          <Text style={styles.queueSubtitle}>{displayedTotal ? `${displayedTotal} item${displayedTotal === 1 ? "" : "s"} queued` : "No items queued"}</Text>
        </View>
        {items.length > 0 && (
          <Pressable accessibilityLabel="Clear queue" accessibilityRole="button" onPress={onClear} style={styles.queueClearButton}>
            <Ionicons name="trash" size={15} color={colors.text} />
            <Text style={styles.queueClearText}>Clear</Text>
          </Pressable>
        )}
      </View>

      {error && <Text style={styles.queueError}>{error}</Text>}

      {loading ? (
        <BottomSheetView style={styles.sheetScroll}>
          <QueueSkeleton colors={colors} styles={styles} />
        </BottomSheetView>
      ) : items.length > 0 ? (
        <BottomSheetView style={styles.sheetScroll}>
          <DraggableFlatList
            ListHeaderComponent={(
              <>
                {pinnedItem && (
                  <QueueItem
                    active
                    colors={colors}
                    item={pinnedItem}
                    onRemove={onRemove}
                    onSelect={onSelect}
                    styles={styles}
                  />
                )}
              </>
            )}
            ListFooterComponent={pinnedItem && upcomingItems.length === 0 ? <Text style={styles.queueEmptyNote}>No upcoming items.</Text> : null}
            activationDistance={8}
            autoscrollThreshold={56}
            containerStyle={styles.queueList}
            contentContainerStyle={styles.queueListContent}
            data={upcomingItems}
            keyExtractor={(item) => String(item.id)}
            onDragEnd={({ data }) => reorderUpcomingItems(data)}
            renderItem={renderQueueItem}
            showsVerticalScrollIndicator={false}
          />
        </BottomSheetView>
      ) : (
        <BottomSheetView style={styles.sheetScroll}>
          <Text style={styles.queueEmpty}>Queue is empty.</Text>
        </BottomSheetView>
      )}

      {!loading && items.length > 0 && (
        <Pressable accessibilityLabel="Refresh queue" accessibilityRole="button" onPress={onRefresh} style={styles.queueRefresh}>
          <Ionicons name="refresh" size={15} color={colors.primary} />
          <Text style={styles.queueRefreshText}>Refresh queue</Text>
        </Pressable>
      )}
    </View>
  );
}

function PlayerBottomSheet({
  activeTab,
  colors,
  currentMedia,
  error,
  height,
  items,
  loading,
  mediaId,
  onClear,
  onClose,
  onMove,
  onRefresh,
  onRemove,
  onSelect,
  onTabChange,
  position,
  queueIndex,
  seek,
  sheetInset,
  styles,
}) {
  const bottomSheetRef = useRef(null);
  const snapPoints = useMemo(() => [height], [height]);
  const renderBackdrop = useCallback(
    (props) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    []
  );
  const tabIconColor = (tab) => tab === activeTab ? colors.primary : colors.muted;
  const tabTextStyle = (tab) => [styles.sheetTabText, tab === activeTab && styles.sheetTabTextActive];

  useEffect(() => {
    bottomSheetRef.current?.present();
  }, []);

  const closeSheet = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      enablePanDownToClose
      handleIndicatorStyle={styles.sheetHandle}
      index={0}
      onDismiss={onClose}
      snapPoints={snapPoints}
    >
      <BottomSheetView style={styles.sheetPanel}>
        <BottomSheetView style={styles.sheetHeader}>
          <View style={styles.sheetTabs}>
            <Pressable
              accessibilityLabel="Show lyrics"
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === "lyrics" }}
              onPress={() => onTabChange("lyrics")}
              style={[styles.sheetTab, activeTab === "lyrics" && styles.sheetTabActive]}
            >
              <Ionicons name="reader" size={17} color={tabIconColor("lyrics")} />
              <Text style={tabTextStyle("lyrics")}>Lyrics</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Show queue"
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === "queue" }}
              onPress={() => onTabChange("queue")}
              style={[styles.sheetTab, activeTab === "queue" && styles.sheetTabActive]}
            >
              <Ionicons name="list" size={18} color={tabIconColor("queue")} />
              <Text style={tabTextStyle("queue")}>Queue</Text>
            </Pressable>
          </View>
          <QueueActionButton accessibilityLabel="Close player details" colors={colors} icon="close" onPress={closeSheet} styles={styles} />
        </BottomSheetView>

        <BottomSheetView style={[styles.sheetBody, { paddingBottom: sheetInset }]}>
          {activeTab === "lyrics" ? (
            <LyricsView
              contentContainerStyle={[styles.sheetLyricsContent, { paddingBottom: sheetInset + spacing.xl }]}
              mediaId={mediaId}
              onSeek={seek}
              position={position}
              scrollComponent={BottomSheetScrollView}
              style={styles.sheetLyrics}
            />
          ) : (
            <QueueContent
              colors={colors}
              currentMedia={currentMedia}
              error={error}
              items={items}
              loading={loading}
              onClear={onClear}
              onMove={onMove}
              onRefresh={onRefresh}
              onRemove={onRemove}
              onSelect={onSelect}
              queueIndex={queueIndex}
              styles={styles}
            />
          )}
        </BottomSheetView>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

export function FullPlayer({ navigation }) {
  const player = usePlayer();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [progressWidth, setProgressWidth] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState("lyrics");
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState("");
  const media = player.currentMedia;

  const closePlayer = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("Tabs", { screen: "Home" });
  };

  const refreshQueuePanel = () => {
    setQueueLoading(true);
    setQueueError("");
    return player.refreshQueue()
      .catch((error) => setQueueError(error.message || "Queue update failed"))
      .finally(() => setQueueLoading(false));
  };

  const openSheet = (tab) => {
    setSheetTab(tab);
    setSheetOpen(true);
    if (tab === "queue") refreshQueuePanel();
  };

  const changeSheetTab = (tab) => {
    setSheetTab(tab);
    if (tab === "queue") refreshQueuePanel();
  };

  const runQueueOperation = (operation, { closeOnSuccess = false } = {}) => {
    setQueueError("");
    return Promise.resolve(operation)
      .then(() => {
        if (closeOnSuccess) setSheetOpen(false);
      })
      .catch((error) => setQueueError(error.message || "Queue update failed"));
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
  const coverSize = Math.max(150, Math.min(width - spacing.lg * 5, height < 720 ? 178 : 230));
  const sheetHeight = Math.min(Math.max(height * 0.6, 330), 560);

  if (!isAudio) {
    return (
      <View style={[styles.visualShell, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
        <PlayerIconButton
          accessibilityLabel="Close player"
          icon="chevron-down"
          onPress={closePlayer}
          style={styles.visualClose}
        />
        <View style={styles.visualStage}>
          {isVideo && (
            <VideoSurface
              key={media.id}
              mediaId={media.id}
              playerState={player}
              shouldPlay={!player.paused}
              styles={styles}
            />
          )}
          {isImage && <Image source={{ uri: mediaStreamUrl(media.id) }} style={styles.image} resizeMode="contain" />}
          {isVideo && (
            <ResumePrompt
              onResume={player.applyResumePosition}
              position={player.resumePosition}
              style={styles.visualResumePrompt}
              styles={styles}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.bg} blurRadius={34} />
      <View style={styles.dim} />
      <View style={styles.header}>
        <PlayerIconButton
          accessibilityLabel="Close player"
          icon="chevron-down"
          onPress={closePlayer}
        />
      </View>

      <View style={styles.mediaZone}>
        <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={[styles.cover, { width: coverSize, height: coverSize }]} />
        <Text style={styles.album} numberOfLines={1}>{getLastFolderName(media)}</Text>
        <Text style={styles.title} numberOfLines={2}>{media.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{getArtistLabel(media.artists)}</Text>
      </View>

      <View style={styles.controlZone}>
        <ResumePrompt
          onResume={player.applyResumePosition}
          position={player.resumePosition}
          styles={styles}
        />
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
            onPress={player.toggleShuffle}
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
            accessibilityLabel="Open queue"
            active={sheetOpen && sheetTab === "queue"}
            icon="list"
            onPress={() => openSheet("queue")}
          />
          <PlayerIconButton
            accessibilityLabel="Open lyrics"
            active={sheetOpen && sheetTab === "lyrics"}
            icon="reader"
            onPress={() => openSheet("lyrics")}
          />
          <PlayerIconButton
            accessibilityLabel={muted ? "Unmute" : "Mute"}
            icon={muted ? "volume-mute" : "volume-high"}
            onPress={player.toggleMute}
          />
        </View>
      </View>

      {sheetOpen && (
        <PlayerBottomSheet
          activeTab={sheetTab}
          colors={colors}
          currentMedia={media}
          error={queueError}
          height={sheetHeight}
          items={player.queueItems}
          loading={queueLoading}
          onClear={() => runQueueOperation(player.clearQueue())}
          onClose={() => setSheetOpen(false)}
          onMove={(ids) => runQueueOperation(player.reorderQueue(ids))}
          onRefresh={refreshQueuePanel}
          onRemove={(id) => runQueueOperation(player.removeFromQueue(id))}
          onSelect={(item) => runQueueOperation(player.selectQueueItem(item), { closeOnSuccess: true })}
          onTabChange={changeSheetTab}
          mediaId={media.id}
          position={player.position}
          queueIndex={player.queueIndex}
          seek={player.seek}
          sheetInset={insets.bottom + spacing.lg}
          styles={styles}
        />
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.52,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  header: {
    minHeight: 44,
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 10,
  },
  mediaZone: {
    alignItems: "center",
    gap: spacing.xs,
  },
  cover: {
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
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
    gap: spacing.sm,
  },
  resumePrompt: {
    alignSelf: "center",
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  resumeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
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
  },
  controlZone: {
    gap: spacing.md,
  },
  sheetBackground: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  sheetPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.card,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.cardSoft,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  sheetTabs: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
  },
  sheetTab: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  sheetTabActive: {
    backgroundColor: alpha(colors.primary, 0.18),
  },
  sheetTabText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  sheetTabTextActive: {
    color: colors.primary,
  },
  sheetBody: {
    flex: 1,
    minHeight: 0,
  },
  sheetScroll: {
    flex: 1,
    minHeight: 0,
  },
  sheetLyrics: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
  },
  sheetLyricsContent: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  queueContent: {
    flex: 1,
    minHeight: 0,
  },
  queueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  queueTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  queueSubtitle: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  queueClearButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  queueClearText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  queueError: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningBg,
    color: colors.warningText,
    fontSize: 12,
    fontWeight: "800",
  },
  queueListContent: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  queueList: {
    flex: 1,
    minHeight: 0,
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  queueItemActive: {
    borderColor: colors.primary,
    backgroundColor: alpha(colors.primary, 0.14),
  },
  queueItemDragging: {
    borderColor: colors.primary,
    backgroundColor: alpha(colors.primary, 0.2),
    ...shadow.soft,
  },
  queueIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.cardSoft,
  },
  queueSelect: {
    flex: 1,
    minWidth: 0,
  },
  queueItemTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  queueItemMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  queueDuration: {
    minWidth: 38,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
  },
  queueDragHandle: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.cardSoft,
  },
  queueActionButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.cardSoft,
  },
  queueActionDisabled: {
    opacity: 0.35,
  },
  queueEmpty: {
    padding: spacing.lg,
    color: colors.muted,
    fontWeight: "800",
    textAlign: "center",
  },
  queueEmptyNote: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  queueRefresh: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  queueRefreshText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  queueSkeleton: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  queueSkeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  queueSkeletonIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.cardSoft,
  },
  queueSkeletonCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  queueSkeletonTitle: {
    width: "72%",
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.cardSoft,
  },
  queueSkeletonMeta: {
    width: "48%",
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.cardSoft,
  },
  visualShell: {
    flex: 1,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.lg,
  },
  visualClose: {
    zIndex: 10,
  },
  visualStage: {
    flex: 1,
    justifyContent: "center",
  },
  visualResumePrompt: {
    position: "absolute",
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
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
