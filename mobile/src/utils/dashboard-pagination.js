export function createDashboardPaginationGate() {
  let generation = 0;
  let pageInFlight = false;
  let pageCounter = 0;

  return {
    startGeneration() {
      generation += 1;
      pageInFlight = false;
      return { generation };
    },
    getGeneration() {
      return generation;
    },
    isGenerationCurrent(gen) {
      return gen === generation;
    },
    startPage() {
      if (pageInFlight) return null;
      pageInFlight = true;
      pageCounter += 1;
      return { generation, pageId: pageCounter };
    },
    isPageCurrent(ticket) {
      return Boolean(ticket && ticket.generation === generation);
    },
    finishPage(ticket) {
      if (ticket && ticket.generation === generation) {
        pageInFlight = false;
      }
      return pageInFlight;
    },
    isPaging() {
      return pageInFlight;
    },
    invalidate() {
      generation += 1;
      pageInFlight = false;
    },
  };
}
