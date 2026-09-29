import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { apiJson, mediaThumbnailUrl } from "../api";
import { MediaTypePills } from "../components/media-type-pills";
import { MediaCard } from "../components/media-card";
import { QuickAccessGrid } from "../components/quick-access-grid";
import { MINI_PLAYER_CLEARANCE, MiniPlayer } from "../components/mini-player";
import { usePlayerLibrary } from "../context/player-context";
import { alpha, radii, spacing, useTheme } from "../theme";
import { getPlaybackErrorPresentation } from "../utils/playback-errors";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

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
      onPress={() => onPlay(item)}
      style={styles.featured}
    >
      <View style={styles.featuredCopy}>
        <Text style={styles.featuredLabel}>Featured</Text>
        <Text numberOfLines={2} style={styles.featuredTitle}>{item.title}</Text>
        {description && <Text numberOfLines={2} style={styles.featuredDescription}>{description}</Text>}
        <View style={styles.featuredAction}>
          <Ionicons color={colors.white} name="play" size={20} />
        </View>
      </View>
      <Image
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: mediaThumbnailUrl(item.id) }}
        style={styles.featuredImage}
      />
    </Pressable>
  );
}

function BrowseSkeleton({ count = 6, styles }) {
  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: count }, (_, index) => (
        <View key={`skeleton-${index}`} style={styles.skeletonRow}>
          <View style={styles.skeletonIndex} />
          <View style={styles.skeletonCover} />
          <View style={styles.skeletonCopy}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonMeta} />
          </View>
          <View style={styles.skeletonTime} />
        </View>
      ))}
    </View>
  );
}

