import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { get } from "@/lib/api";
import { type Issue, labels, entityURL } from "@/lib/types";
import { Loading, ErrorBox, Empty, Status } from "@/components/shared";
import { IssueForm } from "@/components/review-forms";
export default function Reviews() {
  const [p, setP] = useSearchParams();
  const status = p.get("status") || "",
    entity = p.get("entity") || "";
  const [edit, setEdit] = useState<Issue>();
  const result = useQuery({
    queryKey: ["issues", entity, status],
    queryFn: ({ signal }) =>
      get<{ items: Issue[] }>("issues", { entity, status }, signal),
  });
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">REVIEW / 审阅中心</p>
          <h1>每条意见，都有回音。</h1>
          <p>问题绑定具体版本。“已修”之后，仍需要用户查看或试听复核。</p>
        </div>
      </div>
      <div className="filter-bar">
        <SelectField
          aria-label="问题状态筛选"
          value={status}
          onValueChange={(value) =>
            setP((p) => {
              value ? p.set("status", value) : p.delete("status");
              return p;
            })
          }
        >
          <SelectOption value="">全部状态</SelectOption>
          {["open", "in_progress", "resolved", "verified"].map((s) => (
            <SelectOption key={s} value={s}>
              {labels[s]}
            </SelectOption>
          ))}
        </SelectField>
        {entity && (
          <Button
            variant="outline"
            onClick={() =>
              setP((p) => {
                p.delete("entity");
                return p;
              })
            }
          >
            清除对象范围
          </Button>
        )}
      </div>
      {result.isPending ? (
        <Loading />
      ) : result.error ? (
        <ErrorBox error={result.error} />
      ) : !result.data.items.length ? (
        <Empty title="此范围暂无问题" />
      ) : (
        <div className="review-list">
          {result.data.items.map((i) => (
            <article className="panel" key={i.id}>
              <div className="flex justify-between gap-4">
                <div>
                  <Link
                    to={entityURL(i.entity_id, "feedback")}
                    className="font-medium"
                  >
                    {i.name}
                  </Link>
                  <p className="review-body">{i.body}</p>
                </div>
                <Status value={i.status} />
              </div>
              <div className="flex justify-between items-end">
                <div className="subtle">
                  {i.start_ms != null && (
                    <p>
                      时间范围：{i.start_ms / 1000} 秒—
                      {i.end_ms == null ? "未指定" : i.end_ms / 1000 + " 秒"}
                    </p>
                  )}
                  <p>
                    {new Date(i.created_at).toLocaleString()} · {i.severity}
                  </p>
                  {i.verification_evidence && (
                    <p>复核依据：{i.verification_evidence}</p>
                  )}
                </div>
                <Button variant="outline" onClick={() => setEdit(i)}>
                  处理与复核
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <IssueForm
          revision={edit.revision_id}
          issue={edit}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
