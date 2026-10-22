# SF-019：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-019     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-20 |

## 记录

### 2026-10-20 — 产品经理提出第五项Skills需求

- **变更内容：**创建私有技能库、不可变版本、Agent精确绑定/快照及两runtime接入规格；初始化Plan/Tasks，未改业务代码。
- **原因：**SF-018已Accepted，现Skill只是当次文本导入，需变成可复用工作方法；边界保持本人私有和既有工具/联络权限。
- **授权：**按用户预授权需求→实现→独立测试轮转，不新增文档审批。
- **关联项：**REQ-001–REQ-010、AC-001–AC-015。
- **验证：**已读取官方Skills、现Agent/Task/普通及协作运行路径，本期功能未实施和测试。
- **结论：**可规划实施；第六项看板在本项独立验收后提出。

### 2026-10-20 — 澄清既有失败修复选择 Agent 与 AC-010 前提

- **变更内容：**Scope 和版本表明确本期不新增既有会话技能升级入口；保留本人在原失败修复中明确重选自己 Agent 时采用完整快照的既有行为。AC-010 改为真实失败后通过既有公开重试选择技能 Agent，再验固定流程联络边界。
- **原因：**协作模板默认助手不自动读取技能库，正常启动不能凭空带入私有技能；需通过真实用户已有操作构造兼有固定节点与技能的合法验收前提。
- **关联项：**REQ-005、REQ-007、REQ-008、AC-010；仍为 10 条 REQ、15 条 AC，无新增功能。
- **验证：**本次只澄清产品文档，不将数据库改写快照当作本人操作，也不在此提前声明独立行为测试通过；实际 provider/权限证据由测试 agent 记录。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                                                                                                   | 备注                                                         |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| AC-001   | PASS | T-CONTRACT验证60/61、500/501、16000/16001、空白/伪owner和内部换行；真实HTTP创建/重放/非法400/摘要无正文。组件同名短码/搜索总数不变/服务失败与空库区分/首错焦点；B-UI实际桌面及390侧栏Sheet、创建v1→v2/稳定详情/历史和刷新通过。                                                                                                            | 保存与查看零模型。                                           |
| AC-002   | PASS | T-PG两pool同requestId并发仅一v1，改参数冲突；同update动作并发仅一v2，重放返回原v2而非当前，旧版新动作409，竞争只一成功。v1全文/完整历史保留，故意action trigger异常后parent/version/action事务回滚且重试成功。组件409保所有稿并明确比较后人工再次提交。                                                                                    | 正式记录和幂等均真实PostgreSQL。                             |
| AC-003   | PASS | 合同拒绝重复含大小写ID/同技能多版/6项/32001；PG/HTTP精确解析、32000合法/32001拒绝。组件实际同名选择顺序2→0→4→1→3、全文/5与6/移除及父级等待仲裁通过；B-UI实际第2步两同名ddb…v1→a783…v4、10291字及最终预览，成功保存Agent497d2cb0…。                                                                                                         | toolIds仍原选择，顺序不隐式重排。                            |
| AC-004   | PASS | HTTP库v2后Agent仍v1，省略refs改名且技能表故障也保旧snapshot；显式refs v2/[]分别升级/清空，新工作按当时保存版。B-UI实际改名仍v1→明确升级v2→最新guard版升级v4且42字正文正确；移除后保存详情读回“未绑定技能”，打开本人Agent空新聊天草稿入口。                                                                                                 | 持久新chat空绑定由独立HTTP覆盖，不把空草稿截图当已创建记录。 |
| AC-005   | PASS | T-HTTP仅refs合法，由API解析完整原正文；伪snapshot/owner/refs正文拒绝400，外人/缺失版本404。真实team owner无法读写A技能/历史/绑定/Agent；同账户home/team同ID不同正文，DB两维检查含已移除scope。真实多poolresolve有序且返回detached快照。                                                                                                    | 团队/项目不授予私有库访问。                                  |
| AC-006   | PASS | 合同旧Agent无skill字段合法；旧Agent/core/chat/Task/模板回归保持prompt/tool/opening/model。真实API无refs创建保持无技能、清空后新工作[]，通用助手不会从有内容的库自动绑定。                                                                                                                                                                  | 旧记录可选字段兼容。                                         |
| AC-007   | PASS | T-HTTP真实loopback provider经普通Cordis：v1聊天、Task及个人模板旧实例在库v2/Agent显式v2后执行仍v1，即使技能版本表缺失仍成功；新chat及新模板实例实际context为v2。两Skill原顺序、字面内容、原prompt/开场/目标保持，旧聊天只有一次opening。                                                                                                   | 运行只用已冻结快照。                                         |
| AC-008   | PASS | A技能Agent先普通聊天，再真实mentions→provider handoff草稿→专用确认形成bound source；协作runtime仍实际带A原v1，B普通开场/Agent/Project/progress/公开catalog无A正文/skillId，接收查看零模型，B本人输入只用B配置/key。T-PROCESS三boot后A bound同session仍v1。                                                                                 | 不复制发起人的私有技能。                                     |
| AC-009   | PASS | 两条实际Cordis路径捕获原样`${...}`/花括号/代码URL，未插值/执行/抓取；原toolIds与prompt保留。真实provider强制返回未授权handoff/reply/artifact，普通分析/确认无可用外联slot、无草稿/目标正文/共享成果；旧API/PG联络持久guard回归。                                                                                                           | Skill方法文本不授予能力。                                    |
| AC-010   | PASS | T-HTTP真实协作模板默认无技能，投毒本人加密route触发真实failed，再通过既有人工retry显式选择本人SkillAgent，workflowOrigin/原source保留且后续冻结v1。普通开始/确认强制tool无slot；明确下游联系才审稿确认写B原chat，B上游补问后A普通确认不答，明确答复草稿绑定原questionId/v1、专用确认投递500QPS。                                           | 如实使用既有失败修复，不声称模板默认带Skills。               |
| AC-011   | PASS | T-HTTP同账号home/team同SkillId分别不同全文，home Agent在team404，team owner无权。移除后旧X-Harness-Context请求409+Changed marker且无正文；重加仍默认home直到明确切换。PG旧team scope Agent list/get/save均拒绝，重加只恢复本人私有记录；组件慢旧route响应aborted且不覆盖新正文，旧AuthBoundary范围回归。                                   | 撤权不转移私有所有权。                                       |
| AC-012   | PASS | T-PROCESS最新built main.js三次真实独立启动+实际loopback provider：v1/v2/旧版本/动作重放/Agent/chat/Task均恢复，旧source继续v1且session不变、新chatv2，恰好2动作/2版本。版本表缺失真实API库/精确读取/绑定503，省略refs保旧snapshot；冻结普通/Task/协作执行仍成功。                                                                          | 无内存降级。                                                 |
| AC-013   | PASS | B-UI真实desktop/390完成创建/历史literal/script文本、dirty同源Sidebar保稿、真实409→全文比较保local→人工保存v4、Agent保v1/升级/移除/顺序新建及当前消息导入文案。最终10249字全文初焦点标题scrollTop0，Tab关闭可见753.7..785.7；Dialog358=scroll358、pre324=scroll324、document390，p/pre/section/li无局部横溢。组件等待防抢交和焦点断言通过。 | 已目视最终顶部/Footer、版本、详情与顺序截图。                |
| AC-014   | PASS | T-CORE实际Cordis两prompt分支和多轮，独立冻结有序Skill context保原完整prompt/历史/既有calculator，仅本人选定工具。T-HTTP普通与协作捕获正确冻结文本；后者普通source转bound和三boot不回最新库。                                                                                                                                               | 已修复多个complete prompt导致运行失败的实际缺陷。            |
| AC-015   | PASS | 统一58files/377tests PASS（86.28s）；最后Web读取仲裁和长文焦点修复后受影响6files/32tests PASS（10.15s），其中新增2条父级deferred回归。最新server、DB/API/Web types、根format/lint和匹配最终三组件的Web生产构建全部exit0；四包lib无测试产物，AGENTS/UI规范同步，15AC均有真实证据。                                                          | 本地受控provider不冒称云模型，第六项此前未实施。             |

