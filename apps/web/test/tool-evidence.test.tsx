import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchDialog } from "../src/components/ResearchDialog";
import { createDemoClient } from "../dev/demo-client";

test("evidence directory distinguishes actual return, failure and missing historical result", async () => {
  const base = await createDemoClient().session("empty");
  const snapshot = { ...base, turns: [{ id: "turn", role: "assistant" as const, state: "settled" as const, text: "answer", at: "2026-10-28", activity: [
    { id: "failed-call", name: "fetch_snapshot", state: "failed" as const, result: { text: "error <script>bad()</script>", truncated: false, omittedBlocks: 0, capturedAt: "2026-10-28T01:00:00Z" } },
    { id: "old-call", name: "fetch_bars", state: "completed" as const },
  ] }] };
  const html = renderToStaticMarkup(<ResearchDialog page="evidence" setPage={() => {}} snapshot={snapshot} title="synthetic" demo={false} onClose={() => {}} />);
  expect(html).toContain("工具返回记录 1 / 2"); expect(html).toContain("未成功"); expect(html).toContain("未保存工具原始结果");
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain("failed-call");
});
