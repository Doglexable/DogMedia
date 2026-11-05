import { NavigationContainer, DarkTheme, DefaultTheme, createNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson, getAccountToken, setAccountToken, getStoredAccountId, setStoredAccountId } from "./api";
import { PlayerProvider, usePlayer } from "./context/player-context";
import { OfflineProvider, useOffline } from "./context/offline-context";
import { DashboardScreen } from "./screens/dashboard-screen";
import { DownloadsScreen } from "./screens/downloads-screen";
import { FavoritesScreen } from "./screens/favorites-screen";
import { PlayerScreen } from "./screens/player-screen";
import { WrappedScreen } from "./screens/wrapped-screen";
import { ThemeProvider, ThemeToggle, useTheme } from "./theme";
import {
  EQ_BANDS,
  EQ_PRESETS,
  GAIN_MIN,
  GAIN_MAX,
  normalizeEqSettings,
  loadEqSettings,
  saveEqSettings,
} from "./equalizer";

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
    <View style={styles.loading} accessibilityLabel="Opening Dogmedia private library">
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
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getAccountToken()
      .then(() => offline.validateAccess())
      .then(async (data) => {
        if (!data.offline && data.id) {
          if (await getStoredAccountId() !== String(data.id)) {
            await offline.clearAccountData();
            data = await offline.validateAccess();
          }
          await setStoredAccountId(data.id);
        }
        setStatus({ ok: true, ...data });
      })
      .catch((error) => {
        console.warn("Access validation failed:", error?.message || error);
        setStatus({ ok: false });
      });
  }, [offline.validateAccess, offline.clearAccountData]);

  if (status === "loading") return <LoadingScreen />;
  if (!status.ok) return (
    <View style={{ flex: 1, justifyContent: "center", padding: 28, backgroundColor: "#111219" }}>
      <Text style={{ color: "white", fontSize: 24, fontWeight: "700", marginBottom: 12 }}>{mode === "login" ? "Log in to Dogmedia" : "Create account"}</Text>
      <TextInput autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor="#90919c" style={{ color: "white", borderColor: "#555", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 }} />
      <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#90919c" style={{ color: "white", borderColor: "#555", borderWidth: 1, borderRadius: 10, padding: 12 }} />
      {loginError ? <Text style={{ color: "#ff7b88", marginTop: 12 }}>{loginError}</Text> : null}
      <Pressable accessibilityRole="button" disabled={submitting} onPress={async () => {
        setLoginError("");
        setSubmitting(true);
        try {
          const result = await apiJson(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ username, password }) });
          if (await getStoredAccountId() !== String(result.user.id)) await offline.clearAccountData();
          await setAccountToken(result.token);
          await setStoredAccountId(result.user.id);
          setPassword("");
          const access = await offline.validateAccess();
          setStatus({ ok: true, ...access });
        } catch (error) { setLoginError(error.message || "Authentication failed"); }
        finally { setSubmitting(false); }
      }} style={{ marginTop: 16, backgroundColor: "#e11d48", borderRadius: 10, padding: 14 }}><Text style={{ color: "white", textAlign: "center", fontWeight: "700" }}>{mode === "login" ? "Log in" : "Create account"}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "login" ? "register" : "login"); setLoginError(""); }} style={{ marginTop: 18 }}><Text style={{ color: "#22b8ff", textAlign: "center" }}>{mode === "login" ? "Create an account" : "Already have an account? Log in"}</Text></Pressable>
    </View>
  );

  return <AccessContext.Provider value={{ ...status, logout: async () => {
    await apiJson("/api/auth/logout", { method: "POST" }).catch(() => {});
    try { await offline.clearAccountData(); }
    finally {
      await setAccountToken("");
      await setStoredAccountId(null);
      setStatus({ ok: false });
    }
  }, updateUser: (user) => {
    setStatus((prev) => ({ ...prev, ...user, username: user?.username || prev.username, description: user?.username || prev.description }));
  } }}>{children}</AccessContext.Provider>;
}

const ACCOUNT_TABS = [
  { id: "profile", label: "Profile", icon: "person-outline" },
  { id: "security", label: "Security", icon: "lock-closed-outline" },
  { id: "eq", label: "EQ", icon: "options-outline" },
];

