# Toonforge Studio

- 软件在本目录，实际素材库通过 `--root` 指定；当前为 `/Users/one/Desktop/toonforge`。旧工具和素材不要随软件重构迁移或删除。
- Go 业务层 `internal/store` 同时服务 HTTP 与 CLI；验证和事务放业务层，不在前端或命令层重复实现。
- 前端 `resource/src` 使用 React、TypeScript、shadcn/ui、TanStack Query、React Hook Form；服务状态与编辑草稿分开，筛选状态放URL。
- `resource/dist` 是嵌入产物，修改前端后重新构建再编译Go。`make build`、`make test`，涉及并发/存储时跑 `go test -race ./...`。
- 媒体不可变、修订与选用分离、写入检查读取时版本；不把新候选自动当成已验收，不静默覆盖源文件或固定引用。
- 测试写入使用临时库；真实库保留用户反馈，不把技术检查说成美术/听觉验收。边界和操作见README及docs。
