export type DiffLineType = "add" | "remove" | "context" | "header"

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface FileDiff {
  filePath: string
  oldContent: string
  newContent: string
  hunks: DiffHunk[]
  stats: {
    added: number
    removed: number
  }
}

export interface PatchFileChange {
  filePath: string
  oldContent: string
  newContent: string
  status: "M" | "A" | "D"
  diff: FileDiff
}

export interface PatchProposal {
  id: string
  taskId?: string
  projectPath: string
  files: PatchFileChange[]
  summary: {
    files: number
    added: number
    removed: number
  }
  status: "proposed" | "applied" | "rolled_back" | "rejected" | "failed"
  createdAt: string
  appliedAt?: string
  rolledBackAt?: string
  error?: string
}

export interface PatchApplyRecord {
  proposalId: string
  appliedFiles: Array<{
    filePath: string
    status: "M" | "A" | "D"
    backupPath?: string
  }>
  appliedAt: string
}

export interface PatchResult {
  success: boolean
  filePath?: string
  proposalId?: string
  error?: string
  record?: PatchApplyRecord
}

export interface DiffSummary {
  files: FileDiff[]
  totalAdded: number
  totalRemoved: number
  totalFiles: number
  generatedAt: string
}
