import { defineStore } from "pinia"
import { computed, ref } from "vue"

interface WorkspaceTab {
  id: string
  filePath: string
  fileName: string
  language: string
  isDirty: boolean
  content: string
}

interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
  expanded?: boolean
}

interface PersistedTab {
  filePath: string
  fileName: string
  language: string
}

interface SessionSnapshot {
  activeProject: string
  tabs: PersistedTab[]
  activeTabFilePath: string | null
}

const SESSION_KEY = "lingstack_session"

function makeTabId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function readSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data.activeProject !== "string" || !Array.isArray(data.tabs)) {
      return null
    }
    return data as SessionSnapshot
  } catch {
    return null
  }
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const activeProject = ref<string | null>(readSession()?.activeProject ?? null)
  const activeProjectName = ref<string | null>(null)
  const recentProjects = ref<string[]>([])
  const tabs = ref<WorkspaceTab[]>([])
  const activeTabId = ref<string | null>(null)
  const fileTree = ref<FileTreeNode[]>([])
  const expandedFolders = ref<Set<string>>(new Set())
  const editedContentMap = ref<Record<string, string>>({})
  const fileContentCache = ref<Record<string, string>>({})

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null)
  const hasOpenTabs = computed(() => tabs.value.length > 0)
  const openFilePaths = computed(() => new Set(tabs.value.map((tab) => tab.filePath)))

  function selectFile(filePath: string, fileName?: string, content?: string, language?: string) {
    const name = fileName ?? filePath.split(/[/\\]/).pop() ?? "untitled"
    const lang = language ?? name.split(".").pop() ?? "plaintext"
    const existingTab = tabs.value.find((tab) => tab.filePath === filePath)

    if (existingTab) {
      activeTabId.value = existingTab.id
      return
    }

    const initialContent = editedContentMap.value[filePath] ?? content ?? ""
    if (content !== undefined) {
      fileContentCache.value[filePath] = content
    }

    tabs.value.push({
      id: makeTabId(),
      filePath,
      fileName: name,
      language: lang,
      isDirty: false,
      content: initialContent,
    })

    activeTabId.value = tabs.value.at(-1)?.id ?? null
  }

  function selectFiles(files: Array<{ filePath: string; fileName?: string; content?: string; language?: string }>) {
    for (const file of files) {
      selectFile(file.filePath, file.fileName, file.content, file.language)
    }
  }

  function closeTab(id: string) {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    if (index === -1) return

    tabs.value.splice(index, 1)
    if (activeTabId.value !== id) return

    const nextTab = tabs.value[index] ?? tabs.value[index - 1] ?? null
    activeTabId.value = nextTab?.id ?? null
  }

  function switchTab(id: string) {
    if (tabs.value.some((tab) => tab.id === id)) {
      activeTabId.value = id
    }
  }

  function markDirty(filePath: string, dirty: boolean) {
    const tab = tabs.value.find((item) => item.filePath === filePath)
    if (tab) tab.isDirty = dirty
  }

  function setEditedContent(filePath: string, content: string) {
    editedContentMap.value[filePath] = content
    fileContentCache.value[filePath] = content

    const tab = tabs.value.find((item) => item.filePath === filePath)
    if (tab) {
      tab.content = content
      tab.isDirty = true
    }
  }

  function setFileContent(filePath: string, content: string) {
    fileContentCache.value[filePath] = content

    const tab = tabs.value.find((item) => item.filePath === filePath)
    if (tab) {
      tab.content = content
      tab.isDirty = false
    }
  }

  function onSaved(filePath: string, content: string) {
    fileContentCache.value[filePath] = content
    editedContentMap.value[filePath] = content

    const tab = tabs.value.find((item) => item.filePath === filePath)
    if (tab) {
      tab.content = content
      tab.isDirty = false
    }
  }

  function saveSession() {
    if (!activeProject.value) return

    const snapshot: SessionSnapshot = {
      activeProject: activeProject.value,
      tabs: tabs.value.map((tab) => ({
        filePath: tab.filePath,
        fileName: tab.fileName,
        language: tab.language,
      })),
      activeTabFilePath: activeTab.value?.filePath ?? null,
    }

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot))
    } catch {
      // ignore
    }
  }

  function restoreTabs(snapshot: SessionSnapshot) {
    activeProject.value = snapshot.activeProject
    tabs.value = snapshot.tabs.map((tab) => ({
      id: makeTabId(),
      filePath: tab.filePath,
      fileName: tab.fileName,
      language: tab.language,
      isDirty: false,
      content: editedContentMap.value[tab.filePath] ?? "",
    }))

    if (snapshot.activeTabFilePath) {
      const match = tabs.value.find((tab) => tab.filePath === snapshot.activeTabFilePath)
      activeTabId.value = match?.id ?? tabs.value[0]?.id ?? null
      return
    }

    activeTabId.value = tabs.value[0]?.id ?? null
  }

  function setProjectPath(path: string, name?: string) {
    activeProject.value = path
    activeProjectName.value = name ?? null
    saveSession()
  }

  function updateOpenFileContent(filePath: string, content: string) {
    fileContentCache.value[filePath] = content
    editedContentMap.value[filePath] = content

    const tab = tabs.value.find((item) => item.filePath === filePath)
    if (tab) {
      tab.content = content
      tab.isDirty = false
    }
  }

  function removeOpenFileByPath(filePath: string) {
    delete editedContentMap.value[filePath]
    delete fileContentCache.value[filePath]

    const tab = tabs.value.find((item) => item.filePath === filePath)
    if (tab) {
      closeTab(tab.id)
    }
  }

  function getFileContent(filePath: string): string {
    return editedContentMap.value[filePath]
      ?? fileContentCache.value[filePath]
      ?? tabs.value.find((item) => item.filePath === filePath)?.content
      ?? ""
  }

  return {
    activeProject,
    activeProjectName,
    recentProjects,
    tabs,
    activeTabId,
    fileTree,
    expandedFolders,
    editedContentMap,
    fileContentCache,
    activeTab,
    hasOpenTabs,
    openFilePaths,
    selectFile,
    selectFiles,
    closeTab,
    switchTab,
    markDirty,
    setEditedContent,
    setFileContent,
    onSaved,
    saveSession,
    restoreTabs,
    setProjectPath,
    updateOpenFileContent,
    removeOpenFileByPath,
    getFileContent,
  }
})
