import { applyPatchProposal, createPatchProposal, rollbackPatchProposal } from "@/features/diff/patch.service"
import type { PatchProposal } from "@/features/diff/diff.types"
import TauriService from "@/services/ipc/tauri.service"
import {
  isConfigured,
  sendChatMessage,
  type ChatMessage,
  type WorkspaceContext,
} from "@/services/chat/chat.service"
import type { AgentTask, AgentTaskType, ChangedFile, DiffSummary } from "./agent-runtime.types"
import { useAgentTaskStore } from "./agent-task.store"
import { useWorkspaceStore } from "@/features/workspace/store/workspace.store"
import { joinProjectPath, getProjectDisplayName, toRelativeProjectPath } from "@/shared/utils/project-path"

// ── types ─────────────────────────────────────────

interface RunTaskOptions {
  projectPath?: string
  projectName?: string
  activeFile?: string
  modelName?: string
  threadId?: string
}

interface ProjectOverview {
  summary: string
  importantFiles: string[]
  topLevelEntryCount: number
}

interface ParsedPatchFile {
  filePath: string
  newContent: string
}

// ── helpers ───────────────────────────────────────

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/")
}

function makeTitle(type: AgentTaskType, userRequest: string, projectName?: string): string {
  const prefix = projectName ? `${projectName}：` : ""
  const fallback = userRequest.trim().slice(0, 30)

  switch (type) {
    case "self_repair": return `${prefix}自修复分析`
    case "code_modify": return prefix + (fallback || "代码修改")
    case "context_scan": return `${prefix}项目上下文分析`
    case "chat": return fallback || "新对话"
    default: return prefix + (fallback || "新任务")
  }
}

function buildWorkspaceContext(taskId: string, userRequest: string, opts: RunTaskOptions): WorkspaceContext {
  return {
    projectPath: opts.projectPath,
    projectName: opts.projectName,
    activeFilePath: opts.activeFile,
    activeView: "agent-task",
    activeThreadId: opts.threadId || taskId,
    taskGoal: userRequest,
    includeFileContent: false,
  }
}

function proposalToTaskDiff(proposal: PatchProposal): { diff: DiffSummary; changedFiles: ChangedFile[] } {
  const hunks = proposal.files.flatMap((file) =>
    file.diff.hunks.map((hunk) => ({
      filePath: file.filePath,
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines: hunk.lines.map((line) => {
        const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "
        return `${prefix}${line.content}`
      }),
    })),
  )

  const changedFiles: ChangedFile[] = proposal.files.map((file) => ({
    path: file.filePath,
    absolutePath: proposal.projectPath ? joinProjectPath(proposal.projectPath, file.filePath) : file.filePath,
    status: file.status,
    oldContent: file.oldContent,
    newContent: file.newContent,
  }))

  return {
    diff: {
      added: proposal.summary.added,
      removed: proposal.summary.removed,
      files: proposal.summary.files,
      hunks,
    },
    changedFiles,
  }
}

// ── context collection ────────────────────────────

async function collectProjectOverview(projectPath?: string): Promise<ProjectOverview> {
  if (!projectPath) {
    return {
      summary: "当前未打开项目，仅能基于任务描述进行分析。",
      importantFiles: [],
      topLevelEntryCount: 0,
    }
  }

  try {
    const rootEntries = await TauriService.listDir(projectPath)
    const importantFiles = rootEntries
      .filter((entry) =>
        entry.is_file &&
        /^(package\.json|README\.md|Cargo\.toml|tsconfig\.json|vite\.config|tauri\.conf)/i.test(entry.name),
      )
      .map((entry) => entry.path)

    return {
      summary: `项目 ${getProjectDisplayName(projectPath)} 已读取，共发现 ${rootEntries.length} 个顶层条目。`,
      importantFiles,
      topLevelEntryCount: rootEntries.length,
    }
  } catch (error) {
    return {
      summary: `读取项目目录失败：${String(error)}`,
      importantFiles: [],
      topLevelEntryCount: 0,
    }
  }
}

