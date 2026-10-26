/**
 * Manages asynchronous summary loading for the mobile dashboard, ensuring that
 * only the latest requested generation can update state or report failure.
 */
export function createLatestSummaryLoader({ fetchSummary, applySummary }) {
  let currentGeneration = 0;

  return {
    load(url, signal) {
      const generation = ++currentGeneration;
      return Promise.resolve()
        .then(() => fetchSummary(url, { signal }))
        .then((data) => {
          if (generation === currentGeneration) {
            applySummary(data);
          }
          return data;
        })
        .catch((error) => {
          if (error?.name === "AbortError") {
            return;
          }
          if (generation === currentGeneration) {
            applySummary(null);
          }
        });
    },
    invalidate() {
      currentGeneration += 1;
    },
    getCurrentGeneration() {
      return currentGeneration;
    },
  };
}
