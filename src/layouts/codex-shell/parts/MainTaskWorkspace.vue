<script setup lang="ts">
import { computed, ref, watch } from "vue"
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Circle,
  FolderGit2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  X,
} from "lucide-vue-next"
import CenterThreadPane from "./CenterThreadPane.vue"
import WorkspaceShell from "@/features/workspace/components/WorkspaceShell.vue"
import { useAgentTaskService } from "@/features/agent-runtime/agent-task.service"
import { useAgentTaskStore } from "@/features/agent-runtime/agent-task.store"
import { useProjectStore } from "@/features/projects/store/project.store"
import { useThreadStore } from "@/features/threads/store/thread.store"
import { useProjectService } from "@/features/workspace/composables/useProjectService"
import { useWorkspaceStore } from "@/features/workspace/store/workspace.store"

const props = withDefaults(defineProps<{ view?: "chat" | "project" }>(), {
  view: "chat",
})

const agentTaskService = useAgentTaskService()
const agentTaskStore = useAgentTaskStore()
const projectService = useProjectService()
const projectStore = useProjectStore()
const threadStore = useThreadStore()
const workspaceStore = useWorkspaceStore()

const message = ref("")
const isSending = ref(false)
const inputMode = ref<"qa" | "agent">("qa")

function getProjectDisplayName(projectPath?: string | null): string {
  if (!projectPath) return "未打开项目"
  const normalized = projectPath.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || "未命名项目"
}

function createThreadTitle(text?: string): string {
  const projectName = projectStore.currentProjectName || getProjectDisplayName(projectStore.currentProjectPath)
  if (projectStore.currentProjectPath && text) return `新任务：${text.slice(0, 24)}`
  if (projectStore.currentProjectPath) return `新任务：${projectName}`
  return text ? text.slice(0, 24) : "新线程"
}

const hasProject = computed(() => Boolean(projectStore.currentProjectPath))
const hasThread = computed(() => threadStore.activeThread !== null)
const activeThreadId = computed(() => threadStore.activeThread?.id || "")
const activeTask = computed(() =>
  activeThreadId.value ? agentTaskStore.getLatestTaskByThread(activeThreadId.value) : null,
)
const activeFilePath = computed(() => workspaceStore.activeTab?.filePath || "")
const activeFileName = computed(() => workspaceStore.activeTab?.fileName || "未选择")
const showProjectView = computed(() => props.view === "project")
const showProjectShell = computed(() => showProjectView.value && hasProject.value)
const showChatWelcome = computed(() => !showProjectView.value && !hasThread.value)
const canApplyPatch = computed(() =>
  activeTask.value?.status === "waiting_confirm" && activeTask.value.patchStatus === "proposed",
)
const canContinuePatch = computed(() =>
  activeTask.value?.status === "analysis_done",
)
const canRollbackPatch = computed(() => activeTask.value?.patchStatus === "applied")

const currentStatusLabel = computed(() => {
  const status = activeTask.value?.status
  if (!status) return "等待输入"

  const labels: Record<string, string> = {
    created: "任务已创建",
    building_context: "读取上下文",
    planning: "生成计划中",
    waiting_tool: "等待工具执行",
    executing_tool: "正在分析",
    analysis_done: "分析完成",
    patch_requested: "正在生成补丁",
    generating_diff: "生成 Diff",
    waiting_confirm: "等待确认",
    applying_patch: "应用变更中",
    completed: activeTask.value?.patchStatus === "applied" ? "补丁已应用" : "任务已完成",
    failed: "任务失败",
    cancelled: "任务已取消",
  }

  return labels[status] || "处理中"
})

const currentStatusTone = computed(() => {
  const status = activeTask.value?.status
  if (status === "failed") return "danger"
  if (status === "waiting_confirm") return "warning"
  if (status === "completed") return "success"
  if (!status) return "idle"
  return "running"
})

function getStepIcon(status: string) {
  if (status === "done") return CheckCircle2
  if (status === "running") return RefreshCw
  if (status === "failed") return AlertCircle
  return Circle
}

async function handleOpenProject() {
  try {
    await projectService.openProject()
  } catch (error) {
    window.alert((error as Error).message || "打开项目失败")
  }
}

