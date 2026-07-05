<script setup lang="ts">
import { computed } from "vue"
import {
  Bot,
  CheckCircle2,
  Circle,
  RefreshCw,
  Sparkles,
  Wrench,
  User,
  Zap,
} from "lucide-vue-next"
import ThreadHeader from "./ThreadHeader.vue"
import EmptyState from "./EmptyState.vue"
import { useThreadStore } from "@/features/threads/store/thread.store"
import { useThreadSessionStore } from "@/features/threads/store/thread-session.store"
import { useAgentTaskStore } from "@/features/agent-runtime/agent-task.store"

const threadStore = useThreadStore()
const sessionStore = useThreadSessionStore()
const agentTaskStore = useAgentTaskStore()

const hasThread = computed(() => threadStore.activeThread !== null)
const activeThreadId = computed(() => threadStore.activeThreadId)
const activeTask = computed(() =>
  activeThreadId.value ? agentTaskStore.getLatestTaskByThread(activeThreadId.value) : null,
)

const messages = computed(() => {
  if (activeTask.value) {
    return activeTask.value.messages.map((message) => ({
      ...message,
      threadId: activeThreadId.value || activeTask.value?.threadId || "",
      type: message.role === "tool" ? "tool_log" : message.role,
    }))
  }

  const threadId = threadStore.activeThreadId
  return threadId ? sessionStore.getMessages(threadId) : []
})

const hasPlan = computed(() => (activeTask.value?.steps?.length ?? 0) > 0)

function getToolTitle(meta?: Record<string, unknown>): string {
  if (!meta) return "工具调用"
  const toolName = String(meta.toolName || "unknown")
  const kind = meta.kind === "tool_result" ? "工具结果" : "工具调用"
  return `${kind} · ${toolName}`
}

function getToolStatus(meta?: Record<string, unknown>): string {
  const status = String(meta?.status || "")
  if (status === "success") return "成功"
  if (status === "failed") return "失败"
  if (status === "running") return "执行中"
  return "已记录"
}

function getToolStatusTone(meta?: Record<string, unknown>): string {
  const status = String(meta?.status || "")
  if (status === "success") return "success"
  if (status === "failed") return "danger"
  if (status === "running") return "running"
  return "idle"
}

function getStepIcon(status: string) {
  if (status === "done") return CheckCircle2
  if (status === "running") return RefreshCw
  return Circle
}
</script>

<template>
  <div class="center-pane">
    <template v-if="hasThread">
      <ThreadHeader />

      <div class="center-pane__timeline">
        <!-- 当前任务卡 -->
        <div v-if="activeTask" class="center-pane__task-card">
          <div class="center-pane__task-card-head">
            <Zap :size="14" />
            <span>当前任务</span>
            <span class="center-pane__task-card-type">{{ activeTask.title }}</span>
          </div>
          <p class="center-pane__task-card-goal">{{ activeTask.userRequest }}</p>
        </div>

        <!-- 执行计划卡 -->
        <div v-if="hasPlan" class="center-pane__plan-card">
          <div class="center-pane__plan-head">
            <Sparkles :size="14" />
            <span>执行计划</span>
          </div>
          <div class="center-pane__plan-steps">
            <div
              v-for="step in activeTask!.steps"
              :key="step.id"
              class="center-pane__plan-step"
              :class="`center-pane__plan-step--${step.status}`"
            >
              <component :is="getStepIcon(step.status)" :size="14" />
              <span>{{ step.title }}</span>
            </div>
          </div>
        </div>

        <!-- 消息流 -->
        <div class="center-pane__messages">
          <div v-if="messages.length === 0" class="center-pane__placeholder-text">
            暂无消息，请在底部 Command Bar 输入你的任务。
          </div>

          <template v-for="msg in messages" :key="msg.id">
            <div v-if="msg.role === 'user'" class="center-pane__msg center-pane__msg--user">
              <div class="center-pane__msg-bubble center-pane__msg-bubble--user">
                <div class="center-pane__msg-role">
                  <User :size="13" />
                  你
                </div>
                <div class="center-pane__msg-text">{{ msg.content }}</div>
              </div>
            </div>

            <div v-else-if="msg.role === 'assistant'" class="center-pane__msg center-pane__msg--assistant">
              <div class="center-pane__msg-bubble center-pane__msg-bubble--assistant">
                <div class="center-pane__msg-role">
                  <Bot :size="13" />
                  灵栈
                </div>
                <div class="center-pane__msg-text" :class="{ 'center-pane__msg-text--streaming': msg.streaming }">
                  {{ msg.content }}
                  <span v-if="msg.streaming" class="center-pane__streaming-cursor">|</span>
                </div>
              </div>
            </div>

            <div v-else-if="msg.role === 'tool'" class="center-pane__msg center-pane__msg--event">
              <div class="center-pane__tool-card" :class="`center-pane__tool-card--${getToolStatusTone(msg.meta)}`">
                <div class="center-pane__tool-head">
                  <Wrench :size="13" />
                  <span>{{ getToolTitle(msg.meta) }}</span>
                  <span class="center-pane__tool-status">{{ getToolStatus(msg.meta) }}</span>
                </div>
                <div v-if="msg.meta?.params" class="center-pane__tool-params">
                  参数：{{ JSON.stringify(msg.meta.params) }}
                </div>
                <div class="center-pane__tool-body">{{ msg.content }}</div>
              </div>
            </div>

            <div v-else class="center-pane__msg center-pane__msg--event">
              <div class="center-pane__event-card">
                <div class="center-pane__event-head">
                  <Circle :size="10" />
                  <span>{{ msg.type === "task_status" ? "任务更新" : "系统" }}</span>
                </div>
                <div class="center-pane__event-body">{{ msg.content }}</div>
              </div>
            </div>
          </template>

        </div>
      </div>
    </template>

    <div v-else class="center-pane__welcome">
      <EmptyState
        title="灵栈工作台"
        description="创建线程或打开项目后，灵栈会围绕当前任务和项目上下文继续工作。"
      />
    </div>
  </div>
