# Toonforge Studio

本地 AI 制作素材管理工具。Go + SQLite 提供业务、HTTP 和 CLI，React + TypeScript + shadcn/ui 提供界面。前端编译产物通过 Go embed 嵌入，同一个可执行程序即可运行；运行不需要 Python、Node 或独立数据库服务。

软件目录为 `/Users/one/Desktop/toonforge-studio`，素材仍在 `/Users/one/Desktop/toonforge`，旧工具 `/Users/one/Desktop/toonforge-library` 保留。界面采用已选择的 03 模块工作台及胶囊导航。GooseForum 仅用于参考前端资源嵌入方式。

## 启动

```sh
cd /Users/one/Desktop/toonforge-studio
./toonforge --root /Users/one/Desktop/toonforge serve --port 8795
```

打开 http://127.0.0.1:8795 。也可双击 `start.command`。更换素材目录用 `--root` / `TOONFORGE_ROOT`；新空目录会建立空库，不会自动导入全部文件。旧服务 8790 可保留对照。

## 已实现

- 角色、造型、场景、剧本、道具和声音资料；标签筛选、网格/列表、资料编辑、封面、归档恢复、分组。
- 角色的物理资料（含带依据的身高）、外观锚点、造型、表情、声音、使用记录、版本与问题分类查看。
- 媒体上传及批量登记、待整理、增量扫描、外部资料变更比较与明确导入；源文件保留，媒体按哈希保存不可变副本。
- 图片缩放及版本对比、音视频预览、波形与区间试听、视频 Range。缩略图和转码缓存位于系统缓存目录，可重建。
- 剧本工作稿、演员与场景安排、合集审阅、逐镜说明、连续片段、配音清单、版本选用及生成参考包。
- 审阅问题、明确验收证据、固定引用、审计、乐观并发检查；不自动验收或切换最新候选。
- 本地持久任务队列（扫描、完整性检查、备份）、取消及重启中断记录。
- 数据库/媒体校验、完整便携备份及新目录恢复；CLI、HTTP、网页共用业务层；agent skill。

## 当前边界

这是本地单机维护版，不是多用户云平台。不提供账号权限、在线协作、云对象存储、完整音视频剪辑器或模型生成任务。声音页管理和试听现有素材，不会自行修复混音。合集中现有制作图按原始文件展示，未额外生成或裁切。

剧本正文原始文件只读，编辑的是库中工作稿；元数据修订保存在数据库，不自动回写 YAML。扫描会导入新结构镜头/片段，已有镜头以库中编辑为准；不会自动合并外部对白或替已有剧本选用版本。参考包缺失固定素材时会报告原因。完整备份包含数据库及已登记媒体，不包含未登记文件、外部来源正文和可重建缓存；源项目另用 Git/文件备份保存。

## 开发与验证

Go 1.27，Node 24 + npm（仅开发/构建需要），依赖用 go.sum 和 package-lock.json 固定。

```sh
make build
make test
# 开发：一个终端
make dev
# 另一个终端
cd resource && npm run dev
```

开发界面端口 5175，代理到 8795。生产只监听回环地址。安装 FFmpeg/ffprobe 可获得音视频探测、波形与 FLAC 浏览器转码；缺少时仍能维护资料及浏览器原生支持的媒体。

[页面功能设计](design/README.md) · [实施计划](IMPLEMENTATION.md) · [CLI](docs/CLI.md) · [agent skill](skills/toonforge-studio/SKILL.md) · [验证记录](docs/VALIDATION.md)

### FRP 访问：默认远程只读

`serve --remote-read-only=true`（默认）允许远程查看，所有 POST/PUT/PATCH/DELETE 等写入请求必须同时满足本机 Host、本机连接、无代理转发标记及有效本机凭证。上传、资料修改、审阅、任务、设置等均在后端统一拦截；CLI 仍可在本机使用。

FRP TCP 转发可能表现为 loopback 连接，因此不能只根据 IP 判断。服务启动后会将带凭证的本机编辑链接写入素材库 `.toonforge/local-editor-url.txt`，在本机浏览器打开该链接即可编辑；凭证仅存于该标签页会话，地址中的片段随即移除。普通本机地址和分享地址都是只读入口。不要分享本机编辑链接或转发此凭证。凭证文件权限为 0600，不进入 Git。

若明确需要开放写入，可启动 `./toonforge --root /Users/one/Desktop/toonforge serve --remote-read-only=false`；默认保持开启。此开关不限制读取和下载已有素材。
