import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useMemo, useState } from "react";
import { MINI_PLAYER_CLEARANCE, MiniPlayer } from "../components/mini-player";
import { useOffline } from "../context/offline-context";
import { usePlayer } from "../context/player-context";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";
import { formatDuration, getArtistLabel } from "../utils/media";

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function DownloadRow({ item, onPlay, onRefreshAssets, onRemove, onRedownload, styles, colors }) {
  return (
    <Pressable onPress={() => item.status === "stale" ? onRedownload(item.mediaId) : onPlay(item)} style={styles.row}>
      <Image source={{ uri: item.thumbnailUri || mediaThumbnailUrl(item.mediaId) }} style={styles.cover} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.meta}>{getArtistLabel(item.artists)} · {formatDuration(item.duration)}</Text>
        <Text style={[styles.status, item.status !== "ready" && styles.statusWarning]}>{item.status === "ready" ? formatBytes(item.byteSize) : item.status}</Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable accessibilityLabel={`Refresh artwork and lyrics for ${item.title}`} hitSlop={8} onPress={(event) => { event.stopPropagation(); onRefreshAssets(item.mediaId); }} style={styles.iconButton}>
          <Ionicons color={colors.primary} name="cloud-download-outline" size={18} />
        </Pressable>
        <Pressable accessibilityLabel={`Remove ${item.title}`} hitSlop={8} onPress={(event) => { event.stopPropagation(); onRemove(item.mediaId); }} style={styles.iconButton}>
          <Ionicons color={colors.muted} name="trash-outline" size={19} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function JobRow({ job, onCancel, onRetry, styles, colors }) {
  const active = ["queued", "downloading"].includes(job.state);
  return (
    <View style={styles.job}>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.title}>{job.metadata.title}</Text>
        <Text style={styles.meta}>{job.state}{job.error ? ` · ${job.error}` : ""}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(job.progress * 100)}%` }]} /></View>
      </View>
      <Pressable accessibilityLabel={active ? "Cancel download" : "Retry download"} onPress={() => active ? onCancel(job.mediaId) : onRetry(job.mediaId)} style={styles.iconButton}>
        <Ionicons color={colors.primary} name={active ? "close" : "refresh"} size={20} />
      </Pressable>
    </View>
  );
}

export function DownloadsScreen({ navigation }) {
  const offline = useOffline();
  const player = usePlayer();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);
  const playable = offline.downloads.filter((item) => item.status === "ready");
  const aggregateProgress = offline.jobs.length
    ? Math.round((offline.jobs.reduce((sum, job) => sum + Number(job.progress || 0), 0) / offline.jobs.length) * 100)
    : 0;

  const refresh = () => {
    setRefreshing(true);
    offline.flushSync().finally(() => setRefreshing(false));
  };
  const play = (item) => {
    player.playOfflineMedia(playable, item.mediaId)
      .then(() => (navigation.getParent?.() || navigation).navigate("Player"))
      .catch((error) => Alert.alert("Offline playback unavailable", error.message));
  };
  const retry = (mediaId) => {
    const run = (cellularApproved = false) => offline.retryDownload(mediaId, { cellularApproved });
    if (offline.networkType === "cellular") {
      Alert.alert("Use cellular data?", "This download may use a large amount of mobile data.", [
        { text: "Cancel", style: "cancel" },
        { text: "Download", onPress: () => run(true) },
      ]);
    } else run();
  };
  const confirmRemoveAll = () => Alert.alert("Remove all downloads?", "Downloaded audio and offline metadata will be removed from this device.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove all", style: "destructive", onPress: offline.removeAll },
  ]);
  const leaseLabel = offline.leaseState.state === "valid"
    ? `Access until ${new Date(offline.leaseState.expiresAt).toLocaleDateString()}`
    : offline.leaseState.state === "locked" ? "Offline playback locked" : "Access validation required";

  return (
    <View style={styles.screen}>
      <FlatList
        data={offline.downloads}
        keyExtractor={(item) => String(item.mediaId)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing || offline.syncing} onRefresh={refresh} tintColor={colors.primary} />}
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View><Text style={styles.kicker}>On this device</Text><Text style={styles.heading}>Downloads</Text></View>
              {offline.downloads.length > 0 && <Pressable onPress={confirmRemoveAll} style={styles.removeAll}><Text style={styles.removeAllText}>Remove all</Text></Pressable>}
            </View>
            <View style={styles.storageCard}>
              <Ionicons color={colors.primary} name="phone-portrait-outline" size={22} />
              <View style={styles.rowCopy}>
                <Text style={styles.storageTitle}>{formatBytes(offline.storage.usedBytes)} downloaded</Text>
                <Text style={styles.meta}>{formatBytes(offline.storage.freeBytes)} available · {leaseLabel}</Text>
              </View>
            </View>
            {offline.jobs.length > 0 && (
              <View style={styles.jobs}>
                <Text style={styles.sectionTitle}>Download activity · {aggregateProgress}%</Text>
                {offline.jobs.map((job) => <JobRow colors={colors} job={job} key={job.mediaId} onCancel={offline.cancelDownload} onRetry={retry} styles={styles} />)}
              </View>
            )}
            <Text style={styles.sectionTitle}>Downloaded audio</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Download audio from Home to listen without a connection.</Text>}
        renderItem={({ item }) => <DownloadRow colors={colors} item={item} onPlay={play} onRefreshAssets={(id) => offline.retryAssets(id).catch((error) => Alert.alert("Refresh failed", error.message))} onRedownload={(id) => offline.downloadMedia(id).catch((error) => Alert.alert("Download failed", error.message))} onRemove={offline.removeDownload} styles={styles} />}
      />
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingTop: 58, paddingHorizontal: spacing.lg, paddingBottom: MINI_PLAYER_CLEARANCE, gap: spacing.sm },
  header: { gap: spacing.lg, marginBottom: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  kicker: { color: colors.primary, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  heading: { color: colors.text, fontSize: 36, fontWeight: "900" },
  removeAll: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: alpha(colors.danger, 0.12) },
  removeAllText: { color: colors.danger, fontWeight: "900" },
  storageCard: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.card },
  storageTitle: { color: colors.text, fontWeight: "900" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  jobs: { gap: spacing.sm },
  job: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.card },
  row: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.card },
  cover: { width: 58, height: 58, borderRadius: radii.sm, backgroundColor: colors.surface },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowActions: { flexDirection: "row", gap: spacing.xs },
  title: { color: colors.text, fontSize: 15, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  status: { color: colors.primary, fontSize: 10, fontWeight: "900", textTransform: "capitalize" },
  statusWarning: { color: colors.warningText },
  iconButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: colors.cardSoft },
  progressTrack: { height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: colors.cardSoft },
  progressFill: { height: "100%", backgroundColor: colors.primary },
  empty: { color: colors.muted, fontWeight: "800", paddingVertical: spacing.xl },
});
