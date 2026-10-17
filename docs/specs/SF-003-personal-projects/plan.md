# SF-003：功能实施计划

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-003             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 创建日期  | 2026-10-17         |
| 最近更新  | 2026-10-17         |

## 技术方案与理由

SF-002 已 Accepted。本轮沿用 Next.js 同源代理、可信 scope、Nest ChatService、同一 ChatStore 与 Cordis，不修改 runtime。个人项目是纯管理信息，不进入模型请求。项目计数从实时所属任务聚合，不另存会漂移的计数，也不建立项目完成状态。

项目保存名称、说明、稳定 UUID、创建/更新时间。创建 UUID 即动作 ID；存储层另外保存首次规范化创建参数（服务端内部字段），用于编辑后重放创建仍返回当前项目、不同原始参数409。允许同名项目。

任务 task_data 增加可选 projectId（当前归属）及 creationProjectId（首次创建参数，保持不变）。未归组旧记录无需迁移填值。任务创建与其初始归属在同一次完整快照写入，当前项目可移动但创建动作重放只检查 creationProjectId，绝不重新应用旧归属。

## 模块、接口与数据流

- contracts：projectInputSchema(name trim1–120, description trim0–2000)、createProjectSchema(requestId UUID)、personalProjectSchema、projectDetailSchema({project,tasks})；updateTaskProjectSchema({projectId:UUID|null})；CreateTask.projectId可选，TaskMetadata的两个project字段可选。
- db：ChatStore.projects 可选兼容测试资源；ProjectStore list/get/save 使用与会话相同 pool，内部 StoredProject={project,creation:{name,description}}。memory 同生命周期深复制；PostgreSQL 新增 harness_personal_projects，以(workspace_id,user_id,id)复合主键及JSONB完整记录。无服务器数据库客户端进入contracts。
- API：沿用 ChatService 并追加 ProjectController；GET /api/chat/projects → {projects}，POST 同路径 → PersonalProject，GET /:id → {project,tasks}，PUT /:id → PersonalProject。PUT /api/chat/tasks/:id/project → PersonalTask。任务创建现有POST支持可选projectId；不新增模型入口。
- 项目创建/编辑以 project 前缀的 scope/ID 锁互斥；任务归组、任务创建、状态及消息继续共享现有 task 锁。锁在第一次异步读前预留；活动生成时归组409。锁内重新读最新任务、验证目标项目所有权，再只改归属和更新时间完整保存，不用客户端旧快照覆盖。并发移动可有一次409，成功结果至多一个归属。
- 读取项目详情先验证项目，再调用真实 listTasks 过滤 task.projectId；返回实时状态及任务行。任务详情按当前projectId读取项目名称/返回链接。无删除功能，校验后的项目不会被同时删除。
- Web：复用 requestChatResponse 的超时/取消/中文错误与身份初始化；固定 BFF 白名单。新 /projects 和 /projects/[id] 页面，侧栏以“项目”真实入口替换两个演示分组。列表搜索、创建/编辑对话框、项目详情计数、已有任务选择及新任务入口。任务创建流程抽取复用并接受可选projectId；详情增加当前归属与移动/移出表单，生成时禁用。
- 项目创建动作指纹与 UUID 保留到成功；编辑错误保留输入；所有写入等真实响应后更新。归组失败保留旧任务与计数，明确错误可重试；重新加载读取最新记录。

## 数据、兼容与迁移影响

仅添加独立项目表及 task_data 的可选属性；普通聊天、旧未归组任务、Agent快照与SSE结构兼容。ProjectStore与AgentStore共用父级存储生命周期；close释放memory及PG池。服务公开项目没有首次创建内部参数。已完成任务允许管理归属但不可执行；任务状态、消息、开场、模型、目标与ID均保持。

当前部署仍为一个API执行进程，现有进程内互斥提供同进程写入一致性；不声称多worker分布式互斥。权限由API按user+workspace同时过滤项目和任务；猜测/外来ID与不存在返回一致404。无跨任务模型信息共享。

## 风险与缓解

- 创建重放撤销后续编辑或移动：保留不可变原始参数，分别与当前状态隔离，专门回归。
- 归组与生成/状态覆盖：共享既有服务锁并在锁内读取，不另建无协调ProjectService写任务。
- 伪持久化或计数漂移：真实任务聚合，实际PG独立进程关闭/重启验证；memory提示重启清空。
- UI重复任务创建逻辑：复用SF-002表单而非第二套字段/幂等逻辑，原 /inbox 继续包含所有任务。
- 网络故障：延续15秒连接期限与原输入/ID，列表/详情可重载；不保存乐观归属。

## 验证策略

| 验收       | 方法与通过条件                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| AC-001–003 | 契约/存储/服务/客户端：长度边界、UUID、同名、创建重放与编辑后重放；浏览器真实空列表、搜索、编辑失败保留、390px/键盘。           |
| AC-004–005 | 服务与HTTP测试归入/移动/移出/重复/完成任务，快照逐字段相等；浏览器项目A/B与inbox读取真实计数。                                  |
| AC-006–007 | 服务测试项目内原子任务创建、store失败无孤立任务、外来/不存在拒绝、移动后重放不回滚；浏览器复用Agent创建并明确开始。             |
| AC-008–009 | 浏览器稳定路由/归属返回、状态/完成/恢复后项目计数；任务原地址兼容。                                                             |
| AC-010     | 延迟runtime和延迟store确定性测试：生成拒绝/并发移动/状态消息不丢；浏览器生成时禁用。                                            |
| AC-011     | 同user不同workspace、同workspace不同user及双方交叉归属HTTP/存储测试，404且未修改。                                              |
| AC-012–013 | 复用隔离PG容器，built API独立OS进程关闭重启核对项目/归属/完整历史/Agent/状态计数/旧记录；另memory进程重启清空，浏览器故障恢复。 |
| AC-014     | 真实DeepSeek在项目任务连续回复、移动后继续；受控原生provider输入断言没有另任务/项目说明、目标开场不重复，完成仍拒绝。           |

最终运行相关Vitest、全量测试、Web/API/core类型检查、API/Web构建、lint和format:check。仅原有SF-001两个文档格式例外单列，本轮文件必须格式通过。独立评测逐AC依据实测记录PASS/FAIL/NOT RUN，不能以mock代替真实PG/DeepSeek。

## 实施顺序与依赖

T-001契约先行；T-002存储、T-003 API、T-004客户端/BFF、T-005界面在明确接口后并行；T-006集成实测；T-007独立评测与修复后Accepted。主开发者负责Plan/Tasks、契约和集成；分工代理不互相覆盖文件。

## 计划变更记录

- 2026-10-17：SF-002 Accepted后编写首稿，提交用户授权的产品经理与评测审查。