async function readImportantFiles(filePaths: string[]): Promise<string> {
  const chunks: string[] = []

  for (const filePath of filePaths.slice(0, 4)) {
    try {
      const content = await TauriService.readFile(filePath)
      const snippet = content.length > 2400 ? `${content.slice(0, 2400)}\n... 已截断` : content
      chunks.push(`文件：${filePath}\n${snippet}`)
    } catch {
      chunks.push(`文件：${filePath}\n读取失败`)
    }
  }

  return chunks.join("\n\n")
}

async function buildTaskContext(projectPath?: string): Promise<ProjectOverview & { contextSummary: string }> {
  const overview = await collectProjectOverview(projectPath)
  const importantFilesText = await readImportantFiles(overview.importantFiles)

  return {
    ...overview,
    contextSummary: importantFilesText
      ? `${overview.summary}\n\n关键文件摘录：\n${importantFilesText}`
      : overview.summary,
  }
}

function buildContextNotice(task: AgentTask, overview: ProjectOverview): string {
  if (!task.projectPath) {
    return "已读取基础任务上下文。当前未打开项目，后续分析将仅基于你的描述。"
  }

  const importantCount = overview.importantFiles.length
  return `已读取项目上下文：${task.projectName || getProjectDisplayName(task.projectPath)}，顶层条目 ${overview.topLevelEntryCount} 个，关键文件 ${importantCount} 个。`
}

// ── prompt builders ────────────────────────────────

function buildPlanPrompt(type: AgentTaskType, request: string, opts: RunTaskOptions, contextSummary: string): string {
  const projectInfo = opts.projectPath
    ? `项目：${opts.projectName || getProjectDisplayName(opts.projectPath)}\n路径：${opts.projectPath}`
    : "当前未打开项目"

  return [
    "你是灵栈 LingStack 桌面 AI 工作台中的 Agent。",
    "请用中文输出 3-5 条可验证执行计划，保持克制、务实，不要假装已经修改文件。",
    "",
    projectInfo,
    opts.activeFile ? `当前文件：${opts.activeFile}` : "当前文件：未选择",
    "",
    `任务类型：${type}`,
    `用户任务：${request}`,
    "",
    `项目上下文：\n${contextSummary}`,
  ].join("\n")
}

function buildExecutionPrompt(request: string, opts: RunTaskOptions, contextSummary: string): string {
  return [
    "请基于当前项目上下文给出下一步执行结果。",
    "如果你非常确定需要修改当前文件，请只在回复末尾附加一个 lingstack_patch 代码块。",
    "补丁代码块格式必须是 JSON，文件内容必须是完整新内容：",
    "```lingstack_patch",
    '{"files":[{"path":"src/example.ts","content":"完整文件内容"}]}',
    "```",
    "",
    "如果不能确定完整新内容，就只给分析和建议，不要输出补丁块。",
    "",
    `项目：${opts.projectName || opts.projectPath || "未打开项目"}`,
    opts.activeFile ? `当前文件：${opts.activeFile}` : "当前文件：未选择",
    "",
    `项目上下文：\n${contextSummary}`,
    "",
    `用户任务：${request}`,
  ].join("\n")
}

function buildPatchPrompt(task: AgentTask, contextSummary: string): string {
  const latestAssistantMessages = task.messages
    .filter((message) => message.role === "assistant")
    .slice(-2)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n")

  return [
    "你现在需要继续生成可应用的补丁提案。",
    "请避免重复目录扫描结果，不要输出大段项目树。",
    "如果已经具备足够信息，请直接给出 lingstack_patch 代码块。",
    "如果信息仍不足，请先说明缺少什么，再谨慎给出下一步建议。",
    "补丁代码块必须使用完整文件内容，不接受片段 diff：",
    "```lingstack_patch",
    '{"files":[{"path":"src/example.ts","content":"完整文件内容"}]}',
    "```",
    "",
    `项目：${task.projectName || getProjectDisplayName(task.projectPath)}`,
    task.activeFile ? `当前文件：${task.activeFile}` : "当前文件：未选择",
    `原始任务：${task.userRequest}`,
    "",
    latestAssistantMessages ? `已有分析：\n${latestAssistantMessages}` : "已有分析：暂无",
    "",
    `项目上下文：\n${contextSummary}`,
  ].join("\n")
}