</template>

<style scoped>
.center-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ls-bg-app, #f6f8fc);
}

.center-pane__timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
}

.center-pane__welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
}

/* 当前任务卡 */
.center-pane__task-card {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--ls-brand-100, #dbeafe);
  border-radius: 14px;
  background: var(--ls-brand-50, #eff6ff);
}

.center-pane__task-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--ls-brand-500, #3b82f6);
  font-size: 12px;
  font-weight: 600;
}

.center-pane__task-card-type {
  margin-left: auto;
  font-weight: 500;
  opacity: 0.8;
}

.center-pane__task-card-goal {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ls-text-primary, #111827);
}

/* 执行计划卡 */
.center-pane__plan-card {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--ls-border-default);
  border-radius: 14px;
  background: var(--ls-bg-surface);
}

.center-pane__plan-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--ls-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.center-pane__plan-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.center-pane__plan-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--ls-text-muted);
}

.center-pane__plan-step--running {
  background: var(--ls-brand-50, #eff6ff);
  color: var(--ls-brand-500, #3b82f6);
}

.center-pane__plan-step--done {
  color: var(--ls-success, #22c55e);
}

.center-pane__plan-step--failed {
  background: var(--ls-danger-soft, #fef2f2);
  color: var(--ls-danger, #ef4444);
}

/* 消息流 */
.center-pane__messages {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.center-pane__placeholder-text {
  padding: 40px 0;
  font-size: 13px;
  text-align: center;
  color: var(--ls-text-hint, #9ca3af);
}

/* 用户消息气泡 */
.center-pane__msg--user {
  display: flex;
  justify-content: flex-end;
}

.center-pane__msg-bubble--user {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 16px 16px 4px 16px;
  background: var(--ls-brand-500, #3b82f6);
}

.center-pane__msg-bubble--user .center-pane__msg-role {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  text-transform: none;
}

.center-pane__msg-bubble--user .center-pane__msg-text {
  font-size: 13px;
  line-height: 1.55;
  color: #ffffff;
  white-space: pre-wrap;
}

/* Agent 消息气泡 */
.center-pane__msg--assistant {
  display: flex;
  justify-content: flex-start;
}

.center-pane__msg-bubble--assistant {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 16px 16px 16px 4px;
  border: 1px solid var(--ls-border-default);
  background: var(--ls-bg-surface);
}

.center-pane__msg-bubble--assistant .center-pane__msg-role {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ls-brand-500, #3b82f6);
  text-transform: none;
}

.center-pane__msg-bubble--assistant .center-pane__msg-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--ls-text-primary, #111827);
  white-space: pre-wrap;
}

.center-pane__msg-text--streaming {
  color: var(--ls-text-muted);
}

/* 系统事件卡 */
.center-pane__msg--event {
  display: flex;
  justify-content: center;
}

.center-pane__event-card {
  max-width: 600px;
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--ls-border-soft);
  background: var(--ls-bg-muted, #f9fafb);
}

.center-pane__tool-card {
  max-width: 680px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--ls-border-soft);
  border-radius: 12px;
  background: var(--ls-bg-surface);
}

.center-pane__tool-card--running {
  border-color: var(--ls-brand-100, #dbeafe);
  background: var(--ls-brand-50, #eff6ff);
}

.center-pane__tool-card--success {
  border-color: var(--ls-success-soft, #dcfce7);
}

.center-pane__tool-card--danger {
  border-color: var(--ls-danger-soft, #fee2e2);
}

.center-pane__tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--ls-text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.center-pane__tool-status {
  margin-left: auto;
  color: var(--ls-text-subtle);
  font-size: 11px;
  font-weight: 500;
}

.center-pane__tool-params {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--ls-bg-muted, #f9fafb);
  color: var(--ls-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  word-break: break-all;
}

.center-pane__tool-body {
  color: var(--ls-text-muted);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.center-pane__event-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ls-text-subtle);
}

.center-pane__event-body {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ls-text-muted);
  white-space: pre-wrap;
}

.center-pane__streaming-cursor {
  color: var(--ls-brand-500, #3b82f6);
  animation: blink-cursor 1s step-end infinite;
}

.center-pane__msg-error {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 107, 107, 0.08);
  font-size: 11px;
  color: #ff6b6b;
}

@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
