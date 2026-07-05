<script setup lang="ts">
import { computed, ref } from "vue"
import { ChevronDown, Diff, FileCode, FileText, FolderOpen, Plug, X } from "lucide-vue-next"
import { useAgentTaskStore } from "@/features/agent-runtime/agent-task.store"
import { useMcpStore } from "@/features/mcp/store/mcp.store"
import { useProjectStore } from "@/features/projects/store/project.store"
import { useThreadStore } from "@/features/threads/store/thread.store"
import { useWorkspaceStore } from "@/features/workspace/store/workspace.store"
import { toRelativeProjectPath } from "@/shared/utils/project-path"

defineEmits<{ (event: "close"): void }>()

const agentTaskStore = useAgentTaskStore()
const mcpStore = useMcpStore()
const projectStore = useProjectStore()
const threadStore = useThreadStore()
const workspaceStore = useWorkspaceStore()
const demoMode = ref(false)
const selectedDiffFile = ref<string>("")

function getProjectDisplayName(projectPath?: string | null): string {
  if (!projectPath) return "未打开项目"
  const normalized = projectPath.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || "未命名项目"
}

const hasProject = computed(() => Boolean(projectStore.currentProjectPath))
const activeThreadId = computed(() => threadStore.activeThread?.id || "")
const activeTask = computed(() =>
  activeThreadId.value ? agentTaskStore.getLatestTaskByThread(activeThreadId.value) : null,
)
const projectName = computed(() => projectStore.currentProjectName || getProjectDisplayName(projectStore.currentProjectPath))
const projectPath = computed(() => projectStore.currentProjectPath)
const activeFile = computed(() => toRelativeProjectPath(projectStore.currentProjectPath, workspaceStore.activeTab?.filePath))
const openTabs = computed(() => workspaceStore.tabs?.length || 0)
const openTabNames = computed(() => workspaceStore.tabs?.map((tab) => toRelativeProjectPath(projectStore.currentProjectPath, tab.filePath)) || [])
const changedFiles = computed(() => activeTask.value?.changedFiles || [])
const diffStats = computed(() => {
  if (demoMode.value) return { added: 0, removed: 0, files: 0 }
  const diff = activeTask.value?.diff
  return diff ? { added: diff.added, removed: diff.removed, files: diff.files } : null
})
const diffHunks = computed(() => activeTask.value?.diff?.hunks || [])
const selectedHunk = computed(() => {
  if (!selectedDiffFile.value) return diffHunks.value[0] || null
  return diffHunks.value.find((h) => h.filePath === selectedDiffFile.value) || null
})
const diffPreviewLines = computed(() => {
  const hunk = selectedHunk.value
  if (!hunk) return []
  return hunk.lines.slice(0, 20)
})
const patchStatus = computed(() => activeTask.value?.patchStatus || "none")
const patchStatusLabel = computed(() => {
  const map: Record<string, string> = {
    none: "无补丁",
    proposed: "已提案",
    applied: "已应用",
    rolled_back: "已回滚",
    rejected: "已拒绝",
    failed: "失败",
  }
  return map[patchStatus.value] || patchStatus.value
})

const mcpServices = computed(() => mcpStore.services || [])
const connectedCount = computed(() => mcpStore.connectedCount || 0)

function handleChangedFileClick(filePath: string, absolutePath?: string) {
  if (absolutePath) {
    workspaceStore.selectFile(absolutePath, filePath)
  } else if (projectPath.value) {
    const normalized = filePath.replace(/\\/g, "/")
    const full = projectPath.value.replace(/\\/g, "/").replace(/\/+$/, "") + "/" + normalized.replace(/^\/+/, "")
    workspaceStore.selectFile(full, filePath)
  }
}

function handleTabClick(filePath: string) {
  workspaceStore.selectFile(filePath)
}
</script>

