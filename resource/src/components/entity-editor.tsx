import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAction } from "@/lib/api";
import { type Entity, obj, str, strings, labels, entityURL } from "@/lib/types";
import { Busy } from "./shared";
const schema = z.object({
  name: z.string().trim().min(1, "请填写名称").max(200),
  tags: z.string(),
  description: z.string(),
  fullName: z.string(),
  franchise: z.string(),
  height: z
    .string()
    .refine((v) => v === "" || Number(v) > 0, "身高须为正数或留空"),
  heightStatus: z.string(),
  heightSource: z.string(),
  hair: z.string(),
  eyes: z.string(),
  outfit: z.string(),
  accessories: z.string(),
  anchors: z.string(),
  performance: z.string(),
  layout: z.record(z.string(), z.string()),
  kind: z.string(),
});
type Fields = z.infer<typeof schema>;
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity?: Entity;
  type?: string;
  parent?: string;
};
export function EntityEditor(props: Props) {
  return props.open ? (
    <EditorForm
      key={props.entity?.id + ":" + props.entity?.version + ":" + props.type}
      {...props}
    />
  ) : null;
}
function EditorForm({
  onOpenChange,
  entity: e,
  type = "character",
  parent,
}: Props) {
  const navigate = useNavigate();
  const m = e?.metadata || {},
    physical = obj(m.physical),
    h = obj(physical.height_cm),
    appearance = obj(m.appearance);
  const [discard, setDiscard] = useState(false);
  const action = useAction<Entity>(
    e ? "entity/update" : "entity/create",
    "资料已保存为新修订",
  );
  const form = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: e?.name || "",
      tags: e?.tags.join(", ") || "",
      description:
        str(m.description) || str(m.summary) || str(m.adaptation_proposals),
      fullName: str(m.full_name),
      franchise: str(m.franchise),
      height: h.value == null ? "" : str(h.value),
      heightStatus: str(h.status) || "unknown",
      heightSource: str(h.source),
      hair: str(appearance.hair),
      eyes: str(appearance.eyes),
      outfit: str(appearance.outfit),
      accessories: str(appearance.accessories),
      anchors: strings(m.identity_anchors).join("\n"),
      performance: strings(m.performance_flexibility).join("\n"),
      layout: {
        overview: "",
        ...(Object.fromEntries(
          Object.entries(obj(m.layout)).filter(
            ([, v]) => typeof v === "string",
          ),
        ) as Record<string, string>),
      },
      kind: e?.type || type,
    },
  });
  const kind = form.watch("kind");
  const requestClose = () => {
    if (form.formState.isDirty && !action.isSuccess) setDiscard(true);
    else onOpenChange(false);
  };
  const field = (name: keyof Fields, label: string, area = false) => (
    <div className="field" key={name}>
      <Label htmlFor={name}>{label}</Label>
      {area ? (
        <Textarea id={name} {...form.register(name)} rows={3} />
      ) : (
        <Input id={name} {...form.register(name)} />
      )}
    </div>
  );
  const submit = form.handleSubmit(async (values) => {
    const metadata = {
      ...m,
      name: values.name,
      description: values.description,
    };
    if (kind === "character") {
      Object.assign(metadata, {
        full_name: values.fullName,
        franchise: values.franchise,
        physical: {
          ...physical,
          height_cm: {
            ...h,
            value: values.height === "" ? null : Number(values.height),
            unit: "cm",
            status: values.heightStatus,
            source: values.heightSource,
          },
        },
        appearance: {
          ...appearance,
          hair: values.hair,
          eyes: values.eyes,
          outfit: values.outfit,
          accessories: values.accessories,
        },
        identity_anchors: values.anchors.split("\n").filter(Boolean),
        performance_flexibility: values.performance.split("\n").filter(Boolean),
      });
      if (values.height !== "" && !values.heightSource.trim()) {
        form.setError("heightSource", {
          message: "填写身高数值时需要说明依据",
        });
        return;
      }
    }
    if (kind === "look")
      Object.assign(metadata, {
        appearance: {
          ...appearance,
          outfit: values.outfit,
          accessories: values.accessories,
        },
        identity_anchors: values.anchors.split("\n").filter(Boolean),
      });
    if (kind === "scene")
      Object.assign(metadata, {
        layout: { ...obj(m.layout), ...values.layout },
      });
    const payload = {
      name: values.name,
      tags: values.tags
        .split(/[,，]/)
        .map((v) => v.trim())
        .filter(Boolean),
      metadata,
      ...(e
        ? { id: e.id, expected_version: e.version }
        : { type: kind, parent }),
    };
    try {
      const result = await action.mutateAsync(payload);
      onOpenChange(false);
      navigate(entityURL(result.id));
    } catch {
      /* Keep draft, error displayed below. */
    }
  });
  return (
    <>
      <Dialog
        open
        onOpenChange={(v) => {
          if (!v) requestClose();
        }}
      >
        <DialogContent className="editor-dialog sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {e ? "编辑 " + e.name : "新建" + (labels[kind] || "资料")}
            </DialogTitle>
            <DialogDescription>
              保存会建立资料修订；原始文件及已有剧本选用保持。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="editor-form">
            <Tabs defaultValue="basic">
              <TabsList>
                <TabsTrigger value="basic">基本资料</TabsTrigger>
                {["character", "look"].includes(kind) && (
                  <TabsTrigger value="appearance">外观与造型</TabsTrigger>
                )}
                {kind === "character" && (
                  <TabsTrigger value="physical">物理信息</TabsTrigger>
                )}
                {kind === "scene" && (
                  <TabsTrigger value="layout">空间布局</TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="basic">
                {!e && !parent && (
                  <div className="field">
                    <Label>资料类型</Label>
                    <select
                      {...form.register("kind")}
                      className="native-select"
                    >
                      {["character", "scene", "story", "prop", "sound"].map(
                        (t) => (
                          <option value={t} key={t}>
                            {labels[t]}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                )}
                {field("name", "名称 *")}
                {field("tags", "标签，用逗号分隔")}
                {kind === "character" && (
                  <div className="form-grid">
                    {field("fullName", "全名 / 别名")}
                    {field("franchise", "所属作品")}
                  </div>
                )}
                {field("description", "简介与制作说明", true)}
              </TabsContent>
              <TabsContent value="appearance">
                {kind === "character" && (
                  <div className="form-grid">
                    {field("hair", "发型")}
                    {field("eyes", "眼睛与脸部辨识特征")}
                  </div>
                )}
                {field("outfit", "服装组成", true)}
                {field("accessories", "配饰与非对称细节", true)}
                {field("anchors", "身份锚点，每行一项", true)}
                {kind === "character" &&
                  field("performance", "表演范围，每行一项", true)}
              </TabsContent>
              <TabsContent value="physical">
                <div className="form-grid">
                  {field("height", "赤脚制作身高（cm，未知留空）")}
                  <div className="field">
                    <Label htmlFor="heightStatus">身高状态</Label>
                    <select
                      id="heightStatus"
                      className="native-select"
                      {...form.register("heightStatus")}
                    >
                      <option value="unknown">未知</option>
                      <option value="proposed">制作暂定</option>
                      <option value="confirmed">用户已确认</option>
                    </select>
                  </div>
                </div>
                {field("heightSource", "数值依据 / 来源说明", true)}
                <p className="hint">
                  未知信息保持未知。鞋底、发型和头饰高度与实际身高分别记录；现有其他物理字段会保留。
                </p>
              </TabsContent>
              <TabsContent value="layout">
                {Object.entries(form.getValues("layout")).map(([k]) => (
                  <div className="field" key={k}>
                    <Label>{k}</Label>
                    <Textarea {...form.register(`layout.${k}`)} />
                  </div>
                ))}
                {Object.keys(form.getValues("layout")).length === 0 && (
                  <>
                    <Label>主要布局说明</Label>
                    <Textarea {...form.register("layout.overview")} />
                  </>
                )}
                <p className="hint">
                  共享场景维护空间位置；具体人物坐在哪个位置，在剧本的场景安排中维护。
                </p>
              </TabsContent>
            </Tabs>
            <div role="alert" className="form-errors">
              {Object.values(form.formState.errors).map((v, i) => (
                <p key={i}>{typeof v?.message === "string" ? v.message : ""}</p>
              ))}
              {action.error && <p>{action.error.message}</p>}
            </div>
            <div className="dialog-actions">
              <Button type="button" variant="outline" onClick={requestClose}>
                取消
              </Button>
              <Button type="submit" disabled={action.isPending}>
                <Busy busy={action.isPending}>保存资料</Busy>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discard} onOpenChange={setDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保留本次修改？</DialogTitle>
            <DialogDescription>
              尚未保存的输入会在放弃后清除。
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-actions">
            <Button variant="outline" onClick={() => setDiscard(false)}>
              继续编辑
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscard(false);
                onOpenChange(false);
              }}
            >
              放弃本次修改
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
