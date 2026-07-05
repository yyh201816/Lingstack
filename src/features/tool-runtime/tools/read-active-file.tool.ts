import TauriService from "@/services/ipc/tauri.service"
import type { ToolContext, ToolResult } from "@/features/tools/tool-runtime.types"
import type { ExtendedToolDefinition } from "../tool.types"

function inferLanguage(filePath: string): string {
  return filePath.split(".").pop() || "plaintext"
}

export const readActiveFileTool: ExtendedToolDefinition = {
  name: "read_active_file",
  description: "读取当前编辑器中正在活动的文件。如果当前没有活动文件，请不要调用该工具，优先使用 list_dir 或 search_files。",
  category: "filesystem",
  requiresProject: false,
  isReadOnly: true,
  parameters: [],
  async execute(_params?: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const filePath = context?.activeFilePath
    if (!filePath) {
      return {
        success: false,
        content: "当前未选择活动文件，请先打开一个文件，或改用 search_files/list_dir 扫描项目。",
        error: "当前未选择活动文件",
      }
    }

    try {
      const content = context?.activeFileContent || await TauriService.readFile(filePath)
      const truncated = content.length > 16000
        ? `${content.slice(0, 16000)}\n\n... 文件过长，已截断，原始长度 ${content.length} 字符`
        : content
      const language = inferLanguage(filePath)

      return {
        success: true,
        content: [
          `文件：${filePath}`,
          `语言：${language}`,
          `长度：${content.length} 字符`,
          "内容：",
          truncated,
        ].join("\n"),
        data: {
          filePath,
          language,
          size: content.length,
          content: truncated,
        },
      }
    } catch (error) {
      return { success: false, content: "", error: String(error) }
    }
  },
}

export default readActiveFileTool
