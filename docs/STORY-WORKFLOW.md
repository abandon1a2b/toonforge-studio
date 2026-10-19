# 故事与制作版本

故事列表以故事为单位。旧 `story` 实体仍作为制作空间存在，以免破坏既有镜头、素材、选用、审阅和旧链接。

`studio_story_members` 将制作空间归到故事；`studio_workflow` 存储不可变阶段版本，字段包括故事、阶段、名称、来源版本、可选制作空间、内容快照与时间。来源关系固定到版本 ID：剧本可由另一剧本衍生；分镜与配音来自具体剧本；视频来自具体分镜。跨故事和错误阶段关系由共享 Go 业务层拒绝。暂不提供删除或修改版本的接口，调整通过新增版本完成。

当前旧数据整理为一个故事、三个剧本版本及三个分镜版本。导入时保存剧本/分镜文档文本及元数据快照；历史生成时的精确修订无法还原，已在快照中注明，不推定已验收。已存在的配音和视频仍在旧制作空间内，尚未自动包装成阶段版本，避免猜测所用来源。制作空间中的可修改内容与不可变版本快照分开显示。

页面：剧本列表 → 故事与版本 → 点击版本检查快照 / 进入制作空间。新版本表单选择阶段和来源，填写版本内容后保存，不自动替换生产选用。

CLI：

```sh
./toonforge --root /Users/one/Desktop/toonforge workflow --story story:episode-001-handwritten-code-day
./toonforge --root /Users/one/Desktop/toonforge workflow-create --input version.json
```

version.json 示例：

```json
{"story_id":"story:episode-001-handwritten-code-day","stage":"boards","label":"分镜方案 B · v1","source_id":"具体剧本版本 ID","snapshot":{"text":"分镜设计正文"}}
```

HTTP：`GET /api/v2/workflow?story=ID`，`POST /api/v2/workflow/create`。写入遵守远程只读限制。没有将“最新”当成“已选用”，也没有根据上游新增版本覆盖下游。

2026-10-19 验证：前端构建、前端测试及 Go race 测试；真实库整理前备份在素材库 `.toonforge/backups/before-story-workflow-2026-10-19.sqlite`。整理后 entities 227、revisions 907、artifacts 670、selections 51、issues 1，内容与备份逐行比较一致。新增关系表不改变原始实体及素材。