function handleNewThread() {
  threadStore.createThread(createThreadTitle(), projectStore.currentProjectId || "__none__")
}

async function ensureThread(text: string): Promise<string> {
  if (threadStore.activeThread?.id) return threadStore.activeThread.id
  const thread = threadStore.createThread(createThreadTitle(text), projectStore.currentProjectId || "__none__")
  return thread.id
}

function mapTaskStatusToThreadStatus(status?: string) {
  switch (status) {
    case "created":
    case "building_context":
    case "planning":
    case "waiting_tool":
    case "executing_tool":
    case "generating_diff":
    case "applying_patch":
      return "running" as const
    case "waiting_confirm":
      return "waiting_approval" as const
    case "completed":
      return activeTask.value?.diff ? "ready_review" as const : "waiting_input" as const
    case "failed":
      return "failed" as const
    case "cancelled":
      return "paused" as const
    default:
      return "idle" as const
  }
}

async function handleApplyPatch() {
  if (!activeTask.value) return
  await agentTaskService.approveTask(activeTask.value.id)
}

function handleRejectPatch() {
  if (!activeTask.value) return
  agentTaskService.rejectTask(activeTask.value.id)
}

async function handleRollbackPatch() {
  if (!activeTask.value) return
  await agentTaskService.rollbackTask(activeTask.value.id)
}

async function handleContinuePatch() {
  if (!activeTask.value) return
  await agentTaskService.continueGeneratePatch(activeTask.value.id)
}

watch(
  () => activeTask.value?.status,
  (status) => {
    if (!activeThreadId.value || !status) return
    threadStore.updateThreadStatus(activeThreadId.value, mapTaskStatusToThreadStatus(status))
  },
  { immediate: true },
)

async function handleSend() {
  const text = message.value.trim()
  if (!text || isSending.value) return

  isSending.value = true
  const threadId = await ensureThread(text)
  message.value = ""

  try {
    if (inputMode.value === "agent") {
      await agentTaskService.runTask("code_modify", text, {
        threadId,
        projectPath: projectStore.currentProjectPath || undefined,
        projectName: projectStore.currentProjectName || getProjectDisplayName(projectStore.currentProjectPath),
        activeFile: activeFilePath.value || undefined,
      })
    } else {
      await agentTaskService.runChatTask(
        text,
        projectStore.currentProjectPath || undefined,
        projectStore.currentProjectName || getProjectDisplayName(projectStore.currentProjectPath),
        threadId,
      )
    }
  } finally {
    isSending.value = false
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    void handleSend()
  }
}
</script>