## 最终结论

- **结果：**Accepted，AC-001–AC-015全部PASS。统一58文件377项与最后受影响6文件32项增量均通过，独立新增共7文件29项；不重复累加重跑次数。
- **未通过或未执行项：**无。实际发现的运行层、读取竞态与长文焦点缺陷均已修复并保留失败/修复/复验经过。
- **后续行动：**本轮独立验收完成，可按用户授权轮转正式提出第六项看板。

### 2026-10-20 — 独立测试及实际运行缺陷修复

- **独立新增测试：**`packages/contracts/tests/skills.test.ts`2项；`packages/db/tests/skills.integration.test.ts`4项；`packages/core/chat-runtime/tests/skills.spec.ts`2项；`apps/api/tests/skills.integration.test.ts`5项；`apps/api/tests/skills-process.integration.test.ts`1项；`apps/web/tests/components/skills-workspace.test.tsx`8项；`apps/web/tests/components/agent-skills.test.tsx`7项，共7文件29项（含最后补充的2项父级读取竞态回归）。辅助复用SF018隔离HTTP fixture，仅为测试依赖，不进入生产。
- **真实隔离：**所有持久/HTTP/进程数据使用随机独立PostgreSQL schema，真实注册账户/会话/加密个人路由及两pool；调用测试自有loopback OpenAI兼容SSE provider，捕获实际Cordis wire input，不mock runtime结果。私有URL在进程环境构造，未打印秘密或修改用户业务记录。
- **实际发现并修复：**最初给每Skill注册`complete:true`section与原Agent完整systemPrompt冲突，实际Cordis在provider前失败。独立core两case和实际HTTP暴露后改为独立required/literal/order context，保留原完整prompt。修复后普通/协作真正provider均接收原样有序冻结Skill，原工具及prompt不被覆盖。测试没有通过跳过实际run掩盖此缺陷。
- **范围与失败：**技能版本表真实rename验证库/历史/绑定失败503而非空库；真实PG action trigger故障验证同事务回滚。库故障时已冻结普通chat、Task及协作source仍实际provider执行，不回库挑最新版。明确Skill更新动作重放返回当时不可变结果，不随后来版本漂移。
- **固定流程例外：**遵循Spec/PM澄清，模板默认助手不自动带库技能。测试先令本人当前模型加密route无效，使既有节点真实失败，再恢复配置、通过现有公开human retry命令明确选本人SkillAgent；没有向DB注入伪造技能快照。此后原workflowOrigin/source与精确上下游保持，普通确认无能力，真实联络及精确答复仍需草稿/专用确认。
- **执行边界：**受控provider强制发送未授权tool call而非只默认不调用，实际应用拒绝且无外发/共享；它证明实际上下文和能力边界，不评价真实云模型理解质量。三boot是实际编译生产main.js子进程，含真实provider执行，不以内存fake冒充重启。

