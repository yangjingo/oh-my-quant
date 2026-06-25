import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  saveComparison,
  loadComparison,
  listComparisons,
  deleteComparison,
  generateComparisonId,
} from "../src/comparison.ts";
import type { GroupComparisonResult } from "../../quant/group-comparison.ts";

const OHQ = join(process.cwd(), ".ohquant-test-comparison");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("comparison storage", () => {
  it("saves and loads comparison artifact", () => {
    const mockResult: GroupComparisonResult = {
      groupId: "group-1",
      groupName: "科技组",
      symbolCount: 3,
      risk: {
        annualVol: 0.25,
        downsideVol: 0.2,
        maxDrawdown: -0.15,
        maxDdDays: 24,
        var95: -0.02,
        var95Parametric: -0.018,
        var99: -0.03,
        cvar95: -0.025,
        cvar99: -0.035,
        skewness: -0.5,
        kurtosis: 3.2,
      },
      totalReturn: 0.12,
      navSeries: [
        { date: "2026-01-01", nav: 1.0 },
        { date: "2026-01-02", nav: 1.02 },
        { date: "2026-01-03", nav: 1.05 },
      ],
    };

    const artifact = {
      id: "cmp-2026-06-10-120000",
      createdAt: "2026-06-10T12:00:00.000Z",
      groups: [mockResult],
    };

    saveComparison(artifact);
    const loaded = loadComparison(artifact.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(artifact.id);
    expect(loaded!.createdAt).toBe(artifact.createdAt);
    expect(loaded!.groups.length).toBe(1);
    expect(loaded!.groups[0].groupId).toBe("group-1");
    expect(loaded!.groups[0].groupName).toBe("科技组");
    expect(loaded!.groups[0].totalReturn).toBe(0.12);
  });

  it("returns null for non-existent comparison", () => {
    const loaded = loadComparison("non-existent-id");
    expect(loaded).toBeNull();
  });

  it("lists comparisons sorted by createdAt descending", () => {
    const artifact1 = {
      id: "cmp-2026-06-01-120000",
      createdAt: "2026-06-01T12:00:00.000Z",
      groups: [],
    };
    const artifact2 = {
      id: "cmp-2026-06-10-120000",
      createdAt: "2026-06-10T12:00:00.000Z",
      groups: [],
    };
    const artifact3 = {
      id: "cmp-2026-06-05-120000",
      createdAt: "2026-06-05T12:00:00.000Z",
      groups: [],
    };

    saveComparison(artifact1);
    saveComparison(artifact2);
    saveComparison(artifact3);

    const list = listComparisons();
    expect(list.length).toBe(3);
    expect(list[0].id).toBe("cmp-2026-06-10-120000");
    expect(list[1].id).toBe("cmp-2026-06-05-120000");
    expect(list[2].id).toBe("cmp-2026-06-01-120000");
  });

  it("deletes comparison artifact", () => {
    const artifact = {
      id: "cmp-2026-06-10-120000",
      createdAt: "2026-06-10T12:00:00.000Z",
      groups: [],
    };
    saveComparison(artifact);
    expect(loadComparison(artifact.id)).not.toBeNull();

    const deleted = deleteComparison(artifact.id);
    expect(deleted).toBe(true);
    expect(loadComparison(artifact.id)).toBeNull();
  });

  it("returns false when deleting non-existent comparison", () => {
    const deleted = deleteComparison("non-existent-id");
    expect(deleted).toBe(false);
  });

  it("generates comparison ID with timestamp", () => {
    const id = generateComparisonId();
    expect(id).toMatch(/^cmp-\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  it("returns empty list when no comparisons exist", () => {
    const list = listComparisons();
    expect(list).toEqual([]);
  });
});
