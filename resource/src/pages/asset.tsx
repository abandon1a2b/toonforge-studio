import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, ArrowLeft, Check, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { get, useAction } from "@/lib/api";
import {
  type Artifact,
  type Entity,
  obj,
  str,
  arr,
  roles,
  labels,
  entityURL,
} from "@/lib/types";
import { Loading, ErrorBox, Status, Busy } from "@/components/shared";
import { MediaPlayer } from "@/components/media-player";
import { Readable } from "@/components/profile";
import {
  IssueForm,
  ReviewForm,
  SelectionForm,
} from "@/components/review-forms";
export default function AssetPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["artifact", id],
    queryFn: ({ signal }) => get<Artifact>("artifact", { id }, signal),
  });
  const owner = useQuery({
    queryKey: ["entity", q.data?.entity_id],
    queryFn: ({ signal }) =>
      get<Entity>("entity", { id: q.data!.entity_id }, signal),
    enabled: !!q.data,
  });
  const [issue, setIssue] = useState(false),
    [review, setReview] = useState(false),
    [select, setSelect] = useState(false);
  const cover = useAction("entity/cover", "封面已更新");
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data,
    e = owner.data;
  let slot = "reference." + a.id.slice(-8),
    scope = "";
  if (e) {
    if (e.type === "character")
      slot = "character." + str(e.metadata.id) + ".profile";
    if (e.type === "look")
      slot = "character." + e.parent_id?.replace("character:", "") + ".look";
    if (e.type === "scene") slot = "scene." + str(e.metadata.id);
    if (e.type === "mix") {
      slot = "mix.main";
      scope = e.parent_id || "";
    }
    if (e.type === "story") {
      scope = e.id;
      if (a.role === "board")
        slot =
          "board." +
          a.relative_path
            .split("/")
            .pop()
            ?.replace(/\.[^.]+$/, "");
      if (a.role === "voice") {
        for (const shot of e.children || [])
          for (const v of arr(shot.metadata.voices)) {
            const voice = obj(v);
            if (voice.path === a.relative_path && voice.cue_id)
              slot = "voice." + str(voice.cue_id);
          }
      }
    }
  }
  return (
    <>
      <div className="breadcrumb">
        <Link to={entityURL(a.entity_id, "assets")}>
          <ArrowLeft size={14} />
          返回{e?.name || "所属对象"}
        </Link>
      </div>
      <div className="page-intro">
        <div>
          <p className="eyebrow">
            {labels[a.role] || a.role} / {a.media_type.toUpperCase()}
          </p>
          <h1 className="asset-title">{a.relative_path.split("/").pop()}</h1>
          <p>{e?.name || a.entity_id}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Status value={a.status} />
          <Button variant="outline" asChild>
            <a href={"/api/v2/file?id=" + encodeURIComponent(a.id)} download>
              <Download size={15} />
              原文件
            </a>
          </Button>
        </div>
      </div>
      <div className="asset-detail-layout">
        <div>
          <MediaPlayer key={a.id} asset={a} />
          <div className="panel mt-5">
            <h2>来源与说明</h2>
            {a.source ? (
              <Readable value={a.source} />
            ) : (
              <p className="subtle">
                此文件未单独登记来源；可查看所属角色或场景中的参考来源。不会自动推断授权。
              </p>
            )}
            <Readable value={a.metadata.note || null} />
            <details>
              <summary>文件位置、校验值与技术参数</summary>
              <p>{a.relative_path}</p>
              <p className="hash">SHA256 {a.sha256}</p>
              <Readable value={a.metadata.technical} />
            </details>
          </div>
        </div>
        <aside>
          <AssetMetadata
            key={a.id + ":" + String(a.metadata.metadata_version)}
            asset={a}
          />
          <div className="panel">
            <h2>使用与审阅</h2>
            <p>确认选用与质量验收分别记录，旧剧本引用保持固定。</p>
            <div className="stack">
              <Button
                onClick={() => setSelect(true)}
                disabled={a.status === "needs_changes"}
              >
                <Check size={15} />
                选用于剧本
              </Button>
              {a.media_type === "image" && e && (
                <Button
                  variant="outline"
                  disabled={cover.isPending}
                  onClick={() =>
                    cover.mutate({
                      id: e.id,
                      artifact_id: a.id,
                      expected_version: e.version,
                    })
                  }
                >
                  设为资料封面
                </Button>
              )}
              <Button variant="outline" onClick={() => setReview(true)}>
                更新审阅状态
              </Button>
              <Button variant="outline" onClick={() => setIssue(true)}>
                <MessageSquare size={15} />
                记录问题
              </Button>
              <Button variant="ghost" asChild>
                <Link to={entityURL(a.entity_id, "usage")}>查看使用记录 →</Link>
              </Button>
            </div>
          </div>
        </aside>
      </div>
      {issue && (
        <IssueForm revision={a.revision_id} onClose={() => setIssue(false)} />
      )}{" "}
      {review && (
        <ReviewForm
          revision={{ id: a.revision_id, status: a.status }}
          onClose={() => setReview(false)}
        />
      )}{" "}
      {select && (
        <SelectionForm
          revision={a.revision_id}
          defaultSlot={slot}
          defaultScope={scope}
          onClose={() => setSelect(false)}
        />
      )}
    </>
  );
}
function AssetMetadata({ asset: a }: { asset: Artifact }) {
  const [role, setRole] = useState(a.role),
    [tags, setTags] = useState(
      (Array.isArray(a.metadata.tags) ? a.metadata.tags : []).join(", "),
    ),
    [note, setNote] = useState(str(a.metadata.note));
  const save = useAction("artifact/update", "素材分类与标记已保存");
  return (
    <form
      className="panel stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await save.mutateAsync({
            id: a.id,
            expected_version: a.metadata.metadata_version || 1,
            role,
            tags: tags
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean),
            note,
          });
        } catch {}
      }}
    >
      <h2>整理素材</h2>
      <Label htmlFor="asset-role">分类</Label>
      <select
        id="asset-role"
        className="native-select"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {labels[r]}
          </option>
        ))}
      </select>
      <Label htmlFor="asset-tags">标签，逗号分隔</Label>
      <Input
        id="asset-tags"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <Label htmlFor="asset-note">说明</Label>
      <Textarea
        id="asset-note"
        value={note}
        rows={5}
        onChange={(e) => setNote(e.target.value)}
      />
      {save.error && <p className="error-text">{save.error.message}</p>}
      <Button variant="outline" disabled={save.isPending}>
        <Busy busy={save.isPending}>保存标记</Busy>
      </Button>
    </form>
  );
}
