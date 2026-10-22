# SF-012：任务清单

| 字段 | 值                   |
| ---- | -------------------- |
| ID   | SF-012               |
| 状态 | Completed — Accepted |
| Spec | [spec.md](spec.md)   |
| Plan | [plan.md](plan.md)   |

## 任务概览

| ID    | 任务                         | 关联需求/验收          | 依赖       | 状态 |
| ----- | ---------------------------- | ---------------------- | ---------- | ---- |
| T-001 | 三步创建及原生命周期兼容     | REQ001–006 / AC001–008 | 无         | DONE |
| T-002 | 原DOM回归适配与分步防御验证  | REQ001–006 / AC001–008 | T001接口   | DONE |
| T-003 | 真实验收、工程检查与证据闭环 | REQ001–006 / AC001–008 | T001、T002 | DONE |

## T-001：三步创建及原生命周期兼容

- **文件：**`apps/web/components/agent-editor.tsx`、`agent-editor.styles.ts`、`docs/ui-design-spec.md`；UI代理负责。
- **消费/产出：**消费已批准Spec/Plan、现有单份草稿/schema/Dialog/Portal；产出3步字段、导航、完整摘要和原最终POST可用交互。
- **完成标准：**当前步校验、只确认创建、跨步挂载后焦点、IME/多行Enter、前后保草稿、pending互斥/禁关闭、失败/继续/503保步骤及401清理全部符合；方形卡片与旧内联编辑保持。
- **验证：**适用DOM、Web类型/局部lint/format，T002与T003逐AC覆盖。新增函数多行JSDoc，无新依赖/后端迁移/持久草稿。
- [x] 分组/步骤/导航/摘要完成。
- [x] 共享校验/最终提交/当前步焦点与恢复完成。
- [x] 原生命周期、旧编辑和UI规范同步。

## T-002：原DOM回归适配与分步防御验证

- **文件：**根负责`apps/web/tests/components/account-agent-shadcn.test.tsx`；评测负责`agent-create-dialog.test.tsx`，必要公共fixture只在协调后改。
- **消费/产出：**消费T001步骤交互；产出保持原业务断言的真实DOM回归和最多2项新增有价值的分步防御用例。
- **关联：**REQ001–006、AC001–008。
- **完成标准：**首错/前步Enter与direct submit零POST、草稿/5开场顺序/完整摘要、最终防御跨步错误、pending/失败/成功、脏稿/故障恢复当前步焦点及旧PUT/save-chat验证通过。跨步故障使用隔离schema注入，不改生产增加测试后门。
- **验证：**`pnpm exec vitest run apps/web/tests/components/account-agent-shadcn.test.tsx apps/web/tests/components/agent-create-dialog.test.tsx`及Web typecheck；测试位于同级tests，无秘密或云调用。
- [x] 原3项Agent及其余账户用例继续通过。
- [x] 原6项创建生命周期与新增分步防御通过。

## T-003：真实验收、工程检查与证据闭环

- **文件：**SF012四件套/现有UI规范；临时证据仅`.local`或`/tmp`，不提交秘密。
- **消费/产出：**消费T001实现和T002回归；产出桌面/390px、真实创建重读与完整工程证据，评测逐8AC结论。
- **关联：**REQ001–006、AC001–008。
- **完成标准：**真实最终POST返回ID，刷新重读完整配置一致且不自动聊天；所有视口操作可达；适用相关及完整Vitest、Web/API类型、生产构建、全仓lint/format/diff均通过。根恢复自己启动的dev并保用户会话/既有数据；评测按实际证据标注全部AC。
- **验证：**浏览器实际DOM/键盘/截图及返回配置；隔离PostgreSQL/S3完整测试；`pnpm build:web`、`pnpm lint`、`pnpm format:check`、`git diff --check`。未运行如实记录，不以mock代真保存。
- [x] 浏览器步骤/移动端/真实持久化重读完成。
- [x] 相关与完整回归、类型/构建/格式检查通过。
- [x] 评测8AC证据写入changes并关闭任务。

## 完成证据

- T001：三步条件字段、只读步骤、当前步校验和最终全schema/完整摘要落地；真实浏览器抢焦点缺陷经先聚焦常驻标题再切步修复，旧内联编辑/方形卡片/接口保持，UI规范同步。
- T002：独立原6生命周期适配及新增2防御用例共8项PASS，最终含连续两RAF后稳定焦点/跨步首错/503继续保步；原账户/Agent9项PASS。schema错误仅隔离注入，无生产测试后门。
- T003：真实主站最终一次POST201，刷新重读同ID与名称/简介/模型/prompt/工具/五条开场六字段严格一致；桌面/390可达且无横溢出、未执行模型。全量146套2021项、独立最终8项、类型/Web构建/lint/format/diff及生产无suite核对通过，逐8AC均PASS，详见[独立终审](changes.md)。

## 阻塞项

无；沿用既有阶段代理授权，不需人工确认。

## 完成汇总

- 总任务：3
- 已完成：3
- 进行中：0
- 阻塞：0
- 待办：0

最终[Accepted](changes.md)，无必需遗留项。8项独立与9项原DOM为完整测试总数的子集，不重复累加；最后增强焦点断言的定向证据与全量日志分别保留。