// ── patch parsing ──────────────────────────────────

function parsePatchFromText(text: string, opts: RunTaskOptions): ParsedPatchFile[] {
  const match = text.match(/```lingstack_patch\s*([\s\S]*?)```/)
  if (!match) return []

  try {
    const parsed = JSON.parse(match[1].trim())
    const files = Array.isArray(parsed.files)
      ? parsed.files
      : parsed.filePath && typeof parsed.content === "string"
        ? [{ path: parsed.filePath, content: parsed.content }]
        : []

    return files
      .map((file: Record<string, unknown>) => ({
        filePath: toRelativeProjectPath(opts.projectPath, String(file.path || file.filePath || "")),
        newContent: typeof file.content === "string"
          ? file.content
          : typeof file.newContent === "string"
            ? file.newContent
            : "",
      }))
      .filter((file: ParsedPatchFile) => file.filePath && file.filePath !== "未选择" && file.newContent.length > 0)
  } catch {
    return []
  }
}

function stripPatchBlock(text: string): string {
  return text.replace(/```lingstack_patch[\s\S]*?```/g, "").trim()
}

// ── LLM streaming ──────────────────────────────────

async function streamLLM(
  messages: ChatMessage[],
  context: WorkspaceContext,
  onErrorFallback: () => string,
): Promise<string> {
  let fullText = ""

  try {
    await sendChatMessage(
      messages,
      (token) => {
        fullText += token
      },
      (complete) => {
        fullText = complete || fullText
      },
      () => {
        fullText = onErrorFallback()
      },
      context,
    )
  } catch {
    fullText = onErrorFallback()
  }

  return fullText
}

// ── fallback text ──────────────────────────────────

function fallbackPlan(type: AgentTaskType, request: string, projectName?: string): string {
  if (type === "self_repair") {
    return [
      `已建立 ${projectName || "当前项目"} 的自修复任务。`,
      "建议计划：",
      "1. 先核对项目目录、入口文件和构建配置。",
      "2. 区分真实能力、桥接能力和占位能力。",
      "3. 优先修复影响主流程的断链与编码损坏。",
      "4. 只有生成真实文件变更后才进入 Diff 审查。",
    ].join("\n")
  }

  return [
    `已收到任务：${request}`,
    "当前没有可直接应用的补丁提案。",
    "如果需要代码修改，请打开目标文件并让 Agent 输出完整文件内容补丁。",
  ].join("\n")
}

function fallbackAnalysis(projectName?: string, hasProject = false): string {
  if (hasProject) {
    return `已完成第一轮分析。当前项目：${projectName || "未命名项目"}。如需继续修改，我可以下一步生成补丁提案。`
  }
  return "已收到任务。打开项目后，我可以读取上下文并继续生成更精确的计划或补丁。"
}

// ── editor sync helpers ────────────────────────────

function syncEditorAfterApply(workspaceStore: ReturnType<typeof useWorkspaceStore>, changedFiles: ChangedFile[]): void {
  for (const file of changedFiles) {
    if (file.newContent !== undefined && file.path) {
      workspaceStore.setFileContent(
        file.absolutePath || file.path,
        file.newContent,
      )
    }
  }
}

function syncEditorAfterRollback(workspaceStore: ReturnType<typeof useWorkspaceStore>, changedFiles: ChangedFile[]): void {
  for (const file of changedFiles) {
    if (file.oldContent !== undefined && file.path) {
      workspaceStore.setFileContent(
        file.absolutePath || file.path,
        file.oldContent,
      )
    }
  }
}