### 2026-10-20 — 最终独立统一回归

- **T-FINAL命令与结果：**用本地现有依赖执行`node node_modules/vitest/vitest.mjs run --testTimeout=15000`，通过私有环境注入测试数据库URL；下列58文件同次执行，58files/377tests全部PASS，86.28s，无skip。`jsdom`有3条跨文档导航未实现提示，测试与实际Next anchor确认操作全部通过，不将其冒充真实浏览器导航。
- **覆盖文件：**
    - `packages/db/tests/workflow-templates.integration.test.ts`
    - `apps/api/tests/workflow-templates.integration.test.ts`
    - `apps/api/tests/workflow-templates-process.integration.test.ts`
    - `apps/web/tests/components/workflow-templates.test.tsx`
    - `packages/db/tests/workflow-intent.test.ts`
    - `apps/web/tests/lib/workflow-template-client.test.ts`
    - `apps/web/tests/lib/workflow-layout.test.ts`
    - `apps/web/tests/lib/workflow-origin.test.ts`
    - `apps/web/tests/server/workflow-template-proxy.test.ts`
    - `packages/db/tests/accounts-persistence.integration.test.ts`
    - `apps/api/tests/workflow-template-service.test.ts`
    - `packages/db/tests/project-progress.integration.test.ts`
    - `apps/api/tests/project-progress.integration.test.ts`
    - `apps/api/tests/project-progress-process.integration.test.ts`
    - `apps/web/tests/components/project-progress.test.tsx`
    - `apps/web/tests/lib/project-relations.test.ts`
    - `packages/db/tests/team-projects.integration.test.ts`
    - `apps/api/tests/team-projects.integration.test.ts`
    - `apps/api/tests/team-projects-process.integration.test.ts`
    - `apps/web/tests/components/team-projects.test.tsx`
    - `packages/db/tests/workspaces.integration.test.ts`
    - `apps/api/tests/workspace-api.integration.test.ts`
    - `apps/api/tests/workspace-process.integration.test.ts`
    - `apps/web/tests/components/team-workspaces.test.tsx`
    - `apps/web/tests/components/workspace-switch-acceptance.test.tsx`
    - `packages/db/tests/collaboration-persistence.integration.test.ts`
    - `packages/db/tests/collaboration-dispatch.integration.test.ts`
    - `packages/db/tests/collaboration-races.integration.test.ts`
    - `apps/api/tests/project-api.test.ts`
    - `apps/api/tests/template-api.test.ts`
    - `apps/api/tests/template-service.test.ts`
    - `apps/api/tests/template-persistence.integration.test.ts`
    - `apps/api/tests/task-api.test.ts`
    - `apps/api/tests/collaboration-worker.test.ts`
    - `apps/api/tests/collaboration-default-model.test.ts`
    - `apps/web/tests/components/collaboration.test.tsx`
    - `apps/web/tests/components/project-template-shadcn.test.tsx`
    - `packages/contracts/tests/collaboration.test.ts`
    - `packages/db/tests/template-store.spec.ts`
    - `packages/contracts/tests/skills.test.ts`
    - `packages/db/tests/skills.integration.test.ts`
    - `packages/core/chat-runtime/tests/skills.spec.ts`
    - `apps/api/tests/skills.integration.test.ts`
    - `apps/api/tests/skills-process.integration.test.ts`
    - `apps/web/tests/components/skills-workspace.test.tsx`
    - `apps/web/tests/components/agent-skills.test.tsx`
    - `apps/web/tests/lib/skill-client.test.ts`
    - `apps/web/tests/server/skill-proxy.test.ts`
    - `packages/core/chat-runtime/tests/agents.spec.ts`
    - `packages/core/chat-runtime/tests/chat-runtime.spec.ts`
    - `packages/core/chat-runtime/tests/collaboration.spec.ts`
    - `packages/core/chat-runtime/tests/openai-compatible.spec.ts`
    - `apps/api/tests/agent.test.ts`
    - `apps/api/tests/chat-agents.test.ts`
    - `packages/db/tests/agent-store.spec.ts`
    - `packages/db/tests/chat-store.spec.ts`
    - `apps/web/tests/components/agent-create-dialog.test.tsx`
    - `apps/web/tests/components/agent-details.test.tsx`
