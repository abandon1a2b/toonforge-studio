import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { get, useAction, saveJSON } from "@/lib/api";
import {
  type Job,
  type Json,
  type Entity,
  type Page,
  obj,
  str,
  arr,
  entityURL,
  labels,
} from "@/lib/types";
import { Loading, ErrorBox, Empty, Status } from "@/components/shared";
import { Readable } from "@/components/profile";
export default function Manage() {
  const { tab = "settings" } = useParams();
  return (
    <>
      {tab === "tasks" ? (
        <Tasks />
      ) : tab === "tags" ? (
        <TagManager />
      ) : tab === "archive" ? (
        <Archive />
      ) : (
        <Settings />
      )}
    </>
  );
}
function Tasks() {
  const data = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => get<{ items: Job[] }>("jobs", {}, signal),
    refetchInterval: (q) =>
      q.state.data?.items.some((j) => ["running", "queued"].includes(j.status))
        ? 1500
        : false,
  });
  const cancel = useAction("jobs/cancel", "已请求取消任务"),
    submit = useAction("jobs/create", "已提交新任务");
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">LOCAL TASKS</p>
          <h1>后台任务</h1>
          <p>任务状态会保留。服务中断后先检查结果，再明确重新提交。</p>
        </div>
        <Button variant="outline" onClick={() => void data.refetch()}>
          刷新
        </Button>
      </div>
      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <ErrorBox error={data.error} />
      ) : !data.data.items.length ? (
        <Empty title="还没有后台任务" />
      ) : (
        data.data.items.map((j) => (
          <article className="panel" key={j.id}>
            <div className="flex justify-between">
              <h2>
                {(
                  {
                    refresh: "扫描与登记变更",
                    backup: "备份素材库",
                    health: "完整性校验",
                  } as Record<string, string>
                )[j.kind] || j.kind}
              </h2>
              <Status value={j.status} />
            </div>
            <p className="subtle">{new Date(j.created_at).toLocaleString()}</p>
            {["running", "queued"].includes(j.status) && (
              <>
                <Progress value={j.progress} />
                <p className="subtle">{j.progress}%</p>
                <Button
                  variant="outline"
                  onClick={() => cancel.mutate({ id: j.id })}
                >
                  请求取消
                </Button>
              </>
            )}
            {j.error && <p className="error-text">{j.error}</p>}
            {["failed", "cancelled", "interrupted"].includes(j.status) && (
              <Button
                variant="outline"
                onClick={() =>
                  submit.mutate({
                    kind: j.kind,
                    input: { include_media: true },
                  })
                }
              >
                检查后重新提交
              </Button>
            )}
            {j.result && Object.keys(j.result).length > 0 && (
              <details>
                <summary>结果与范围</summary>
                <Readable value={j.result} />
              </details>
            )}
          </article>
        ))
      )}
    </>
  );
}
function Settings() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => get<Json>("overview", {}, signal),
  });
  const events = useQuery({
    queryKey: ["events"],
    queryFn: ({ signal }) => get<{ items: Json[] }>("events", {}, signal),
  });
  const prefs = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => get<Json>("settings", {}, signal),
  });
  const [include, setInclude] = useState(true);
  const job = useAction("jobs/create", "已提交后台任务，请在任务页查看进度");
  const pref = useAction("settings/save", "偏好已保存");
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">LIBRARY / DATA</p>
          <h1>数据与备份</h1>
          <p>知道资料保存在哪里，也知道备份实际覆盖什么。</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/manage/tasks">查看后台任务</Link>
        </Button>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>当前素材库</h2>
          <p>{str(overview.data?.project)}</p>
          <p className="path-text">{str(overview.data?.root)}</p>
          <p className="subtle">
            数据库保存资料、版本与引用，媒体以不可变副本保留。原始工程文件仍应独立备份。
          </p>
          <Button
            variant="outline"
            onClick={() => job.mutate({ kind: "health", input: {} })}
          >
            校验数据库与全部媒体
          </Button>
        </section>
        <section className="panel">
          <h2>备份与恢复</h2>
          <p>
            完整备份包括数据库快照、登记媒体和校验清单；恢复只写入新的空目录。
          </p>
          <label className="check-label mb-4">
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
            />
            包含全部登记媒体（可独立恢复）
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                job.mutate({
                  kind: "backup",
                  input: { include_media: include },
                })
              }
              disabled={job.isPending}
            >
              创建{include ? "完整" : "元数据"}备份
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const items: Entity[] = [];
                let offset = 0;
                while (true) {
                  const page = await get<Page<Entity>>("entities", {
                    limit: 200,
                    offset,
                  });
                  items.push(...page.items);
                  offset += page.limit;
                  if (offset >= page.total) break;
                }
                saveJSON("toonforge-library-index.json", items);
              }}
            >
              导出资料索引
            </Button>
          </div>
          <details>
            <summary>恢复操作说明</summary>
            <p className="subtle">
              先找到完整备份目录，再通过CLI恢复到一个新的空目录。现有库不会被覆盖；恢复后执行health检查。
            </p>
            <code>
              toonforge restore --backup /完整备份目录 --destination /新的空目录
            </code>
          </details>
        </section>
        <section className="panel">
          <h2>界面偏好</h2>
          <Label>默认素材列表方式</Label>
          <select
            className="native-select mt-3"
            value={str(prefs.data?.["studio.view"]) || "grid"}
            onChange={(e) =>
              pref.mutate({ key: "studio.view", value: e.target.value })
            }
          >
            <option value="grid">缩略图网格</option>
            <option value="list">资料列表</option>
          </select>
          <p className="subtle">
            音频默认由点击触发。历史版本默认折叠，可以在资源列表中展开。
          </p>
        </section>
        <section className="panel">
          <h2>给 Agent 使用</h2>
          <p>
            网页与CLI共用相同的数据及校验规则。可通过机器可读命令说明查询支持的操作。
          </p>
          <code>toonforge describe</code>
          <p className="subtle">
            运行形态：Go后端 +
            嵌入式React界面。媒体预览使用本机FFmpeg／FFprobe。
          </p>
          <a
            href="/api/v2/overview"
            target="_blank"
            rel="noreferrer"
            className="source-link"
          >
            查看库的结构化概况 ↗
          </a>
        </section>
      </div>
      <section className="panel">
        <h2>最近操作记录</h2>
        {events.data?.items.slice(0, 50).map((ev) => (
          <details key={str(ev.id)} className="audit-row">
            <summary>
              {str(ev.action)} · {str(ev.entity_name) || "素材库"}{" "}
              <small>{new Date(str(ev.created_at)).toLocaleString()}</small>
            </summary>
            <Readable
              value={{
                执行者: ev.actor,
                说明: ev.reason,
                修改前: parseJSON(ev.before_json),
                修改后: parseJSON(ev.after_json),
              }}
            />
          </details>
        ))}
      </section>
    </>
  );
}
function parseJSON(v: unknown) {
  try {
    return JSON.parse(str(v)) as unknown;
  } catch {
    return v;
  }
}
function Archive() {
  const [type, setType] = useState("");
  const q = useQuery({
    queryKey: ["archived", type],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { archived: 1, type, limit: 200 }, signal),
  });
  const action = useAction("entity/archive", "资料已恢复");
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">ARCHIVE</p>
          <h1>已归档资料</h1>
          <p>归档保留媒体、版本及引用。恢复后重新出现在日常列表中。</p>
        </div>
      </div>
      <select
        className="native-select mb-5"
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        <option value="">全部类型</option>
        {["character", "look", "scene", "story", "prop", "sound", "mix"].map(
          (t) => (
            <option key={t} value={t}>
              {labels[t]}
            </option>
          ),
        )}
      </select>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data.items.length ? (
        <Empty title="没有已归档资料" />
      ) : (
        q.data.items.map((e) => (
          <div className="record-row panel" key={e.id}>
            <Link to={entityURL(e.id)}>
              <strong>{e.name}</strong>
              <p>
                {labels[e.type]} · v{e.version}
              </p>
            </Link>
            <Button
              variant="outline"
              onClick={() =>
                action.mutate({
                  id: e.id,
                  expected_version: e.version,
                  archived: false,
                })
              }
            >
              恢复资料
            </Button>
          </div>
        ))
      )}
      <p className="hint">当前版本采用可恢复的归档，不提供永久删除源素材。</p>
    </>
  );
}
function TagManager() {
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: ({ signal }) => get<{ items: Json[] }>("tags", {}, signal),
  });
  const groups = useQuery({
    queryKey: ["collections"],
    queryFn: ({ signal }) => get<{ items: Json[] }>("collections", {}, signal),
  });
  const [editing, setEditing] = useState<Json>(),
    [name, setName] = useState(""),
    [merge, setMerge] = useState(false),
    [groupName, setGroupName] = useState(""),
    [group, setGroup] = useState<Json>();
  const rename = useAction("tags/rename", "标签已更新");
  const saveGroup = useAction("collections/save", "分组已保存");
  const entities = useQuery({
    queryKey: ["group-entities"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { limit: 200 }, signal),
  });
  const [members, setMembers] = useState<Set<string>>(new Set());
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">ORGANIZE</p>
          <h1>标签与收藏分组</h1>
          <p>标签用于筛选；收藏分组用于个人整理，均不改变素材归属。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>标签</h2>
          {tags.isPending ? (
            <Loading />
          ) : (
            tags.data?.items.map((t) => (
              <div className="record-row" key={str(t.id)}>
                <div>
                  <strong>{str(t.label)}</strong>
                  <small>
                    {str(t.namespace)} · {str(t.count)} 项使用
                  </small>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(t);
                    setName(str(t.label));
                    setMerge(false);
                  }}
                >
                  改名 / 合并
                </Button>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>收藏分组</h2>
            <Button
              variant="outline"
              onClick={() => {
                setGroup({});
                setGroupName("");
                setMembers(new Set());
              }}
            >
              新建分组
            </Button>
          </div>
          {groups.data?.items.map((g) => (
            <div key={str(g.id)} className="panel">
              <div className="flex justify-between">
                <strong>{str(g.name)}</strong>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setGroup(g);
                    setGroupName(str(g.name));
                    setMembers(
                      new Set(arr(g.items).map((v) => str(obj(v).id))),
                    );
                  }}
                >
                  编辑
                </Button>
              </div>
              {arr(g.items).map((v) => {
                const e = obj(v);
                return (
                  <Link
                    key={str(e.id)}
                    className="record-row"
                    to={entityURL(str(e.id))}
                  >
                    {str(e.name)}
                  </Link>
                );
              })}
            </div>
          ))}
          {groups.data?.items.length === 0 && <Empty title="尚无收藏分组" />}
        </section>
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>维护标签</DialogTitle>
            <DialogDescription>
              目前用于 {str(editing?.count)}{" "}
              项资料。合并会把引用关联到目标标签，并留下操作记录。
            </DialogDescription>
          </DialogHeader>
          <Label>标签名称</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <label className="check-label">
            <input
              type="checkbox"
              checked={merge}
              onChange={(e) => setMerge(e.target.checked)}
            />
            若同名标签已存在，明确合并到该标签
          </label>
          <Button
            disabled={rename.isPending}
            onClick={async () => {
              try {
                await rename.mutateAsync({ id: editing?.id, name, merge });
                setEditing(undefined);
              } catch {}
            }}
          >
            保存标签调整
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!group}
        onOpenChange={(v) => {
          if (!v) setGroup(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>收藏分组</DialogTitle>
            <DialogDescription>
              可把多个角色、场景或剧本放进一个集合，不复制素材。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="例如 本篇备选演员"
          />
          <div className="group-choices">
            {entities.data?.items
              .filter((e) => !["shot", "clip"].includes(e.type))
              .map((e) => (
                <label className="check-label" key={e.id}>
                  <input
                    type="checkbox"
                    checked={members.has(e.id)}
                    onChange={(ev) =>
                      setMembers((old) => {
                        const next = new Set(old);
                        ev.target.checked ? next.add(e.id) : next.delete(e.id);
                        return next;
                      })
                    }
                  />
                  {e.name}
                </label>
              ))}
          </div>
          <Button
            disabled={!groupName || saveGroup.isPending}
            onClick={async () => {
              try {
                await saveGroup.mutateAsync({
                  id: group?.id,
                  name: groupName,
                  entity_ids: [...members],
                });
                setGroup(undefined);
              } catch {}
            }}
          >
            保存收藏分组
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
