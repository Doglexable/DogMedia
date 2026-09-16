import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { apiJson, mediaThumbnailUrl } from "../api";
import { CategoryChips } from "../components/category-chips";
import { MediaTypePills } from "../components/media-type-pills";
import { MediaCard } from "../components/media-card";
import { MINI_PLAYER_CLEARANCE, MiniPlayer } from "../components/mini-player";
import { usePlayerLibrary } from "../context/player-context";
import { useOffline } from "../context/offline-context";
import { radii, spacing, useTheme } from "../theme";
import { resolveMediaArtist } from "../utils/media";
import { getPlaybackErrorPresentation } from "../utils/playback-errors";

function orderMediaByIds(ids = [], byId, fallbackItems, limit = 12) {
  const seen = new Set();
  const ordered = [];

  for (const id of ids) {
    const item = byId.get(Number(id));
    if (!item || seen.has(Number(item.id))) continue;
    seen.add(Number(item.id));
    ordered.push(item);
    if (ordered.length >= limit) return ordered;
  }

  for (const item of fallbackItems) {
    if (!item || seen.has(Number(item.id))) continue;
    seen.add(Number(item.id));
    ordered.push(item);
    if (ordered.length >= limit) return ordered;
  }

  return ordered;
}

function Featured({ colors, item, onPlay, styles }) {
  if (!item) return null;
  const description = item.description?.trim();

  return (
    <Pressable
      accessibilityLabel="Play featured media"
      accessibilityRole="button"
      style={styles.featured}
      onPress={() => onPlay(item)}
    >
      <View style={styles.featuredCopy}>
        <Text style={styles.featuredLabel}>Featured</Text>
        <Text style={styles.featuredTitle} numberOfLines={3}>{item.title}</Text>
        {description && <Text style={styles.featuredDescription} numberOfLines={3}>{description}</Text>}
        <View style={styles.featuredAction}>
          <Ionicons name="play" size={20} color={colors.white} />
        </View>
      </View>
      <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: mediaThumbnailUrl(item.id) }} style={styles.featuredImage} />
    </Pressable>
  );
}