function AccountScreen() {
  const access = useAccess();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const currentUsername = access?.username || access?.description || "";
  const tier = access?.tier ?? 0;
  const userEqSettings = access?.user?.eq_settings || access?.eq_settings;
  const [activeTab, setActiveTab] = useState("profile");
  const [username, setUsername] = useState(currentUsername);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [eqEnabled, setEqEnabled] = useState(false);
  const [eqPreset, setEqPreset] = useState("flat");
  const [eqGains, setEqGains] = useState(() => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [eqDirty, setEqDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setUsername(currentUsername);
    setPassword("");
    setCurrentPassword("");
    setError("");
    setSuccess("");
    if (userEqSettings) {
      const normalized = normalizeEqSettings(userEqSettings);
      setEqEnabled(normalized.enabled);
      setEqPreset(normalized.preset);
      setEqGains(normalized.gains);
    } else {
      loadEqSettings().then((loaded) => {
        if (loaded) {
          setEqEnabled(loaded.enabled);
          setEqPreset(loaded.preset);
          setEqGains(loaded.gains);
        }
      }).catch(() => {});
    }
  }, [currentUsername, userEqSettings]);

  const handleSelectPreset = (key) => {
    const preset = EQ_PRESETS[key];
    if (!preset) return;
    setEqPreset(key);
    setEqGains(preset.gains.slice());
    setEqDirty(true);
    saveEqSettings({ enabled: eqEnabled, preset: key, gains: preset.gains });
  };

  const handleToggleEqEnabled = () => {
    const next = !eqEnabled;
    setEqEnabled(next);
    setEqDirty(true);
    saveEqSettings({ enabled: next, preset: eqPreset, gains: eqGains });
  };

  const handleChangeBandGain = (index, delta) => {
    const nextGains = eqGains.slice();
    const current = nextGains[index] || 0;
    const clamped = Math.min(GAIN_MAX, Math.max(GAIN_MIN, current + delta));
    nextGains[index] = clamped;
    setEqGains(nextGains);
    setEqPreset("custom");
    setEqDirty(true);
    saveEqSettings({ enabled: eqEnabled, preset: "custom", gains: nextGains });
  };

  const handleUpdate = async () => {
    setError("");
    setSuccess("");
    const hasNewUsername = username.trim() !== currentUsername;
    const hasNewPassword = password.length > 0;
    const hasNewEq = eqDirty;

    if (!hasNewUsername && !hasNewPassword && !hasNewEq) {
      setError("No changes requested.");
      return;
    }
    if (hasNewPassword && password.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }
    if (hasNewPassword && !currentPassword) {
      setError("Enter your current password to verify this change.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = { username: username.trim() };
      if (hasNewPassword) {
        payload.password = password;
        payload.currentPassword = currentPassword;
      }
      if (hasNewEq) {
        payload.eq_settings = {
          enabled: eqEnabled,
          preset: eqPreset,
          gains: eqGains,
          targetDb: 0,
        };
      }
      const data = await apiJson("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (data?.user) {
        access?.updateUser?.(data.user);
      }
      setSuccess("Profile updated successfully!");
      setEqDirty(false);
      saveEqSettings(payload.eq_settings || { enabled: eqEnabled, preset: eqPreset, gains: eqGains });
      setPassword("");
      setCurrentPassword("");
    } catch (err) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setUsername(currentUsername);
    setPassword("");
    setCurrentPassword("");
    setError("");
    setSuccess("");
    setEqDirty(false);
    if (userEqSettings) {
      const normalized = normalizeEqSettings(userEqSettings);
      setEqEnabled(normalized.enabled);
      setEqPreset(normalized.preset);
      setEqGains(normalized.gains);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: Math.max(insets.top, 24) + 16,
        paddingBottom: Math.max(insets.bottom, 24) + 32,
      }}
      style={{ flex: 1, backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800", marginBottom: 18 }}>
        Profile
      </Text>

      {/* User Card */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          padding: 16,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          borderRadius: 14,
          marginBottom: 20,
        }}
      >
        <Ionicons name="person-circle-outline" size={48} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
            {currentUsername || "User"}
          </Text>
          <View
            style={{
              alignSelf: "flex-start",
              marginTop: 4,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 9999,
              backgroundColor: "rgba(225, 29, 72, 0.15)",
              borderWidth: 1,
              borderColor: "rgba(225, 29, 72, 0.3)",
            }}
          >
            <Text
              style={{
                color: colors.primary,
                fontSize: 10,
                fontWeight: "800",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {tier >= 100 ? "Administrator" : "Standard User"}
            </Text>
          </View>
        </View>
      </View>

      {/* Settings Tab Strip */}
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: colors.cardBorder,
          marginBottom: 16,
        }}
        accessibilityRole="tablist"
      >
        {ACCOUNT_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${tab.label} tab`}
              onPress={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 10,
                borderBottomWidth: 2,
                borderBottomColor: isActive ? colors.primary : "transparent",
                gap: 4,
              }}
            >
              <Ionicons
                name={tab.icon}
                size={16}
                color={isActive ? colors.text : colors.muted}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? "700" : "600",
                  color: isActive ? colors.text : colors.muted,
                  letterSpacing: 0.3,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab 1: Profile */}
      {activeTab === "profile" && (
        <View>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 6 }}>
            Username
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={colors.muted}
            editable={!submitting}
            style={{
              color: colors.text,
              borderColor: colors.cardBorder,
              borderWidth: 1,
              borderRadius: 10,
              padding: 12,
              backgroundColor: colors.surface,
              marginBottom: 16,
            }}
          />
        </View>
      )}

      {/* Tab 2: Security */}
      {activeTab === "security" && (
        <View>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 6 }}>
            New Password
          </Text>
          <TextInput
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            placeholder="Leave blank to keep current"
            placeholderTextColor={colors.muted}
            editable={!submitting}
            style={{
              color: colors.text,
              borderColor: colors.cardBorder,
              borderWidth: 1,
              borderRadius: 10,
              padding: 12,
              backgroundColor: colors.surface,
              marginBottom: 16,
            }}
          />

          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 6 }}>
            Current Password
          </Text>
          <TextInput
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder={password ? "Required to confirm changes" : "Optional verification"}
            placeholderTextColor={colors.muted}
            editable={!submitting}
            style={{
              color: colors.text,
              borderColor: colors.cardBorder,
              borderWidth: 1,
              borderRadius: 10,
              padding: 12,
              backgroundColor: colors.surface,
              marginBottom: 16,
            }}
          />
        </View>
      )}

      {/* Tab 3: Equalizer (EQ) Settings */}
      {activeTab === "eq" && (
        <View
          style={{
            marginTop: 4,
            marginBottom: 20,
            padding: 16,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            borderRadius: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <View>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                Audio Equalizer (EQ)
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                {eqEnabled ? `Active • ${EQ_PRESETS[eqPreset]?.label || "Custom"}` : "Disabled"}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Toggle Equalizer"
              accessibilityRole="switch"
              accessibilityState={{ checked: eqEnabled }}
              onPress={handleToggleEqEnabled}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 9999,
                backgroundColor: eqEnabled ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: eqEnabled ? colors.primary : colors.cardBorder,
              }}
            >
              <Text style={{ color: eqEnabled ? "white" : colors.muted, fontSize: 12, fontWeight: "700" }}>
                {eqEnabled ? "ON" : "OFF"}
              </Text>
            </Pressable>
          </View>

          {/* Presets Horizontal List */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
            {Object.entries(EQ_PRESETS).map(([key, p]) => {
              const isSelected = eqPreset === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.label} preset`}
                  onPress={() => handleSelectPreset(key)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 8,
                    backgroundColor: isSelected ? "rgba(225, 29, 72, 0.2)" : colors.surface,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.cardBorder,
                  }}
                >
                  <Text style={{ color: isSelected ? colors.primary : colors.text, fontSize: 12, fontWeight: isSelected ? "700" : "500" }}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* 10 Band Gain Steppers */}
          <View style={{ gap: 10, marginTop: 8 }}>
            {EQ_BANDS.map((band, idx) => {
              const gain = eqGains[idx] || 0;
              const gainLabel = gain > 0 ? `+${gain} dB` : `${gain} dB`;
              return (
                <View
                  key={band.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: colors.surface,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", width: 60 }}>
                    {band.label}
                  </Text>
                  <Text style={{ color: gain === 0 ? colors.muted : (gain > 0 ? colors.primary : "#38bdf8"), fontSize: 13, fontWeight: "700" }}>
                    {gainLabel}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable
                      accessibilityLabel={`Decrease ${band.label}`}
                      onPress={() => handleChangeBandGain(idx, -1)}
                      disabled={gain <= GAIN_MIN}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        backgroundColor: colors.card,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: gain <= GAIN_MIN ? 0.3 : 1,
                      }}
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Increase ${band.label}`}
                      onPress={() => handleChangeBandGain(idx, 1)}
                      disabled={gain >= GAIN_MAX}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        backgroundColor: colors.card,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: gain >= GAIN_MAX ? 0.3 : 1,
                      }}
                    >
                      <Ionicons name="add" size={16} color={colors.text} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {error ? (
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            borderWidth: 1,
            borderColor: "rgba(239, 68, 68, 0.3)",
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#f87171", fontSize: 13, fontWeight: "600" }}>{error}</Text>
        </View>
      ) : null}

      {success ? (
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: "rgba(34, 197, 94, 0.15)",
            borderWidth: 1,
            borderColor: "rgba(34, 197, 94, 0.3)",
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#4ade80", fontSize: 13, fontWeight: "600" }}>{success}</Text>
        </View>
      ) : null}

      {/* Action Buttons: Update user & Batal */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={handleUpdate}
          style={{
            flex: 1,
            backgroundColor: colors.primary,
            borderRadius: 10,
            padding: 14,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "white", textAlign: "center", fontWeight: "700" }}>
            {submitting ? "Updating…" : "Update user"}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={handleCancel}
          style={{
            flex: 1,
            backgroundColor: "transparent",
            borderColor: colors.cardBorder,
            borderWidth: 1,
            borderRadius: 10,
            padding: 14,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          <Text style={{ color: colors.text, textAlign: "center", fontWeight: "700" }}>
            Batal
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          height: 1,
          backgroundColor: colors.cardBorder,
          marginBottom: 20,
        }}
      />

      {/* Log out at the very bottom */}
      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={() => access?.logout?.()}
        style={{
          backgroundColor: "rgba(239, 68, 68, 0.12)",
          borderColor: "rgba(239, 68, 68, 0.28)",
          borderWidth: 1,
          borderRadius: 10,
          padding: 14,
        }}
      >
        <Text style={{ color: "#f87171", textAlign: "center", fontWeight: "700" }}>Log out</Text>
      </Pressable>
    </ScrollView>
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
      <Tab.Screen name="Account" component={AccountScreen} options={{ tabBarIcon: (props) => <TabIcon {...props} name="person" outlineName="person-outline" /> }} />
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

export const navigationRef = createNavigationContainerRef();

function NonAudioPlayerAutoNavigator() {
  const player = usePlayer();
  const lastNavigatedMediaIdRef = useRef(null);

  useEffect(() => {
    const currentMedia = player?.currentMedia;
    if (!currentMedia?.id) {
      lastNavigatedMediaIdRef.current = null;
      return;
    }

    const isAudio = currentMedia.mime_type?.startsWith("audio/");
    if (!isAudio && lastNavigatedMediaIdRef.current !== currentMedia.id) {
      lastNavigatedMediaIdRef.current = currentMedia.id;
      if (navigationRef.isReady()) {
        const currentRoute = navigationRef.getCurrentRoute();
        if (currentRoute?.name !== "Player") {
          navigationRef.navigate("Player");
        }
      }
    }
  }, [player?.currentMedia]);

  return null;
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
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <StatusBar style={resolvedMode === "dark" ? "light" : "dark"} />
      <BottomSheetModalProvider>
        <OfflineProvider>
          <AccessGuard>
            <AuthorizedPlayerProvider>
              <NonAudioPlayerAutoNavigator />
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Tabs" component={Tabs} />
                <Stack.Screen name="Player" component={PlayerScreen} />
              </Stack.Navigator>
            </AuthorizedPlayerProvider>
          </AccessGuard>
        </OfflineProvider>
      </BottomSheetModalProvider>
    </NavigationContainer>
  );
}

function AuthorizedPlayerProvider({ children }) {
  const access = useAccess();
  return <PlayerProvider accessTier={Number(access?.tier) || 0}>{children}</PlayerProvider>;
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
