# SF-021：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-021     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-22 |

## 记录

### 2026-10-22 — 项目含义重新澄清与需求草案

- **变更内容：**用户纠正项目为个人文件夹，明确侧栏直接列各项目、展开所属普通对话、右侧复用现有 Session；全部对话仍包含项目内对话。首版创建项目及项目内新对话，移动已有对话后续再做。
- **资料确认：**用户指定项目聊天最右上角资料图标，打开本项目资料列表并能上传；随后明确 Agent 可根据当前问题主动查阅本项目资料。
- **删除授权：**用户在旧项目功能去留问题中回答“直接删除，以前的数据也不用保存了”；针对关联聊天和资料的独立范围问题，进一步回答“一并删除，旧项目相关内容全部不要了”。本授权限于有真实旧项目关联的数据，不是整库或全部普通会话/资料清空。
- **只读发现：**当前普通 ChatConversation 和 KnowledgeDocument 无项目归属，旧项目详情只聚合 Task；部分个人项目是协作兼容壳。现有资料工具尚未接入聊天，向量调用仅独立调试。需提供真实、受当前项目约束的 runtime 查阅能力。
- **关联项：**REQ-001–014、AC-001–012。
- **验证：**本轮仅检查仓库现状与需求追踪；未修改业务代码、未执行数据库/对象存储清理，全部功能验收 NOT RUN。
- **结论：**Spec 为 Draft — Awaiting User Review；Plan/Tasks 只初始化等待状态，未编写方案或实施任务。

### 2026-10-22 — 需求独立复核

- **发现与修订：**旧项目并非只从项目页面创建，Agent 交接及个人/流程模板中也有兼容创建路径。补充 REQ-011 与 AC-010：清理后这些入口不得再生成旧项目或兼容壳；同时明确无旧项目归属的模板定义不因本轮清理而删除。
- **内容层清理：**同轮复核补充真实消息、Cordis journal、资料内容副本与业务快照的删除验收；单纯隐藏或拒绝访问不能通过，仍被无关对象合法引用的资源必须保留，并阻止迟到执行写回旧内容。
- **验证：**需求交叉检查完成，四文档格式检查通过；业务实现与全部 AC 仍 NOT RUN。
- **结论：**仍为需求草案，等待用户审阅，不开始方案或清理。

### 2026-10-22 — 用户确认并授权完整执行

- 用户在需求稿呈交后明确“开始执行”，据此确认 Spec 并授权本轮完整实施；此前旧项目及关联内容的删除授权延续，不重复请求阶段确认。
- 补齐 Plan/Tasks，并行实施文件夹数据、Web 和旧项目清理，主 agent 负责普通聊天、API、资料 runtime 与集成。

### 2026-10-22 — 实施与实际验证完成

- **个人文件夹：**新增独立 PostgreSQL 文件夹记录；侧栏直接显示各文件夹，展开所属普通对话，项目内和“全部对话”指向同一会话。创建及首条输入持久幂等，关系由独立列固定，后台旧快照不能移动聊天。全局新对话默认无项目，尚未提交的项目草稿不创建聊天。
- **项目资料：**真实私有上传及解析状态，SQL 按本人、当前 Workspace 和项目过滤。提供分页文件列表、分页搜索和完整分片读取，资料来源链接到原文精确分片。模型不能通过额外参数选择用户、空间、项目或任意 URL。无项目聊天不注册资料能力。
- **运行边界：**普通 Cordis AgentLoop 和 durable CollaborationRuntime 均执行实际 provider 原生工具循环。含 humanLoop port 时资料读工具不进入审核/等待、不产生外发。资料只是非指令参考，不能授予其他能力。发现系统提示 complete 冲突和工具额外参数未执行验证后均已修复，并有真实 runtime 回归。
- **旧功能：**旧项目页面返回 notFound；旧项目创建、成员/进度/资料发布、任务归组及会再生旧项目的交接/模板启动路径返回明确 410。无旧项目归属的模板定义继续保留和编辑。
- **旧数据：**初始化事务按旧私人/协作项目、Task 当前/初始归属、精确节点/source 绑定删除相关聊天、journal、聚合资料/历史、授权、通知、动作和待执行工作；持久墓碑拒绝迟到写回。开发热重载自动应用 v1 后，增加独立 v2 补偿动作账本清理，覆盖已删除对象的历史 action 引用；没有伪装成新文件夹。
- **物理资料范围：**查证旧项目资料保存在 aggregate note/artifact，历史上传文档没有旧项目关联字段或绑定；因此不存在按项目判定应删的旧 S3/向量对象。保留无关知识库原件、分片和向量，不能以同名文件或所有者推断删除。
- **文档：**已同步 AGENTS.md 与 docs/ui-design-spec.md 的项目所有权、侧栏和资料读取边界，明确旧项目规范被本期替代。