<template>
  <aside class="v02-right">
    <div class="v02-right__header">
      <span class="v02-right__title">审查</span>
      <button class="v02-right__close" title="关闭审查面板" @click="$emit('close')">
        <X :size="16" />
      </button>
    </div>

    <div class="v02-right__body">
      <div v-if="!hasProject" class="v02-right__empty-full">
        <FolderOpen :size="32" class="v02-right__empty-icon" />
        <p class="v02-right__empty-title">暂无项目上下文</p>
        <p class="v02-right__empty-desc">打开项目后，灵栈会在这里显示当前文件、变更文件和 Diff 摘要。</p>
      </div>

      <template v-else>
        <div class="v02-card">
          <div class="v02-card__header">
            <FolderOpen :size="14" />
            <span>上下文</span>
          </div>
          <div class="v02-card__body">
            <div class="v02-card__row">
              <span class="v02-card__label">项目</span>
              <span class="v02-card__value">{{ projectName }}</span>
            </div>
            <div class="v02-card__row">
              <span class="v02-card__label">当前文件</span>
              <span class="v02-card__value" :class="{ 'v02-card__clickable': activeFile !== '未选择' }" @click="activeFile !== '未选择' && workspaceStore.activeTab?.filePath && handleTabClick(workspaceStore.activeTab.filePath)">{{ activeFile }}</span>
            </div>
            <div class="v02-card__row">
              <span class="v02-card__label">已打开标签 ({{ openTabs }})</span>
            </div>
            <div v-for="tabPath in openTabNames" :key="tabPath" class="v02-card__tab-row" @click="handleTabClick(tabPath)">
              <FileText :size="12" class="v02-card__tab-icon" />
              <span class="v02-card__tab-name">{{ tabPath }}</span>
            </div>
            <div v-if="activeTask?.patchProposalId" class="v02-card__row">
              <span class="v02-card__label">补丁状态</span>
              <span class="v02-card__value">{{ patchStatusLabel }}</span>
            </div>
          </div>
        </div>

        <div class="v02-card">
          <div class="v02-card__header">
            <FileCode :size="14" />
            <span>变更文件</span>
          </div>
          <div class="v02-card__body">
            <div v-if="changedFiles.length === 0" class="v02-card__empty">暂无变更</div>
            <div v-for="file in changedFiles" :key="file.path" class="v02-card__file-row v02-card__clickable" @click="handleChangedFileClick(file.path, file.absolutePath)">
              <FileText :size="13" class="v02-card__file-icon" />
              <span class="v02-card__file-path">{{ file.path }}</span>
              <span class="v02-card__file-tag" :class="`v02-card__file-tag--${file.status}`">{{ file.status }}</span>
            </div>
          </div>
        </div>

        <div class="v02-card">
          <div class="v02-card__header">
            <Diff :size="14" />
            <span>Diff 摘要</span>
            <span v-if="diffHunks.length > 1" class="v02-card__badge">{{ diffHunks.length }} 文件</span>
          </div>
          <div class="v02-card__body">
            <div v-if="!diffStats" class="v02-card__empty">暂无 Diff / 当前任务尚未生成可审查变更</div>
            <template v-else>
              <div class="v02-card__diff-stats">
                <span class="v02-card__diff-added">+{{ diffStats.added }}</span>
                <span class="v02-card__diff-removed">-{{ diffStats.removed }}</span>
                <span class="v02-card__diff-files">{{ diffStats.files }} 个文件变更</span>
              </div>
              <!-- 多文件 Diff 选择器 -->
              <div v-if="diffHunks.length > 1" class="v02-card__diff-file-select">
                <button
                  v-for="hunk in diffHunks"
                  :key="hunk.filePath"
                  class="v02-card__diff-file-chip"
                  :class="{ 'v02-card__diff-file-chip--active': selectedDiffFile === hunk.filePath || (!selectedDiffFile && hunk === diffHunks[0]) }"
                  @click="selectedDiffFile = hunk.filePath"
                >
                  {{ hunk.filePath }}
                </button>
              </div>
              <div v-if="selectedHunk" class="v02-card__diff-file-label">
                <FileCode :size="11" /> {{ selectedHunk.filePath }}
              </div>
              <div v-if="diffPreviewLines.length" class="v02-card__diff-preview">
                <div
                  v-for="(line, index) in diffPreviewLines"
                  :key="index"
                  class="v02-card__diff-line"
                  :class="{
                    'v02-card__diff-line--add': line.startsWith('+'),
                    'v02-card__diff-line--del': line.startsWith('-'),
                  }"
                >
                  {{ line }}
                </div>
              </div>
            </template>
          </div>
        </div>

        <details class="v02-card v02-card--tools">
          <summary class="v02-card__header v02-card__header--clickable">
            <Plug :size="14" />
            <span>工具连接</span>
            <span class="v02-card__badge">{{ connectedCount }}/{{ mcpServices.length }}</span>
            <ChevronDown :size="12" class="v02-card__chevron" />
          </summary>
          <div class="v02-card__body">
            <div v-if="mcpServices.length === 0" class="v02-card__empty">未配置 MCP 服务</div>
            <div v-for="service in mcpServices" :key="service.id" class="v02-card__tool-row">
              <span class="v02-card__tool-name">{{ service.name }}</span>
              <span class="v02-card__tool-status" :class="service.status === 'connected' ? 'v02-card__tool-status--ok' : 'v02-card__tool-status--off'">
                {{ service.status === "connected" ? "已连接" : "未连接" }}
              </span>
            </div>
          </div>
        </details>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.v02-right {
  display: flex;
  flex-direction: column;
  width: 320px;
  height: 100%;
  flex-shrink: 0;
  overflow: hidden;
  border-left: 1px solid var(--ls-border-default);
  background: var(--ls-bg-surface);
}

