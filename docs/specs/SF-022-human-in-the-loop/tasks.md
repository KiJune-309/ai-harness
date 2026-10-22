# SF-022：任务清单

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-022             |
| 状态      | Complete           |
| 关联 Spec | [spec.md](spec.md) |
| 关联 Plan | [plan.md](plan.md) |

## 任务状态定义

- TODO：尚未开始。
- IN PROGRESS：正在实施。
- BLOCKED：存在实际阻塞，记录原因。
- DONE：完成标准及指定验证均通过。

## 任务概览

| ID    | 任务                              | 关联需求/验收                                                                            | 依赖              | 状态 |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------------- | ----------------- | ---- |
| T-001 | 契约与持久请求/决定事务           | REQ-002–006、008–013、015 / AC-001–003、006、008–015、017、018                           | 无                | DONE |
| T-002 | Cordis 提问、工具拦截与原调用恢复 | REQ-002、004–010、012–015、018 / AC-001、004–007、009、010、012、013、017、020           | T-001 接口        | DONE |
| T-003 | 普通聊天/API/worker 持久集成      | REQ-001–004、007–016 / AC-001、003、008、010、011、014–018                               | T-001、T-002 接口 | DONE |
| T-004 | 聊天预览、底部回答与审批          | REQ-001–004、006–008、013、014、016、017 / AC-001–003、005、007、008、010、016、018、019 | T-001 契约        | DONE |
| T-005 | 集成、工程检查及逐项验收          | 全部 / AC-001–020                                                                        | T-001–004         | DONE |

## 任务细节

### T-001：契约与持久事务

**文件/边界：** contracts/src/human-loop.ts、index.ts；db/src/collaboration.ts 及初始化调用边界 及相应 tests。
**接口：** HumanRequest、humanResponse、决定；租约绑定 wait/read/begin/finish 与本人 decide。
**完成标准：** PG 请求/决定/效果与 job 恢复原子；真实答案及旧草稿规则一致，旧版/撤权/竞争不推进。
**验证：** schema 测试、隔离 PG 并发、租约、重启和未知效果；关联 AC 见概览。

### T-002：runtime

**文件/边界：** core/chat-runtime/src/human-loop.ts、collaboration.ts 及 tests；必要的工具调度接口。
**接口：** 当前 writer 的 HumanLoopPort，测试工具仅显式服务端依赖注入。
**完成标准：** 真正结束模型轮次等待；原 journal/call 恢复；只读自动、未批准零效果、前置不重放。
**验证：** 真实 Cordis + 受控 HTTP、多调用、批准/拒绝、冻结参数与重启。

### T-003：API/worker

**文件/边界：** api/src/chat-service.ts、controller.ts、collaboration-worker.ts、app.ts 及 tests。
**接口：** messages/humanResponse，专用 human-requests 决策，worker 当前租约端口及私有请求投影。
**完成标准：** 普通聊天持久接受且不创建协作节点，身份先验、等待不占连接、原发送边界不变。
**验证：** 真实 API/PG 提问/答案、权限/幂等/重启及现有发送回归。

### T-004：Web

**文件/边界：** web/components/human-request-panel.tsx、workspace.tsx、message-composer.tsx、lib/chat-client.ts、server/chat-proxy.ts 及 tests；UI规范。
**接口：** humanRequests、底部精确回答、actionId/version 决定。
**完成标准：** 一个输入器，建议只填稿、旧题不误答，完整预览与真实回执，失败保稿、身份切换清私有状态。
**验证：** 组件/客户端/代理及桌面/390px 浏览器、键盘/输入法/长内容/失败。

### T-005：验收

**文件/边界：** 集成测试、AGENTS.md、UI规范和本四文档。
**完成标准：** 逐项 AC 实证与工程检查，区分真实生产及隔离工具；未执行如实记录。
**验证：** Plan 验证矩阵及根 format:check/lint、相关类型/构建。

## 阻塞项

无。所有任务及本期验收已完成。

## 完成汇总

总任务 5，已完成 5，进行中 0，待办 0。
