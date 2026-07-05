export type AgentTaskType =
  | "chat"
  | "code_modify"
  | "self_repair"
  | "context_scan"
  | "generate_plan"
  | "generate_diff"
  | "apply_patch"
  | "run_command"
  | "review_changes"

export type AgentTaskStatus =
  | "idle"
  | "created"
  | "building_context"
  | "planning"
  | "waiting_tool"
  | "executing_tool"
  | "analysis_done"
  | "patch_requested"
  | "generating_diff"
  | "waiting_confirm"
  | "applying_patch"
  | "completed"
  | "failed"
  | "cancelled"

export interface AgentTaskStep {
  id: string
  title: string
  status: "pending" | "running" | "done" | "failed" | "skipped"
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface AgentContextSnapshot {
  projectPath?: string
  projectName?: string
  activeFile?: string
  openTabs: number
  relatedFiles: string[]
  projectTreeSummary?: string
  selectedText?: string
}

export interface AgentTask {
  id: string
  threadId?: string
  type: AgentTaskType
  title: string
  userRequest: string
  projectPath?: string
  projectName?: string
  activeFile?: string
  modelName?: string
  status: AgentTaskStatus
  steps: AgentTaskStep[]
  context?: AgentContextSnapshot
  messages: AgentMessage[]
  toolCalls: ToolCallRecord[]
  diff?: DiffSummary
  changedFiles: ChangedFile[]
  patchProposalId?: string
  patchStatus?: "none" | "proposed" | "applied" | "rolled_back" | "rejected" | "failed"
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
}

export interface AgentMessage {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  createdAt: string
  streaming?: boolean
  error?: boolean
}

export interface ToolCallRecord {
  id: string
  toolName: string
  params: Record<string, unknown>
  result?: string
  status: "pending" | "running" | "done" | "failed"
  startedAt: string
  completedAt?: string
  error?: string
}

export interface DiffSummary {
  added: number
  removed: number
  files: number
  hunks: DiffHunk[]
}

export interface DiffHunk {
  filePath: string
  oldStart: number
  newStart: number
  lines: string[]
}

export interface ChangedFile {
  path: string
  absolutePath?: string
  status: "M" | "A" | "D" | "R" | "new"
  oldContent?: string
  newContent?: string
}

export type RuntimeEventType =
  | "task_created"
  | "task_status_changed"
  | "step_started"
  | "step_completed"
  | "message_added"
  | "tool_call_started"
  | "tool_call_completed"
  | "diff_generated"
  | "waiting_confirm"
  | "patch_applied"
  | "task_completed"
  | "task_failed"

export interface RuntimeEvent {
  type: RuntimeEventType
  taskId: string
  timestamp: string
  payload?: Record<string, unknown>
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void