- **类型与格式：**新增7文件最终ESLint exit0；独立DB/Web类型检查exit0（明确补齐SkillRecord[]测试变量类型），新增文件Prettier通过。API类型检查前次exit0；根完整工程门待最终证据。
- **测试归属：**此轮统一执行时独立新增7文件27项；其余包括实现agent补充的client/BFF与现有Agent、SF004、SF015–018回归，不把同一测试的多次重跑累加计数。此前运行层缺陷失败及修复经过保留，不以最新通过删除发现记录。

### 2026-10-20 — 最后读取竞态缺陷及增量复验

- **发现：**父Agent创建/编辑新增读取等待保护后，独立deferred真实组件测试证明：读取过程中下一步/关闭/保存正确被禁用，但完成精确GET后子picker回填仍被父普通字段busy guard拒绝，导致新建提交`skillRefs:[]`、显式升级仍提交v1。两项测试实际FAIL，未沿用前次58/377成功提前接受。
- **修复：**父级独立`commitSkillRefs`仅接收picker已校验的精确版本结果，不走普通human字段等待拒绝；refs与snapshot同batch提交，同时保留readlock直至finally，期间submit/Escape/关闭/上一步/下一步均不能抢提交旧配置，不存在中间解锁窗口。
- **实际增量命令与结果：**`node node_modules/vitest/vitest.mjs run apps/web/tests/components/agent-skills.test.tsx apps/web/tests/components/skills-workspace.test.tsx apps/web/tests/components/agent-create-dialog.test.tsx apps/web/tests/components/agent-details.test.tsx apps/web/tests/lib/skill-client.test.ts apps/web/tests/server/skill-proxy.test.ts`，6files/32tests全部PASS（12.51s），包含新增2项完整父级创建/编辑deferred用例，最终提交分别带合法v1/v2。该增量针对最后Web改动；此前PG/API/core/三boot统一回归结果保留，不把两次重复测试相加。
- **增量工程：**最终新增测试ESLint exit0、Web types exit0、Prettier通过；主agent最终Web生产副本需同步这一修复后完成构建，实际UI与工程门待下条证据。

- **实际长文焦点修复：**随后真实390浏览器发现只读全文弹层默认聚焦Footer关闭按钮，会在打开时直接滚到底部、跳过标题和正文开头。已对Agent全文、技能历史和最新版本比较设置明确可聚焦标题作为initialFocus；独立组件增加三处实际activeElement断言。最终同一受影响6files/32tests再次全部PASS（10.15s），Web types和测试ESLint exit0；此为已有用例增加断言，不另增测试计数。最终实际浏览器仍须确认打开在顶部、Tab到Footer可达。

