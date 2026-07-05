export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/")
}

export function getProjectDisplayName(projectPath?: string | null): string {
  if (!projectPath) return "未打开项目"
  const normalized = normalizePath(projectPath)
  const name = normalized.split("/").filter(Boolean).pop()
  return name || "未命名项目"
}

export function joinProjectPath(projectPath: string, filePath: string): string {
  const root = normalizePath(projectPath).replace(/\/+$/, "")
  const relative = normalizePath(filePath).replace(/^\/+/, "")
  return `${root}/${relative}`
}

export function toRelativeProjectPath(projectPath?: string | null, filePath?: string | null): string {
  if (!filePath) return "未选择"
  if (!projectPath) return normalizePath(filePath)

  const normalizedProject = normalizePath(projectPath).replace(/\/+$/, "")
  const normalizedFile = normalizePath(filePath)

  if (normalizedFile.startsWith(`${normalizedProject}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1)
  }

  return normalizedFile.replace(/^\/+/, "")
}
