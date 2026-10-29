export class WorkbenchError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

/** Only deliberate public diagnostics cross the boundary; provider/parser errors may contain secrets. */
export function publicError(error: unknown) {
  if (error instanceof WorkbenchError) return error;
  const code = (error as { code?: string } | null)?.code;
  if (code === "ESTORAGECONFLICT") return new WorkbenchError(code, "设置已被其他窗口修改，请重新连接后再保存。", 409);
  if (code === "ESTORAGEFORMAT") return new WorkbenchError(code, "本机设置文件无效，原文件已保留，请在本机修复。", 503);
  if (code === "ELOCKED") return new WorkbenchError(code, "设置正被使用，请稍后重试。", 409);
  return new WorkbenchError("WORKBENCH_FAILED", "操作未完成，请检查本机模型设置或重试。", 503);
}

/** Classify provider failures without copying response bodies, request headers or credentials. */
export function modelError(error: unknown): WorkbenchError {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(?:401|403)\b|unauthorized|invalid.api.key|configure.credentials/i.test(message)) return new WorkbenchError("MODEL_AUTH", "模型服务未接受当前凭据，请检查本机模型配置。", 502);
  if (/\b429\b|rate.limit/i.test(message)) return new WorkbenchError("MODEL_RATE_LIMIT", "模型服务暂时限流，请稍后再试；界面不会自动重复提交。", 502);
  if (/timeout|timed.out|ETIMEDOUT/i.test(message)) return new WorkbenchError("MODEL_TIMEOUT", "模型响应超时，已返回内容保留，请核对会话后再重试。", 504);
  if (/socket.*closed|connection.*(?:reset|closed)|ECONNRESET|fetch.failed|network.error|terminated/i.test(message)) return new WorkbenchError("MODEL_CONNECTION", "模型连接在回答完成前中断，已返回内容保留，请核对会话后再重试。", 502);
  return new WorkbenchError("MODEL_REQUEST_FAILED", "研究请求未完成，请检查本机配置或重试。", 502);
}
