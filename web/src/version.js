import packageJson from "../package.json";

/**
 * Global web client version identifier.
 * Uses compile-time define or env variable if present, falling back to package.json version.
 */
export const APP_VERSION =
  (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "") ||
  import.meta.env?.VITE_APP_VERSION ||
  packageJson.version ||
  "0.1.0";

export const APP_VERSION_LABEL = `v${APP_VERSION.replace(/^v/, "")}`;
export const APP_NAME = "Dogmedia";
export const APP_FULL_NAME = `Dogmedia Web ${APP_VERSION_LABEL}`;

export default APP_VERSION;
