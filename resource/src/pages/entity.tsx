import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Pencil,
  Plus,
  Upload,
  ArrowLeft,
  Download,
  Archive,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { get, post, useAction, saveJSON } from "@/lib/api";
import {
  type Entity,
  type Page,
  type Artifact,
  type Revision,
  type Issue,
  entityURL,
  obj,
  str,
  labels,
  thumb,
  height,
  assetURL,
} from "@/lib/types";
import {
  Loading,
  ErrorBox,
  Empty,
  Tags,
  Status,
  EntityCard,
} from "@/components/shared";
import { EntityEditor } from "@/components/entity-editor";
import { EntityAssets } from "@/components/entity-assets";
import { ProfileSections, Readable } from "@/components/profile";
import {
  IssueForm,
  ReviewForm,
  SelectionForm,
} from "@/components/review-forms";
import { StoryWorkspace, ShotWorkspace } from "@/components/story-workspace";
export default function EntityPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "profile";
  const [edit, setEdit] = useState(false),
    [newLook, setNewLook] = useState(false),
    [archive, setArchive] = useState(false),
    [revision, setRevision] = useState<Revision>();
  const data = useQuery({
    queryKey: ["entity", id],
    queryFn: ({ signal }) => get<Entity>("entity", { id }, signal),
  });
  const archived = useAction<Entity>("entity/archive", "资料归档状态已更新");
  useEffect(() => {
    void post("entity/visit", { id }).catch(() => {});
  }, [id]);
  if (data.isPending) return <Loading />;
  if (data.error)
    return <ErrorBox error={data.error} retry={() => void data.refetch()} />;
  const e = data.data,
    m = e.metadata;
  const tabs = [
    ["profile", "资料总览"],
    ...(e.type === "character"
      ? [
          ["appearance", "外观锚点"],
          ["looks", "服装造型"],
          ["expressions", "表情动作"],
          ["voice", "声音"],
        ]
      : []),
    ...(e.type === "scene" ? [["layout", "空间与机位"]] : []),
    ...(e.type === "story" ? [["production", "剧本与制作"]] : []),
    ...(["shot", "clip"].includes(e.type) ? [["shot", "演出与引用"]] : []),
    ["assets", "分类资源"],
    ["usage", "使用记录"],
    ["versions", "版本"],
    ["feedback", "审阅"],
  ];
  const profileKeys =
    e.type === "character"
      ? [
          "description",
          "full_name",
          "franchise",
          "appearance_variant",
          "physical",
          "identity_anchors",
          "performance_flexibility",
          "sources",
          "review_notes",
        ]
      : e.type === "scene"
        ? ["description", "layout", "wardrobe", "review", "sources"]
        : [
            "description",
            "summary",
            "adaptation_proposals",
            "identity_anchors",
            "sources",
            "review_notes",
          ];
  return (
    <>
      <div className="breadcrumb">
        <Link
          to={
            "/library/" +
            (["look"].includes(e.type)
              ? "character"
              : ["shot", "clip"].includes(e.type)
                ? "story"
                : ["prop", "sound", "mix"].includes(e.type)
                  ? "public"
                  : e.type)
          }
        >
          <ArrowLeft size={14} />
          返回{labels[e.type]}资料库
        </Link>
        {e.parent_id && <Link to={entityURL(e.parent_id)}>查看所属对象</Link>}
      </div>
      <div className="entity-header">
        <div className="entity-cover">
          {e.cover_artifact_id ? (
            <img src={thumb(e.cover_artifact_id)} alt={e.name} />
          ) : (
            <ImageIcon size={32} />
          )}
        </div>
        <div className="entity-title">
          <p className="eyebrow">
            {labels[e.type]} / 资料 v{e.version}
          </p>
          <h1>{e.name}</h1>
          <Tags tags={e.tags} />
          {e.type === "character" && <p>{height(e)}</p>}
          {e.archived === 1 && <Status value="已归档" />}
        </div>
        <div className="entity-actions">
          <Button onClick={() => setEdit(true)}>
            <Pencil size={15} />
            编辑资料
          </Button>
          <Button variant="outline" asChild>
            <Link to={"/import?entity=" + encodeURIComponent(id)}>
              <Upload size={15} />
              添加资源
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="导出资料"
            onClick={() => saveJSON(e.name + ".json", e)}
          >
            <Download size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="归档或恢复"
            onClick={() => setArchive(true)}
          >
            <Archive size={16} />
          </Button>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setParams((p) => {
            p.set("tab", value);
            return p;
          })
        }
        className="entity-tabs"
      >
        <TabsList>
          {tabs.map(([v, t]) => (
            <TabsTrigger key={v} value={v}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="profile">
          <ProfileSections metadata={m} keys={profileKeys} />
          {e.type === "look" && (
            <ProfileSections
              metadata={m}
              keys={[
                "appearance",
                "outfit",
                "clothing",
                "performance_flexibility",
                "constraints",
              ]}
            />
          )}
          <details className="technical-details">
            <summary>完整资料与原始文件位置</summary>
            <pre>{JSON.stringify(m, null, 2)}</pre>
          </details>
        </TabsContent>
        <TabsContent value="appearance">
          <ProfileSections
            metadata={m}
            keys={[
              "appearance",
              "identity_anchors",
              "performance_flexibility",
              "review_notes",
            ]}
          />
        </TabsContent>
        <TabsContent value="layout">
          <ProfileSections
            metadata={m}
            keys={["layout", "spatial_anchors", "continuity_rules", "wardrobe"]}
          />
          <EntityAssets entity={id} defaultRole="layout" />
        </TabsContent>
        <TabsContent value="looks">
          <div className="section-heading">
            <h2>独立维护每套造型</h2>
            <Button onClick={() => setNewLook(true)}>
              <Plus size={15} />
              增加服装造型
            </Button>
          </div>
          {e.children?.some((x) => x.type === "look") ? (
            <div className="entity-grid">
              {e.children
                .filter((x) => x.type === "look")
                .map((c) => (
                  <EntityCard key={c.id} entity={c} />
                ))}
            </div>
          ) : (
            <Empty title="尚未建立独立造型">
              <p>角色资料可以先维护，再逐步增加不同服装。</p>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="expressions">
          <EntityAssets entity={id} defaultRole="expression" />
        </TabsContent>
        <TabsContent value="voice">
          <div className="panel">
            <h2>声源、音色与配音</h2>
            <p>原始声音、处理样本与实际台词分别分类，按具体版本查看和试听。</p>
            <Readable
              value={m.voice || m.voice_profile || m.voice_references || null}
            />
          </div>
          <EntityAssets entity={id} defaultRole="source_audio" />
        </TabsContent>
        <TabsContent value="production">
          <StoryWorkspace entity={e} />
        </TabsContent>
        <TabsContent value="shot">
          <ShotWorkspace entity={e} />
        </TabsContent>
        <TabsContent value="assets">
          <EntityAssets entity={id} />
        </TabsContent>
        <TabsContent value="usage">
          <div className="panel">
            <h2>明确选用记录</h2>
            {e.selected_by?.length ? (
              e.selected_by.map((r, i) => (
                <Link
                  className="record-row"
                  key={i}
                  to={entityURL(r.scope_entity_id, "production")}
                >
                  <strong>{r.scope_name || r.scope_entity_id}</strong>
                  <span>{r.slot}</span>
                  <small>查看本篇选用 →</small>
                </Link>
              ))
            ) : (
              <Empty title="尚无明确选用记录" />
            )}
            <h2 className="mt-8">关联镜头</h2>
            {e.usage?.length ? (
              e.usage.map((r) => (
                <Link
                  className="record-row"
                  key={r.id}
                  to={entityURL(r.id, "shot")}
                >
                  <strong>{r.name}</strong>
                  <span>查看镜头 →</span>
                </Link>
              ))
            ) : (
              <p className="subtle">没有显式关联的镜头，不从画面推断人物。</p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="versions">
          <VersionList revisions={e.revisions || []} onOpen={setRevision} />
        </TabsContent>
        <TabsContent value="feedback">
          <EntityFeedback id={id} revisions={e.revisions || []} />
        </TabsContent>
      </Tabs>
      <EntityEditor open={edit} onOpenChange={setEdit} entity={e} />
      <EntityEditor
        open={newLook}
        onOpenChange={setNewLook}
        type="look"
        parent={id}
      />
      {revision && (
        <RevisionDetail
          revision={revision}
          onClose={() => setRevision(undefined)}
        />
      )}
      <Dialog open={archive} onOpenChange={setArchive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{e.archived ? "恢复资料" : "归档资料"}</DialogTitle>
            <DialogDescription>
              归档隐藏日常列表中的条目，保留所有媒体、历史及剧本引用。当前有{" "}
              {e.selected_by?.length || 0} 条选用记录。
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setArchive(false)}>
              取消
            </Button>
            <Button
              disabled={archived.isPending}
              onClick={async () => {
                try {
                  await archived.mutateAsync({
                    id,
                    expected_version: e.version,
                    archived: !e.archived,
                  });
                  setArchive(false);
                } catch {}
              }}
            >
              {e.archived ? "恢复" : "明确归档"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function VersionList({
  revisions,
  onOpen,
}: {
  revisions: Revision[];
  onOpen: (v: Revision) => void;
}) {
  const [count, setCount] = useState(20);
  return (
    <>
      <p className="subtle">
        媒体与资料修订分别保留。新候选不会自动替换本篇选用。
      </p>
      {revisions.slice(0, count).map((r) => (
        <button
          className="version-row panel"
          key={r.id}
          onClick={() => onOpen(r)}
        >
          <div>
            <strong>{r.label}</strong>
            <p>
              {new Date(r.created_at).toLocaleString()} · {r.created_by}
            </p>
            {r.acceptance_evidence && <small>{r.acceptance_evidence}</small>}
          </div>
          <Status value={r.status} />
        </button>
      ))}
      {count < revisions.length && (
        <Button variant="outline" onClick={() => setCount(count + 20)}>
          显示更多（共{revisions.length}版）
        </Button>
      )}
    </>
  );
}
function RevisionDetail({
  revision: r,
  onClose,
}: {
  revision: Revision;
  onClose: () => void;
}) {
  const media = useQuery({
    queryKey: ["revision-media", r.id],
    queryFn: ({ signal }) =>
      get<Page<Artifact>>("artifacts", { revision: r.id, history: 1 }, signal),
  });
  const [review, setReview] = useState(false),
    [issue, setIssue] = useState(false),
    [select, setSelect] = useState(false);
  return (
    <>
      <Dialog
        open
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <DialogContent className="sm:max-w-3xl revision-dialog">
          <DialogHeader>
            <DialogTitle>{r.label}</DialogTitle>
            <DialogDescription>
              查看这一版的冻结资料与媒体；原始文件保持不变。
            </DialogDescription>
          </DialogHeader>
          <Status value={r.status} />
          {media.data?.items.map((a) => (
            <Link
              className="record-row"
              key={a.id}
              to={assetURL(a.id)}
              onClick={onClose}
            >
              <strong>{a.relative_path.split("/").pop()}</strong>
              <span>查看具体素材 →</span>
            </Link>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setReview(true)}>审阅状态</Button>
            <Button variant="outline" onClick={() => setIssue(true)}>
              记录问题
            </Button>
            <Button variant="outline" onClick={() => setSelect(true)}>
              选用于剧本
            </Button>
          </div>
          <div className="revision-snapshot">
            <Readable value={r.snapshot} />
          </div>
        </DialogContent>
      </Dialog>
      {review && <ReviewForm revision={r} onClose={() => setReview(false)} />}{" "}
      {issue && <IssueForm revision={r.id} onClose={() => setIssue(false)} />}{" "}
      {select && (
        <SelectionForm
          revision={r.id}
          defaultSlot="reference.profile"
          onClose={() => setSelect(false)}
        />
      )}
    </>
  );
}
function EntityFeedback({
  id,
  revisions,
}: {
  id: string;
  revisions: Revision[];
}) {
  const data = useQuery({
    queryKey: ["issues", id],
    queryFn: ({ signal }) =>
      get<{ items: Issue[] }>("issues", { entity: id }, signal),
  });
  const [issue, setIssue] = useState<Issue>(),
    [create, setCreate] = useState(false);
  return (
    <>
      <div className="section-heading">
        <h2>审阅与修复</h2>
        <Button disabled={!revisions.length} onClick={() => setCreate(true)}>
          记录当前版本问题
        </Button>
      </div>
      {data.data?.items.map((i) => (
        <div className="panel" key={i.id}>
          <div className="flex justify-between">
            <strong>{i.name}</strong>
            <Status value={i.status} />
          </div>
          <p>{i.body}</p>
          <Button variant="outline" onClick={() => setIssue(i)}>
            处理与复核
          </Button>
        </div>
      ))}
      {data.data?.items.length === 0 && <Empty title="暂无审阅问题" />}
      {issue && (
        <IssueForm
          issue={issue}
          revision={issue.revision_id}
          onClose={() => setIssue(undefined)}
        />
      )}{" "}
      {create && revisions[0] && (
        <IssueForm
          revision={revisions[0].id}
          onClose={() => setCreate(false)}
        />
      )}
    </>
  );
}
