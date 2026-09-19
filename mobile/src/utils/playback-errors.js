export const API_UNREACHABLE = "API_UNREACHABLE";

export function createApiUnreachableError() {
  const error = new Error("The Dogmedia server cannot be reached.");
  error.code = API_UNREACHABLE;
  return error;
}

export function getPlaybackErrorPresentation(error) {
  if (error?.code === API_UNREACHABLE) {
    return {
      title: "Server unavailable",
      message: "Dogmedia cannot reach the configured server. Open Downloads to play files stored on this device.",
      actionLabel: "Open Downloads",
      route: "Downloads",
    };
  }

  return {
    title: "Playback unavailable",
    message: error?.message || "The selected media could not be played.",
    actionLabel: "OK",
    route: null,
  };
}
