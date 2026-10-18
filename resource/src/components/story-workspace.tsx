import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { get, useAction, saveJSON } from "@/lib/api";
import {
  type Entity,
  type Selection,
  type Page,
  type Artifact,
  obj,
  str,
  arr,
  strings,
  entityURL,
  assetURL,
  mediaURL,
  labels,
} from "@/lib/types";
import { Loading, ErrorBox, Empty, Status, EntityCard } from "./shared";
import { EntityAssets } from "./entity-assets";
import { Readable } from "./profile";

interface DocumentItem {
  key: string;
  path: string;
  bytes: number;
  text?: string;
}
interface Collection {
  title: string;
  status: string;
  pages: {
    id: string;
    title: string;
    image: string;
    shot_ids: string[];
    notes?: string;
  }[];
}
export function StoryWorkspace({ entity: e }: { entity: Entity }) {
  const [params, setParams] = useSearchParams();
  const section = params.get("section") || "boards";
  const [pack, setPack] = useState(false);
  const children = e.children || [];
  return (
    <>
      <div className="workspace-summary">
        <div>
          <strong>{children.filter((c) => c.type === "shot").length}</strong>
          <span>设计镜头</span>
        </div>
        <div>
          <strong>{children.filter((c) => c.type === "clip").length}</strong>
          <span>连续制作片段</span>
        </div>
        <div>
          <strong>{arr(e.metadata.cast).length}</strong>
          <span>本篇演员</span>
        </div>
        <Button variant="outline" onClick={() => setPack(true)}>
          构建镜头参考包
        </Button>
      </div>
      <Tabs
        value={section}
        onValueChange={(v) =>
          setParams((p) => {
            p.set("section", v);
            return p;
          })
        }
      >
        <TabsList className="workspace-tabs">
          {[
            ["script", "剧本与配音稿"],
            ["cast", "选角与服装"],
            ["scenes", "场景安排"],
            ["boards", "分镜与连续组"],
            ["sound", "声音"],
            ["output", "视频与交付"],
          ].map(([v, t]) => (
            <TabsTrigger key={v} value={v}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="script">
          <StoryDocuments entity={e} />
        </TabsContent>
        <TabsContent value="cast">
          <StoryCast entity={e} />
          <StorySelections id={e.id} />
        </TabsContent>
        <TabsContent value="scenes">
          <StoryScenes entity={e} />
        </TabsContent>
        <TabsContent value="boards">
          <StoryBoards entity={e} />
        </TabsContent>
        <TabsContent value="sound">
          <StorySound entity={e} />
        </TabsContent>
        <TabsContent value="output">
          <div className="panel">
            <h2>预演、片段与成片</h2>
            <p>静态预演与生成运动分别分类；每次选用固定到具体版本。</p>
          </div>
          <EntityAssets entity={e.id} defaultRole="preview" />
        </TabsContent>
      </Tabs>
      {pack && <ContextDialog story={e.id} onClose={() => setPack(false)} />}
    </>
  );
}
function useSaveMetadata(e: Entity) {
  const save = useAction<Entity>(
    "entity/update",
    "本篇资料已保存；既有镜头与选用需按影响范围检查",
  );
  return {
    save,
    submit: (metadata: Record<string, unknown>) =>
      save.mutateAsync({
        id: e.id,
        name: e.name,
        tags: e.tags,
        metadata,
        expected_version: e.version,
      }),
  };
}
function StoryDocuments({ entity: e }: { entity: Entity }) {
  const docs = useQuery({
    queryKey: ["documents", e.id],
    queryFn: ({ signal }) =>
      get<{ items: DocumentItem[] }>("documents", { entity: e.id }, signal),
  });
  const [key, setKey] = useState("script");
  const doc = useQuery({
    queryKey: ["document", e.id, key],
    queryFn: ({ signal }) =>
      get<DocumentItem>("documents", { entity: e.id, key }, signal),
    enabled: !!docs.data?.items.some((d) => d.key === key),
  });
  const [edit, setEdit] = useState(false),
    [draft, setDraft] = useState("");
  const { save, submit } = useSaveMetadata(e);
  return (
    <div className="panel">
      <div className="section-heading">
        <h2>剧本与演出稿</h2>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(str(e.metadata.script_draft) || doc.data?.text || "");
            setEdit(true);
          }}
        >
          编辑本篇工作稿
        </Button>
      </div>
      <div className="flex gap-2 flex-wrap mb-5">
        {docs.data?.items.map((d) => (
          <Button
            key={d.key}
            variant={key === d.key ? "secondary" : "ghost"}
            onClick={() => setKey(d.key)}
          >
            {(
              {
                script: "本篇剧本",
                original_script: "原始剧本",
                voice_script: "配音演出稿",
                voice_cues: "配音清单",
                shot_list: "分镜清单",
                collection_manifest: "合集资料",
              } as Record<string, string>
            )[d.key] || d.key}
          </Button>
        ))}
      </div>
      {e.metadata.script_draft != null && (
        <details className="mb-5">
          <summary>已保存的本篇工作稿</summary>
          <div className="document-reader">{str(e.metadata.script_draft)}</div>
        </details>
      )}
      {doc.isFetching ? (
        <Loading />
      ) : doc.error ? (
        <ErrorBox error={doc.error} />
      ) : doc.data ? (
        <>
          <p className="subtle">{doc.data.path} · 原始文件只读保留</p>
          <div className="document-reader">{doc.data.text}</div>
        </>
      ) : (
        <Empty title="尚未登记正文文件">
          <p>可以直接建立本篇工作稿。</p>
        </Empty>
      )}
      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>本篇工作稿</DialogTitle>
            <DialogDescription>
              保存为资料修订，不覆盖原始剧本。对白与分镜改动后需检查对应的镜头和声音。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="script-editor"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            rows={18}
          />
          <div className="dialog-actions">
            <Button
              variant="outline"
              onClick={() =>
                setDraft(draft + "\n\n## 新场次\n场景：\n动作：\n对白：\n")
              }
            >
              添加场次
            </Button>
            <Button
              disabled={save.isPending}
              onClick={async () => {
                try {
                  await submit({ ...e.metadata, script_draft: draft });
                  setEdit(false);
                } catch {}
              }}
            >
              保存工作稿
            </Button>
          </div>
          {save.error && <p className="error-text">{save.error.message}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function StorySelections({ id }: { id: string }) {
  const result = useQuery({
    queryKey: ["selections", id],
    queryFn: ({ signal }) =>
      get<{ items: Selection[] }>("selections", { scope: id }, signal),
  });
  return (
    <details className="panel">
      <summary>本篇固定选用 · {result.data?.items.length || 0} 项</summary>
      {result.data?.items.map((s) => (
        <Link
          key={s.slot}
          className="record-row"
          to={entityURL(s.entity_id, "versions")}
        >
          <div>
            <strong>{s.name}</strong>
            <p>{s.label}</p>
            <small>{s.slot}</small>
          </div>
          <Status value={s.status} />
        </Link>
      ))}
    </details>
  );
}
function StoryCast({ entity: e }: { entity: Entity }) {
  const looks = useQuery({
    queryKey: ["all-looks"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { type: "look", limit: 200 }, signal),
  });
  const all = useQuery({
    queryKey: ["all-characters"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { type: "character", limit: 200 }, signal),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>[]>([]);
  const { save, submit } = useSaveMetadata(e);
  const members = arr(e.metadata.cast).map((v) =>
    typeof v === "string" ? { id: v } : obj(v),
  );
  return (
    <div className="panel">
      <div className="section-heading">
        <h2>本篇演员与改编身份</h2>
        <Button
          onClick={() => {
            setDraft(members);
            setEditing(true);
          }}
        >
          维护本篇选角
        </Button>
      </div>
      <div className="entity-grid">
        {members.map((c) => {
          const char = all.data?.items.find(
            (a) => str(a.metadata.id) === str(c.id),
          );
          return char ? (
            <div key={char.id}>
              <EntityCard entity={char} />
              <p className="subtle">
                本篇造型：{str(c.variant) || "基础造型"} ·{" "}
                {str(c.role) || "出场角色"}
              </p>
            </div>
          ) : (
            <div className="panel" key={str(c.id)}>
              {str(c.id)} · 角色资料待绑定
            </div>
          );
        })}
      </div>
      {str(e.metadata.narrator_name) && (
        <p className="hint">
          旁白：{str(e.metadata.narrator_name)}。旁白声音与出镜演员分别管理。
        </p>
      )}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>本篇选角与造型</DialogTitle>
            <DialogDescription>
              修改的是本篇配置；更换演员后需检查受影响的镜头与声音。具体图片版本通过素材详情选用。
            </DialogDescription>
          </DialogHeader>
          <div className="cast-editor">
            {draft.map((c, i) => (
              <div className="cast-edit-row" key={i}>
                <select
                  className="native-select"
                  value={str(c.id)}
                  onChange={(ev) =>
                    setDraft((old) =>
                      old.map((v, n) =>
                        n === i
                          ? { id: ev.target.value, role: str(c.role) }
                          : v,
                      ),
                    )
                  }
                >
                  <option value="">选择角色</option>
                  {all.data?.items.map((a) => (
                    <option key={a.id} value={str(a.metadata.id)}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder="用途：主演 / 路人 / 旁白"
                  value={str(c.role)}
                  onChange={(ev) =>
                    setDraft((old) =>
                      old.map((v, n) =>
                        n === i ? { ...v, role: ev.target.value } : v,
                      ),
                    )
                  }
                />
                <select
                  className="native-select"
                  aria-label="本篇服装造型"
                  value={str(c.variant)}
                  onChange={(ev) =>
                    setDraft((old) =>
                      old.map((v, n) =>
                        n === i ? { ...v, variant: ev.target.value } : v,
                      ),
                    )
                  }
                >
                  <option value="">基础造型</option>
                  {looks.data?.items
                    .filter(
                      (look) => look.parent_id === "character:" + str(c.id),
                    )
                    .map((look) => {
                      const id =
                        str(look.metadata.id) || look.id.split(":").pop() || "";
                      return (
                        <option key={look.id} value={id}>
                          {look.name}
                        </option>
                      );
                    })}
                  {str(c.variant) &&
                    !looks.data?.items.some(
                      (look) =>
                        look.parent_id === "character:" + str(c.id) &&
                        (str(look.metadata.id) || look.id.split(":").pop()) ===
                          c.variant,
                    ) && (
                      <option value={str(c.variant)}>
                        当前服装：{str(c.variant)}
                      </option>
                    )}
                </select>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setDraft((old) => old.filter((_, n) => n !== i))
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <Button
              variant="outline"
              onClick={() => setDraft([...draft, { id: "", role: "" }])}
            >
              加入角色
            </Button>
            <Button
              disabled={save.isPending || draft.some((c) => !str(c.id))}
              onClick={async () => {
                try {
                  await submit({ ...e.metadata, cast: draft });
                  setEditing(false);
                } catch {}
              }}
            >
              保存本篇选角
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function StoryScenes({ entity: e }: { entity: Entity }) {
  const scenes = useQuery({
    queryKey: ["all-scenes"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { type: "scene", limit: 200 }, signal),
  });
  const [editing, setEditing] = useState(false);
  const [left, setLeft] = useState(""),
    [middle, setMiddle] = useState(""),
    [right, setRight] = useState(""),
    [notes, setNotes] = useState("");
  const { save, submit } = useSaveMetadata(e);
  const ids = strings(e.metadata.scenes);
  const config = obj(e.metadata.scene_config);
  return (
    <>
      <div className="panel">
        <div className="section-heading">
          <h2>本篇场景与人物座位</h2>
          <Button
            onClick={() => {
              setLeft(str(config.left));
              setMiddle(str(config.middle));
              setRight(str(config.right));
              setNotes(str(config.notes) || str(e.metadata.spatial_revision));
              setEditing(true);
            }}
          >
            维护本篇位置
          </Button>
        </div>
        <div className="entity-grid">
          {scenes.data?.items
            .filter((s) => ids.includes(str(s.metadata.id)))
            .map((s) => (
              <EntityCard key={s.id} entity={s} />
            ))}
        </div>
        <div className="seat-layout">
          {[
            ["左席", str(config.left)],
            ["中席", str(config.middle)],
            ["右席", str(config.right)],
          ].map(([a, b]) => (
            <div key={a}>
              <small>{a}</small>
              <strong>{b || "待明确"}</strong>
            </div>
          ))}
        </div>
        <p>
          {str(config.notes) ||
            str(e.metadata.spatial_revision) ||
            "本篇人物位置尚未单独登记。共享场景中保留空间锚点。"}
        </p>
      </div>
      <StorySelections id={e.id} />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>本篇人物与道具位置</DialogTitle>
            <DialogDescription>
              这里记录本篇安排，不改写共享场景的空间版本。
            </DialogDescription>
          </DialogHeader>
          <Label>左席人物</Label>
          <Input value={left} onChange={(ev) => setLeft(ev.target.value)} />
          <Label>中席人物</Label>
          <Input value={middle} onChange={(ev) => setMiddle(ev.target.value)} />
          <Label>右席人物</Label>
          <Input value={right} onChange={(ev) => setRight(ev.target.value)} />
          <Label>道具、机位与连续性说明</Label>
          <Textarea
            value={notes}
            rows={5}
            onChange={(ev) => setNotes(ev.target.value)}
          />
          <Button
            disabled={save.isPending}
            onClick={async () => {
              try {
                await submit({
                  ...e.metadata,
                  scene_config: { ...config, left, middle, right, notes },
                });
                setEditing(false);
              } catch {}
            }}
          >
            保存本篇安排
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
function StoryBoards({ entity: e }: { entity: Entity }) {
  const [view, setView] = useState("collections");
  const shots = e.children?.filter((c) => c.type === "shot") || [],
    clips = e.children?.filter((c) => c.type === "clip") || [];
  const result = useQuery({
    queryKey: ["collection", e.id],
    queryFn: async ({ signal }) => {
      const r = await fetch(
        "/api/collection?story=" +
          encodeURIComponent(str(e.metadata.legacy_story_id) || e.id.slice(6)),
        { signal },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      return data as Collection;
    },
    enabled: !!e.metadata.collection_manifest,
  });
  return (
    <>
      <div className="filter-bar">
        {[
          ["collections", "整张分镜合集"],
          ["shots", "逐镜清单"],
          ["clips", "连续制作片段"],
        ].map(([v, t]) => (
          <Button
            key={v}
            variant={v === view ? "secondary" : "ghost"}
            onClick={() => setView(v)}
          >
            {t}
          </Button>
        ))}
        <Button variant="outline" asChild>
          <Link
            to={"/review-collection?story=" + encodeURIComponent(e.id.slice(6))}
            target="_blank"
          >
            独立审阅页 ↗
          </Link>
        </Button>
      </div>
      {view === "collections" ? (
        result.isPending && e.metadata.collection_manifest ? (
          <Loading />
        ) : result.error ? (
          <ErrorBox error={result.error} />
        ) : result.data?.pages.length ? (
          <div className="collection-grid">
            {result.data.pages.map((p) => (
              <article className="panel" key={p.id}>
                <div className="section-heading">
                  <h2>
                    {p.id} · {p.title}
                  </h2>
                  <Status value="pending_review" />
                </div>
                <a
                  href={"/media?path=" + encodeURIComponent(p.image)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={"/media?path=" + encodeURIComponent(p.image)}
                    alt={p.title}
                    loading="lazy"
                  />
                </a>
                <p className="subtle">{p.notes}</p>
                <div className="flex flex-wrap gap-2">
                  {p.shot_ids?.map((id) => {
                    const shot = shots.find(
                      (s) => str(s.metadata.legacy_shot_id) === id,
                    );
                    return shot ? (
                      <Link
                        className="shot-chip"
                        key={id}
                        to={entityURL(shot.id, "shot")}
                      >
                        {id}
                      </Link>
                    ) : (
                      <span key={id}>{id}</span>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="尚未登记分镜合集">
            <p>可以先导入整张合集，再关联镜号。</p>
          </Empty>
        )
      ) : (
        <div className="panel">
          {(view === "shots" ? shots : clips).map((s) => (
            <Link
              className="record-row"
              key={s.id}
              to={entityURL(s.id, "shot")}
            >
              <div>
                <strong>{s.name}</strong>
                <p>
                  {view === "clips"
                    ? strings(s.metadata.shots).join(" → ")
                    : strings(s.metadata.characters).join(" / ")}
                </p>
              </div>
              <span>打开演出与引用 →</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
function StorySound({ entity: e }: { entity: Entity }) {
  const [view, setView] = useState("voice");
  const selection = useQuery({
    queryKey: ["selections", e.id],
    queryFn: ({ signal }) =>
      get<{ items: Selection[] }>("selections", { scope: e.id }, signal),
  });
  const cues = new Map<string, Record<string, unknown>>();
  for (const child of e.children || []) {
    for (const v of arr(child.metadata.voices)) {
      const m = obj(v),
        id = str(m.cue_id) || str(m.path);
      if (id && !cues.has(id))
        cues.set(id, { ...m, shot: child.id, shotName: child.name });
    }
  }
  return (
    <>
      <div className="filter-bar">
        {[
          ["voice", "逐句配音"],
          ["sfx", "音效与环境"],
          ["music", "音乐"],
          ["mix", "混音与分轨"],
        ].map(([v, t]) => (
          <Button
            key={v}
            variant={view === v ? "secondary" : "ghost"}
            onClick={() => setView(v)}
          >
            {t}
          </Button>
        ))}
      </div>
      {view === "voice" ? (
        <div className="panel">
          <h2>本篇配音 · {cues.size} 句</h2>
          <p className="subtle">
            优先播放本篇明确选用的版本；尚未选用时标为候选。
          </p>
          {[...cues.entries()].map(([id, c]) => (
            <CueRow
              key={id}
              cue={c}
              selection={selection.data?.items.find(
                (s) => s.slot === "voice." + id,
              )}
            />
          ))}
          {!cues.size && <Empty title="尚未登记台词声音关系" />}
        </div>
      ) : (
        <EntityAssets key={view} entity={e.id} defaultRole={view} />
      )}
    </>
  );
}
function CueRow({
  cue,
  selection,
}: {
  cue: Record<string, unknown>;
  selection?: Selection;
}) {
  const a = useQuery({
    queryKey: ["cue", str(cue.path), selection?.revision_id],
    queryFn: ({ signal }) =>
      get<Page<Artifact>>(
        "artifacts",
        selection
          ? { revision: selection.revision_id, history: 1 }
          : { q: str(cue.path), limit: 1 },
        signal,
      ),
  });
  const asset = a.data?.items[0];
  return (
    <div className="cue-row">
      <div>
        <strong>{str(cue.character)}</strong>
        <p>{str(cue.text)}</p>
        <Link to={entityURL(str(cue.shot), "shot")}>{str(cue.shotName)}</Link>
      </div>
      <div>
        {asset ? (
          <>
            <audio controls preload="none" src={mediaURL(asset)} />
            <Link to={assetURL(asset.id)}>
              {selection ? "本篇固定选用" : "候选试听"} · 查看版本
            </Link>
          </>
        ) : (
          <small>{a.isPending ? "读取声音…" : "尚未找到声音文件"}</small>
        )}
      </div>
    </div>
  );
}
export function ShotWorkspace({ entity: e }: { entity: Entity }) {
  const m = e.metadata;
  const [edit, setEdit] = useState(false),
    [direction, setDirection] = useState(""),
    [duration, setDuration] = useState(""),
    [continuity, setContinuity] = useState("");
  const { save, submit } = useSaveMetadata(e);
  const story = e.parent_id || str(m.story_id);
  const siblings = useQuery({
    queryKey: ["entity", story],
    queryFn: ({ signal }) => get<Entity>("entity", { id: story }, signal),
    enabled: !!story,
  });
  const shots = siblings.data?.children?.filter((c) => c.type === "shot") || [];
  const index = shots.findIndex((s) => s.id === e.id);
  const groups =
    siblings.data?.children?.filter(
      (c) =>
        c.type === "clip" &&
        strings(c.metadata.shots).includes(str(m.legacy_shot_id)),
    ) || [];
  return (
    <>
      <div className="filter-bar">
        {index > 0 && (
          <Button variant="outline" asChild>
            <Link to={entityURL(shots[index - 1].id, "shot")}>← 前一镜</Link>
          </Button>
        )}
        {index >= 0 && index < shots.length - 1 && (
          <Button variant="outline" asChild>
            <Link to={entityURL(shots[index + 1].id, "shot")}>后一镜 →</Link>
          </Button>
        )}
        <Button
          onClick={() => {
            setDirection(str(m.direction) || str(m.action));
            setDuration(str(m.duration_seconds) || str(m.duration));
            setContinuity(str(m.continuity_notes));
            setEdit(true);
          }}
        >
          编辑演出与连续性
        </Button>
        {story && (
          <Button variant="ghost" asChild>
            <Link to={entityURL(story, "production")}>返回本篇工作区</Link>
          </Button>
        )}
      </div>
      <div className="panel">
        <h2>{e.type === "clip" ? "连续片段安排" : "画面与演出"}</h2>
        <Readable
          value={Object.fromEntries(
            Object.entries(m).filter(
              ([k]) =>
                ![
                  "_legacy_hash",
                  "_legacy_source",
                  "voices",
                  "dialogue",
                  "story_id",
                ].includes(k),
            ),
          )}
        />
      </div>
      {groups.length > 0 && (
        <div className="panel">
          <h2>属于连续制作片段</h2>
          {groups.map((g) => (
            <Link
              className="record-row"
              key={g.id}
              to={entityURL(g.id, "shot")}
            >
              <strong>{g.name}</strong>
              <span>{strings(g.metadata.shots).join(" → ")}</span>
            </Link>
          ))}
        </div>
      )}
      {arr(m.voices).length > 0 && (
        <div className="panel">
          <h2>对应声音</h2>
          {arr(m.voices).map((c, i) => (
            <CueRow key={i} cue={{ ...obj(c), shot: e.id, shotName: e.name }} />
          ))}
        </div>
      )}
      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>演出与连续性</DialogTitle>
            <DialogDescription>
              保存修订后，已有画面和声音仍需按内容变化检查。
            </DialogDescription>
          </DialogHeader>
          <Label>动作、画面与机位说明</Label>
          <Textarea
            rows={6}
            value={direction}
            onChange={(ev) => setDirection(ev.target.value)}
          />
          <Label>预计秒数</Label>
          <Input
            type="number"
            min="0"
            step="0.1"
            value={duration}
            onChange={(ev) => setDuration(ev.target.value)}
          />
          <Label>人物位置、服装、道具与动作衔接</Label>
          <Textarea
            value={continuity}
            onChange={(ev) => setContinuity(ev.target.value)}
          />
          <Button
            disabled={save.isPending}
            onClick={async () => {
              try {
                await submit({
                  ...m,
                  direction,
                  duration_seconds: duration ? Number(duration) : null,
                  continuity_notes: continuity,
                });
                setEdit(false);
              } catch {}
            }}
          >
            保存演出说明
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ContextDialog({
  story,
  onClose,
}: {
  story: string;
  onClose: () => void;
}) {
  const [shots, setShots] = useState(""),
    [purpose, setPurpose] = useState("video"),
    [request, setRequest] = useState<{ shots: string; purpose: string }>();
  const data = useQuery({
    queryKey: ["context", story, request],
    queryFn: ({ signal }) =>
      get<Record<string, unknown>>(
        "context",
        { story, shots: request?.shots, purpose: request?.purpose },
        signal,
      ),
    enabled: !!request,
    retry: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>构建固定版本参考包</DialogTitle>
          <DialogDescription>
            连续组自动展开；缺项不会由最新文件自动补齐。引用完整不等于素材通过验收。
          </DialogDescription>
        </DialogHeader>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setRequest({ shots: shots.replaceAll("，", ","), purpose });
          }}
        >
          <Input
            required
            value={shots}
            onChange={(e) => setShots(e.target.value)}
            placeholder="shot-014,shot-015"
            aria-label="镜号列表"
          />
          <select
            className="native-select"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          >
            <option value="video">视频镜头</option>
            <option value="image">镜头原画</option>
            <option value="audio">声音</option>
          </select>
          <Button>构建</Button>
        </form>
        {data.isFetching && <Loading />}
        {data.error && <ErrorBox error={data.error} />}{" "}
        {data.data && (
          <>
            <p className={data.data.ready ? "success-text" : "error-text"}>
              {data.data.ready
                ? "引用已完整，可导出检查。"
                : "仍有需要明确的选用：" +
                  strings(data.data.missing_selections).join("、")}
            </p>
            <p>连续组展开：{strings(data.data.expanded_shots).join(" → ")}</p>
            <Button
              variant="outline"
              onClick={() =>
                saveJSON("toonforge-reference-pack.json", data.data)
              }
            >
              下载固定引用清单
            </Button>
            <details>
              <summary>查看参考包完整内容</summary>
              <pre>{JSON.stringify(data.data, null, 2)}</pre>
            </details>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
