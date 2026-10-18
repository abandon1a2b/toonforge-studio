import { obj, arr, str } from "@/lib/types";
const names: Record<string, string> = {
  id: "标识",
  name: "名称",
  full_name: "全名",
  franchise: "所属作品",
  description: "简介",
  summary: "故事简介",
  appearance: "外观设定",
  appearance_variant: "造型范围",
  identity_anchors: "身份锚点",
  performance_flexibility: "表演范围",
  physical: "物理资料",
  hair: "发型",
  eyes: "眼睛",
  skin: "肤色",
  outfit: "服装",
  accessories: "配饰",
  height_cm: "身高",
  weight_kg: "体重",
  age_years: "年龄",
  head_to_body_ratio: "头身比",
  build: "体型",
  shoe_lift_cm: "鞋底增高",
  hair_extra_height_cm: "发型增高",
  headwear_extra_height_cm: "头饰增高",
  source: "依据",
  sources: "参考来源",
  review_notes: "审阅备注",
  layout: "空间布局",
  main_table: "主桌",
  dottore: "博士位置",
  scaramouche: "散兵位置",
  sandrone: "木偶位置",
  north_wall: "北墙",
  east_wall: "东墙",
  west: "西侧",
  framing: "构图规则",
  sandrone_action: "木偶动作",
  wardrobe: "服装方向",
  notes: "备注",
  spatial_revision: "空间设计",
  continuity_rules: "连续性要求",
  generation: "生成记录",
  status: "状态",
  version: "设定版本",
  adaptation_proposals: "改编提案",
  page: "网页",
  file: "文件",
  type: "用途",
  label: "名称",
  clothing: "服装",
  acting: "表演",
  constraints: "约束",
};
const stateNames: Record<string, string> = {
  unknown: "待确认",
  proposed: "制作暂定",
  confirmed: "已确认",
  draft: "草稿",
  pending_user_review: "待用户检查",
};
export function Readable({ value }: { value: unknown }) {
  if (value == null || value === "")
    return <span className="subtle">待确认</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (typeof value === "number") return <span>{value}</span>;
  if (typeof value === "string")
    return /^https?:\/\//.test(value) ? (
      <a href={value} target="_blank" rel="noreferrer" className="source-link">
        {value}
      </a>
    ) : (
      <span className="whitespace-pre-wrap">{stateNames[value] || value}</span>
    );
  if (Array.isArray(value))
    return (
      <ul className="readable-list">
        {value.map((v, i) => (
          <li key={i}>
            <Readable value={v} />
          </li>
        ))}
      </ul>
    );
  const m = obj(value);
  if ("value" in m && "unit" in m)
    return (
      <div className="measurement">
        <strong>
          {m.value == null ? "待确认" : str(m.value) + " " + str(m.unit)}
        </strong>
        <small>{stateNames[str(m.status)] || str(m.status)}</small>
        {m.source != null && (
          <p>
            <Readable value={m.source} />
          </p>
        )}
      </div>
    );
  return (
    <dl className="readable-map">
      {Object.entries(m)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => (
          <div key={k}>
            <dt>{names[k] || k}</dt>
            <dd>
              <Readable value={v} />
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function ProfileSections({
  metadata,
  keys,
}: {
  metadata: Record<string, unknown>;
  keys: string[];
}) {
  return (
    <div className="profile-sections">
      {keys
        .filter((k) => metadata[k] !== undefined)
        .map((k) => (
          <section className="panel" key={k}>
            <h2>{names[k] || k}</h2>
            <Readable value={metadata[k]} />
          </section>
        ))}
    </div>
  );
}
