import { Type } from "typebox";
import type { AgentTool } from "../../agent/src/session-runtime/index.ts";
import { requestString } from "./requests.ts";

export const CLARIFICATION_TOOL = "ask_user";

/** An explicit user question, executed and journalled by the existing Pi loop. */
export function clarificationTool(receive: (question: string) => void): AgentTool {
  return {
    name: CLARIFICATION_TOOL, label: "澄清研究问题",
    description: "研究需要用户补充范围或作出选择时，提出一个明确问题并等待回答。单独调用此工具，不与其他工具放在同一批次。",
    parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_id, input) {
      const question = requestString((input as { question: unknown }).question, 1000).trim();
      receive(question);
      return { content: [{ type: "text", text: question }], details: { question }, terminate: true };
    },
  };
}
