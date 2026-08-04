import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { apiJson } from "./api";
import { PlayerProvider, usePlayer } from "./context/player-context";
import { AccessDeniedScreen } from "./screens/access-denied-screen";
import { DashboardScreen } from "./screens/dashboard-screen";
import { FavoritesScreen } from "./screens/favorites-screen";
import { PlayerScreen } from "./screens/player-screen";
import { WrappedScreen } from "./screens/wrapped-screen";
import { colors } from "./theme";

const Tab = createBottomTabNavigator();
const AccessContext = createContext(null);

export function useAccess() {
  return useContext(AccessContext);
}

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.loadingText}>Opening private library</Text>
    </View>
  );
}

function AccessGuard({ children }) {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    apiJson("/api/check-access")
      .then((data) => setStatus({
        ok: true,
        tier: data.tier,
        description: data.description,
        firstRun: data.firstRun,
        clientIp: data.ip,
      }))
      .catch(() => setStatus({ ok: false }));
  }, []);

  if (status === "loading") return <LoadingScreen />;
  if (!status.ok) return <AccessDeniedScreen />;

  return (
    <AccessContext.Provider value={status}>
      {children}
    </AccessContext.Provider>
  );
}

function Tabs() {
  const player = usePlayer();
  const [wrappedAvailable, setWrappedAvailable] = useState(true);

  const loadWrappedAccess = useCallback(() => {
    return apiJson("/api/wrapped/access")
      .then((status) => setWrappedAvailable(status?.available !== false))
      .catch(() => setWrappedAvailable(true));
  }, []);

  useEffect(() => {
    loadWrappedAccess();
  }, [loadWrappedAccess]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          borderTopWidth: 0,
          backgroundColor: colors.surface,
          minHeight: 72,
          paddingTop: 8,
          paddingBottom: 12,
        },
        tabBarLabelStyle: {
          fontWeight: "900",
        },
      }}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      {wrappedAvailable && (
        <Tab.Screen name="Wrapped">
          {(props) => <WrappedScreen {...props} onAccessChanged={loadWrappedAccess} />}
        </Tab.Screen>
      )}
      <Tab.Screen
        name="Player"
        component={PlayerScreen}
        options={{
          tabBarButton: player.currentMedia ? undefined : () => null,
        }}
      />
    </Tab.Navigator>
  );
}

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    primary: colors.primary,
    border: "transparent",
  },
};

export default function App() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      <AccessGuard>
        <PlayerProvider>
          <Tabs />
        </PlayerProvider>
      </AccessGuard>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  loadingText: {
    marginTop: 14,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
});