<template>
  <main class="v02-main">
    <div v-if="showProjectShell" class="v02-main__workspace">
      <WorkspaceShell />
    </div>

    <div v-else-if="showProjectView" class="v02-main__welcome">
      <div class="v02-main__welcome-card">
        <div class="v02-main__welcome-icon"><FolderGit2 :size="32" /></div>
        <h1 class="v02-main__welcome-title">未打开项目</h1>
        <p class="v02-main__welcome-desc">打开项目后，这里会显示真实文件树和当前工作区。</p>
        <div class="v02-main__welcome-actions">
          <button class="v02-main__welcome-btn v02-main__welcome-btn--primary" @click="handleOpenProject">
            <FolderGit2 :size="16" />
            打开项目
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="showChatWelcome" class="v02-main__welcome">
      <div class="v02-main__welcome-card">
        <div class="v02-main__welcome-icon"><Bot :size="32" /></div>
        <h1 class="v02-main__welcome-title">
          {{ hasProject ? `已打开项目：${projectStore.currentProjectName || getProjectDisplayName(projectStore.currentProjectPath)}` : "灵栈 LingStack" }}
        </h1>
        <p class="v02-main__welcome-desc">
          {{ hasProject ? "可以直接向灵栈描述任务，它会围绕当前项目上下文继续推进。" : "先打开项目，或直接创建一个普通对话线程开始工作。" }}
        </p>
        <div class="v02-main__welcome-actions">
          <button class="v02-main__welcome-btn v02-main__welcome-btn--primary" @click="handleOpenProject">
            <FolderGit2 :size="16" />
            打开项目
          </button>
          <button class="v02-main__welcome-btn" @click="handleNewThread">
            <MessageSquare :size="16" />
            新建线程
          </button>
        </div>
      </div>
    </div>

    <div v-else class="v02-main__task">
      <div class="v02-agent-bar">
        <div class="v02-agent-bar__meta">
          <div class="v02-agent-bar__status" :class="`v02-agent-bar__status--${currentStatusTone}`">
            <RefreshCw v-if="currentStatusTone === 'running'" :size="14" class="v02-spin" />
            <CheckCircle2 v-else-if="currentStatusTone === 'success'" :size="14" />
            <AlertCircle v-else-if="currentStatusTone === 'danger'" :size="14" />
            <Circle v-else :size="14" />
            <span>{{ currentStatusLabel }}</span>
          </div>
          <div class="v02-agent-bar__sub">
            <span>项目：{{ projectStore.currentProjectName || getProjectDisplayName(projectStore.currentProjectPath) }}</span>
            <span>当前文件：{{ activeFileName }}</span>
            <span v-if="activeTask?.patchProposalId">补丁：{{ activeTask.patchProposalId }}</span>
          </div>
        </div>
        <div v-if="canApplyPatch || canContinuePatch || canRollbackPatch" class="v02-agent-bar__actions">
          <template v-if="canApplyPatch">
            <button class="v02-agent-action v02-agent-action--primary" @click="handleApplyPatch">
              <CheckCircle2 :size="14" />
              应用补丁
            </button>
            <button class="v02-agent-action" @click="handleRejectPatch">
              <X :size="14" />
              拒绝
            </button>
          </template>
          <button v-else-if="canContinuePatch" class="v02-agent-action v02-agent-action--primary" @click="handleContinuePatch">
            <Send :size="14" />
            继续生成补丁
          </button>
          <button v-else-if="canRollbackPatch" class="v02-agent-action" @click="handleRollbackPatch">
            <RotateCcw :size="14" />
            回滚补丁
          </button>
        </div>
      </div>

      <div v-if="activeTask?.steps.length" class="v02-plan-card">
        <h3 class="v02-plan-card__title">执行计划</h3>
        <div class="v02-plan-card__steps">
          <div
            v-for="step in activeTask.steps"
            :key="step.id"
            class="v02-plan-card__step"
            :class="`v02-plan-card__step--${step.status}`"
          >
            <component :is="getStepIcon(step.status)" :size="16" :class="{ 'v02-spin': step.status === 'running' }" />
            <span class="v02-plan-card__step-text">{{ step.title }}</span>
          </div>
        </div>
      </div>

      <div class="v02-main__flow">
        <CenterThreadPane />
      </div>
    </div>

    <div class="v02-commandbar">
      <div class="v02-commandbar__modes">
        <button class="v02-commandbar__mode" :class="{ 'v02-commandbar__mode--active': inputMode === 'qa' }" @click="inputMode = 'qa'">
          <MessageSquare :size="13" />
          问答
        </button>
        <button class="v02-commandbar__mode" :class="{ 'v02-commandbar__mode--active': inputMode === 'agent' }" @click="inputMode = 'agent'">
          <Bot :size="13" />
          Agent
        </button>
      </div>

      <div class="v02-commandbar__input-row">
        <textarea
          v-model="message"
          class="v02-commandbar__input"
          placeholder="向灵栈描述你的任务..."
          rows="1"
          :disabled="isSending"
          @keydown="handleKeydown"
        />
        <button class="v02-commandbar__send" :disabled="!message.trim() || isSending" @click="handleSend">
          <RefreshCw v-if="isSending" :size="16" class="v02-spin" />
          <Send v-else :size="16" />
        </button>
      </div>

      <div class="v02-commandbar__hint">Enter 发送，Shift + Enter 换行</div>
    </div>
  </main>
</template>

<style scoped>
.v02-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--ls-bg-app);
}

