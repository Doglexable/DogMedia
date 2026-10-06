#include <mach-o/dyld.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
  (void)argc;
  char path[PATH_MAX];
  uint32_t length = sizeof(path);
  if (_NSGetExecutablePath(path, &length) != 0) {
    fputs("Dogmedia launcher path is too long\n", stderr);
    return 1;
  }
  char resolved[PATH_MAX];
  if (realpath(path, resolved) == NULL) {
    perror("realpath");
    return 1;
  }
  char *slash = strrchr(resolved, '/');
  if (slash == NULL) return 1;
  *slash = '\0'; // Contents/MacOS
  char binary[PATH_MAX], plugin[PATH_MAX], scanner[PATH_MAX];
  if ((size_t)snprintf(binary, sizeof(binary), "%s/Dogmedia-bin", resolved) >= sizeof(binary) ||
      (size_t)snprintf(plugin, sizeof(plugin), "%s/../Frameworks/GStreamer.framework/Versions/1.0/lib/gstreamer-1.0", resolved) >= sizeof(plugin) ||
      (size_t)snprintf(scanner, sizeof(scanner), "%s/../Frameworks/GStreamer.framework/Versions/1.0/libexec/gstreamer-1.0/gst-plugin-scanner", resolved) >= sizeof(scanner)) {
    fputs("Dogmedia framework path is too long\n", stderr);
    return 1;
  }
  setenv("GST_PLUGIN_SYSTEM_PATH_1_0", "", 1);
  setenv("GST_PLUGIN_PATH_1_0", plugin, 1);
  setenv("GST_PLUGIN_SCANNER_1_0", scanner, 1);

  const char *home = getenv("HOME");
  char cache[PATH_MAX], registry[PATH_MAX];
  if (home != NULL &&
      (size_t)snprintf(cache, sizeof(cache), "%s/Library/Caches/Dogmedia", home) < sizeof(cache) &&
      (size_t)snprintf(registry, sizeof(registry), "%s/gstreamer-registry.bin", cache) < sizeof(registry)) {
    if (mkdir(cache, 0700) == 0 || errno == EEXIST) {
      setenv("GST_REGISTRY_1_0", registry, 1);
    }
  }
  execv(binary, argv);
  perror("execv Dogmedia-bin");
  return 1;
}