### 2026-10-20 — 最终真实浏览器与工程验收

- **B-UI实际范围：**Web验收agent使用测试自有隔离schema/loopback与真实账户操作，desktop库与当前团队显示一致，同名按稳定编号区分；390移动Sheet中Skills位于Agents后，底栏仍5项。真实创建v1/保存v2、历史精确原文及literal `<script>`纯文本、未保存正文点击同源Sidebar可继续保稿/明确放弃；没有以模拟503/409冒充实际并发。
- **实际冲突及版本：**浏览器先编辑已读v2，主agent实际API更新v3，旧提交409保全部输入。显式重读展示服务器v3与本地v2完整正文，保留local并采用基准后仍须再次人工保存，成功v4。Agent先仅改名保存保持旧v1，再显式升级v2；最新等待保护/verified commit版本实际升级v4，保存读回42字本地冲突稿全文。移除保存详情明确未绑定，使用该Agent打开`/?agent=…`空聊天草稿、未发送模型输入；持久创建新chat无Skills由T-HTTP另行验证。
- **实际有序新建与长文：**新Agent第2步依次选择同名ddb…v1与a783…v4，已选2个/10291字，最终确认预览后成功保存Agent`497d2cb0…`，桌面详情处于systemPrompt后、工具前，版本/编号/顺序准确。最终10249字全文打开时标题聚焦、scrollTop0，不再直接跳Footer；Tab关闭后scrollTop12363.5，关闭按钮753.7..785.7在844视口完整可达。Dialog宽358/scroll358、高760/scroll13123，pre宽324/scroll324，document宽390，所有p/pre/section/li无局部横溢。历史/冲突/全文均真实键盘操作。
- **最终截图：**`/private/tmp/sf019-visual/desktop-library-final.jpg`、`mobile-navigation.jpg`、`mobile-history-v1.jpg`、`mobile-conflict-comparison.jpg`、`mobile-agent-frozen-v1.jpg`、`mobile-agent-upgraded-v2.jpg`、`mobile-agent-final-v4.jpg`、`mobile-agent-removed-detail.jpg`、`mobile-removed-empty-chat.jpg`、`mobile-agent-final-preview.jpg`、`desktop-agent-ordered.jpg`、`mobile-longtext-start-final.jpg`、`mobile-longtext-footer-final.jpg`（均同目录）。独立测试agent已实际目视库、导航、冲突比较、v1/v2/v4全文、移除详情/空草稿、顺序和最终长文顶部/Footer；主agent也独立目视最后关键截图。只用最后`*-final`长文截图证明焦点修复通过。
- **最终工程：**最新`node scripts/build-server.mjs` exit0，DB/API/Web类型检查exit0；根`pnpm --config.verify-deps-before-run=false format:check`、`lint`及最后Web types全部exit0（包括最终等待与标题焦点修复）。日志`/private/tmp/sf019-format-check.log`已实际读到全部格式匹配，`/private/tmp/sf019-lint.log`无错误；新增测试最终ESLint/Prettier通过。已扫描`apps/api/lib`、`packages/db/lib`、`packages/contracts/lib`、`packages/core/chat-runtime/lib`，test/spec产物均0；AGENTS技能所有权段和UI规范SF019节已同步读取。
- **最终Web生产：**完整相同源码隔离副本`/private/tmp/ai-harness-sf019-web`，现有依赖、无安装，运行`node /Users/kijune/Documents/code/ai-harness/apps/web/node_modules/next/dist/bin/next build --webpack` exit0；日志`/private/tmp/sf019-web-build.log`实际包含17静态页与`/skills`、`/skills/[id]`等完整路由和traces，BUILD_ID存在。临时副本关闭webpack缓存以避环境路径缓存问题，原项目Next配置未改；已逐字节核对最终`skills-workspace.tsx`、`agent-skills.tsx`、`agent-editor.tsx`与生产副本一致。
- **最终结论：**15项AC全部PASS，状态Accepted。真实模型侧为受控本地OpenAI兼容provider，真实持久/进程/UI分别如实记录，不把多次重跑、空聊天草稿或纯组件几何误算为额外实证。
- **浏览器收尾：**Web验收agent最终确认`desktop-library-final.jpg`已稳定重拍并实际查看、团队归属正确；精确动作/路径/尺寸另存`/private/tmp/sf019-visual/evidence.json`。本测试tab已关闭、viewport已恢复，主agent可正常停止隔离fixture并清理独立schema，不影响原用户服务。
