import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "./api";
import { PlayerProvider } from "./context/player-context";
import { AccessDeniedScreen } from "./screens/access-denied-screen";
import { DashboardScreen } from "./screens/dashboard-screen";
import { FavoritesScreen } from "./screens/favorites-screen";
import { PlayerScreen } from "./screens/player-screen";
import { WrappedScreen } from "./screens/wrapped-screen";
import { ThemeProvider, ThemeToggle, useTheme } from "./theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const AccessContext = createContext(null);

function TabIcon({ color, focused, name, outlineName, size }) {
  return <Ionicons name={focused ? name : outlineName} size={size} color={color} />;
}

export function useAccess() {
  return useContext(AccessContext);
}

function LoadingScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
  const { colors, mode, toggleMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [wrappedAvailable, setWrappedAvailable] = useState(true);
  const [currentTab, setCurrentTab] = useState("Home");
  const showWrapped = wrappedAvailable || currentTab === "Wrapped";
  const themeIcon = mode === "light" ? "sunny" : mode === "dark" ? "moon" : "contrast";

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
      screenListeners={{
        state: (event) => {
          const state = event.data.state;
          const route = state.routes[state.index];
          setCurrentTab(route?.name || "Home");
        },
      }}
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
      {showWrapped && (
        <Tab.Screen
          name="Wrapped"
          options={{
            tabBarIcon: (props) => <TabIcon {...props} name="stats-chart" outlineName="stats-chart-outline" />,
            tabBarStyle: { display: "none" },
          }}
        >
          {(props) => <WrappedScreen {...props} onAccessChanged={loadWrappedAccess} />}
        </Tab.Screen>
      )}
      <Tab.Screen
        name="Theme"
        component={ThemeToggle}
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            toggleMode();
          },
        }}
        options={{
          tabBarIcon: (props) => <TabIcon {...props} name={themeIcon} outlineName={themeIcon} />,
        }}
      />
    </Tab.Navigator>
  );
}

function AppShell() {
  const { colors, resolvedMode } = useTheme();
  const navigationTheme = useMemo(() => {
    const baseTheme = resolvedMode === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        primary: colors.primary,
        border: "transparent",
      },
    };
  }, [colors, resolvedMode]);

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={resolvedMode === "dark" ? "light" : "dark"} />
      <BottomSheetModalProvider>
        <AccessGuard>
          <PlayerProvider>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Tabs" component={Tabs} />
              <Stack.Screen name="Player" component={PlayerScreen} />
            </Stack.Navigator>
          </PlayerProvider>
        </AccessGuard>
      </BottomSheetModalProvider>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
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

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
});
