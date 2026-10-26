import { describe, expect, it } from "vitest";
import { createDashboardPaginationGate } from "./dashboard-pagination.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createDashboardPaginationGate", () => {
  it("allows starting a page and finishes it", () => {
    const gate = createDashboardPaginationGate();
    gate.startGeneration();
    expect(gate.isPaging()).toBe(false);

    const ticket = gate.startPage();
    expect(ticket).not.toBeNull();
    expect(gate.isPaging()).toBe(true);
    expect(gate.isPageCurrent(ticket)).toBe(true);

    // Cannot start concurrent page in the same generation
    expect(gate.startPage()).toBeNull();

    const stillPaging = gate.finishPage(ticket);
    expect(stillPaging).toBe(false);
    expect(gate.isPaging()).toBe(false);
  });

  it("handles page A in flight, filter reset, page B in flight, late A completion, then B completion", async () => {
    const gate = createDashboardPaginationGate();
    const appliedItems = [];

    // Generation 1 starts
    gate.startGeneration();
    const defA = deferred();
    const ticketA = gate.startPage();
    expect(ticketA).not.toBeNull();
    expect(gate.isPaging()).toBe(true);

    const runA = defA.promise
      .then((items) => {
        if (!gate.isPageCurrent(ticketA)) return "ignored";
        appliedItems.push(...items);
        return "applied";
      })
      .catch((error) => {
        if (!gate.isPageCurrent(ticketA)) return "ignored-error";
        throw error;
      })
      .finally(() => {
        gate.finishPage(ticketA);
      });

    // User switches filter: generation 2 starts
    gate.startGeneration();
    // After generation reset, paging in-flight must be cleared
    expect(gate.isPaging()).toBe(false);
    expect(gate.isPageCurrent(ticketA)).toBe(false);

    // Generation 2 starts page B
    const defB = deferred();
    const ticketB = gate.startPage();
    expect(ticketB).not.toBeNull();
    expect(gate.isPaging()).toBe(true);
    expect(gate.isPageCurrent(ticketB)).toBe(true);

    const runB = defB.promise
      .then((items) => {
        if (!gate.isPageCurrent(ticketB)) return "ignored";
        appliedItems.push(...items);
        return "applied";
      })
      .catch((error) => {
        if (!gate.isPageCurrent(ticketB)) return "ignored-error";
        throw error;
      })
      .finally(() => {
        gate.finishPage(ticketB);
      });

    // Page A finishes late with data
    defA.resolve([{ id: 101, title: "Old Page A item" }]);
    const resultA = await runA;
    expect(resultA).toBe("ignored");
    expect(appliedItems).toEqual([]);
    // Finishing old page A must not clear page B's in-flight status!
    expect(gate.isPaging()).toBe(true);

    // Page B finishes
    defB.resolve([{ id: 201, title: "New Page B item" }]);
    const resultB = await runB;
    expect(resultB).toBe("applied");
    expect(appliedItems).toEqual([{ id: 201, title: "New Page B item" }]);
    expect(gate.isPaging()).toBe(false);

    // Paging is available again for generation 2
    const ticketC = gate.startPage();
    expect(ticketC).not.toBeNull();
    expect(gate.isPaging()).toBe(true);
  });

  it("handles page A erroring late after filter reset", async () => {
    const gate = createDashboardPaginationGate();
    gate.startGeneration();
    const defA = deferred();
    const ticketA = gate.startPage();

    let errorHandled = false;
    const runA = defA.promise
      .then(() => "ok")
      .catch(() => {
        if (gate.isPageCurrent(ticketA)) {
          errorHandled = true;
        }
      })
      .finally(() => {
        gate.finishPage(ticketA);
      });

    // Filter reset
    gate.startGeneration();
    expect(gate.isPaging()).toBe(false);

    // Page A errors late
    defA.reject(new Error("Network failed"));
    await runA;
    expect(errorHandled).toBe(false);
    expect(gate.isPaging()).toBe(false);
  });

  it("clears page in-flight on reset without a subsequent page", () => {
    const gate = createDashboardPaginationGate();
    gate.startGeneration();
    const ticketA = gate.startPage();
    expect(gate.isPaging()).toBe(true);

    // Reset without starting a new page
    gate.startGeneration();
    expect(gate.isPaging()).toBe(false);

    // Old ticket completion does not affect state
    gate.finishPage(ticketA);
    expect(gate.isPaging()).toBe(false);

    // Next page can start
    expect(gate.startPage()).not.toBeNull();
  });

  it("invalidates all tickets on unmount/cleanup", () => {
    const gate = createDashboardPaginationGate();
    const { generation } = gate.startGeneration();
    const ticket = gate.startPage();
    expect(gate.isPageCurrent(ticket)).toBe(true);

    gate.invalidate();
    expect(gate.isGenerationCurrent(generation)).toBe(false);
    expect(gate.isPageCurrent(ticket)).toBe(false);
    expect(gate.isPaging()).toBe(false);
  });
});
