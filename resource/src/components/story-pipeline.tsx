import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get, useAction } from "@/lib/api";
import { type Entity, type Json, entityURL } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { Loading, ErrorBox } from "./shared";
import { Readable } from "./profile";
interface Node {
  id: string;
  stage: string;
  label: string;
  source_id?: string;
  production_entity_id?: string;
  production_name?: string;
  snapshot: Json;
  created_at: string;
}
interface Workflow {
  story: Entity;
  nodes: Node[];
}
const stages = [
  ["script", "剧本版本"],
  ["boards", "分镜版本"],
  ["voice", "配音版本"],
  ["video", "视频版本"],
];
export function StoryPipeline({ entity }: { entity: Entity }) {
  const data = useQuery({
    queryKey: ["workflow", entity.id],
    queryFn: ({ signal }) =>
      get<Workflow>("workflow", { story: entity.id }, signal),
  });
  const [stage, setStage] = useState("script"),
    [source, setSource] = useState(""),
    [label, setLabel] = useState(""),
    [content, setContent] = useState(""),
    [selected, setSelected] = useState("");
  const create = useAction("workflow/create", "已建立版本，已有版本保持不变");
  if (data.isPending) return <Loading />;
  if (data.error) return <ErrorBox error={data.error} />;
  const workflow = data.data,
    nodes = workflow.nodes,
    current = nodes.find((n) => n.id === selected);
  const upstream = stage === "video" ? "boards" : "script";
  return (
    <section className="story-pipeline">
      <div className="section-heading">
        <h2>{workflow.story.name}</h2>
        <span className="subtle">一个故事 · 独立阶段版本 · 固定来源</span>
      </div>
      <p className="subtle">
        选择剧本版本衍生分镜，再基于具体版本制作配音、视频。新增版本不会覆盖已有内容，也不会自动替换剧本选用。
      </p>
      <div className="pipeline-stages">
        {stages.map(([key, title]) => (
          <section key={key}>
            <h3>
              {title}{" "}
              <small>{nodes.filter((n) => n.stage === key).length}</small>
            </h3>
            {nodes
              .filter((n) => n.stage === key)
              .map((n) => (
                <div
                  key={n.id}
                  className="pipeline-node"
                  data-selected={selected === n.id}
                >
                  <button onClick={() => setSelected(n.id)}>
                    <strong>{n.label}</strong>
                    <span>
                      {n.source_id
                        ? "来源：" +
                          (nodes.find((p) => p.id === n.source_id)?.label ||
                            n.source_id)
                        : "独立剧本版本"}
                    </span>
                  </button>
                  {n.production_entity_id && (
                    <Link to={entityURL(n.production_entity_id, "production")}>
                      进入制作空间 →
                    </Link>
                  )}
                </div>
              ))}
            {!nodes.some((n) => n.stage === key) && (
              <span className="subtle">尚未整理版本</span>
            )}
          </section>
        ))}
      </div>
      {current && (
        <section className="pipeline-snapshot">
          <div className="section-heading">
            <h3>{current.label} · 版本内容</h3>
            <Button variant="ghost" onClick={() => setSelected("")}>
              收起
            </Button>
          </div>
          <p className="subtle">
            版本记录保持不变；制作空间中的工作内容可继续修改。
          </p>
          <Readable value={current.snapshot} />
        </section>
      )}
      <form
        className="pipeline-create"
        onSubmit={async (ev) => {
          ev.preventDefault();
          try {
            await create.mutateAsync({
              story_id: workflow.story.id,
              stage,
              label,
              source_id: source,
              snapshot: { text: content },
            });
            setLabel("");
            setContent("");
          } catch {
            /* useAction displays the server error. */
          }
        }}
      >
        <h3>建立新版本</h3>
        <label>
          制作阶段
          <SelectField
            value={stage}
            onValueChange={(v) => {
              setStage(v);
              setSource("");
            }}
          >
            {stages.map(([v, t]) => (
              <SelectOption key={v} value={v}>
                {t}
              </SelectOption>
            ))}
          </SelectField>
        </label>
        <label>
          来源版本
          <SelectField
            value={source || "none"}
            onValueChange={(v) => setSource(v === "none" ? "" : v)}
          >
            <SelectOption value="none">
              {stage === "script" ? "独立新稿" : "请选择上游版本"}
            </SelectOption>
            {nodes
              .filter((n) => n.stage === upstream)
              .map((n) => (
                <SelectOption key={n.id} value={n.id}>
                  {n.label}
                </SelectOption>
              ))}
          </SelectField>
        </label>
        <label>
          版本名称
          <Input
            required
            value={label}
            onChange={(ev) => setLabel(ev.target.value)}
            placeholder="例如：办公室版 · 修正对白"
          />
        </label>
        <label className="pipeline-content">
          版本正文 / 制作设计
          <Textarea
            required
            value={content}
            onChange={(ev) => setContent(ev.target.value)}
            placeholder="填写本版本的剧本或分镜设计；保存后形成独立记录。"
          />
        </label>
        <Button disabled={create.isPending || (stage !== "script" && !source)}>
          保存新版本
        </Button>
      </form>
    </section>
  );
}
