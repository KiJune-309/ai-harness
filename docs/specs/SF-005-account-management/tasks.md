# SF-005：登录注册与个人账户管理任务清单

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-005             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 关联 Plan | [plan.md](plan.md) |

| ID    | 边界/文件                                                                       | REQ                    | AC                    | 依赖            | 完成标准及验证                                                                                        | 状态 |
| ----- | ------------------------------------------------------------------------------- | ---------------------- | --------------------- | --------------- | ----------------------------------------------------------------------------------------------------- | ---- |
| T-001 | contracts/src/accounts.ts、db/src/accounts.ts、共享store与tests                 | 001、004–006、009、010 | 001、004–007、011–013 | 无              | strict契约；唯一邮箱、会话hash/版本/期限、模型加密记录、单默认事务、memory等价；契约/DB测试与类型通过 | DONE |
| T-002 | api account-service/controller/auth/config/app、tests                           | 001–004、009–011       | 001–006、012、013     | T-001           | 真session授权、scrypt与节流、资料改动及原子撤销；伪header/过期/错误/并发验证；HTTP测试                | DONE |
| T-003 | core/chat-runtime适配器、地址transport与tests                                   | 005、007–009           | 008–010、012、015     | T-001           | OpenAI兼容流与工具经真实Cordis；精确origin+DNS pin+拒redirect+取消限时；受控服务断言协议和防泄密      | DONE |
| T-004 | api AgentService/catalog、ChatService及模型测试callback                         | 005–010、012           | 007–013、015          | T-001、002、003 | scoped目录和路由解析；默认冻结、更新整条取、删除拒绝；旧任务/模板语义不变；受控provider端到端验证     | DONE |
| T-005 | Web account-client/proxy/auth boundary/login/register/account/Workspace、UI规范 | 001–008、011           | 001–012、014、015     | T-001、002、004 | 登录注册资料模型页完整可用、cookie和Origin保护、401卸载；空/加载/失败反馈；390px键盘浏览器验证        | DONE |
| T-006 | tests/session-fixture、现有HTTP测试、PG进程测试、dev/env/AGENTS                 | 003、009、010、012     | 003、009、012–016     | T-001–005       | 无匿名测试后门；真实PG关闭重启仍可执行；真实个人DeepSeek；全量测试/类型/构建/lint/格式/目录检查       | DONE |
| T-007 | spec/plan/tasks/changes及独立评测                                               | 全部                   | 001–016               | T-006           | 逐AC以真实证据验收，修复必改意见，记录最终状态，不以mock取代PG/真实模型                               | DONE |
