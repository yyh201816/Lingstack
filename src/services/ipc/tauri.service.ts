import { APP_NAME, APP_VERSION } from "@/shared/constants/app"

function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke
}

export interface DirEntry {
  name: string
  path: string
  is_directory: boolean
  is_file: boolean
}

const MOCK_TREE: DirEntry[] = [
  { name: "src", path: "/mock-project/src", is_directory: true, is_file: false },
  { name: "public", path: "/mock-project/public", is_directory: true, is_file: false },
  { name: "package.json", path: "/mock-project/package.json", is_directory: false, is_file: true },
  { name: "tsconfig.json", path: "/mock-project/tsconfig.json", is_directory: false, is_file: true },
  { name: "README.md", path: "/mock-project/README.md", is_directory: false, is_file: true },
]

const MOCK_SRC: DirEntry[] = [
  { name: "components", path: "/mock-project/src/components", is_directory: true, is_file: false },
  { name: "main.ts", path: "/mock-project/src/main.ts", is_directory: false, is_file: true },
  { name: "App.vue", path: "/mock-project/src/App.vue", is_directory: false, is_file: true },
]

const MOCK_SRC_COMPONENTS: DirEntry[] = [
  { name: "Panel.vue", path: "/mock-project/src/components/Panel.vue", is_directory: false, is_file: true },
  { name: "Button.tsx", path: "/mock-project/src/components/Button.tsx", is_directory: false, is_file: true },
]

const MOCK_FILES: Record<string, string> = {
  "/mock-project/package.json": JSON.stringify({ name: "lingstack-demo", version: "0.1.0" }, null, 2),
  "/mock-project/README.md": "# LingStack Demo\n\n桌面 AI 工作台演示项目。",
  "/mock-project/src/main.ts": "import { createApp } from 'vue'\nimport App from './App.vue'\n\ncreateApp(App).mount('#app')",
  "/mock-project/src/App.vue": "<template>\n  <div class=\"app\">Hello LingStack!</div>\n</template>",
  "/mock-project/src/components/Panel.vue": "<template>\n  <aside>Panel</aside>\n</template>",
  "/mock-project/src/components/Button.tsx": "export function Button() { return <button>Click</button> }",
}

export async function getAppInfo() {
  if (!isTauriEnv()) {
    return { name: APP_NAME, version: APP_VERSION, platform: "browser", arch: "unknown" }
  }

  const invoke = await getInvoke()
  return invoke("get_app_info")
}

export async function listDir(dirPath: string): Promise<DirEntry[]> {
  if (isTauriEnv()) {
    const invoke = await getInvoke()
    return invoke<DirEntry[]>("list_dir", { path: dirPath })
  }

  if (dirPath.includes("src/components")) return [...MOCK_SRC_COMPONENTS]
  if (dirPath.includes("/src") || dirPath.includes("\\src")) return [...MOCK_SRC]
  if (dirPath.includes("mock-project")) return [...MOCK_TREE]
  return []
}

export async function readFile(filePath: string): Promise<string> {
  if (isTauriEnv()) {
    const invoke = await getInvoke()
    return invoke<string>("read_file", { path: filePath })
  }

  return MOCK_FILES[filePath] ?? `// ${filePath.split("/").pop() || "untitled"}\n// 浏览器模拟文件内容\n`
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  if (isTauriEnv()) {
    const invoke = await getInvoke()
    return invoke("write_file", { path: filePath, content })
  }

  MOCK_FILES[filePath] = content
}

export async function deleteFile(filePath: string): Promise<void> {
  if (isTauriEnv()) {
    const invoke = await getInvoke()
    return invoke("delete_file", { path: filePath })
  }

  delete MOCK_FILES[filePath]
}

export async function checkPath(targetPath: string): Promise<boolean> {
  if (isTauriEnv()) {
    const invoke = await getInvoke()
    return invoke<boolean>("check_path", { path: targetPath })
  }

  return Boolean(targetPath?.trim())
}

export async function setWindowTitle(title: string) {
  if (!isTauriEnv()) return
  const invoke = await getInvoke()
  return invoke("set_window_title", { title })
}

export async function openDirectoryDialog(): Promise<string | null> {
  if (!isTauriEnv()) return "/mock-project"

  try {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const result = await open({ directory: true, multiple: false })
    return result as string | null
  } catch {
    return null
  }
}

export const TauriService = {
  listDir,
  readFile,
  writeFile,
  deleteFile,
  checkPath,
  getAppInfo,
  setWindowTitle,
  openDirectoryDialog,
}

export default TauriService
