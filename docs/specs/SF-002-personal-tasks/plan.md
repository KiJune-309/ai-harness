# SF-002：功能实施计划

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-002             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 创建日期  | 2026-10-17         |
| 最近更新  | 2026-10-17         |

## 技术方案与理由

在已有 Nest ChatService、scoped ChatStore 与 Cordis ChatRuntime 上扩展个人任务，不新增执行服务、不修改 DeepSeek 上游 core。任务作为带 task 元数据的完整会话快照保存，目标、状态、Agent 快照及消息由同一持久化记录原子更新，避免半成品。普通聊天入口过滤并拒绝任务会话，专用任务入口执行业务规则。

用户已于 2026-10-17 批准 Spec，并委托产品经理与评测 agent 审核后续 SDD 阶段；本计划经两者评审后实施，不再逐阶段请求用户确认。

## 模块、接口与数据流

- contracts：新增 TaskStatus（not-started/in-progress/needs-input/completed）、TaskMetadata、PersonalTask、CreateTask、UpdateTaskStatus schemas/types。ChatConversation 可选 task 元数据，PersonalTask 必须包含 task 与实际 agent 快照；复用 SSE ChatStreamEvent。
- task 元数据：目标、首次执行标记、完成前状态、创建时选定的原 Agent 标识；创建请求 UUID 直接作为任务 UUID，按规范化 title/goal/sourceAgentId 比较幂等内容。
- db：现有会话表增量新增可空 task_data jsonb；旧行兼容。内存及 PG 使用同一完整快照验证与单次 save，不增加独立任务/消息双写。查询继续带 workspace/user 条件。
- API：ChatService 增加任务 list/create/get/updateStatus/start/send/cancel；复用原有 runtime、回合幂等及取消。创建、状态写入与执行共享作用域互斥边界，在首次异步读前保留锁，避免延迟读覆盖新状态。本轮部署为单 API 进程，多副本协调与队列不在范围。
- Agent：自定义与通用助手都冻结实际模型、prompt、工具、开场消息。自定义空 prompt 在创建时解析部署默认；通用助手保存默认模型/prompt、空工具/开场。凭据和 provider 连接设置不进入公开快照。
- 路由：GET/POST /api/chat/tasks；GET /api/chat/tasks/:id；PUT .../:id/status；POST .../:id/start（requestId）、messages（content/requestId）、cancel（requestId）。start 使用保存目标，首个目标记录前不能补充消息；普通 conversations GET/send/cancel 拒绝任务 ID。
- 状态：创建未开始；首次 start 接受时与首条目标一起保存为进行中。后续手动状态不被生成结束覆盖。完成保存 previousStatus，恢复回原未完成状态；运行期间拒绝状态修改；已完成禁止 start/send。
- 幂等与失败：创建响应不明保留 UUID，修改字段后换 UUID。同 ID 不同内容冲突；成功消息重放而不调模型，运行中冲突；最新失败/停止重试替换回复、不重复用户消息，有后续回合拒绝旧失败重试。未接受的输入保留草稿，状态写入失败保留旧值，断流后拉取真实保存结果。
- Web：BFF 增加固定 task 路由并保持 Origin/大小/身份规则；类型化客户端复用 SSE 解析。/inbox 替换 Demo，为真实列表、搜索、数量与创建；/inbox/[id] 显示目标、冻结助手/模型、状态和流式会话，支持开始/停止/重试/完成/恢复。先建立身份 cookie，再读取任务和 Agent，避免首次并发身份漂移。
- UI 沿用现有中性色变量与响应式模式；新任务组件替换 InboxView，资料库保持现状。新增 docs/ui-design-spec.md，仅区分任务已实现交互与未实现公共能力，不为演示数据背书。

## 数据、兼容与迁移影响

增量 ALTER TABLE ADD COLUMN IF NOT EXISTS task_data jsonb，不重置会话或 Agent，不迁移演示任务。旧协议 task 可选，任务响应要求完整快照。正式持久化用 DATABASE_URL；显式 memory 页面提示重启清空。真实 PG 测试使用独立临时容器/数据库和 API 端口，不修改当前 dev 环境，完成后清理临时资源。

## 风险与缓解

| 风险              | 影响             | 缓解方式                                                          |
| ----------------- | ---------------- | ----------------------------------------------------------------- |
| 状态与消息写竞争  | 丢状态或重复调用 | 单记录更新，异步读前作用域互斥，延迟存储并发测试。                |
| 普通入口绕过      | 完成任务仍生成   | 普通 list 过滤，GET/send/cancel 拒绝任务并做 HTTP 回归。          |
| 默认配置变化      | 旧任务漂移       | 两类 Agent 均保存实际配置，配置变更后重建 API 验证。              |
| 模型/网络失败     | 输入丢失、假完成 | 草稿和幂等 ID 保留，保存部分回复，受控失败及真实调用验证。        |
| PostgreSQL 未启动 | 无法证明持久化   | 启动本机已有 Docker，隔离 PG 实测；未执行时 AC-013 保持 NOT RUN。 |

## 验证策略

| 验证项        | 关联验收标准                                 | 方法                                                                   | 通过条件                                             |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| 契约/生命周期 | AC-001–AC-004、AC-008–AC-012                 | Vitest：受控 runtime、延迟/失败 store                                  | 幂等、目标、快照、状态与失败符合 Spec。              |
| HTTP/权限     | AC-004、AC-008、AC-011、AC-012、AC-015       | Nest 集成与 BFF Origin/path/body 测试                                  | 隔离、普通入口防绕过、完成/运行规则均不可绕过。      |
| 存储          | AC-007、AC-013、AC-014                       | DB 单测、实际 PG/API 关闭重建、memory 生命周期                         | PG 保留完整记录，memory 同进程恢复/重启丢失。        |
| 页面          | AC-001–AC-003、AC-005–AC-009、AC-011、AC-014 | 浏览器创建、两轮真实 DeepSeek、刷新、搜索、完成恢复、390px/键盘        | 真实数据、可见状态、无核心溢出，失败可恢复。         |
| 工程回归      | 所有 AC                                      | pnpm test/lint/typecheck:web/api/core/build:api/build:web/format:check | 适用检查通过；既有 SF-001 格式问题单列，不修改历史。 |

## 实施顺序与依赖

1. T-001 契约。
2. T-002 存储；T-003 API 按稳定契约与存储约定并行开发。
3. T-004 客户端/代理；T-005 页面按稳定接口与 API 并行。
4. T-006 集成、真实 PG/模型与浏览器验证。
5. T-007 独立评测、修复与逐 AC 验收，然后进入下一轮需求。

## 计划变更记录

| 日期       | 变更                          | 原因                       |
| ---------- | ----------------------------- | -------------------------- |
| 2026-10-17 | 首版 Plan，等待授权代表评审。 | 用户批准 Spec 并授权代审。 |
