import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Upload,
  ClipboardCheck,
  ImageIcon,
  Plus,
  Users,
  Map,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { get } from "@/lib/api";
import {
  type Overview,
  type Page,
  type Entity,
  entityURL,
  thumb,
  obj,
  str,
} from "@/lib/types";
import { Loading, ErrorBox, Empty, Status } from "@/components/shared";
export default function Home() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => get<Overview>("overview", {}, signal),
  });
  const characters = useQuery({
    queryKey: ["home-characters"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { type: "character", limit: 200 }, signal),
  });
  const scenes = useQuery({
    queryKey: ["home-scenes"],
    queryFn: ({ signal }) =>
      get<Page<Entity>>("entities", { type: "scene", limit: 2 }, signal),
  });
  const o = overview.data;
  const story =
    o?.stories.find((s) => s.id.endsWith("fatui-office-v3")) || o?.stories[0];
  const detail = useQuery({
    queryKey: ["entity", story?.id],
    enabled: !!story,
    queryFn: ({ signal }) => get<Entity>("entity", { id: story!.id }, signal),
  });
  if (overview.isPending) return <Loading />;
  if (overview.error)
    return (
      <ErrorBox error={overview.error} retry={() => void overview.refetch()} />
    );
  if (!o) return null;
  const recentIds = new Set(
    o.recent.filter((x) => x.type === "character").map((x) => x.id),
  );
  const preferred = new Set(["dottore", "scaramouche", "sandrone"]);
  const actors = [...(characters.data?.items || [])]
    .sort((a, b) => {
      const rank = (c: Entity) =>
        recentIds.has(c.id) ? 0 : preferred.has(str(c.metadata.id)) ? 1 : 2;
      return rank(a) - rank(b);
    })
    .slice(0, 3);
  const displayed = actors.length
    ? actors
    : (characters.data?.items || []).slice(0, 3);
  const scene = scenes.data?.items[0];
  const issues = o.issues.filter((i) => i.status !== "verified");
  const shots = detail.data?.children?.filter((e) => e.type === "shot").length;
  const clips = detail.data?.children?.filter((e) => e.type === "clip").length;
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">YOUR CREATIVE WORKSPACE</p>
          <h1>
            让灵感有处安放 <span className="asterisk">✳</span>
          </h1>
          <p>为每个角色建立记忆，让每一篇故事有据可循。</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/library/character?create=1">
            <Plus size={16} />
            新建资料
          </Link>
        </Button>
      </div>
      <div className="home-bento">
        <section className="home-story">
          <div className="flex justify-between items-center">
            <p className="eyebrow">继续制作</p>
            <Badge variant="secondary">
              {story ? "制作工作区" : "从一个故事开始"}
            </Badge>
          </div>
          <h2>{story?.name || "建立你的第一篇剧本"}</h2>
          <p>
            {story
              ? "从分镜、人物与声音继续上次的工作。"
              : "已有的角色和场景，都可以被下一篇故事引用。"}
          </p>
          {story?.cover_artifact_id ? (
            <Link to={entityURL(story.id, "production")} className="home-board">
              <img src={thumb(story.cover_artifact_id)} alt={story.name} />
            </Link>
          ) : (
            <div className="home-board no-image">
              <BookOpen size={55} />
            </div>
          )}
          <div className="home-story-meta">
            {shots !== undefined ? (
              <span>
                {shots} 个设计镜头 · {clips || 0} 个连续片段
              </span>
            ) : (
              <span>剧本 · 选角 · 场景 · 分镜 · 声音</span>
            )}
            <Button asChild>
              <Link
                to={
                  story
                    ? entityURL(story.id, "production")
                    : "/library/story?create=1"
                }
              >
                进入工作区 <ArrowRight size={16} />
              </Link>
            </Button>
          </div>
        </section>
        <section className="home-characters">
          <div className="flex justify-between items-start">
            <div>
              <p className="eyebrow">CHARACTER LIBRARY</p>
              <h2>角色，从这里生长。</h2>
            </div>
            <Button size="icon" variant="outline" asChild>
              <Link to="/library/character" aria-label="打开角色库">
                <ArrowUpRight size={17} />
              </Link>
            </Button>
          </div>
          {displayed.length ? (
            <div className="home-faces">
              {displayed.map((e) => (
                <Link key={e.id} to={entityURL(e.id)}>
                  {e.cover_artifact_id ? (
                    <img src={thumb(e.cover_artifact_id)} alt={e.name} />
                  ) : (
                    <Users />
                  )}
                  <strong>{e.name}</strong>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="还没有角色">
              <Link to="/library/character?create=1">建立第一个角色</Link>
            </Empty>
          )}
          <div className="flex justify-between subtle">
            <span>
              {o.counts.character || 0} 位角色 / {o.counts.look || 0} 套造型
            </span>
            <Link to="/library/character">打开角色库 ↗</Link>
          </div>
        </section>
        <Link
          className="home-scene"
          to={scene ? entityURL(scene.id) : "/library/scene"}
        >
          {scene?.cover_artifact_id ? (
            <img src={thumb(scene.cover_artifact_id)} alt={scene.name} />
          ) : (
            <div className="no-image">
              <Map size={40} />
            </div>
          )}
          <div>
            <p className="eyebrow">SCENE LIBRARY</p>
            <h2>{scene?.name || "为故事搭一处空间"}</h2>
            <p>
              {o.counts.scene || 0} 处场景 · 空间、机位与连续性{" "}
              <ArrowRight size={17} />
            </p>
          </div>
        </Link>
        <section className="home-tasks">
          <div className="flex justify-between">
            <h2>今天，处理这几件。</h2>
            <Badge variant="outline">{issues.length + o.pending_imports}</Badge>
          </div>
          {issues.slice(0, 2).map((i) => (
            <Link
              className="task-link"
              to={"/reviews?entity=" + encodeURIComponent(i.entity_id)}
              key={i.id}
            >
              <ClipboardCheck size={18} />
              <div>
                <strong>{i.name} 需要检查</strong>
                <p>{i.body.length > 55 ? i.body.slice(0, 55) + "…" : i.body}</p>
              </div>
              <ArrowUpRight size={15} />
            </Link>
          ))}
          {o.pending_imports > 0 && (
            <Link className="task-link" to="/import?tab=pending">
              <ImageIcon size={18} />
              <div>
                <strong>{o.pending_imports} 项外部资料变更</strong>
                <p>比较后再决定是否导入。</p>
              </div>
              <ArrowUpRight size={15} />
            </Link>
          )}
          <Link className="task-link" to="/import">
            <Upload size={18} />
            <div>
              <strong>给新素材找个位置</strong>
              <p>导入、分类，再关联角色或剧本。</p>
            </div>
            <ArrowUpRight size={15} />
          </Link>
          <Link className="subtle" to="/reviews">
            查看全部审阅 →
          </Link>
        </section>
      </div>
      <div className="home-bottom">
        <span>
          {o.artifacts} 个媒体版本 · {o.counts.story || 0} 份剧本
        </span>
        <div>
          {o.recent.slice(0, 4).map((e) => (
            <Link key={e.id} to={entityURL(e.id)}>
              {e.name}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
