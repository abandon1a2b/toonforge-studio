import { Link } from "react-router-dom";
import {
  FileAudio,
  Film,
  ImageIcon,
  ArrowUpRight,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  type Entity,
  type Artifact,
  type Page,
  labels,
  height,
  entityURL,
  assetURL,
  thumb,
  obj,
  str,
} from "@/lib/types";
export function Status({ value }: { value: string }) {
  return (
    <Badge variant="secondary" className={"status status-" + value}>
      {labels[value] || value}
    </Badge>
  );
}
export function Tags({
  tags,
  plain = false,
}: {
  tags: string[];
  plain?: boolean;
}) {
  return (
    <div className="tags">
      {tags.map((t) =>
        plain ? (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ) : (
          <Link key={t} to={"/search?tag=" + encodeURIComponent(t)}>
            <Badge variant="outline">{t}</Badge>
          </Link>
        ),
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-grid" aria-label="正在加载">
      {[1, 2, 3].map((n) => (
        <Skeleton key={n} className="h-48 rounded-2xl" />
      ))}
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>操作未完成</AlertTitle>
      <AlertDescription>
        {error?.message || "无法读取数据"}
        {retry && (
          <Button variant="outline" onClick={retry}>
            重试
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function Empty({
  title = "暂无内容",
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <FolderOpen size={30} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Section({
  title,
  to,
  action,
  children,
}: {
  title: string;
  to?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="section-heading">
        <h2>{title}</h2>
        {to ? (
          <Link to={to}>
            查看全部 <ArrowUpRight size={15} />
          </Link>
        ) : (
          action
        )}
      </div>
      {children}
    </section>
  );
}
export function EntityCard({ entity: e }: { entity: Entity }) {
  return (
    <Link to={entityURL(e.id)} className="entity-card">
      <div className="entity-image">
        {e.cover_artifact_id ? (
          <img src={thumb(e.cover_artifact_id)} alt={e.name} loading="lazy" />
        ) : (
          <ImageIcon size={32} />
        )}
      </div>
      <div className="entity-card-body">
        <div className="flex justify-between gap-2">
          <h3>{e.name}</h3>
          <small>v{e.version}</small>
        </div>
        <p>{e.type === "character" ? height(e) : labels[e.type]}</p>
        <Tags tags={e.tags.slice(0, 3)} plain />
      </div>
    </Link>
  );
}
export function AssetCard({
  asset: a,
  selected,
  onSelect,
}: {
  asset: Artifact;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
}) {
  const tech = obj(a.metadata.technical);
  return (
    <Card className="asset-card overflow-hidden p-0">
      <div className="relative">
        {onSelect && (
          <label className="asset-check">
            <input
              aria-label={"对比 " + a.relative_path.split("/").pop()}
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
            />
          </label>
        )}
        <Link to={assetURL(a.id)} className="asset-image">
          {a.media_type === "image" ? (
            <img
              src={thumb(a.id)}
              loading="lazy"
              alt={a.relative_path.split("/").pop()}
            />
          ) : a.media_type === "audio" ? (
            <FileAudio size={38} />
          ) : (
            <Film size={38} />
          )}
        </Link>
      </div>
      <CardContent className="p-4">
        <Link to={assetURL(a.id)}>
          <h3 className="truncate">{a.relative_path.split("/").pop()}</h3>
        </Link>
        <p>
          {a.entity_name || ""} · {labels[a.role] || a.role}
        </p>
        <div className="flex gap-2 flex-wrap">
          <Status value={a.status} />
          {a.historical && <Badge variant="outline">历史</Badge>}
        </div>
        <small>
          {tech.width
            ? `${str(tech.width)} × ${str(tech.height)}`
            : typeof tech.duration_seconds === "number"
              ? `${tech.duration_seconds.toFixed(2)} 秒`
              : ""}
        </small>
      </CardContent>
    </Card>
  );
}
export function Pagination<T>({
  page,
  onPage,
}: {
  page: Page<T>;
  onPage: (offset: number) => void;
}) {
  if (page.total === 0) return null;
  return (
    <div className="pagination">
      <span>
        共 {page.total} 项 · {page.offset + 1}—
        {Math.min(page.total, page.offset + page.limit)}
      </span>
      <Button
        variant="outline"
        disabled={page.offset === 0}
        onClick={() => onPage(Math.max(0, page.offset - page.limit))}
      >
        上一页
      </Button>
      <Button
        variant="outline"
        disabled={page.offset + page.limit >= page.total}
        onClick={() => onPage(page.offset + page.limit)}
      >
        下一页
      </Button>
    </div>
  );
}
export function Busy({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {busy && <LoaderCircle className="animate-spin" size={15} />} {children}
    </>
  );
}