export function DashboardScreen({ navigation }) {
  const player = usePlayerLibrary();
  const { colors, shadow } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isCompact = windowWidth < 380;
  const styles = useMemo(() => makeStyles(colors, shadow, isCompact), [colors, shadow, isCompact]);
  const [media, setMedia] = useState([]);
  const [mediaType, setMediaType] = useState("all");
  const [summary, setSummary] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState("");
  const browseGenerationRef = useRef(0);

  const greeting = useMemo(() => getGreeting(), []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const loadMedia = useCallback((signal) => {
    const generation = browseGenerationRef.current + 1;
    browseGenerationRef.current = generation;
    const params = new URLSearchParams({ limit: "50", view: "all" });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (mediaType && mediaType !== "all") params.set("type", mediaType);
    setMediaLoading(true);
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
      })
      .finally(() => {
        if (browseGenerationRef.current === generation) {
          setMediaLoading(false);
        }
      });
  }, [debouncedSearch, mediaType]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const generation = browseGenerationRef.current;
    const params = new URLSearchParams({ limit: "50", view: "all", cursor: nextCursor });
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
  }, [debouncedSearch, loadingMore, mediaType, nextCursor]);

  const loadSummary = useCallback(() => {
    const params = new URLSearchParams({ view: "all" });
    if (mediaType && mediaType !== "all") params.set("type", mediaType);
    apiJson(`/api/playback/dashboard?${params.toString()}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [mediaType]);

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
  const recentlyPlayed = orderMediaByIds(recentlyPlayedIds, byId, visibleMedia, 10);

  const play = (item) => {
    player.playMedia(item)
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

  const currentMediaId = player.currentMedia?.id;
  const isPaused = player.paused;

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={visibleMedia}
        initialNumToRender={8}
        keyExtractor={(item) => String(item.id)}
        maxToRenderPerBatch={8}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
        windowSize={7}
        renderItem={({ index, item }) => (
          <View style={styles.browseRowCard}>
            <MediaCard
              compact={false}
              index={index + 1}
              isCurrent={Number(currentMediaId) === Number(item.id)}
              isPaused={isPaused}
              item={item}
              layout="row"
              liked={player.isLiked(item.id)}
              onPlayNext={player.playNext}
              onPress={play}
              onQueue={player.addToQueue}
              onToggleLike={toggleLike}
            />
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.headerContainer}>
            {/* Spotify-style Header Top Group (Greeting, Search, Pills) */}
            <View style={styles.headerTop}>
              <View style={styles.header}>
                <View style={styles.greetingRow}>
                  <Text style={styles.greeting}>{greeting}</Text>
                  <Text style={styles.kicker}>Dogmedia</Text>
                </View>
                <Text style={styles.subhead}>
                  {visibleMedia.length}{nextCursor ? "+" : ""} item{visibleMedia.length === 1 ? "" : "s"} ready
                </Text>
              </View>

              {/* Spotify Search Bar */}
              <View style={styles.searchWrapper}>
                <Ionicons color={colors.muted} name="search" size={18} style={styles.searchIcon} />
                <TextInput
                  onChangeText={setSearch}
                  placeholder="Search tracks, artists, media..."
                  placeholderTextColor={colors.subtle}
                  style={styles.search}
                  value={search}
                />
                {search.length > 0 && (
                  <Pressable
                    accessibilityLabel="Clear search"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setSearch("")}
                    style={styles.clearSearch}
                  >
                    <Ionicons color={colors.muted} name="close-circle" size={18} />
                  </Pressable>
                )}
              </View>

              {/* Category Filter Pills */}
              <MediaTypePills onChange={setMediaType} value={mediaType} />
            </View>

            {/* Auto-dismissing Banner Notice */}
            {notice ? (
              <View style={styles.noticeContainer}>
                <Text style={styles.noticeText}>{notice}</Text>
                <Pressable hitSlop={8} onPress={() => setNotice("")}>
                  <Ionicons color={colors.warningText} name="close" size={16} />
                </Pressable>
              </View>
            ) : null}

            {/* Spotify 2-Column Quick Access Grid */}
            {!debouncedSearch && quickAccess.length > 0 && (
              <View style={styles.section}>
                <QuickAccessGrid
                  currentMediaId={currentMediaId}
                  isPaused={isPaused}
                  items={quickAccess}
                  onPlay={play}
                />
              </View>
            )}

            {/* Recently Played Horizontal Carousel */}
            {!debouncedSearch && recentlyPlayed.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recently played</Text>
                <ScrollView
                  contentContainerStyle={styles.horizontalCarousel}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.carouselScrollView}
                >
                  {recentlyPlayed.map((item) => (
                    <MediaCard
                      compact
                      isCurrent={Number(currentMediaId) === Number(item.id)}
                      isPaused={isPaused}
                      key={`recent-${item.id}`}
                      item={item}
                      liked={player.isLiked(item.id)}
                      onPlayNext={player.playNext}
                      onPress={play}
                      onQueue={player.addToQueue}
                      onToggleLike={toggleLike}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Featured Spotlight Card */}
            {!debouncedSearch && featured && (
              <Featured colors={colors} item={featured} onPlay={play} styles={styles} />
            )}

            {/* Browse Section Header & Track List Header */}
            {visibleMedia.length > 0 && (
              <View style={styles.browseSectionHeader}>
                <View style={styles.browseHeader}>
                  <Text style={styles.sectionTitle}>
                    {debouncedSearch ? `Search results (${visibleMedia.length})` : "Browse"}
                  </Text>
                </View>

                {/* Web-aligned Track List Column Header */}
                <View style={styles.trackListHeader}>
                  <Text style={styles.trackListColIndex}>#</Text>
                  <Text style={styles.trackListColTitle}>TITLE</Text>
                  <Ionicons color={colors.muted} name="time-outline" size={14} style={styles.trackListColDuration} />
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          mediaLoading ? (
            <BrowseSkeleton count={6} styles={styles} />
          ) : debouncedSearch ? (
            <View style={styles.emptyContainer}>
              <Ionicons color={colors.subtle} name="search-outline" size={44} />
              <Text style={styles.emptyTitle}>No media matches “{search.trim()}”</Text>
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                onPress={() => setSearch("")}
                style={styles.clearSearchButton}
              >
                <Text style={styles.clearSearchButtonText}>Clear search</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons color={colors.subtle} name="folder-open-outline" size={44} />
              <Text style={styles.emptyTitle}>
                {mediaType !== "all"
                  ? `No ${mediaType === "audio" ? "music" : mediaType} items found.`
                  : "No media yet in this category."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={loadingMore ? <Text style={styles.loadingMore}>Loading more media…</Text> : null}
      />
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors, shadow, isCompact) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    content: {
      paddingTop: 54,
      paddingHorizontal: spacing.lg,
      paddingBottom: MINI_PLAYER_CLEARANCE,
    },
    headerContainer: {
      gap: spacing.xl,
    },
    headerTop: {
      gap: spacing.md,
    },
    header: {
      gap: spacing.xs,
    },
    greetingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    greeting: {
      color: colors.text,
      fontSize: isCompact ? 24 : 28,
      fontWeight: "900",
      letterSpacing: -0.4,
    },
    kicker: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    subhead: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: "700",
    },
    searchWrapper: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radii.full,
      backgroundColor: colors.cardSoft,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.md,
      minHeight: 46,
    },
    searchIcon: {
      marginRight: spacing.sm,
    },
    search: {
      flex: 1,
      height: 46,
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },
    clearSearch: {
      padding: spacing.xs,
    },
    noticeContainer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.warningBg,
    },
    noticeText: {
      flex: 1,
      color: colors.warningText,
      fontWeight: "800",
      fontSize: 13,
      marginRight: spacing.sm,
    },
    section: {
      gap: spacing.md,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    carouselScrollView: {
      marginHorizontal: -spacing.lg,
    },
    horizontalCarousel: {
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
    },
    featured: {
      flexDirection: "row",
      alignItems: "center",
      gap: isCompact ? spacing.md : spacing.lg,
      minHeight: isCompact ? 160 : 190,
      padding: isCompact ? spacing.md : spacing.lg,
      borderRadius: radii.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      ...shadow.soft,
    },
    featuredCopy: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xs,
    },
    featuredLabel: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    featuredTitle: {
      color: colors.text,
      fontSize: isCompact ? 20 : 24,
      lineHeight: isCompact ? 24 : 28,
      fontWeight: "900",
    },
    featuredDescription: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "600",
    },
    featuredAction: {
      width: 40,
      height: 40,
      alignSelf: "flex-start",
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.xs,
      borderRadius: 20,
      backgroundColor: colors.primary,
      ...shadow.floating,
    },
    featuredImage: {
      width: isCompact ? 92 : 110,
      height: isCompact ? 92 : 110,
      borderRadius: radii.lg,
      backgroundColor: colors.surface,
    },
    browseSectionHeader: {
      gap: spacing.sm,
    },
    browseHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    trackListHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: alpha(colors.text, 0.08),
      marginBottom: spacing.xs,
    },
    trackListColIndex: {
      width: 22,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "900",
      marginRight: 2,
    },
    trackListColTitle: {
      flex: 1,
      color: colors.muted,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    trackListColDuration: {
      marginRight: 48,
    },
    browseRowCard: {
      marginBottom: spacing.xs,
    },
    loadingMore: {
      paddingVertical: spacing.lg,
      color: colors.muted,
      textAlign: "center",
      fontWeight: "800",
    },
    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xxl,
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "800",
      textAlign: "center",
    },
    clearSearchButton: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      backgroundColor: colors.cardSoft,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      marginTop: spacing.xs,
    },
    clearSearchButtonText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: "800",
    },
    skeletonContainer: {
      gap: spacing.sm,
      paddingTop: spacing.xs,
    },
    skeletonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    skeletonIndex: {
      width: 18,
      height: 14,
      borderRadius: 4,
      backgroundColor: colors.cardSoft,
    },
    skeletonCover: {
      width: 48,
      height: 48,
      borderRadius: radii.sm,
      backgroundColor: colors.cardSoft,
    },
    skeletonCopy: {
      flex: 1,
      gap: 6,
    },
    skeletonTitle: {
      width: "60%",
      height: 12,
      borderRadius: 4,
      backgroundColor: colors.cardSoft,
    },
    skeletonMeta: {
      width: "40%",
      height: 10,
      borderRadius: 4,
      backgroundColor: colors.cardSoft,
    },
    skeletonTime: {
      width: 32,
      height: 10,
      borderRadius: 4,
      backgroundColor: colors.cardSoft,
    },
  });
