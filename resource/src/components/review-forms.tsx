import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { get, useAction } from "@/lib/api";
import {
  type Entity,
  type Page,
  type Selection,
  type Issue,
  type Revision,
  labels,
} from "@/lib/types";
import { Busy } from "./shared";
export function IssueForm({
  revision,
  issue,
  onClose,
}: {
  revision: string;
  issue?: Issue;
  onClose: () => void;
}) {
  const [body, setBody] = useState(issue?.body || "");
  const [status, setStatus] = useState(issue?.status || "open");
  const [severity, setSeverity] = useState(issue?.severity || "minor");
  const [start, setStart] = useState(
    issue?.start_ms == null ? "" : String(issue.start_ms / 1000),
  );
  const [end, setEnd] = useState(
    issue?.end_ms == null ? "" : String(issue.end_ms / 1000),
  );
  const [evidence, setEvidence] = useState(issue?.verification_evidence || "");
  const save = useAction("issue/save", "反馈已保存");
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{issue ? "处理审阅问题" : "记录审阅反馈"}</DialogTitle>
          <DialogDescription>
            问题绑定具体版本；“已修”之后仍需用户复核。
          </DialogDescription>
        </DialogHeader>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await save.mutateAsync({
                revision_id: revision,
                id: issue?.id,
                expected_version: issue?.version || 0,
                body,
                status,
                severity,
                start_ms:
                  start === "" ? null : Math.round(Number(start) * 1000),
                end_ms: end === "" ? null : Math.round(Number(end) * 1000),
                evidence,
              });
              onClose();
            } catch {}
          }}
        >
          <Label>问题与期望</Label>
          <Textarea
            value={body}
            required
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="form-grid">
            <div>
              <Label>处理状态</Label>
              <select
                className="native-select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["open", "in_progress", "resolved", "verified"].map((v) => (
                  <option key={v} value={v}>
                    {labels[v]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>影响程度</Label>
              <select
                className="native-select"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {[
                  ["note", "备注"],
                  ["minor", "小问题"],
                  ["major", "明显影响"],
                  ["blocking", "阻碍制作"],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div>
              <Label>起始秒（可选）</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <Label>结束秒（可选）</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <Label>用户复核依据</Label>
          <Input
            value={evidence}
            required={status === "verified"}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="用户检查了哪个版本、确认了什么"
          />
          {save.error && <p className="error-text">{save.error.message}</p>}
          <Button disabled={save.isPending}>
            <Busy busy={save.isPending}>保存反馈</Busy>
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ReviewForm({
  revision,
  onClose,
}: {
  revision: Pick<Revision, "id" | "status" | "acceptance_evidence">;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(revision.status),
    [proof, setProof] = useState(revision.acceptance_evidence || "");
  const save = useAction("revision/review", "审阅记录已保存");
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>版本审阅</DialogTitle>
          <DialogDescription>
            生成成功或技术校验通过不能代替用户验收。
          </DialogDescription>
        </DialogHeader>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await save.mutateAsync({
                id: revision.id,
                status,
                evidence: proof,
                expected_status: revision.status,
              });
              onClose();
            } catch {}
          }}
        >
          <Label>审阅状态</Label>
          <select
            className="native-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {["draft", "pending_review", "needs_changes", "accepted"].map(
              (s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ),
            )}
          </select>
          <Label>用户验收依据</Label>
          <Textarea
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            required={status === "accepted"}
          />
          {save.error && <p className="error-text">{save.error.message}</p>}
          <Button disabled={save.isPending}>保存审阅记录</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function SelectionForm({
  revision,
  defaultSlot = "",
  defaultScope = "",
  onClose,
}: {
  revision: string;
  defaultSlot?: string;
  defaultScope?: string;
  onClose: () => void;
}) {
  const stories = useQuery({
    queryKey: ["stories-select"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { type: "story" }, signal),
  });
  const [scope, setScope] = useState(defaultScope),
    [slot, setSlot] = useState(defaultSlot),
    [reason, setReason] = useState("");
  const selections = useQuery({
    queryKey: ["selections", scope],
    queryFn: ({ signal }) =>
      get<{ items: Selection[] }>("selections", { scope }, signal),
    enabled: !!scope,
  });
  const save = useAction("selection/set", "本篇选用已固定");
  const current = selections.data?.items.find((s) => s.slot === slot);
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>选用于剧本</DialogTitle>
          <DialogDescription>
            选用与验收分别记录，已有镜头不会跟随最新候选变化。
          </DialogDescription>
        </DialogHeader>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await save.mutateAsync({
                scope,
                slot,
                revision_id: revision,
                expected_version: current?.version || 0,
                reason,
              });
              onClose();
            } catch {}
          }}
        >
          <Label>目标剧本</Label>
          <select
            className="native-select"
            value={scope}
            required
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">请选择剧本</option>
            {stories.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <Label>引用用途</Label>
          <select
            className="native-select"
            value={slot}
            required
            onChange={(e) => setSlot(e.target.value)}
          >
            <option value="">请选择用途</option>
            {Array.from(
              new Set([
                defaultSlot,
                ...(selections.data?.items.map((s) => s.slot) || []),
              ]),
            )
              .filter(Boolean)
              .map((s) => (
                <option key={s} value={s}>
                  {s.startsWith("character.")
                    ? "角色 · " + s.split(".")[1]
                    : s.startsWith("scene.")
                      ? "场景 · " + s.slice(6)
                      : s.startsWith("voice.")
                        ? "配音 · " + s.slice(6)
                        : s.startsWith("board.")
                          ? "分镜合集 · " + s.slice(6)
                          : s}
                </option>
              ))}
            <option value="reference.补充参考">补充参考</option>
          </select>
          <p className="hint">
            用途由素材归属预填，也可以替换剧本中已有的引用。
          </p>
          {current && (
            <p className="subtle">
              将替换：{current.name} / {current.label}
            </p>
          )}
          <Label>选用说明</Label>
          <Input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {save.error && <p className="error-text">{save.error.message}</p>}
          <Button disabled={!scope || selections.isPending || save.isPending}>
            固定此版本
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
