import { Checkbox } from "@/components/ui/checkbox";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { get, useAction } from "@/lib/api";
import {
  type Page,
  type Artifact,
  type Entity,
  roles,
  labels,
  assetURL,
  mediaURL,
  obj,
} from "@/lib/types";
import { AssetCard, Pagination, Loading, ErrorBox, Empty } from "./shared";
import { CompareDialog } from "./media-player";
export function EntityAssets({
  entity,
  defaultRole = "",
  mediaType = "",
  coverOwner,
}: {
  entity: string;
  defaultRole?: string;
  mediaType?: string;
  coverOwner?: Entity;
}) {
  const [role, setRole] = useState(defaultRole),
    [history, setHistory] = useState(false),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [compare, setCompare] = useState(false);
  const playing = useRef<HTMLAudioElement | null>(null);
  const cover = useAction("entity/cover", "默认图片已更新");
  const result = useQuery({
    queryKey: ["artifacts", entity, role, mediaType, history, q, offset],
    queryFn: ({ signal }) =>
      get<Page<Artifact>>(
        "artifacts",
        {
          entity,
          role,
          type: mediaType,
          history: history ? 1 : 0,
          q,
          offset,
          limit: 24,
        },
        signal,
      ),
  });
  return (
    <>
      <div className="filter-bar">
        <Input
          aria-label="搜索此对象的素材"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          placeholder="搜索素材名称或标签"
        />
        <SelectField
          aria-label="素材用途分类"
          value={role}
          onValueChange={(value) => {
            setRole(value);
            setOffset(0);
          }}
        >
          <SelectOption value="">全部分类</SelectOption>
          {roles
            .filter(
              (r) =>
                !mediaType ||
                (mediaType === "audio"
                  ? ["source_audio", "voice", "sfx", "music", "mix", "stem"]
                  : [
                      "turnaround",
                      "portrait",
                      "look",
                      "expression",
                      "action",
                      "reference",
                    ]
                ).includes(r),
            )
            .map((r) => (
              <SelectOption key={r} value={r}>
                {labels[r]}
              </SelectOption>
            ))}
        </SelectField>
        <label className="check-label">
          <Checkbox
            checked={history}
            onCheckedChange={(checked) => {
              setHistory(checked === true);
              setOffset(0);
            }}
          />
          历史版本
        </label>
        <Button
          variant="outline"
          disabled={selected.length !== 2}
          onClick={() => setCompare(true)}
        >
          对比所选 ({selected.length}/2)
        </Button>
        <Button asChild>
          <Link to={"/import?entity=" + encodeURIComponent(entity)}>
            添加资源
          </Link>
        </Button>
      </div>
      {result.isPending ? (
        <Loading />
      ) : result.error ? (
        <ErrorBox error={result.error} />
      ) : !result.data.items.length ? (
        <Empty title="这一分类还没有资源">
          <p>可以导入已有素材，或调整筛选条件。</p>
        </Empty>
      ) : (
        <>
          <div
            className={
              mediaType === "audio" ? "audio-resource-list" : "asset-grid"
            }
          >
            {result.data.items.map((a) =>
              a.media_type === "audio" ? (
                <article className="audio-resource-row" key={a.id}>
                  <Checkbox
                    aria-label={"对比 " + a.relative_path.split("/").pop()}
                    checked={selected.includes(a.id)}
                    onCheckedChange={(checked) =>
                      setSelected((old) =>
                        checked === true
                          ? old.length < 2
                            ? [...old, a.id]
                            : old
                          : old.filter((id) => id !== a.id),
                      )
                    }
                  />
                  <div className="audio-resource-title">
                    <Link to={assetURL(a.id)}>
                      {a.relative_path.split("/").pop()}
                    </Link>
                    <small>
                      {labels[a.role] || a.role} ·{" "}
                      {typeof obj(a.metadata.technical).duration_seconds ===
                      "number"
                        ? Number(
                            obj(a.metadata.technical).duration_seconds,
                          ).toFixed(1) + " 秒"
                        : ""}
                    </small>
                  </div>
                  <audio
                    controls
                    preload="none"
                    aria-label={"播放 " + a.relative_path.split("/").pop()}
                    src={mediaURL(a)}
                    onPlay={(event) => {
                      if (
                        playing.current &&
                        playing.current !== event.currentTarget
                      )
                        playing.current.pause();
                      playing.current = event.currentTarget;
                    }}
                  />
                  <Link className="subtle" to={assetURL(a.id)}>
                    版本与来源
                  </Link>
                </article>
              ) : (
                <div key={a.id}>
                  <AssetCard
                    asset={a}
                    selected={selected.includes(a.id)}
                    onSelect={(checked) =>
                      setSelected((old) =>
                        checked
                          ? old.length < 2
                            ? [...old, a.id]
                            : old
                          : old.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {coverOwner && a.media_type === "image" && (
                    <Button
                      className="default-image-action"
                      variant="ghost"
                      disabled={
                        cover.isPending || coverOwner.cover_artifact_id === a.id
                      }
                      onClick={() =>
                        cover.mutate({
                          id: coverOwner.id,
                          artifact_id: a.id,
                          expected_version: coverOwner.version,
                        })
                      }
                    >
                      {coverOwner.cover_artifact_id === a.id
                        ? "当前默认图"
                        : "设为默认图"}
                    </Button>
                  )}
                </div>
              ),
            )}
          </div>
          <Pagination page={result.data} onPage={setOffset} />
        </>
      )}
      {compare && (
        <CompareDialog ids={selected} onClose={() => setCompare(false)} />
      )}
    </>
  );
}
