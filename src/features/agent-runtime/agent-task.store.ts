import { defineStore } from "pinia"
import { computed, ref } from "vue"
import type { AgentTask, AgentTaskStatus, AgentTaskStep, AgentTaskType, ChangedFile, DiffSummary, ToolCallRecord } from "./agent-runtime.types"
import { runtimeEventBus } from "./runtime-event-bus"

const STORAGE_KEY = "lingstack_agent_tasks"

function loadTasks(): AgentTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveTasks(tasks: AgentTask[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export const useAgentTaskStore = defineStore("agentTask", () => {
  const tasks = ref<AgentTask[]>(loadTasks())
  const activeTaskId = ref<string | null>(null)

  const activeTask = computed<AgentTask | null>(() =>
    tasks.value.find((task) => task.id === activeTaskId.value) ?? null,
  )

  const runningTasks = computed(() =>
    tasks.value.filter((task) =>
      [
        "created",
        "building_context",
        "planning",
        "waiting_tool",
        "executing_tool",
        "patch_requested",
        "generating_diff",
        "waiting_confirm",
        "applying_patch",
      ].includes(task.status),
    ),
  )

  const completedTasks = computed(() =>
    tasks.value.filter((task) => task.status === "completed" || task.status === "analysis_done"),
  )

  function getLatestTaskByThread(threadId: string): AgentTask | null {
    return tasks.value
      .filter((task) => task.threadId === threadId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null
  }

  function createTask(
    type: AgentTaskType,
    title: string,
    userRequest: string,
    opts?: {
      projectPath?: string
      projectName?: string
      activeFile?: string
      modelName?: string
      threadId?: string
    },
  ): AgentTask {
    const now = new Date().toISOString()
    const task: AgentTask = {
      id: generateId("task"),
      threadId: opts?.threadId,
      type,
      title,
      userRequest,
      projectPath: opts?.projectPath,
      projectName: opts?.projectName,
      activeFile: opts?.activeFile,
      modelName: opts?.modelName || "未配置模型",
      status: "created",
      steps: [],
      messages: [],
      toolCalls: [],
      changedFiles: [],
      patchStatus: "none",
      createdAt: now,
      updatedAt: now,
    }

    tasks.value.unshift(task)
    activeTaskId.value = task.id
    persist()
    runtimeEventBus.emit("task_created", task.id, { taskType: type, title, threadId: opts?.threadId })
    return task
  }

  function setActiveTask(id: string | null): void {
    activeTaskId.value = id
  }

  function updateTaskStatus(id: string, status: AgentTaskStatus, error?: string): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    task.status = status
    task.updatedAt = new Date().toISOString()
    if (error) task.error = error
    if (status === "completed" || status === "failed" || status === "cancelled") {
      task.completedAt = new Date().toISOString()
    }

    persist()
    runtimeEventBus.emit("task_status_changed", id, { status, error, threadId: task.threadId })
    if (status === "completed") runtimeEventBus.emit("task_completed", id, { threadId: task.threadId })
    if (status === "failed") runtimeEventBus.emit("task_failed", id, { error, threadId: task.threadId })
  }

  function addStep(id: string, title: string): AgentTaskStep {
    const step: AgentTaskStep = {
      id: generateId("step"),
      title,
      status: "pending",
    }

    const task = tasks.value.find((item) => item.id === id)
    if (task) {
      task.steps.push(step)
      task.updatedAt = new Date().toISOString()
      persist()
    }

    return step
  }

  function updateStep(id: string, stepId: string, status: AgentTaskStep["status"], error?: string): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    const step = task.steps.find((item) => item.id === stepId)
    if (!step) return

    step.status = status
    if (status === "running") step.startedAt = new Date().toISOString()
    if (status === "done" || status === "failed") step.completedAt = new Date().toISOString()
    if (error) step.error = error
    task.updatedAt = new Date().toISOString()
    persist()

    if (status === "running") {
      runtimeEventBus.emit("step_started", id, { stepId, title: step.title, threadId: task.threadId })
    }
    if (status === "done") {
      runtimeEventBus.emit("step_completed", id, { stepId, title: step.title, threadId: task.threadId })
    }
  }

  function addMessage(id: string, role: "user" | "assistant" | "system" | "tool", content: string, meta?: Record<string, unknown>): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    task.messages.push({
      id: generateId("msg"),
      role,
      content,
      createdAt: new Date().toISOString(),
      meta,
    })
    task.updatedAt = new Date().toISOString()
    persist()
    runtimeEventBus.emit("message_added", id, { role, threadId: task.threadId })
  }

  function addToolCall(id: string, toolName: string, params: Record<string, unknown>): ToolCallRecord | null {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return null

    const record: ToolCallRecord = {
      id: generateId("tool"),
      toolName,
      params,
      status: "running",
      startedAt: new Date().toISOString(),
    }

    task.toolCalls.push(record)
    task.updatedAt = new Date().toISOString()
    persist()
    return record
  }

  function updateToolCall(id: string, recordId: string, patch: Partial<Pick<ToolCallRecord, "status" | "result" | "error">>): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    const record = task.toolCalls.find((item) => item.id === recordId)
    if (!record) return

    Object.assign(record, patch)
    if (patch.status === "done" || patch.status === "failed") {
      record.completedAt = new Date().toISOString()
    }
    task.updatedAt = new Date().toISOString()
    persist()
  }

  function setDiff(id: string, diff: DiffSummary, changedFiles: ChangedFile[]): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    task.diff = diff
    task.changedFiles = changedFiles
    task.updatedAt = new Date().toISOString()
    persist()
    runtimeEventBus.emit("diff_generated", id, { files: changedFiles.length, threadId: task.threadId })
  }

  function setPatchProposal(id: string, proposalId: string, diff: DiffSummary, changedFiles: ChangedFile[]): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    task.patchProposalId = proposalId
    task.patchStatus = "proposed"
    task.diff = diff
    task.changedFiles = changedFiles
    task.updatedAt = new Date().toISOString()
    persist()
    runtimeEventBus.emit("diff_generated", id, { files: changedFiles.length, proposalId, threadId: task.threadId })
    runtimeEventBus.emit("waiting_confirm", id, { proposalId, threadId: task.threadId })
  }

  function updatePatchStatus(id: string, status: NonNullable<AgentTask["patchStatus"]>, error?: string): void {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return

    task.patchStatus = status
    if (error) task.error = error
    task.updatedAt = new Date().toISOString()
    persist()

    if (status === "applied") {
      runtimeEventBus.emit("patch_applied", id, { proposalId: task.patchProposalId, threadId: task.threadId })
    }
  }

  function clearCompleted(): void {
    tasks.value = tasks.value.filter((task) => task.status !== "completed" && task.status !== "cancelled")
    persist()
  }

  function hydrate(): void {
    tasks.value = loadTasks()
  }

  function persist(): void {
    saveTasks(tasks.value)
  }

  return {
    tasks,
    activeTaskId,
    activeTask,
    runningTasks,
    completedTasks,
    getLatestTaskByThread,
    createTask,
    setActiveTask,
    updateTaskStatus,
    addStep,
    updateStep,
    addMessage,
    addToolCall,
    updateToolCall,
    setDiff,
    setPatchProposal,
    updatePatchStatus,
    clearCompleted,
    hydrate,
    persist,
  }
})
