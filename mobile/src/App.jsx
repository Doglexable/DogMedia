import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
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

function TabIcon({ color, focused, name, outlineName, size }) {
  return <Ionicons name={focused ? name : outlineName} size={size} color={color} />;
}

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
  const insets = useSafeAreaInsets();
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
          minHeight: 72 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 12),
        },
        tabBarLabelStyle: {
          fontWeight: "900",
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={DashboardScreen}
        options={{
          tabBarIcon: (props) => <TabIcon {...props} name="home" outlineName="home-outline" />,
        }}
      />
      <Tab.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          tabBarIcon: (props) => <TabIcon {...props} name="bookmark" outlineName="bookmark-outline" />,
        }}
      />
      {wrappedAvailable && (
        <Tab.Screen
          name="Wrapped"
          options={{
            tabBarIcon: (props) => <TabIcon {...props} name="stats-chart" outlineName="stats-chart-outline" />,
          }}
        >
          {(props) => <WrappedScreen {...props} onAccessChanged={loadWrappedAccess} />}
        </Tab.Screen>
      )}
      <Tab.Screen
        name="Player"
        component={PlayerScreen}
        options={{
          tabBarButton: player.currentMedia ? undefined : () => null,
          tabBarIcon: (props) => <TabIcon {...props} name="play-circle" outlineName="play-circle-outline" />,
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
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="light" />
        <AccessGuard>
          <PlayerProvider>
            <Tabs />
          </PlayerProvider>
        </AccessGuard>
      </NavigationContainer>
    </SafeAreaProvider>
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
