export const files = [
  { id: "dir-reports", label: "reports/", path: "reports/", kind: "directory" },
  { id: "dir-data", label: "data/", path: "data/", kind: "directory" },
  { id: "file-readme", label: "README.md", path: "README.md", kind: "file" },
  {
    id: "file-report",
    label: "回撤结构.md",
    path: "reports/回撤结构.md",
    kind: "file",
  },
  {
    id: "file-notes",
    label: "研究笔记 10月.md",
    path: "reports/研究笔记 10月.md",
    kind: "file",
  },
  {
    id: "file-bars",
    label: "300308.SZ.csv",
    path: "data/300308.SZ.csv",
    kind: "file",
  },
  {
    id: "file-benchmark",
    label: "沪深300.csv",
    path: "data/沪深300.csv",
    kind: "file",
  },
].map((f) => ({
  ...f,
  group: "文件与目录",
  category: "files",
  description: f.path + " · 示例工作区",
}));
export const fallbackSessions = [
  {
    id: "demo-session-drawdown",
    label: "回撤结构研究",
    project: "sample",
    description: "300308.SZ · 6 条演示证据",
  },
  {
    id: "demo-session-tracking",
    label: "结构跟踪",
    project: "empty",
    description: "002048.SZ · 示例历史研究",
  },
].map((s) => ({
  ...s,
  kind: "session",
  group: "历史研究",
  category: "sessions",
}));
