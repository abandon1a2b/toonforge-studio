import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { get } from "@/lib/api";
import { type Page, type Artifact, roles, labels } from "@/lib/types";
import { AssetCard, Pagination, Loading, ErrorBox, Empty } from "./shared";
import { CompareDialog } from "./media-player";
export function EntityAssets({
  entity,
  defaultRole = "",
}: {
  entity: string;
  defaultRole?: string;
}) {
  const [role, setRole] = useState(defaultRole),
    [history, setHistory] = useState(false),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [compare, setCompare] = useState(false);
  const result = useQuery({
    queryKey: ["artifacts", entity, role, history, q, offset],
    queryFn: ({ signal }) =>
      get<Page<Artifact>>(
        "artifacts",
        { entity, role, history: history ? 1 : 0, q, offset, limit: 24 },
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
        <select
          className="native-select"
          aria-label="素材用途分类"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全部分类</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {labels[r]}
            </option>
          ))}
        </select>
        <label className="check-label">
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => {
              setHistory(e.target.checked);
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
          <div className="asset-grid">
            {result.data.items.map((a) => (
              <AssetCard
                key={a.id}
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
            ))}
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
