import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pg from "pg";
import { runMigrations, migrate } from "./migrate.js";

vi.mock("pg", () => {
  const Client = vi.fn();
  return {
    default: {
      Client,
    },
  };
});

describe("database migrations", () => {
  let tempDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "pfs-migration-test-"));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wraps successful migrations in transactions and records completion", async () => {
    writeFileSync(join(tempDir, "001_first.sql"), "CREATE TABLE test1 (id INT);");
    writeFileSync(join(tempDir, "002_second.sql"), "CREATE TABLE test2 (id INT);");

    const queryCalls = [];
    const client = {
      query: vi.fn(async (sql, params = []) => {
        queryCalls.push({ sql, params });
        if (typeof sql === "string" && sql.includes("SELECT 1 FROM _migrations")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await runMigrations(client, tempDir);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS _migrations"));

    const sqlQueries = queryCalls.map((c) => c.sql);
    expect(sqlQueries).toContain("BEGIN");
    expect(sqlQueries).toContain("COMMIT");
    expect(sqlQueries).not.toContain("ROLLBACK");

    const firstBeginIdx = sqlQueries.indexOf("BEGIN");
    const firstSqlIdx = sqlQueries.indexOf("CREATE TABLE test1 (id INT);");
    const firstCommitIdx = sqlQueries.indexOf("COMMIT");

    expect(firstBeginIdx).toBeLessThan(firstSqlIdx);
    expect(firstSqlIdx).toBeLessThan(firstCommitIdx);

    expect(client.query).toHaveBeenCalledWith("INSERT INTO _migrations (name) VALUES ($1)", ["001_first.sql"]);
    expect(client.query).toHaveBeenCalledWith("INSERT INTO _migrations (name) VALUES ($1)", ["002_second.sql"]);
  });

  it("skips migrations that have already been recorded", async () => {
    writeFileSync(join(tempDir, "001_first.sql"), "CREATE TABLE test1 (id INT);");

    const client = {
      query: vi.fn(async (sql) => {
        if (typeof sql === "string" && sql.includes("SELECT 1 FROM _migrations")) {
          return { rows: [{ "?column?": 1 }] };
        }
        return { rows: [] };
      }),
    };

    await runMigrations(client, tempDir);

    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
    expect(client.query).not.toHaveBeenCalledWith("CREATE TABLE test1 (id INT);");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.query).not.toHaveBeenCalledWith("ROLLBACK");
  });

  it("rolls back the transaction and re-throws when migration SQL fails", async () => {
    writeFileSync(join(tempDir, "001_fail.sql"), "INVALID SQL STATEMENT;");

    const queryCalls = [];
    const client = {
      query: vi.fn(async (sql) => {
        queryCalls.push(sql);
        if (typeof sql === "string" && sql.includes("SELECT 1 FROM _migrations")) {
          return { rows: [] };
        }
        if (sql === "INVALID SQL STATEMENT;") {
          throw new Error("syntax error at or near INVALID");
        }
        return { rows: [] };
      }),
    };

    await expect(runMigrations(client, tempDir)).rejects.toThrow("syntax error at or near INVALID");

    expect(queryCalls).toContain("BEGIN");
    expect(queryCalls).toContain("ROLLBACK");
    expect(queryCalls).not.toContain("COMMIT");
    expect(client.query).not.toHaveBeenCalledWith(
      "INSERT INTO _migrations (name) VALUES ($1)",
      ["001_fail.sql"]
    );
  });

  it("rolls back the transaction if recording migration fails", async () => {
    writeFileSync(join(tempDir, "001_fail_record.sql"), "CREATE TABLE test (id INT);");

    const queryCalls = [];
    const client = {
      query: vi.fn(async (sql) => {
        queryCalls.push(sql);
        if (typeof sql === "string" && sql.includes("SELECT 1 FROM _migrations")) {
          return { rows: [] };
        }
        if (typeof sql === "string" && sql.includes("INSERT INTO _migrations")) {
          throw new Error("disk full");
        }
        return { rows: [] };
      }),
    };

    await expect(runMigrations(client, tempDir)).rejects.toThrow("disk full");

    expect(queryCalls).toContain("BEGIN");
    expect(queryCalls).toContain("ROLLBACK");
    expect(queryCalls).not.toContain("COMMIT");
  });

  it("ensures client connection and cleanup in migrate()", async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    pg.Client.mockImplementation(function () { return mockClient; });

    await migrate("postgres://test", tempDir);

    expect(pg.Client).toHaveBeenCalledWith("postgres://test");
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });

  it("ensures client.end() is called even if migration fails in migrate()", async () => {
    writeFileSync(join(tempDir, "001_broken.sql"), "BROKEN;");
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(async (sql) => {
        if (typeof sql === "string" && sql.includes("SELECT 1 FROM _migrations")) {
          return { rows: [] };
        }
        if (sql === "BROKEN;") {
          throw new Error("fatal DDL failure");
        }
        return { rows: [] };
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    pg.Client.mockImplementation(function () { return mockClient; });

    await expect(migrate("postgres://test", tempDir)).rejects.toThrow("fatal DDL failure");
    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });
});