export function DashboardScreen({ navigation }) {
  const player = usePlayerLibrary();
  const offline = useOffline();
  const { colors, shadow } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isCompact = windowWidth < 380;
  const styles = useMemo(() => makeStyles(colors, shadow, isCompact), [colors, shadow, isCompact]);
  const [categories, setCategories] = useState([]);
  const [media, setMedia] = useState([]);
  const [mediaType, setMediaType] = useState("all");
  const [summary, setSummary] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState("");
  const browseGenerationRef = useRef(0);

  const loadCategories = useCallback(() => {
    apiJson("/api/categories")
      .then((items) => setCategories(items.filter((category) => Number(category.media_count) > 0)))
      .catch(() => setCategories([]));
  }, []);

  const loadMedia = useCallback((signal) => {
    const generation = browseGenerationRef.current + 1;
    browseGenerationRef.current = generation;
    const params = new URLSearchParams({ limit: "50", view: "all" });
    if (selectedCategory) params.set("category_id", selectedCategory);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (mediaType && mediaType !== "all") params.set("type", mediaType);
    setMedia([]);
    setNextCursor(null);
    return apiJson(`/api/media/browse?${params.toString()}`, { signal })
      .then((data) => {
        if (browseGenerationRef.current !== generation) return;
        setMedia(Array.isArray(data.items) ? data.items : []);
        setNextCursor(data.nextCursor || null);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (browseGenerationRef.current !== generation) return;
        setMedia([]);
        setNotice("Could not load media.");
      });
  }, [debouncedSearch, mediaType, selectedCategory]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const generation = browseGenerationRef.current;
    const params = new URLSearchParams({ limit: "50", view: "all", cursor: nextCursor });
    if (selectedCategory) params.set("category_id", selectedCategory);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (mediaType && mediaType !== "all") params.set("type", mediaType);
    setLoadingMore(true);
    apiJson(`/api/media/browse?${params.toString()}`)
      .then((data) => {
        if (browseGenerationRef.current !== generation) return;
        setMedia((current) => {
          const seen = new Set(current.map((item) => Number(item.id)));
          return [...current, ...(data.items || []).filter((item) => !seen.has(Number(item.id)))];
        });
        setNextCursor(data.nextCursor || null);
      })
      .catch(() => { if (browseGenerationRef.current === generation) setNotice("Could not load more media."); })
      .finally(() => { if (browseGenerationRef.current === generation) setLoadingMore(false); });
  }, [debouncedSearch, loadingMore, mediaType, nextCursor, selectedCategory]);

  const loadSummary = useCallback(() => {
    const params = new URLSearchParams({ view: "all" });
    if (selectedCategory) params.set("category_id", selectedCategory);
    if (mediaType && mediaType !== "all") params.set("type", mediaType);
    apiJson(`/api/playback/dashboard?${params.toString()}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [mediaType, selectedCategory]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    loadMedia(controller.signal);
    loadSummary();
    return () => controller.abort();
  }, [loadMedia, loadSummary]);

  const visibleMedia = media;

  const byId = useMemo(() => {
    const result = new Map(visibleMedia.map((item) => [Number(item.id), item]));
    for (const item of summary?.media || []) if (!result.has(Number(item.id))) result.set(Number(item.id), item);
    return result;
  }, [summary, visibleMedia]);
  const featured = byId.get(Number(summary?.featuredId)) || visibleMedia[0] || null;
  const recentlyPlayedIds = summary?.rows?.find((row) => row.key === "recently-played")?.mediaIds;
  const quickAccess = orderMediaByIds(recentlyPlayedIds || summary?.quickAccessIds, byId, visibleMedia, 8);

  const play = (item) => {
    player.playMedia(item, selectedCategory)
      .then(() => (navigation.getParent?.() || navigation).navigate("Player"))
      .catch((error) => {
        const presentation = getPlaybackErrorPresentation(error);
        Alert.alert(
          presentation.title,
          presentation.message,
          [{
            text: presentation.actionLabel,
            onPress: presentation.route ? () => navigation.navigate(presentation.route) : undefined,
          }],
          presentation.route ? { cancelable: false } : undefined
        );
      });
  };

  const toggleLike = (item) => player.toggleLike(item).catch(() => setNotice("Could not update favorites."));
  const downloadFolder = (cellularApproved = false) => offline.downloadCategory(selectedCategory, { cellularApproved })
    .then((count) => setNotice(count ? `${count} audio download${count === 1 ? "" : "s"} queued.` : "No audio found in this folder."))
    .catch((error) => setNotice(error.message || "Could not download this folder."));
  const confirmFolderDownload = () => {
    if (offline.networkType !== "cellular") return downloadFolder();
    Alert.alert("Use cellular data?", "Download this folder using mobile data?", [
      { text: "Cancel", style: "cancel" },
      { text: "Download", onPress: () => downloadFolder(true) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={visibleMedia}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.browseRow}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        renderItem={({ item }) => (
          <View style={styles.browseCard}>
            <MediaCard
              compact
              item={item}
              liked={player.isLiked(item.id)}
              onPress={play}
              onPlayNext={player.playNext}
              onQueue={player.addToQueue}
              onToggleLike={toggleLike}
            />
          </View>
        )}
        ListHeaderComponent={<>
        <View style={styles.header}>
          <Text style={styles.kicker}>DogMedia</Text>
          <Text style={styles.heading}>Private library</Text>
          <Text style={styles.subhead}>{visibleMedia.length}{nextCursor ? "+" : ""} item{visibleMedia.length === 1 ? "" : "s"} ready</Text>
        </View>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search media..."
          placeholderTextColor={colors.subtle}
          style={styles.search}
        />

        <MediaTypePills value={mediaType} onChange={setMediaType} />

        {categories.length > 0 && (
          <CategoryChips categories={categories} selectedId={selectedCategory} onSelect={setSelectedCategory} />
        )}

        {selectedCategory && (
          <Pressable accessibilityRole="button" onPress={confirmFolderDownload} style={styles.downloadFolder}>
            <Ionicons color={colors.primary} name="download-outline" size={19} />
            <Text style={styles.downloadFolderText}>Download this folder</Text>
          </Pressable>
        )}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        {!debouncedSearch && <View style={styles.quickHeader}>
          <Text style={styles.sectionTitle}>Quick access</Text>
          {featured && <Text style={styles.quickMeta}>{resolveMediaArtist(featured, "Featured")}</Text>}
        </View>}
        {!debouncedSearch && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {quickAccess.map((item) => (
            <MediaCard
              compact
              key={`quick-${item.id}`}
              item={item}
              liked={player.isLiked(item.id)}
              onPress={play}
              onPlayNext={player.playNext}
              onQueue={player.addToQueue}
              onToggleLike={toggleLike}
            />
          ))}
        </ScrollView>}

        {!debouncedSearch && <Featured colors={colors} item={featured} onPlay={play} styles={styles} />}
        {visibleMedia.length > 0 && <Text style={styles.sectionTitle}>Browse</Text>}
        </>}
        ListFooterComponent={loadingMore ? <Text style={styles.loadingMore}>Loading more media…</Text> : null}
      />
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors, shadow, isCompact) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingTop: 58,
    paddingHorizontal: spacing.lg,
    paddingBottom: MINI_PLAYER_CLEARANCE,
    gap: spacing.lg,
  },
  browseRow: {
    gap: spacing.md,
  },
  browseCard: {
    flex: 1,
    marginBottom: spacing.md,
  },
  loadingMore: {
    paddingVertical: spacing.lg,
    color: colors.muted,
    textAlign: "center",
    fontWeight: "800",
  },
  header: {
    gap: spacing.xs,
  },
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heading: {
    color: colors.text,
    fontSize: isCompact ? 28 : 38,
    lineHeight: isCompact ? 32 : 40,
    fontWeight: "900",
  },
  subhead: {
    color: colors.muted,
    fontWeight: "800",
  },
  search: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    color: colors.text,
    fontWeight: "800",
  },
  notice: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warningBg,
    color: colors.warningText,
    fontWeight: "800",
  },
  downloadFolder: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  downloadFolderText: {
    color: colors.primary,
    fontWeight: "900",
  },
  featured: {
    flexDirection: "row",
    alignItems: "center",
    gap: isCompact ? spacing.md : spacing.lg,
    minHeight: isCompact ? 180 : 220,
    padding: isCompact ? spacing.md : spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    ...shadow.soft,
  },
  featuredCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  featuredLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  featuredTitle: {
    color: colors.text,
    fontSize: isCompact ? 22 : 30,
    lineHeight: isCompact ? 26 : 31,
    fontWeight: "900",
  },
  featuredDescription: {
    color: colors.muted,
    fontSize: isCompact ? 12 : 13,
    lineHeight: isCompact ? 16 : 18,
    fontWeight: "700",
  },
  featuredAction: {
    width: 42,
    height: 42,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    overflow: "hidden",
    borderRadius: 21,
    backgroundColor: colors.primary,
  },
  featuredImage: {
    width: isCompact ? 96 : 118,
    height: isCompact ? 96 : 118,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  quickHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  quickMeta: {
    color: colors.subtle,
    fontSize: 12,
    fontWeight: "800",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  row: {
    gap: spacing.md,
    paddingRight: spacing.xl,
  },
});
