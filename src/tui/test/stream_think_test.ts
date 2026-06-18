import { describe, expect, it } from "bun:test";
import { Buffer, wrap, sanitizeTerminalText } from "../src/buffer.ts";
import { S } from "../src/styles.ts";
import { buildConversationView, drawConversation, layout } from "../src/render.ts";
import type { UIMessage } from "../src/types.ts";

function extractThinking(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; thinking?: string }>)
    .filter((c) => c.type === "thinking" && c.thinking)
    .map((c) => c.thinking!)
    .join("\n");
}

function extractText(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");
}

describe("thinking streaming display", () => {
  it("shows thinking text during streaming when message_update carries thinking blocks", () => {
    const messages: UIMessage[] = [];
    
    // message_start (assistant role)
    messages.push({ role: "thinking", text: "", thinkingLive: true });
    messages.push({ role: "assistant", text: "" });
    
    // message_update with thinking content (simulating deepseek reasoning_content)
    const update = { 
      content: [
        { type: "thinking", thinking: "正在分析数据...需要查看历史价格", thinkingSignature: "reasoning_content" },
        { type: "text", text: "根据分析结果，" }
      ] 
    };
    
    const thinking = extractThinking(update);
    if (thinking.trim()) {
      // upsertThinkingMessage simulation
      const lastAsstIdx = messages.length - 1;
      const prev = messages[lastAsstIdx - 1];
      if (prev?.role === "thinking") {
        prev.text = thinking;
      }
    }
    messages[messages.length - 1].text = extractText(update);
    
    // Render
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    drawConversation(buf, L.conversation, messages, "thinking", L.mainPane);
    
    const rows = buf.toPlain().map(r => r.slice(L.conversation.x, L.conversation.x + L.conversation.w));
    const hasThinking = rows.some(r => r.includes("正在分析数据...需要查看历史价格"));
    const hasText = rows.some(r => r.includes("根据分析结果，"));
    
    expect(hasThinking).toBe(true);
    expect(hasText).toBe(true);
  });

  it("shows thinking text even when text content arrives before thinking", () => {
    const messages: UIMessage[] = [];
    messages.push({ role: "thinking", text: "", thinkingLive: true });
    messages.push({ role: "assistant", text: "" });
    
    // First update: only text (no thinking yet)
    const update1 = { 
      content: [
        { type: "text", text: "Based on " }
      ] 
    };
    const t1 = extractThinking(update1);
    if (t1.trim()) {
      messages[0].text = t1;
    }
    messages[1].text = extractText(update1);
    
    // Second update: thinking arrives
    const update2 = { 
      content: [
        { type: "thinking", thinking: "Let me analyze the data first...", thinkingSignature: "reasoning_content" },
        { type: "text", text: "Based on the analysis, " }
      ] 
    };
    const t2 = extractThinking(update2);
    if (t2.trim()) {
      messages[0].text = t2;
    }
    messages[1].text = extractText(update2);
    
    const buf = new Buffer(100, 24);
    const L = layout(100, 24);
    drawConversation(buf, L.conversation, messages, "thinking", L.mainPane);
    
    const rows = buf.toPlain().map(r => r.slice(L.conversation.x, L.conversation.x + L.conversation.w));
    expect(rows.some(r => r.includes("Let me analyze the data first"))).toBe(true);
    expect(rows.some(r => r.includes("Based on the analysis"))).toBe(true);
  });

  it("removes empty thinking after finalize", () => {
    const messages: UIMessage[] = [];
    messages.push({ role: "thinking", text: "", thinkingLive: true });
    messages.push({ role: "assistant", text: "" });
    
    // finalizeThinking simulation
    const thinkMsg = messages[0];
    thinkMsg.thinkingLive = false;
    if (!thinkMsg.text?.trim()) {
      messages.splice(0, 1);
    }
    
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("assistant");
  });

  it("keeps thinking content after finalize", () => {
    const messages: UIMessage[] = [];
    messages.push({ role: "thinking", text: "Real thinking content", thinkingLive: true });
    messages.push({ role: "assistant", text: "Response text" });
    
    // finalizeThinking simulation
    const thinkMsg = messages.find((m) => m.role === "thinking" && m.thinkingLive);
    if (thinkMsg) {
      thinkMsg.thinkingLive = false;
      if (!thinkMsg.text?.trim()) messages.splice(messages.indexOf(thinkMsg), 1);
    }
    
    expect(messages.length).toBe(2);
    expect(messages[0]).toMatchObject({
      role: "thinking",
      text: "Real thinking content",
      thinkingLive: false,
    });
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].text).toBe("Response text");
  });
});
