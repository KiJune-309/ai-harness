# SF-004：任务清单

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-004             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 关联 Plan | [plan.md](plan.md) |

## 任务状态定义

TODO未开始；IN PROGRESS实施中；BLOCKED依赖阻塞（记changes）；DONE完成标准及验证满足。

## 任务概览

| ID    | 任务                | 关联需求/验收                           | 依赖             | 状态 |
| ----- | ------------------- | --------------------------------------- | ---------------- | ---- |
| T-001 | 模板契约及来源顺序  | REQ-001–010 / AC-001–014                | 无               | DONE |
| T-002 | 模板/动作与原子存储 | REQ-001、005–008、010 / AC-001、006–013 | T-001            | DONE |
| T-003 | 模板API与实例生成   | REQ-001–010 / AC-001、004–014           | T-001、T-002接口 | DONE |
| T-004 | 客户端及同源代理    | REQ-001–008、010 / AC-001–007、010–013  | T-001、T-003接口 | DONE |
| T-005 | 模板编辑/预览与导航 | REQ-001–010 / AC-001–007、013–014       | T-001、T-004接口 | DONE |
| T-006 | 真实事务/模型与集成 | REQ-001–010 / AC-001–014                | T-002–005        | DONE |
| T-007 | 独立评测及修复      | REQ-001–010 / AC-001–014                | T-006            | DONE |

## 任务细节

### T-001：契约

**文件/接口：**contracts/src/index.ts、contracts/tests/templates.test.ts。新增Plan模板输入/资源/启动及可选项目origin。**完成标准：**唯一条目、字符总限、版本、UUID、严格公开结构和旧项目兼容。**验证：**契约边界、旧结构与无凭据测试及contracts构建通过。

### T-002：存储

**文件/接口：**db/src/index.ts与db/tests。新增ProjectTemplateStore、StoredTemplate/Launch、TemplateProjectBatch、可识别冲突错误、同pool原子instantiate。**完成标准：**Plan的CAS与PG事务/内存草稿正确，scope/深复制/旧记录不变。**验证：**针对存储测试：后项失败、版本/ID冲突、不覆盖旧记录；T006真实PG故障与重启。

### T-003：API

**文件/接口：**API/src/chat-service.ts、template-controller.ts、app.ts；API/tests/template-service.test.ts、template-api.test.ts。**完成标准：**固定接口、创建/启动原参数、共享锁、版本/Agent检查、重复助手只解析一次、独立快照/开场、普通项目动作冲突及按origin顺序显示。**验证：**服务及真实HTTP：无key、并发/故障/重放后移动和改名、双scope、实际Cordis受控输入隔离及SF002/003回归。

### T-004：客户端与BFF

**文件/接口：**Web/lib/template-client.ts、server/chat-proxy.ts、tests/lib/template-client.test.ts、tests/server/chat-proxy.test.ts。**完成标准：**严格响应、保留UUID/版本、超时/错误/取消、固定路由+Origin/body边界。**验证：**正常/非法/冲突/网络与跨源测试通过。

### T-005：界面

**文件/接口：**Web/app/templates、components/template-workspace.tsx/CSS、workspace/project-workspace、ui-design-spec。**完成标准：**真实列表搜索、完整编辑器增删排序、同版本预览与项目字段、成功跳转、错误保留/显式冲突；来源顺序可读、手机入口与memory提示。**验证：**类型/lint及浏览器字段/顺序/刷新/失败/390px/键盘/真实项目执行。

### T-006：集成

**文件/接口：**API/tests/template-persistence.integration.test.ts及changes证据。**完成标准：**真实PG第二任务写入故障ROLLBACK并同动作重试、独立API重启持久化与memory重启清空、真实DeepSeek多轮及全部工程检查。**验证：**Plan矩阵实测命令/日志/截图，无密钥输出；清理仅本轮临时容器、还原网络/视口覆盖。

### T-007：独立验收

**文件/接口：**四份功能文档及评测指出的实现。**完成标准：**PM范围确认、评测14AC全部有实际证据且无必修缺陷，7任务DONE后Accepted。**验证：**独立源码/测试/日志/截图审查，修复必修意见后针对复验。

## 阻塞项

- 无；全部14AC通过，产品经理及独立评测批准。

## 完成汇总

总任务7；完成7；进行0；阻塞0；待办0。
