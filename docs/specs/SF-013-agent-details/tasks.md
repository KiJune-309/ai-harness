# SF-013：任务清单

| 字段 | 值                   |
| ---- | -------------------- |
| ID   | SF-013               |
| 状态 | Completed — Accepted |
| Spec | [spec.md](spec.md)   |
| Plan | [plan.md](plan.md)   |

## 任务概览

| ID    | 任务                        | 需求/验收              | 依赖       | 状态 |
| ----- | --------------------------- | ---------------------- | ---------- | ---- |
| T-001 | 独立详情路由与可读/编辑交互 | REQ001–006 / AC001–007 | 无         | DONE |
| T-002 | 详情与原创建DOM验证         | REQ001–006 / AC001–008 | T001接口   | DONE |
| T-003 | 浏览器真实读写、工程与终验  | REQ001–006 / AC001–008 | T001、T002 | DONE |

## T-001：独立详情路由与可读/编辑交互

- **文件/分工：**UI仅`apps/web/components/agent-editor.tsx`、`agent-editor.styles.ts`、`docs/ui-design-spec.md`；根新增`apps/web/app/agents/[id]/page.tsx`、更新列表page说明及workspace导航活跃判定。
- **消费/产出：**已批准Spec/Plan、既有Agent客户端/schema/三步/私有Portal→真实Link与稳定按ID详情、默认完整只读、显式完整编辑/保存/返回保护。
- **完成标准：**IDkey隔离/abort忽略/返回ID验证，404/故障无fallback可重试返回；默认完整纯文本/公开名/时间、无输入；保存有效成功才更新只读及可用焦点，失败保草稿，dirty取消/返回确认、pending全guard；创建最终成功去真实ID无自动聊。新route及嵌套导航可用，函数多行JSDoc，无新后端/依赖。
- **验证：**T002实际DOM、Webtypecheck/局部lintformat及T003浏览器/构建覆盖。
- [x] route/卡片Link/导航/独立GET与错误态完成。
- [x] 详情只读/编辑/保存/草稿确认与原三步兼容完成。
- [x] UI规范标注新需求替代旧呈现。

## T-002：详情与原创建DOM验证

- **文件/分工：**根`apps/web/tests/components/account-agent-shadcn.test.tsx`；评测`agent-create-dialog.test.tsx`及新`agent-details.test.tsx`（最多5个必要新增case）；不改对方文件。
- **消费/产出：**T001接口→适配原9项账户/Agent与8项向导，补按ID/只读/完整数据、404retry/错ID/迟到响应及详情授权/编辑失败等真实DOM证据。
- **完成标准：**不删原校验/互斥/草稿/503/401等有效断言；仅旧内联选择及创建选中要求按本Spec替换。detail无list、未保存不假显示、取消/返回/更新失效的焦点正确、A迟到不盖B、401清私有层，模型不调用。
- **验证：**三份DOM与原agent-client13项定向Vitest、Webtypecheck；mock权限与真实API证据明确分开，不加测试后门。
- [x] 原两份DOM适配且保有效断言。
- [x] 新详情边界与独立授权恢复验证通过。

## T-003：浏览器真实读写、工程与终验

- **文件：**SF013四件套，临时截图/安全报告`.local`或`/tmp`，无秘密记录。
- **消费/产出：**T001/T002→真实点击/直接URL/刷新、完整六字段保存重读、三步成功真实ID详情、桌面/390px及工程证据；评测8AC最终状态。
- **完成标准：**真实GET/PUT与必要明确标识非秘密验收Agent创建成功并刷新同ID，零自动模型；方卡/详情/编辑/长prompt/5开场可达无核心横溢出；相关及全量Vitest、Web/API类型、Web生产构建、全仓lintformatdiff通过。恢复根的dev服务并保护现有数据/会话，任务/验收与事实一致。
- **验证：**实际浏览器/网络受限观测、隔离schema与S3完整测试；`pnpm build:web`、`pnpm lint`、`pnpm format:check`、`git diff --check`，生产产物不含suite。未跑如实记录，不冒称跨账户真实已测。
- [x] 浏览器桌面/390px、真实创建/保存/刷新重读完成。
- [x] 适用回归、类型/生产构建/lintformatdiff通过。
- [x] 独立8AC记录并关闭任务。

## 阻塞项

无，沿用用户既有阶段代理授权。

## 完成汇总

- 总任务：3
- 已完成：3
- 进行中：0
- 阻塞：0
- 待办：0
