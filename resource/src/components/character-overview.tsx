import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { type Entity, assetURL, obj, str, height } from "@/lib/types";
import { ProfileSections, Readable } from "./profile";
const imageTypes = [
  ["turnaround", "三视图 / 设定表", "默认展示，供比例和服装核对"],
  ["portrait", "头像 / 特写", "眼睛、发型与面部细节"],
  ["expression", "表情参考", "喜怒哀乐与口型"],
  ["action", "动作参考", "姿态、手势与肢体"],
  ["look", "服装造型", "本体服装与改编版本"],
  ["reference", "其他参考", "来源图与补充资料"],
];
export function CharacterOverview({
  entity: e,
  onImages,
}: {
  entity: Entity;
  onImages: () => void;
}) {
  const m = e.metadata,
    h = obj(obj(m.physical).height_cm);
  return (
    <div className="character-overview">
      <section className="character-reference">
        <div className="section-heading">
          <h2>默认角色参考</h2>
          <Button variant="ghost" onClick={onImages}>
            管理图片
          </Button>
        </div>
        {e.cover_artifact_id ? (
          <Link to={assetURL(e.cover_artifact_id)}>
            <img
              src={"/api/v2/file?id=" + encodeURIComponent(e.cover_artifact_id)}
              alt={e.name + "默认参考图"}
            />
          </Link>
        ) : (
          <div className="character-image-empty">
            暂无三视图，可在图片资源中添加
          </div>
        )}
        <p className="subtle">
          优先展示三视图；可手动指定默认图。展示不代表验收或剧本选用。
        </p>
      </section>
      <div className="character-facts">
        <dl className="character-basics">
          <div>
            <dt>姓名 / 别名</dt>
            <dd>{str(m.full_name) || e.name}</dd>
          </div>
          <div>
            <dt>所属作品</dt>
            <dd>{str(m.franchise) || "待确认"}</dd>
          </div>
          <div>
            <dt>制作身高</dt>
            <dd>
              {height(e)}
              {h.source != null && (
                <small>
                  <Readable value={h.source} />
                </small>
              )}
            </dd>
          </div>
        </dl>
        <ProfileSections
          metadata={m}
          keys={[
            "description",
            "adaptation_proposals",
            "appearance",
            "identity_anchors",
            "performance_flexibility",
          ]}
        />
      </div>
      <section className="character-reference-types">
        <h2>图片用途</h2>
        <div>
          {imageTypes.map(([id, name, note]) => (
            <span key={id}>
              <strong>{name}</strong>
              <small>{note}</small>
            </span>
          ))}
        </div>
      </section>
      <details className="character-more">
        <summary>更多物理资料、来源与审阅备注</summary>
        <ProfileSections
          metadata={m}
          keys={["physical", "appearance_variant", "sources", "review_notes"]}
        />
      </details>
    </div>
  );
}