.v02-right__header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ls-border-default);
}

.v02-right__title {
  color: var(--ls-text-primary);
  font-size: 14px;
  font-weight: 650;
}

.v02-right__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ls-text-muted);
  cursor: pointer;
}

.v02-right__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 16px;
}

.v02-right__empty-full {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  padding: 60px 20px;
  text-align: center;
}

.v02-right__empty-icon {
  color: var(--ls-text-subtle);
  opacity: 0.4;
}

.v02-right__empty-title {
  margin: 0;
  color: var(--ls-text-muted);
  font-size: 14px;
  font-weight: 600;
}

.v02-right__empty-desc {
  max-width: 260px;
  margin: 0;
  color: var(--ls-text-subtle);
  font-size: 12px;
  line-height: 1.6;
}

.v02-card {
  overflow: hidden;
  border: 1px solid var(--ls-border-default);
  border-radius: var(--ls-radius-md);
  background: var(--ls-bg-soft);
}

.v02-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ls-border-soft);
  color: var(--ls-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.v02-card__header--clickable {
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.v02-card__header--clickable::-webkit-details-marker {
  display: none;
}

.v02-card__badge {
  margin-left: auto;
  color: var(--ls-text-subtle);
  font-size: 11px;
}

.v02-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
}

.v02-card__row,
.v02-card__file-row,
.v02-card__tool-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.v02-card__row,
.v02-card__tool-row {
  justify-content: space-between;
}

.v02-card__label,
.v02-card__empty {
  color: var(--ls-text-muted);
  font-size: 12px;
}

.v02-card__empty {
  padding: 8px 0;
  text-align: center;
}

.v02-card__value {
  min-width: 0;
  overflow: hidden;
  color: var(--ls-text-primary);
  font-size: 12px;
  font-weight: 500;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v02-card__file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ls-text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v02-card__file-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}

.v02-card__file-tag--M {
  background: var(--ls-warning-soft);
  color: var(--ls-warning);
}

.v02-card__file-tag--A,
.v02-card__file-tag--new {
  background: var(--ls-success-soft);
  color: var(--ls-success);
}

.v02-card__file-tag--D {
  background: var(--ls-danger-soft);
  color: var(--ls-danger);
}

.v02-card__diff-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
}

.v02-card__diff-added {
  color: var(--ls-success);
  font-weight: 600;
}

.v02-card__diff-removed {
  color: var(--ls-danger);
  font-weight: 600;
}

.v02-card__diff-files,
.v02-card__tool-name {
  color: var(--ls-text-muted);
  font-size: 12px;
}

.v02-card__diff-preview {
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: #1e1e2e;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.6;
}

.v02-card__diff-line--add {
  color: #a6e3a1;
}

.v02-card__diff-line--del {
  color: #f38ba8;
}

.v02-card__tool-status {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
}

.v02-card__tool-status--ok {
  background: var(--ls-success-soft);
  color: var(--ls-success);
}

.v02-card__tool-status--off {
  background: var(--ls-bg-muted);
  color: var(--ls-text-subtle);
}

.v02-card__clickable {
  cursor: pointer;
  transition: background 120ms;
}

.v02-card__clickable:hover {
  background: var(--ls-bg-surface-alpha);
  border-radius: 4px;
}

.v02-card__tab-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 11px;
  color: var(--ls-text-secondary);
  cursor: pointer;
  transition: color 120ms;
}

.v02-card__tab-row:hover {
  color: var(--ls-text-primary);
}

.v02-card__tab-icon {
  color: var(--ls-text-muted);
  flex-shrink: 0;
}

.v02-card__tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v02-card__diff-file-select {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.v02-card__diff-file-chip {
  padding: 2px 8px;
  border: 1px solid var(--ls-border-soft);
  border-radius: 999px;
  background: var(--ls-bg-muted);
  color: var(--ls-text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  cursor: pointer;
  transition: all 120ms;
}

.v02-card__diff-file-chip:hover {
  border-color: var(--ls-border-default);
  color: var(--ls-text-secondary);
}

.v02-card__diff-file-chip--active {
  border-color: var(--ls-primary);
  background: var(--ls-primary-soft);
  color: var(--ls-primary);
}

.v02-card__diff-file-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ls-text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
</style>
