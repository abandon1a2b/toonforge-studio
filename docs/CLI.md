# CLI 与 API

命令入口 `./toonforge --root PROJECT`，`--help` 为实际参数契约。数据命令不要求服务器启动，统一 JSON 输出。生产 API 与网页同源 `/api/v2/`，不向公网提供服务。

```sh
./toonforge --root /Users/one/Desktop/toonforge workspace
./toonforge --root /Users/one/Desktop/toonforge entity list --type character --tag setting:office
./toonforge --root /Users/one/Desktop/toonforge entity show --id character:dottore
./toonforge --root /Users/one/Desktop/toonforge artifact list --entity character:dottore
./toonforge --root /Users/one/Desktop/toonforge pending
./toonforge --root /Users/one/Desktop/toonforge health
./toonforge --root /Users/one/Desktop/toonforge backup --include-media
```

写入可使用 JSON 文件或 stdin：

```sh
./toonforge --root PROJECT entity create --input new-scene.json
./toonforge --root PROJECT entity update --input updated-scene.json
./toonforge --root PROJECT artifact register --input registration.json
./toonforge --root PROJECT selection set --input selection.json
./toonforge --root PROJECT cover-set --input cover.json
```

新建资料：`{"type":"scene","name":"办公室","tags":["室内"],"metadata":{"layout":{"overview":"一排三个座位"}}}`。

更新资料：`{"id":"scene:...","expected_version":1,"name":"办公室","tags":["室内"],"metadata":{...完整合并后的资料...}}`。标签和 metadata 是完整值，不是局部 patch。

登记媒体：`{"entity_id":"scene:...","path":"scenes/office/reference.png","role":"scene","note":"候选","source":{"url":"...","author":"...","license_id":"..."}}`。path 是项目相对路径。

固定选用：`{"scope":"story:...","slot":"scene.office","revision_id":"rev:...","expected_version":0,"reason":"用户指定"}`。首次版本0，替换必须使用读取到的选用版本。

封面：`{"id":"scene:...","artifact_id":"artifact:...","expected_version":1}`。仅能使用本对象/子造型的图片。

其他命令：`revision review`、`issue list/save`、`selection list/set`、`context`、`entity archive/export`、`artifact annotate`、`refresh`、`apply-pending`、`inbox`、`events`、`tags`、`tag-rename`、`collections`、`collection-save`、`settings-save`、`jobs`、`job-submit`、`job-cancel`、`restore`。复杂字段通过 `--input` 传入。

退出0成功；2输入/业务错误；3版本冲突；4对象不存在。错误 JSON 写 stderr，不混入 stdout。`describe` 提供机器可读策略概览。

HTTP GET: overview、entities、entity、artifacts、artifact、documents、selections、issues、events、tags、settings、pending、inbox、jobs、health、context、collections；file/thumb/waveform/audio-preview 处理媒体。POST: entity/create/update/archive/cover/export/visit、artifact/register/update、revision/review、selection/set、issue/save、import/refresh/apply、jobs/create/cancel、backup/create、settings/save、tags/rename、collections/save；上传用 multipart `/api/v2/upload`。所有 JSON 写入要求 Content-Type: application/json，并与 CLI 使用相同校验。

角色图片可使用 `turnaround`（三视图/设定表）、`portrait`（头像/特写）、`expression`（表情）、`action`（动作）、`look`（服装）、`reference`（其他参考）作为role。`cover-set`明确指定的图片优先于自动三视图展示；该操作不等于验收或替换剧本引用。
