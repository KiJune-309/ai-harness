# SF-002：任务清单

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-002             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 关联 Plan | [plan.md](plan.md) |

## 任务状态定义

TODO 未开始；IN PROGRESS 实施中；BLOCKED 具体依赖待解决（原因记 Changes）；DONE 完成标准和验证满足。

## 任务概览

| ID    | 任务                | 关联需求/验收                                           | 依赖                  | 状态 |
| ----- | ------------------- | ------------------------------------------------------- | --------------------- | ---- |
| T-001 | 任务契约            | REQ-001–REQ-010 / AC-001–AC-015                         | 无                    | DONE |
| T-002 | 任务存储与迁移      | REQ-002、004、006、009、010 / AC-003、004、007、013–015 | T-001                 | DONE |
| T-003 | 任务 API 与执行规则 | REQ-001–REQ-010 / AC-001–004、006–015                   | T-001、T-002 接口约定 | DONE |
| T-004 | Web 客户端及 BFF    | REQ-001、003–010 / AC-001、005–015                      | T-001、T-003 接口约定 | DONE |
| T-005 | 真实列表与详情      | REQ-001–REQ-009 / AC-001–003、005–014                   | T-001、T-004          | DONE |
| T-006 | 集成及真实验证      | REQ-001–REQ-010 / AC-001–AC-015                         | T-002–T-005           | DONE |
| T-007 | 独立评测与修复      | REQ-001–REQ-010 / AC-001–AC-015                         | T-006                 | DONE |

## 任务细节

### T-001：任务契约

**文件：** packages/contracts/src/index.ts 及契约测试。**接口：**输出任务状态、元数据、PersonalTask、创建/状态 schemas/types；SSE 保留 task。**完成标准：**UUID、长度、状态、必需快照正确，普通会话兼容。**验证：**契约 Vitest 和 contracts build，合法/非法边界及旧数据解析通过。

### T-002：任务存储与迁移

**文件：** packages/db/src/index.ts、packages/db/tests/。**接口：**沿用 ChatStore list/get/save，task_data 映射。**完成标准：**任务与消息原子保存、旧行兼容、scope 过滤、无可见半记录。**验证：**memory/PG 映射单测，以及 T-006 实际 PG API 重建 AC-013。

### T-003：任务 API 与执行规则

**文件：** apps/api/src/chat-service.ts、task-controller.ts、app.ts 和测试。**接口：**Plan 的 tasks list/create/get/status/start/messages/cancel，复用初始化 Cordis。**完成标准：**快照、目标、幂等、状态互斥、恢复、普通入口隔离、配置缺失、失败和 scope 规则满足。**验证：**受控 runtime、延迟/失败 store 与 HTTP 测试；同 ID 不同内容、成功重放、最新失败重试、旧失败拒绝、活动状态竞争及跨身份/工作空间均覆盖。

### T-004：Web 客户端及 BFF

**文件：** apps/web/lib/chat-client.ts、task-client.ts 及测试；server/chat-proxy.ts 及测试。**接口：**类型化 task 操作、复用 SSE 解析，固定同源路由。**完成标准：**响应校验、POST/PUT Origin/body、无公开凭据、异常可恢复。**验证：**客户端和代理 Vitest，非法响应/HTTP/截断/跨源均拒绝。

### T-005：真实任务页面

**文件：** apps/web/app/inbox/page.tsx、app/inbox/[id]/page.tsx、components/task-workspace.tsx/CSS、原 InboxView、docs/ui-design-spec.md。**接口：**客户端及既有 Agent 列表，先建立 cookie。**完成标准：**真实列表/搜索/数量/空态/失败重试；稳定详情；带标签的创建表单；开始/流式/停止/重试/完成/恢复、草稿、临时存储提示。**验证：**类型检查、浏览器 AC-002 窄屏/键盘、AC-005 搜索、AC-007 刷新、AC-011 完成恢复。

### T-006：集成和真实环境

**文件：**测试、必要的独立 PG 验证脚本、changes.md 证据。**接口：**全部可运行实现，已有服务端 DeepSeek 密钥。**完成标准：**两轮真实聊天、PG API 关闭重建恢复、memory 生命周期和工程检查；不输出密钥；清理临时资源。**验证：**Plan 矩阵所有适用命令与浏览器操作，未执行项如实记录。

### T-007：独立评测

**文件：**四份 SDD 文档及评测指出的业务文件。**接口：**评测逐条 AC 给 PASS/FAIL/NOT RUN，PM确认产品范围。**完成标准：**全部 Must AC 有实际证据、必修意见修复且重验，所有必需任务 DONE 才 Accepted。**验证：**独立代码/行为审查、针对性测试与真实环境证据。

## 阻塞项

- Plan/Tasks 已由授权 PM 与评测 agent 批准。
- 无剩余阻塞；真实 PostgreSQL 与独立 API 进程重启验证已通过。

## 完成汇总

总任务 7；已完成 7；进行中 0；阻塞 0；待办 0。
