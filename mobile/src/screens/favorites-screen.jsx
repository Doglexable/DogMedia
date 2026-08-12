import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "../api";
import { MediaCard } from "../components/media-card";
import { MiniPlayer } from "../components/mini-player";
import { usePlayer } from "../context/player-context";
import { spacing, useTheme } from "../theme";

export function FavoritesScreen({ navigation }) {
  const player = usePlayer();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    return apiJson("/api/likes")
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const play = (item) => {
    player.playMedia(item);
    (navigation.getParent?.() || navigation).navigate("Player");
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Favorites</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: 140 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={<Text style={styles.empty}>Saved audio will appear here.</Text>}
        renderItem={({ item }) => (
          <MediaCard
            item={item}
            liked={player.isLiked(item.id)}
            onPress={play}
            onPlayNext={player.playNext}
            onQueue={player.addToQueue}
            onToggleLike={(media) => player.toggleLike(media).then(load)}
          />
        )}
      />
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 58,
    paddingHorizontal: spacing.lg,
  },
  heading: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.lg,
    paddingBottom: 140,
  },
  columns: {
    gap: spacing.md,
  },
  empty: {
    color: colors.muted,
    fontWeight: "800",
    paddingTop: spacing.xl,
  },
});