## 验证执行记录

| 检查                                                              | 最终结果                 | 实际范围与边界                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15 个 contracts/db/API/core 相关文件                              | PASS，59 tests，退出 0   | 真实本地 PostgreSQL 随机隔离 schema、实际 HTTP 授权/解析、原生 Cordis 工具循环、durable replay；`vitest run --testTimeout=30000`。首次默认 5 秒预算有一项 PG 初始化并发测试超时，保持实现和断言不变后重跑同集合全部通过。                    |
| 12 个 Web 相关文件                                                | PASS，124 tests，退出 0  | 项目/资料组件、聊天首条提交及切换/重试、客户端、知识代理和旧入口回归。组件测 390px/1280px 的 Escape 焦点返回、资料切项目、来源分页定位。                                                                                                     |
| durable 与人工审核交界组合                                        | PASS，4 files / 33 tests | project-knowledge-durable、project-knowledge、human-loop、collaboration；真实 list/search/read，3 组 tool call/result 持久入 journal，重建 runtime 零 provider 重复，零 wait/beginEffect/finishEffect/外发。与 59 tests 有重叠，不累加总数。 |
| `pnpm format:check && pnpm lint`                                  | PASS，退出 0             | 根工作区全部文件。此前并行修改导致临时格式及人工审核源码问题，最终检查已通过。                                                                                                                                                               |
| `pnpm typecheck:api && pnpm typecheck:core && pnpm typecheck:web` | PASS，退出 0             | 最终源码与稳定生成目录。此前 Web 与 Next 构建并行产生 TS6053 生成文件竞争；停止竞争后原检查通过。                                                                                                                                            |
| `pnpm build:web && node scripts/build-server.mjs`                 | PASS，退出 0             | Next.js 生产构建、17 个静态页面、API/core/contracts 服务端构建；生产输出不含 tests。                                                                                                                                                         |
| 实际浏览器上传及模型回答                                          | PASS                     | IAB 中创建“项目功能验收”，真实上传 MD 至私有对象存储并处理 ready；向当前真实模型询问发布暗号，回答水杉742并返回准确文件/项目/chunk=1 来源，点击得到一致正文。HTTP 集成测试的对象端口为显式 fake，真实 S3 结论来自本项浏览器及原件 SHA 校验。 |
| 完整进程重启及资料回读                                            | PASS                     | 最终检查曾发现 Next 开发服务无响应，重启 Web/API 后重新打开同一项目、同一聊天和 ready 文件，消息、项目归属、来源正文均恢复。开发服务沿用既有私有配置，无新建凭据。                                                                           |
| 桌面及 390px 浏览器                                               | PASS                     | 项目在全部对话上方；聊天右上角资料按钮；资料 Sheet 可上传/查看。桌面及手机 Escape 均返回“打开项目资料”；手机聊天/来源 scrollWidth=390，准确聚焦 chunk-1，无向量配置/调试卡干扰来源页。视口检查后已恢复默认。                                 |

### 相关测试文件

- contracts：`project-folders.test.ts`、`knowledge.test.ts`。
- db：`project-folders.integration.test.ts`、`project-conversations.integration.test.ts`、`legacy-project-cleanup.integration.test.ts`、`knowledge-acceptance.integration.test.ts`、`knowledge-variable-chunks.integration.test.ts`、`knowledge-variable-chunks.test.ts`。
- API：`project-folders.integration.test.ts`、`legacy-project-policy.test.ts`、`project-material-pagination.integration.test.ts`。
- core/chat-runtime：`project-knowledge.spec.ts`、`project-knowledge-durable.spec.ts`、`chat-runtime.spec.ts`、`agents.spec.ts`。
- Web 关键证据：`tests/components/project-folders.test.tsx`、`workspace-new-chat.test.tsx`、`library-shadcn-acceptance.test.tsx`，以及 knowledge/chat 客户端及代理回归。

### 浏览器取证

- 桌面聊天与来源回答：`/private/tmp/sf021-project-chat-desktop.png`。
- 最终桌面资料列表：`/private/tmp/sf021-project-files-desktop-final.png`。
- 最终手机资料列表：`/private/tmp/sf021-project-files-mobile-final.png`。
- 最终手机来源正文：`/private/tmp/sf021-project-source-mobile-final.png`。
- 以上为验收时实际截图，含本次自建测试文件夹；图片不包含密钥。

