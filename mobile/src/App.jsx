import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson } from "./api";
import { PlayerProvider } from "./context/player-context";
import { OfflineProvider, useOffline } from "./context/offline-context";
import { AccessDeniedScreen } from "./screens/access-denied-screen";
import { DashboardScreen } from "./screens/dashboard-screen";
import { DownloadsScreen } from "./screens/downloads-screen";
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
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const haloStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.46] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) }],
  };

  return (
    <View style={styles.loading} accessibilityLabel="Opening DogMedia private library">
      <View style={styles.splashMarkWrap}>
        <Animated.View style={[styles.splashHalo, haloStyle]} />
        <Image
          accessibilityIgnoresInvertColors
          accessible={false}
          source={require("../assets/splash-mark-v2.png")}
          resizeMode="contain"
          style={styles.splashMark}
        />
      </View>

      <Text style={styles.splashWordmark}>DOGMEDIA</Text>
      <Text style={styles.splashTagline}>YOUR PRIVATE MEDIA LIBRARY</Text>

      <View style={styles.loadingStatus}>
        <ActivityIndicator color="#22b8ff" size="small" />
        <Text style={styles.loadingText}>Opening your library</Text>
      </View>
    </View>
  );
}

function AccessGuard({ children }) {
  const offline = useOffline();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    offline.validateAccess()
      .then((data) => setStatus({
        ok: true,
        tier: data.tier,
        description: data.description,
        firstRun: data.firstRun,
        clientIp: data.ip,
        offline: Boolean(data.offline),
        managementOnly: Boolean(data.managementOnly),
      }))
      .catch(() => setStatus({ ok: false }));
  }, [offline.validateAccess]);

  if (status === "loading") return <LoadingScreen />;
  if (!status.ok) return <AccessDeniedScreen />;

  return (
    <AccessContext.Provider value={status}>
      {children}
    </AccessContext.Provider>
  );
}

function Tabs() {
  const access = useAccess();
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
      initialRouteName={access?.managementOnly ? "Downloads" : "Home"}
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
      <Tab.Screen
        name="Downloads"
        component={DownloadsScreen}
        options={{
          tabBarIcon: (props) => <TabIcon {...props} name="download" outlineName="download-outline" />,
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
        <OfflineProvider>
          <AccessGuard>
            <PlayerProvider>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Tabs" component={Tabs} />
                <Stack.Screen name="Player" component={PlayerScreen} />
              </Stack.Navigator>
            </PlayerProvider>
          </AccessGuard>
        </OfflineProvider>
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

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050607",
    paddingBottom: 18,
  },
  splashMarkWrap: {
    width: 252,
    height: 252,
    alignItems: "center",
    justifyContent: "center",
  },
  splashHalo: {
    position: "absolute",
    width: 198,
    height: 198,
    borderRadius: 99,
    backgroundColor: "rgba(22,140,255,0.08)",
    borderColor: "rgba(61,227,242,0.28)",
    borderWidth: 1,
  },
  splashMark: {
    width: 252,
    height: 252,
  },
  splashWordmark: {
    marginTop: -16,
    color: "#f4f4f5",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: 5.5,
  },
  splashTagline: {
    marginTop: 8,
    color: "#667085",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 2.1,
  },
  loadingStatus: {
    position: "absolute",
    bottom: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: "#8b95a7",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  gestureRoot: {
    flex: 1,
  },
});
