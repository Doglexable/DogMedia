import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson, mediaThumbnailUrl } from "../api";
import { CategoryChips } from "../components/category-chips";
import { MediaCard } from "../components/media-card";
import { MiniPlayer } from "../components/mini-player";
import { usePlayer } from "../context/player-context";
import { colors, radii, shadow, spacing } from "../theme";
import { getArtistLabel } from "../utils/media";

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

function Featured({ item, onPlay }) {
  if (!item) return null;
  const description = item.description?.trim();

  return (
    <Pressable style={styles.featured} onPress={() => onPlay(item)}>
      <View style={styles.featuredCopy}>
        <Text style={styles.featuredLabel}>Featured</Text>
        <Text style={styles.featuredTitle} numberOfLines={3}>{item.title}</Text>
        {description && <Text style={styles.featuredDescription} numberOfLines={3}>{description}</Text>}
        <Text style={styles.featuredAction}>Play</Text>
      </View>
      <Image source={{ uri: mediaThumbnailUrl(item.id) }} style={styles.featuredImage} />
    </Pressable>
  );
}

function Row({ items, likedIds, onPlay, onQueue, onToggleLike, title }) {
  if (!items.length) return null;
  return (
    <View style={styles.rowSection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <MediaCard
            compact
            key={`${title}-${item.id}`}
            item={item}
            liked={likedIds.has(Number(item.id))}
            onPress={onPlay}
            onQueue={onQueue}
            onToggleLike={onToggleLike}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function DashboardScreen({ navigation }) {
  const player = usePlayer();
  const insets = useSafeAreaInsets();
  const [categories, setCategories] = useState([]);
  const [media, setMedia] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  const loadCategories = useCallback(() => {
    apiJson("/api/categories")
      .then((items) => setCategories(items.filter((category) => Number(category.media_count) > 0)))
      .catch(() => setCategories([]));
  }, []);

  const loadMedia = useCallback(() => {
    const endpoint = selectedCategory ? `/api/media?category_id=${selectedCategory}` : "/api/media";
    apiJson(endpoint)
      .then(setMedia)
      .catch(() => {
        setMedia([]);
        setNotice("Could not load media.");
      });
  }, [selectedCategory]);

  const loadSummary = useCallback(() => {
    const params = new URLSearchParams({ view: "all" });
    if (selectedCategory) params.set("category_id", selectedCategory);
    apiJson(`/api/playback/dashboard?${params.toString()}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [selectedCategory]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadMedia();
    loadSummary();
  }, [loadMedia, loadSummary]);

  const visibleMedia = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return media;
    return media.filter((item) => [
      item.title,
      item.artists,
      item.description,
      item.category_name,
      item.category_path,
      item.mime_type,
    ].some((value) => String(value ?? "").toLowerCase().includes(normalized)));
  }, [media, search]);

  const byId = useMemo(() => new Map(visibleMedia.map((item) => [Number(item.id), item])), [visibleMedia]);
  const featured = byId.get(Number(summary?.featuredId)) || visibleMedia[0] || null;
  const quickAccess = orderMediaByIds(summary?.quickAccessIds, byId, visibleMedia, 8);
  const rows = Array.isArray(summary?.rows) && summary.rows.length
    ? summary.rows.slice(0, 3).map((row, index) => ({
      title: row.title || `Shelf ${index + 1}`,
      items: orderMediaByIds(row.mediaIds, byId, visibleMedia, 12),
    }))
    : [{ title: "Recently added", items: visibleMedia.slice(0, 12) }];

  const play = (item) => {
    player.playMedia(item, selectedCategory);
    (navigation.getParent?.() || navigation).navigate("Player");
  };

  const toggleLike = (item) => player.toggleLike(item).catch(() => setNotice("Could not update favorites."));

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 160 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.kicker}>DogMedia</Text>
          <Text style={styles.heading}>Private library</Text>
          <Text style={styles.subhead}>{visibleMedia.length} item{visibleMedia.length === 1 ? "" : "s"} ready</Text>
        </View>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search media..."
          placeholderTextColor={colors.subtle}
          style={styles.search}
        />

        <CategoryChips categories={categories} selectedId={selectedCategory} onSelect={setSelectedCategory} />
        {notice && <Text style={styles.notice}>{notice}</Text>}

        <Featured item={featured} onPlay={play} />

        <View style={styles.quickHeader}>
          <Text style={styles.sectionTitle}>Quick access</Text>
          {featured?.artists && <Text style={styles.quickMeta}>{getArtistLabel(featured.artists)}</Text>}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {quickAccess.map((item) => (
            <MediaCard
              compact
              key={`quick-${item.id}`}
              item={item}
              liked={player.isLiked(item.id)}
              onPress={play}
              onQueue={player.addToQueue}
              onToggleLike={toggleLike}
            />
          ))}
        </ScrollView>

        {rows.map((row) => (
          <Row
            key={row.title}
            title={row.title}
            items={row.items}
            likedIds={player.likedIds}
            onPlay={play}
            onQueue={player.addToQueue}
            onToggleLike={toggleLike}
          />
        ))}
      </ScrollView>
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingTop: 58,
    paddingHorizontal: spacing.lg,
    paddingBottom: 160,
    gap: spacing.lg,
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
    fontSize: 38,
    lineHeight: 40,
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
  featured: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    minHeight: 220,
    padding: spacing.lg,
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
    fontSize: 30,
    lineHeight: 31,
    fontWeight: "900",
  },
  featuredDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  featuredAction: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    overflow: "hidden",
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    color: colors.white,
    fontWeight: "900",
  },
  featuredImage: {
    width: 118,
    height: 118,
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
  rowSection: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.md,
    paddingRight: spacing.xl,
  },
});