## 验收矩阵

| 验收标准 | 状态 | 证据                                                                          | 实际结果及限制                                                                                                                                                   |
| -------- | ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001   | PASS | contracts/folder PG + project-folders 组件，实际浏览器创建                    | A/B 私有归属、空名拒绝、失败保稿/幂等；直接列文件夹且无旧入口，不创建模型/Task/消息。                                                                            |
| AC-002   | PASS | conversation PG、workspace-new-chat，浏览器项目内首条输入                     | 归属 A 的普通聊天；未发送草稿无主记录。                                                                                                                          |
| AC-003   | PASS | workspace 两入口/发送回归、真实聊天                                           | 两入口同一 ID、消息/Agent/生成状态；复用原停止和重试输入器，无项目进度面板。                                                                                     |
| AC-004   | PASS | workspace 异步切换/失败重试、conversation PG 并发快照                         | A/B 及全局新对话不串写，关系不被旧快照覆盖；同 requestId 不重复首条创建，冲突拒绝。                                                                              |
| AC-005   | PASS | project-folders 组件资料切换，桌面/手机资料按钮                               | 空白项目聊天和已发送聊天都有右上角资料入口；key/scope 清空前项目投影，真实空/加载/失败。                                                                         |
| AC-006   | PASS | knowledge contracts/PG/HTTP、实际 S3 上传/ready、重启回读                     | 原件私有保存、项目关联持久；跨项目重放拒绝，重试不重复；解析受限，无文件代码/外链执行。                                                                          |
| AC-007   | PASS | HTTP 实际 parser + Cordis；浏览器真实当前模型及来源点击                       | 回答使用仅在 A 正文中的事实；B 同名及无项目资料排除；文件来源与精确分片可打开。                                                                                  |
| AC-008   | PASS | project-material-pagination PG/HTTP，project-knowledge 普通/durable           | queued/failed 明示、无匹配真实；额外 user/project 参数在执行前拒绝，资料读取零审核等待/外发，越界读取拒绝。                                                      |
| AC-009   | PASS | folder/conversation/knowledge PG 及 HTTP 授权/撤权测试                        | 真实用户+Workspace+folder 全范围 SQL 过滤，模型端口固定当前会话归属；跨范围 ID 拒绝。                                                                            |
| AC-010   | PASS | legacy 清理真实 PG 2 tests、policy HTTP 13 旧路由、实际迁移标记与零旧项目计数 | v1/v2 幂等补偿、正文/journal/业务快照及旧授权实际清除，迟到写入拒绝，无关/同 UUID 不同用户保留。旧项目无上传对象关联，保留未关联知识库，不虚报删除不存在的对象。 |
| AC-011   | PASS | PG/API 关闭重开、durable 重建重放、最终完整进程重启浏览器                     | 同一项目/聊天/资料及来源恢复；DB 故障抛出失败，不降级内存或样例。                                                                                                |
| AC-012   | PASS | 390px/桌面组件和实际浏览器，UI/AGENTS 同步                                    | 名称/图标可达，Sheet Escape 焦点准确返回，来源聚焦正确，无页面横向溢出。                                                                                         |

## 最终结论

- **结果：Accepted。**14 个 Must 需求均有任务映射，AC-001–012 全部 PASS，T-001–005 DONE。
- **范围：**已有对话移动、新文件夹删除/归档、团队项目和看板不在本版范围；旧依赖启动明确不可用，不假装成功。
- **验收数据收尾：**首次自动审批因缺少针对新建验收数据的明确删除授权而拒绝，未执行删除；用户随后明确回答“删除本次验收数据”，按精确清单继续清理。最终清理及独立复核已通过：删除验收文件夹 1、聊天 1、document 1、source/journal 1、分片 1（级联）及精确私有原件 1；任务 0。全部目标剩余 0，原件 HEAD 404；18 张表的全部无关记录指纹与审计基线一致。

### 2026-10-22 — 最终开发库复核

- `sf021-project-folders` 与 `sf021-project-action-cleanup` 两个持久迁移标记齐全；旧私人项目与旧协作项目均为 0。
- 当前开发库仍有 43 段无关聊天（跨账户总数，非当前用户聊天数），验收清理未改这些记录。当前账户原有两段无项目聊天仍在列表。
- 本次自建“项目功能验收”、唯一测试对话和测试文件均已按用户的独立明确授权永久清理，未保留演示项目或对象原件。截图只作为验收时效果证明。
