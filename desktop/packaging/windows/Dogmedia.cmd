@echo off
setlocal
set "PFS_APP_DIR=%~dp0"
set "PATH=%PFS_APP_DIR%;%PATH%"
set "GST_PLUGIN_SYSTEM_PATH_1_0="
set "GST_PLUGIN_PATH_1_0=%PFS_APP_DIR%lib\gstreamer-1.0"
set "GST_PLUGIN_SCANNER_1_0=%PFS_APP_DIR%libexec\gstreamer-1.0\gst-plugin-scanner.exe"
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
if not exist "%LOCALAPPDATA%\Dogmedia" mkdir "%LOCALAPPDATA%\Dogmedia"
set "GST_REGISTRY_1_0=%LOCALAPPDATA%\Dogmedia\gstreamer-registry.bin"
"%PFS_APP_DIR%Dogmedia.exe" %*
