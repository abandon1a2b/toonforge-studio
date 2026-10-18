export type Json = Record<string, unknown>;
export type EntityType =
  | "character"
  | "look"
  | "scene"
  | "prop"
  | "sound"
  | "story"
  | "shot"
  | "clip"
  | "mix";
export interface Revision {
  id: string;
  entity_id: string;
  label: string;
  status: string;
  snapshot: Json;
  generation: Json;
  created_at: string;
  created_by: string;
  acceptance_evidence?: string;
}
export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  parent_id?: string;
  version: number;
  archived: number;
  metadata: Json;
  tags: string[];
  cover_artifact_id?: string;
  children?: Entity[];
  revisions?: Revision[];
  selected_by?: Selection[];
  usage?: { id: string; name: string; story_id: string }[];
}
export interface Artifact {
  id: string;
  revision_id: string;
  entity_id: string;
  entity_name?: string;
  relative_path: string;
  sha256: string;
  media_type: "image" | "audio" | "video";
  role: string;
  status: string;
  label?: string;
  metadata: Json;
  historical?: boolean;
  source?: Json;
}
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
export interface Selection {
  scope_entity_id: string;
  scope_name?: string;
  slot: string;
  revision_id: string;
  version: number;
  status: string;
  name: string;
  entity_id: string;
  label: string;
}
export interface Issue {
  id: string;
  revision_id: string;
  entity_id: string;
  name: string;
  body: string;
  status: string;
  severity: string;
  version: number;
  start_ms?: number;
  end_ms?: number;
  verification_evidence?: string;
  created_at: string;
}
export interface Job {
  id: string;
  kind: string;
  status: string;
  progress: number;
  result: Json;
  error?: string;
  created_at: string;
}
export interface Overview {
  project: string;
  root: string;
  counts: Record<string, number>;
  artifacts: number;
  visible_artifacts: number;
  pending_imports: number;
  stories: Entity[];
  issues: Issue[];
  recent: Entity[];
  engine: string;
  version: string;
}
export const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
export const strings = (v: unknown): string[] =>
  arr(v).filter((x): x is string => typeof x === "string");
export const entityURL = (id: string, tab?: string) =>
  `/entities/${encodeURIComponent(id)}${tab ? "?tab=" + tab : ""}`;
export const assetURL = (id: string) => `/assets/${encodeURIComponent(id)}`;
export const thumb = (id: string) =>
  "/api/v2/thumb?id=" + encodeURIComponent(id);
export const mediaURL = (a: Artifact) =>
  `/api/v2/${a.media_type === "audio" ? "audio-preview" : "file"}?id=${encodeURIComponent(a.id)}`;
export const labels: Record<string, string> = {
  character: "角色",
  look: "服装造型",
  scene: "场景",
  prop: "道具",
  sound: "声音素材",
  story: "剧本",
  shot: "镜头",
  clip: "连续片段",
  mix: "混音",
  draft: "草稿",
  pending_review: "待审阅",
  needs_changes: "需修改",
  accepted: "用户确认可用",
  open: "待处理",
  in_progress: "处理中",
  resolved: "已修待复核",
  verified: "已复核",
  unknown: "未知",
  proposed: "制作暂定",
  confirmed: "已确认",
  reference: "参考图",
  turnaround: "角色设定表",
  expression: "表情动作",
  source_audio: "原始声源",
  voice: "配音",
  sfx: "音效",
  music: "音乐",
  stem: "分轨",
  layout: "空间布局",
  board: "分镜合集",
  frame: "镜头原画",
  preview: "预演",
  video: "视频",
  queued: "排队中",
  running: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
export const roles = [
  "reference",
  "turnaround",
  "look",
  "expression",
  "source_audio",
  "voice",
  "sfx",
  "music",
  "mix",
  "stem",
  "scene",
  "layout",
  "board",
  "frame",
  "preview",
  "video",
];
export function height(e: Entity) {
  const h = obj(obj(e.metadata.physical).height_cm);
  return `${h.value == null ? "待确认" : str(h.value) + " cm"} · ${labels[str(h.status)] || str(h.status) || "未知"}`;
}
