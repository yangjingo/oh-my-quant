export {
	type AgentHarnessEvent,
	type AgentHarnessOptions,
	type AgentHarnessStreamOptionsPatch,
	type BranchSummaryEntry,
	type CompactResult,
	type ExecutionEnv,
	FileError,
	type FileInfo,
	type JsonlSessionMetadata,
	type NavigateTreeResult,
	type PromptTemplate,
	type Result,
	type Session,
	type SessionContext,
	type SessionTreeEntry,
	type Skill,
	type AgentHarnessResources,
	type AgentHarnessOwnEvent,
	type AgentHarnessPhase,
	type AgentHarnessStreamOptions,
	type PendingSessionWrite,
	AgentHarnessError,
	BranchSummaryError,
	CompactionError,
	SessionError,
	err,
	ok,
	toError,
} from "./harness/types.ts";

export { AgentHarness } from "./harness/agent-harness.ts";
export {
	type BranchPreparation,
	type BranchSummaryDetails,
	type CollectEntriesResult,
	collectEntriesForBranchSummary,
	generateBranchSummary,
	prepareBranchEntries,
} from "./harness/compaction/branch-summarization.ts";
export {
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	estimateTokens,
	findCutPoint,
	findTurnStartIndex,
	generateSummary,
	getLastAssistantUsage,
	prepareCompaction,
	serializeConversation,
	shouldCompact,
} from "./harness/compaction/compaction.ts";
export { convertToLlm } from "./harness/messages.ts";
export { formatSkillsForSystemPrompt } from "./harness/system-prompt.ts";
export { loadSourcedSkills, type SkillDiagnostic } from "./harness/skills.ts";
export { JsonlSessionRepo } from "./harness/session/jsonl-repo.ts";
export { Session as SessionImpl } from "./harness/session/session.ts";
export { executeShellWithCapture } from "./harness/utils/shell-output.ts";
export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from "./harness/utils/truncate.ts";
export type {
	AgentContext,
	AgentEvent,
	AgentMessage,
	AgentTool,
	AgentToolResult,
	QueueMode,
	StreamFn,
	ThinkingLevel,
} from "./types.ts";