// ── main service ───────────────────────────────────

export function useAgentTaskService() {
  const store = useAgentTaskStore()
  const workspaceStore = useWorkspaceStore()

  // ── runTask: 主任务流水线 ───────────────────────

  async function runTask(type: AgentTaskType, userRequest: string, opts: RunTaskOptions = {}): Promise<AgentTask> {
    const title = makeTitle(type, userRequest, opts.projectName)
    const task = store.createTask(type, title, userRequest, opts)
    const taskId = task.id
    store.addMessage(taskId, "user", userRequest)

    try {
      // Step 1: 读取项目上下文
      store.updateTaskStatus(taskId, "building_context")
      const contextStep = store.addStep(taskId, "读取项目上下文")
      store.updateStep(taskId, contextStep.id, "running")

      const contextBundle = await buildTaskContext(opts.projectPath)
      store.updateStep(taskId, contextStep.id, "done")
      store.addMessage(taskId, "system", buildContextNotice(task, contextBundle))

      // Step 2: 生成执行计划
      store.updateTaskStatus(taskId, "planning")
      const planStep = store.addStep(taskId, "生成执行计划")
      store.updateStep(taskId, planStep.id, "running")

      const workspaceContext = buildWorkspaceContext(taskId, userRequest, opts)
      const planText = isConfigured()
        ? await streamLLM(
            [{ role: "user", content: buildPlanPrompt(type, userRequest, opts, contextBundle.contextSummary) }],
            workspaceContext,
            () => fallbackPlan(type, userRequest, opts.projectName),
          )
        : fallbackPlan(type, userRequest, opts.projectName)

      store.addMessage(taskId, "assistant", planText)
      store.updateStep(taskId, planStep.id, "done")

      // Step 3: 执行分析
      store.updateTaskStatus(taskId, "executing_tool")
      const executionStep = store.addStep(taskId, "生成分析结果")
      store.updateStep(taskId, executionStep.id, "running")

      const executionText = isConfigured()
        ? await streamLLM(
            [{ role: "user", content: buildExecutionPrompt(userRequest, opts, contextBundle.contextSummary) }],
            workspaceContext,
            () => fallbackAnalysis(opts.projectName, Boolean(opts.projectPath)),
          )
        : fallbackAnalysis(opts.projectName, Boolean(opts.projectPath))

      const parsedPatch = parsePatchFromText(executionText, opts)
      const visibleExecution = stripPatchBlock(executionText)

      if (visibleExecution) {
        store.addMessage(taskId, "assistant", visibleExecution)
      }

      store.updateStep(taskId, executionStep.id, "done")

      // Step 4: 生成补丁（如 LLM 输出了 patch block）
      if (opts.projectPath && parsedPatch.length > 0) {
        store.updateTaskStatus(taskId, "generating_diff")
        const diffStep = store.addStep(taskId, "生成补丁提案")
        store.updateStep(taskId, diffStep.id, "running")

        const proposal = await createPatchProposal({
          projectPath: opts.projectPath,
          taskId,
          files: parsedPatch.map((f) => ({
            filePath: f.filePath,
            newContent: f.newContent,
          })),
        })
        const { diff, changedFiles } = proposalToTaskDiff(proposal)
        store.setPatchProposal(taskId, proposal.id, diff, changedFiles)
        store.addMessage(taskId, "system", `已生成真实补丁提案：${proposal.id}，涉及 ${changedFiles.length} 个文件，等待你确认后应用。`)
        store.updateStep(taskId, diffStep.id, "done")
        store.updateTaskStatus(taskId, "waiting_confirm")
        return task
      }

      // 无 patch → analysis_done
      store.addMessage(taskId, "system", "分析完成，可继续生成补丁。当前还没有可审查的 Diff。")
      store.updateTaskStatus(taskId, "analysis_done")
      return task
    } catch (error) {
      store.updateTaskStatus(taskId, "failed", String(error))
      store.addMessage(taskId, "system", `任务执行失败：${String(error)}`)
      throw error
    }
  }

  // ── runChatTask: 简单对话 ────────────────────────

  async function runChatTask(
    text: string,
    projectPath?: string,
    projectName?: string,
    threadId?: string,
  ): Promise<AgentTask> {
    return runTask("chat", text, { projectPath, projectName, threadId })
  }

  // ── continueGeneratePatch: 从 analysis_done 继续 ─

  async function continueGeneratePatch(taskId: string): Promise<void> {
    const task = store.tasks.find((item) => item.id === taskId)
    if (!task) return

    if (!task.projectPath) {
      store.addMessage(taskId, "system", "当前未打开项目，无法继续生成补丁。请先打开项目。")
      store.updateTaskStatus(taskId, "analysis_done")
      return
    }

    store.updateTaskStatus(taskId, "patch_requested")
    const step = store.addStep(taskId, "继续生成补丁")
    store.updateStep(taskId, step.id, "running")

    try {
      const contextBundle = await buildTaskContext(task.projectPath)
      const workspaceContext = buildWorkspaceContext(taskId, task.userRequest, {
        projectPath: task.projectPath,
        projectName: task.projectName,
        activeFile: task.activeFile,
        modelName: task.modelName,
        threadId: task.threadId,
      })

      const patchText = isConfigured()
        ? await streamLLM(
            [{ role: "user", content: buildPatchPrompt(task, contextBundle.contextSummary) }],
            workspaceContext,
            () => "已完成补丁生成尝试，但当前上下文仍不足以输出安全补丁。你可以指定目标文件后继续。",
          )
        : "已完成补丁生成尝试，但当前未配置模型，暂时无法输出真实补丁。"

      const parsedPatch = parsePatchFromText(patchText, {
        projectPath: task.projectPath,
        projectName: task.projectName,
        activeFile: task.activeFile,
        modelName: task.modelName,
        threadId: task.threadId,
      })
      const visibleText = stripPatchBlock(patchText)

      if (visibleText) {
        store.addMessage(taskId, "assistant", visibleText)
      }

      if (parsedPatch.length > 0) {
        store.updateTaskStatus(taskId, "generating_diff")
        const proposal = await createPatchProposal({
          projectPath: task.projectPath,
          taskId,
          files: parsedPatch.map((f) => ({
            filePath: f.filePath,
            newContent: f.newContent,
          })),
        })
        const { diff, changedFiles } = proposalToTaskDiff(proposal)
        store.setPatchProposal(taskId, proposal.id, diff, changedFiles)
        store.updateStep(taskId, step.id, "done")
        store.addMessage(taskId, "system", `已生成新的补丁提案：${proposal.id}，涉及 ${changedFiles.length} 个文件，可以前往审查并确认应用。`)
        store.updateTaskStatus(taskId, "waiting_confirm")
        return
      }

      store.updateStep(taskId, step.id, "done")
      store.addMessage(taskId, "system", "分析完成，可继续生成补丁。当前仍未生成可应用变更。")
      store.updateTaskStatus(taskId, "analysis_done")
    } catch (error) {
      store.updateStep(taskId, step.id, "failed", String(error))
      store.updateTaskStatus(taskId, "failed", String(error))
      store.addMessage(taskId, "system", `补丁生成失败：${String(error)}`)
    }
  }

  // ── approveTask: 确认并应用补丁 ──────────────────

  async function approveTask(taskId: string): Promise<void> {
    const task = store.tasks.find((item) => item.id === taskId)
    if (!task?.patchProposalId || task.status !== "waiting_confirm") return

    const confirm = (window as any).__LINGSTACK_CONFIRM__ as
      | ((title: string, message: string, detail?: string) => Promise<boolean>)
      | undefined

    if (confirm) {
      const fileList = task.changedFiles.map((f) => `  ${f.status}  ${f.path}`).join("\n")
      const ok = await confirm(
        "应用补丁",
        `灵栈将把当前补丁写入本地项目文件（${task.changedFiles.length} 个文件）。`,
        `提案：${task.patchProposalId}\n${fileList}`,
      )
      if (!ok) return
    }

    store.updateTaskStatus(taskId, "applying_patch")
    const step = store.addStep(taskId, "应用补丁")
    store.updateStep(taskId, step.id, "running")

    try {
      const result = await applyPatchProposal(task.patchProposalId)
      if (!result.success) {
        throw new Error(result.error || "补丁应用失败")
      }

      store.updatePatchStatus(taskId, "applied")
      store.updateStep(taskId, step.id, "done")
      store.addMessage(taskId, "system", `补丁已成功应用到本地项目文件（${task.changedFiles.length} 个文件）。`)

      // 同步编辑器内容
      syncEditorAfterApply(workspaceStore, task.changedFiles)

      store.updateTaskStatus(taskId, "completed")
    } catch (error) {
      store.updateStep(taskId, step.id, "failed", String(error))
      store.updatePatchStatus(taskId, "failed", String(error))
      store.updateTaskStatus(taskId, "failed", String(error))
      store.addMessage(taskId, "system", `补丁应用失败：${String(error)}`)
    }
  }

  // ── rejectTask: 拒绝补丁 ─────────────────────────

  function rejectTask(taskId: string): void {
    const task = store.tasks.find((item) => item.id === taskId)
    if (!task) return

    store.updatePatchStatus(taskId, "rejected")
    store.updateTaskStatus(taskId, "failed", "补丁已被用户拒绝")
    store.addMessage(taskId, "system", "补丁已被拒绝。你可以调整需求后重新发起任务。")
  }

  // ── rollbackTask: 回滚已应用的补丁 ───────────────

  async function rollbackTask(taskId: string): Promise<void> {
    const task = store.tasks.find((item) => item.id === taskId)
    if (!task?.patchProposalId || task.patchStatus !== "applied") return

    const confirm = (window as any).__LINGSTACK_CONFIRM__ as
      | ((title: string, message: string, detail?: string) => Promise<boolean>)
      | undefined

    if (confirm) {
      const fileList = task.changedFiles.map((f) => `  ${f.path}`).join("\n")
      const ok = await confirm(
        "回滚补丁",
        `灵栈将把以下 ${task.changedFiles.length} 个文件恢复到补丁应用前的状态。`,
        `提案：${task.patchProposalId}\n${fileList}`,
      )
      if (!ok) return
    }

    store.updateTaskStatus(taskId, "applying_patch")
    const step = store.addStep(taskId, "回滚补丁")
    store.updateStep(taskId, step.id, "running")

    try {
      const result = await rollbackPatchProposal(task.patchProposalId)
      if (!result.success) {
        throw new Error(result.error || "回滚失败")
      }

      store.updatePatchStatus(taskId, "rolled_back")
      store.updateStep(taskId, step.id, "done")
      store.addMessage(taskId, "system", `补丁已回滚，${task.changedFiles.length} 个文件已恢复到应用前的状态。`)

      // 同步编辑器：恢复到旧内容
      syncEditorAfterRollback(workspaceStore, task.changedFiles)

      store.updateTaskStatus(taskId, "completed")
    } catch (error) {
      store.updateStep(taskId, step.id, "failed", String(error))
      store.updatePatchStatus(taskId, "failed", String(error))
      store.updateTaskStatus(taskId, "failed", String(error))
      store.addMessage(taskId, "system", `补丁回滚失败：${String(error)}`)
    }
  }

  return {
    runTask,
    runChatTask,
    approveTask,
    rejectTask,
    rollbackTask,
    continueGeneratePatch,
  }
}