.v02-main__workspace,
.v02-main__task {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.v02-main__welcome {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.v02-main__welcome-card {
  max-width: 520px;
  padding: 40px;
  border: 1px solid var(--ls-border-default);
  border-radius: var(--ls-radius-xl);
  background: var(--ls-bg-surface);
  text-align: center;
  box-shadow: var(--ls-shadow-sm);
}

.v02-main__welcome-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  margin-bottom: 18px;
  border-radius: var(--ls-radius-lg);
  background: var(--ls-accent-soft);
  color: var(--ls-accent);
}

.v02-main__welcome-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 650;
  color: var(--ls-text-primary);
}

.v02-main__welcome-desc {
  margin: 0 0 24px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ls-text-muted);
}

.v02-main__welcome-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.v02-main__welcome-btn,
.v02-agent-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--ls-border-default);
  border-radius: 10px;
  background: var(--ls-bg-surface);
  color: var(--ls-text-secondary);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: all 140ms ease;
}

.v02-main__welcome-btn {
  padding: 10px 20px;
}

.v02-agent-action {
  padding: 7px 12px;
}

.v02-main__welcome-btn:hover,
.v02-agent-action:hover {
  border-color: var(--ls-accent);
  color: var(--ls-accent);
}

.v02-main__welcome-btn--primary,
.v02-agent-action--primary {
  border-color: transparent;
  background: var(--ls-accent);
  color: #fff;
}

.v02-main__welcome-btn--primary:hover,
.v02-agent-action--primary:hover {
  background: var(--ls-accent-hover);
  color: #fff;
}

.v02-main__task {
  gap: 12px;
  overflow: hidden;
  padding: 16px 24px;
}

.v02-agent-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 12px 16px;
  border: 1px solid var(--ls-border-default);
  border-radius: var(--ls-radius-md);
  background: var(--ls-bg-surface);
}

.v02-agent-bar__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.v02-agent-bar__status {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.v02-agent-bar__status--idle {
  background: var(--ls-bg-muted);
  color: var(--ls-text-muted);
}

.v02-agent-bar__status--running {
  background: var(--ls-accent-soft);
  color: var(--ls-accent);
}

.v02-agent-bar__status--success {
  background: var(--ls-success-soft);
  color: var(--ls-success);
}

.v02-agent-bar__status--warning {
  background: var(--ls-warning-soft);
  color: var(--ls-warning);
}

.v02-agent-bar__status--danger {
  background: var(--ls-danger-soft);
  color: var(--ls-danger);
}

.v02-agent-bar__sub,
.v02-agent-bar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--ls-text-subtle);
  font-size: 12px;
}

.v02-plan-card {
  flex-shrink: 0;
  padding: 16px 20px;
  border: 1px solid var(--ls-border-default);
  border-radius: var(--ls-radius-md);
  background: var(--ls-bg-surface);
}

.v02-plan-card__title {
  margin: 0 0 10px;
  color: var(--ls-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.v02-plan-card__steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.v02-plan-card__step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
}

.v02-plan-card__step--done {
  color: var(--ls-text-muted);
}

.v02-plan-card__step--running {
  color: var(--ls-accent);
  font-weight: 500;
}

.v02-plan-card__step--pending {
  color: var(--ls-text-subtle);
}

.v02-plan-card__step--failed {
  color: var(--ls-danger);
}

.v02-main__flow {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.v02-commandbar {
  flex-shrink: 0;
  margin: 0 24px 16px;
  padding: 12px 16px;
  border: 1px solid var(--ls-border-default);
  border-radius: var(--ls-radius-lg);
  background: var(--ls-bg-surface);
  box-shadow: var(--ls-shadow-sm);
}

.v02-commandbar__modes {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.v02-commandbar__mode {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: none;
  border-radius: 8px;
  background: var(--ls-bg-muted);
  color: var(--ls-text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.v02-commandbar__mode--active {
  background: var(--ls-accent);
  color: #fff;
}

.v02-commandbar__input-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.v02-commandbar__input {
  flex: 1;
  min-height: 24px;
  max-height: 120px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--ls-text-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
}

.v02-commandbar__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  background: var(--ls-accent);
  color: #fff;
  cursor: pointer;
}

.v02-commandbar__send:disabled {
  opacity: 0.4;
  cursor: default;
}

.v02-commandbar__hint {
  margin-top: 6px;
  color: var(--ls-text-subtle);
  font-size: 11px;
  text-align: center;
}

.v02-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
