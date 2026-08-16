import { copyFile, mkdir, stat } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, "..");
const source = resolve(mobileDir, "android/app/build/outputs/apk/release/app-release.apk");
const destinationDir = resolve(mobileDir, "../web/public/downloads");
const destination = resolve(destinationDir, "dogmedia-android.apk");

await stat(source);
await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
console.log(`Android APK exported to ${destination}`);
