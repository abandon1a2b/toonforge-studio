import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Upload, Grid2X2, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { get } from "@/lib/api";
import {
  type Entity,
  type Artifact,
  type Page,
  labels,
  roles,
  entityURL,
  height,
} from "@/lib/types";
import {
  EntityCard,
  AssetCard,
  Pagination,
  Empty,
  Loading,
  ErrorBox,
  Tags,
} from "@/components/shared";
import { EntityEditor } from "@/components/entity-editor";
export default function Library({ search = false }: { search?: boolean }) {
  const { type = "character" } = useParams();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "",
    tag = params.get("tag") || "",
    offset = Number(params.get("offset") || 0);
  const publicType = params.get("kind") || "prop";
  const currentType = search ? "" : type === "public" ? publicType : type;
  const mediaMode = params.get("view") === "media";
  const [draftInput, setDraftInput] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [tagInput, setTagInput] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const draft = draftInput?.key === query ? draftInput.value : query;
  const tagDraft = tagInput?.key === tag ? tagInput.value : tag;
  const setDraft = (value: string) => setDraftInput({ key: query, value });
  const setTagDraft = (value: string) => setTagInput({ key: tag, value });
  const preferences = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) =>
      get<Record<string, string>>("settings", {}, signal),
  });
  const view =
    params.get("layout") || preferences.data?.["studio.view"] || "grid";
  const setView = (value: string) => update({ layout: value });
  const create = params.get("create") === "1";
  const update = (next: Record<string, string>) =>
    setParams((p) => {
      Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
      return p;
    });
  const entities = useQuery({
    queryKey: ["entities", currentType, query, tag, offset],
    queryFn: ({ signal }) =>
      get<Page<Entity>>(
        "entities",
        { type: currentType, q: query, tag, offset, limit: 24 },
        signal,
      ),
    enabled: !mediaMode,
  });
  const media = useQuery({
    queryKey: [
      "artifacts",
      query,
      tag,
      params.get("role"),
      offset,
      params.get("history"),
    ],
    queryFn: ({ signal }) =>
      get<Page<Artifact>>(
        "artifacts",
        {
          q: query,
          tag,
          role: params.get("role") || "",
          history: params.get("history") || "0",
          offset,
          limit: 24,
        },
        signal,
      ),
    enabled: mediaMode,
  });
  const page = mediaMode ? media : entities;
  const title = search
    ? "搜索素材库"
    : type === "public"
      ? "公共素材"
      : labels[type] + "资料库";
  return (
    <section className="library-page" aria-label={title}>
      <h1 className="sr-only">{title}</h1>
      {(search || type === "public") && (
        <Tabs
          value={mediaMode ? "media" : search ? "entities" : publicType}
          onValueChange={(v) =>
            update({
              view: v === "media" ? "media" : "",
              kind: v === "media" ? "" : v,
              offset: "",
            })
          }
        >
          <TabsList>
            {(search
              ? [
                  ["entities", "资料对象"],
                  ["media", "全部媒体"],
                ]
              : [
                  ["prop", "道具"],
                  ["sound", "声音素材"],
                  ["mix", "混音方案"],
                  ["media", "全部媒体"],
                ]
            ).map(([v, t]) => (
              <TabsTrigger key={v} value={v}>
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft, tag: tagDraft, offset: "" });
        }}
      >
        <Input
          placeholder="搜索名称、别名、资料或文件…"
          aria-label="搜索列表"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Input
          placeholder="精确标签"
          aria-label="标签筛选"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
        />
        {mediaMode && (
          <Select
            value={params.get("role") || "all"}
            onValueChange={(v) =>
              update({ role: v === "all" ? "" : v, offset: "" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {labels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button type="submit" variant="outline">
          筛选
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft("");
            setTagDraft("");
            update({ q: "", tag: "", offset: "", role: "" });
          }}
        >
          重置
        </Button>
        {!mediaMode && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="切换列表方式"
            onClick={() => setView(view === "grid" ? "list" : "grid")}
          >
            {view === "grid" ? <List size={17} /> : <Grid2X2 size={17} />}
          </Button>
        )}
        {mediaMode && (
          <label className="check-label">
            <Checkbox
              checked={params.get("history") === "1"}
              onCheckedChange={(checked) =>
                update({ history: checked === true ? "1" : "", offset: "" })
              }
            />
            包含历史版本
          </label>
        )}
        <div className="library-toolbar-actions">
          <Button variant="outline" asChild>
            <Link to="/import">
              <Upload size={15} />
              导入
            </Link>
          </Button>
          <Button type="button" onClick={() => update({ create: "1" })}>
            <Plus size={15} />
            新建{labels[currentType] || "资料"}
          </Button>
        </div>
      </form>
      {page.isPending ? (
        <Loading />
      ) : page.error ? (
        <ErrorBox error={page.error} />
      ) : !page.data?.items.length ? (
        <Empty title="没有匹配的内容">
          <p>可以清除筛选，或建立新资料。</p>
        </Empty>
      ) : mediaMode ? (
        <>
          <div className="asset-grid">
            {media.data?.items.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </div>
          {media.data && (
            <Pagination
              page={media.data}
              onPage={(n) => update({ offset: String(n) })}
            />
          )}
        </>
      ) : (
        <>
          {view === "grid" ? (
            <div className="entity-grid">
              {entities.data?.items.map((e) => (
                <EntityCard key={e.id} entity={e} />
              ))}
            </div>
          ) : (
            <div className="list-table">
              {entities.data?.items.map((e) => (
                <Link key={e.id} to={entityURL(e.id)}>
                  <strong>{e.name}</strong>
                  <span>
                    {e.type === "character" ? height(e) : labels[e.type]}
                  </span>
                  <Tags tags={e.tags} plain />
                  <small>v{e.version}</small>
                </Link>
              ))}
            </div>
          )}
          {entities.data && (
            <Pagination
              page={entities.data}
              onPage={(n) => update({ offset: String(n) })}
            />
          )}
        </>
      )}
      <EntityEditor
        open={create}
        onOpenChange={(v) => update({ create: v ? "1" : "" })}
        type={currentType || "character"}
      />
    </section>
  );
}
