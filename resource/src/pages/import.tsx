import { Checkbox } from "@/components/ui/checkbox";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FolderInput, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { get, useAction, post } from "@/lib/api";
import {
  type Entity,
  type Page,
  type Json,
  obj,
  str,
  roles,
  labels,
  entityURL,
} from "@/lib/types";
import { Loading, ErrorBox, Empty } from "@/components/shared";
import { Readable } from "@/components/profile";
type FileItem = { path: string; name: string; type: string; bytes?: number };
export default function ImportPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "upload";
  const [files, setFiles] = useState<FileItem[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [entity, setEntity] = useState(params.get("entity") || ""),
    [role, setRole] = useState("reference"),
    [note, setNote] = useState(""),
    [url, setURL] = useState(""),
    [author, setAuthor] = useState(""),
    [license, setLicense] = useState(""),
    [uploading, setUploading] = useState(false),
    [registering, setRegistering] = useState(false),
    [outcome, setOutcome] = useState<{ path: string; error?: string }[]>([]),
    [pending, setPending] = useState<Json>();
  const client = useQueryClient();
  const all = useQuery({
    queryKey: ["import-entities"],
    queryFn: async ({ signal }) => {
      const first = await get<Page<Entity>>("entities", { limit: 200 }, signal);
      const items = [...first.items];
      for (let offset = 200; offset < first.total; offset += 200)
        items.push(
          ...(
            await get<Page<Entity>>("entities", { limit: 200, offset }, signal)
          ).items,
        );
      return { ...first, items };
    },
  });
  const inbox = useQuery({
    queryKey: ["inbox"],
    queryFn: ({ signal }) => get<{ items: FileItem[] }>("inbox", {}, signal),
    enabled: tab === "inbox",
  });
  const changes = useQuery({
    queryKey: ["pending"],
    queryFn: ({ signal }) => get<{ items: Json[] }>("pending", {}, signal),
  });
  const current = useQuery({
    queryKey: ["entity", pending?.entity_id],
    queryFn: ({ signal }) =>
      get<Entity>("entity", { id: str(pending?.entity_id) }, signal),
    enabled: !!pending,
  });
  const apply = useAction("import/apply", "已明确导入为新的资料修订");
  const scan = useAction("import/refresh", "扫描任务已进入队列");
  const items = tab === "inbox" ? inbox.data?.items || [] : files;
  async function upload(list: FileList | File[]) {
    setUploading(true);
    const added: FileItem[] = [],
      errors: string[] = [];
    for (const f of Array.from(list)) {
      const form = new FormData();
      form.append("file", f);
      try {
        const r = await fetch("/api/v2/upload", { method: "POST", body: form });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        added.push(d as FileItem);
      } catch (e) {
        errors.push(f.name + ": " + (e as Error).message);
      }
    }
    setFiles((old) => [...old, ...added]);
    setSelected((old) => new Set([...old, ...added.map((f) => f.path)]));
    setUploading(false);
    if (added.length)
      toast.success("已收集 " + added.length + " 个文件，请分类后登记");
    if (errors.length) toast.error(errors.join("\n"));
    void client.invalidateQueries({ queryKey: ["inbox"] });
  }
  async function register() {
    setRegistering(true);
    const result: { path: string; error?: string }[] = [];
    for (const path of selected) {
      try {
        await post("artifact/register", {
          entity_id: entity,
          path,
          role,
          note,
          source: { url, author, license_id: license },
        });
        result.push({ path });
      } catch (e) {
        result.push({ path, error: (e as Error).message });
      }
    }
    setOutcome(result);
    setSelected(new Set(result.filter((r) => r.error).map((r) => r.path)));
    setFiles((old) =>
      old.filter((f) => result.every((r) => r.path !== f.path || r.error)),
    );
    setRegistering(false);
    void client.invalidateQueries();
    toast.success(
      "已登记 " +
        result.filter((r) => !r.error).length +
        " 项；失败项保留以便重试",
    );
  }
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">COLLECT / ORGANIZE</p>
          <h1>给素材找个位置。</h1>
          <p>先收集，再分类。文件保留原始内容，登记后建立可追溯的候选版本。</p>
        </div>
        <Button
          variant="outline"
          disabled={scan.isPending}
          onClick={() => scan.mutate({})}
        >
          扫描项目变更
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setParams((p) => {
            p.set("tab", v);
            return p;
          })
        }
      >
        <TabsList>
          <TabsTrigger value="upload">收集与导入</TabsTrigger>
          <TabsTrigger value="inbox">待整理文件</TabsTrigger>
          <TabsTrigger value="pending">
            资料变更 ({changes.data?.items.length || 0})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <label
            className={"import-drop " + (uploading ? "busy" : "")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!uploading) void upload(e.dataTransfer.files);
            }}
          >
            <Upload size={32} />
            <strong>
              {uploading ? "正在收集文件…" : "拖入图片、声音或视频"}
            </strong>
            <p>也可以点击选择。文件先进入本地待整理区，之后再明确归属。</p>
            <input
              type="file"
              multiple
              disabled={uploading}
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
              }}
            />
          </label>
        </TabsContent>
        <TabsContent value="inbox">
          <p className="hint">
            项目中发现但尚未登记的媒体文件，最多展示500项。选择归属后可批量登记。
          </p>
          {inbox.isPending && <Loading />}
          {inbox.error && <ErrorBox error={inbox.error} />}
        </TabsContent>
        <TabsContent value="pending">
          {!changes.data?.items.length ? (
            <Empty title="没有待确认的外部资料变更" />
          ) : (
            changes.data.items.map((p) => (
              <div className="record-row panel" key={str(p.id)}>
                <div>
                  <strong>{str(p.name)}</strong>
                  <p>{str(p.source_path)}</p>
                </div>
                <Button variant="outline" onClick={() => setPending(p)}>
                  比较变更
                </Button>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
      {tab !== "pending" && items.length > 0 && (
        <div className="import-layout">
          <section className="panel">
            <div className="section-heading">
              <h2>
                选择文件 · {selected.size}/{items.length}
              </h2>
              <Button
                variant="ghost"
                onClick={() =>
                  setSelected(
                    selected.size === items.length
                      ? new Set()
                      : new Set(items.map((f) => f.path)),
                  )
                }
              >
                全选 / 清空
              </Button>
            </div>
            {items.map((f) => (
              <label className="file-choice" key={f.path}>
                <Checkbox
                  checked={selected.has(f.path)}
                  onCheckedChange={(checked) =>
                    setSelected((old) => {
                      const next = new Set(old);
                      checked === true ? next.add(f.path) : next.delete(f.path);
                      return next;
                    })
                  }
                />
                {f.type === "image" ? (
                  <img
                    src={"/thumb?path=" + encodeURIComponent(f.path)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <FolderInput size={24} />
                )}
                <div>
                  <strong>{f.name}</strong>
                  <small>{f.path}</small>
                </div>
                <span>{f.type}</span>
              </label>
            ))}
          </section>
          <aside className="panel stack">
            <h2>批量归属与分类</h2>
            <Label>所属角色、造型、场景或剧本</Label>
            <SelectField
              aria-label="资源归属"
              value={entity}
              onValueChange={(value) => setEntity(value)}
            >
              <SelectOption value="">请选择归属</SelectOption>
              {all.data?.items
                .filter((e) => !["clip", "shot"].includes(e.type))
                .map((e) => (
                  <SelectOption key={e.id} value={e.id}>
                    {labels[e.type]} / {e.name}
                  </SelectOption>
                ))}
            </SelectField>
            <Label>素材用途</Label>
            <SelectField
              aria-label="资源分类"
              value={role}
              onValueChange={(value) => setRole(value)}
            >
              {roles.map((r) => (
                <SelectOption key={r} value={r}>
                  {labels[r]}
                </SelectOption>
              ))}
            </SelectField>
            <Label>备注</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            <details>
              <summary>来源与授权信息</summary>
              <div className="stack pt-4">
                <Input
                  placeholder="来源URL"
                  value={url}
                  onChange={(e) => setURL(e.target.value)}
                />
                <Input
                  placeholder="作者"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
                <Input
                  placeholder="许可说明，未知留空"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                />
              </div>
            </details>
            <p className="subtle">
              将登记 {selected.size}{" "}
              个候选版本。不会自动通过审阅或替换本篇选用。
            </p>
            <Button
              disabled={!entity || !selected.size || registering}
              onClick={() => void register()}
            >
              {registering ? "正在登记…" : "确认登记所选文件"}
            </Button>
            <Button variant="ghost" asChild>
              <Link to={"/library/character?create=1"}>先建立角色资料 →</Link>
            </Button>
          </aside>
        </div>
      )}
      {outcome.length > 0 && (
        <div className="panel">
          <h2>本次登记结果</h2>
          {outcome.map((r) => (
            <div className="record-row" key={r.path}>
              <span>{r.path}</span>
              {r.error ? (
                <span className="error-text">{r.error}</span>
              ) : (
                <CheckCircle2 className="success-text" size={17} />
              )}
            </div>
          ))}
          {entity && (
            <Button variant="outline" asChild>
              <Link to={entityURL(entity, "assets")}>进入对应资源分类 →</Link>
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={!!pending}
        onOpenChange={(v) => {
          if (!v) setPending(undefined);
        }}
      >
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>比较外部资料变更</DialogTitle>
            <DialogDescription>
              现有资料不会被扫描自动覆盖。确认后保存为新修订。
            </DialogDescription>
          </DialogHeader>
          <div className="compare-grid">
            <section>
              <h3>当前维护资料 · v{current.data?.version}</h3>
              <Readable value={current.data?.metadata} />
            </section>
            <section>
              <h3>外部候选</h3>
              <Readable value={pending?.payload} />
            </section>
          </div>
          <Button
            disabled={!current.data || apply.isPending}
            onClick={async () => {
              try {
                await apply.mutateAsync({
                  id: pending?.id,
                  expected_version: current.data?.version,
                });
                setPending(undefined);
              } catch {}
            }}
          >
            明确导入外部候选
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
