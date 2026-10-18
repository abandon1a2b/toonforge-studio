---
name: toonforge-studio
description: 通过 Go CLI 管理 Toonforge 本地角色、造型、场景、剧本、媒体版本和固定引用，提供导入、审阅、备份及浏览器服务。用于素材库维护，不负责生成图片、语音或视频。
---

# Toonforge Studio

软件：`/Users/one/Desktop/toonforge-studio`；当前素材库：`/Users/one/Desktop/toonforge`。二者独立。优先使用下方 CLI，避免直接改 SQLite 或覆盖素材原文件。

```sh
/Users/one/Desktop/toonforge-studio/toonforge --root /Users/one/Desktop/toonforge describe
/Users/one/Desktop/toonforge-studio/toonforge --root /Users/one/Desktop/toonforge entity list --type character
/Users/one/Desktop/toonforge-studio/toonforge --root /Users/one/Desktop/toonforge serve --port 8795
```

查询与写入不要求 Web 服务运行；排队任务由运行中的 `serve` 执行。数据命令 stdout 为 JSON，错误写入 stderr；退出码 2 输入错误、3 版本冲突、4 不存在。`--help` 获取各命令参数，完整 JSON 用 `--input FILE` 或 `--input -`。

## 维护规则

- 编辑前 `entity show --id ID` 读取版本和完整 metadata。更新传 `expected_version`，保留不打算修改的字段；冲突时重新读取并合并，不盲目重试。归档可恢复，不做物理删除。
- 角色身高 `physical.height_cm` 含 `value`、`unit:"cm"`、`status`、`source`；未知用 null，数值必须注明依据，不把制作暂定值称为官方值。
- `artifact register` 接收项目相对路径、entity_id、role；会保存不可变副本和修订，原文件不会改写。先核对归属，来源/授权未知保持未知。
- `refresh` 是明确的增量导入。新素材成为候选，外部资料变化进入 pending；先比较再 `apply-pending`。新导入的结构镜头不会覆盖已管理的镜头编辑。
- 修订验收与剧本选用分开。`revision review` 的 accepted 需用户明确验收依据；技术测试不能代替美术或听觉验收。
- `selection set` 必须指定精确 revision_id、scope、slot、expected_version，不用“最新文件”替换。角色用途 `character.<稳定角色ID>.profile|look`，场景 `scene.<稳定场景ID>`，分镜 `board.<用途>`，配音 `voice.<cue_id>`；后两者必须属于本篇。
- `context --story ID --shots shot-014 --purpose video` 导出固定参考包，会展开连续镜头。检查 ready/missing，未满足引用时补齐，勿绕过缺失项；参考包不提交生成任务。
- 问题绑定具体修订。verified 需复核证据，保留尚未解决的反馈。
- 完整备份用 `backup --include-media`。`restore --backup PATH --destination NEW_EMPTY_DIR` 只恢复到新空目录；先校验再决定是否切换。不含媒体的索引备份不能独立恢复。

更多操作示例与实现边界见软件目录 `docs/CLI.md`、`README.md`。
