# SF-012：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-012     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-18 |

## 记录

### 2026-10-18 — 产品规格草案

- **变更内容：**按sdd-spec读取当前Agent创建与既有SF011验收/UI规范，编写新建三步流程6REQ/8AC，初始化另外三件套。
- **原因：**用户明确希望分步骤填写新建Agent，原完整长表单仍需滚动。
- **边界：**只改createDialog的呈现/导航/校验时机；完整字段、最终现有POST、取消/互斥/Portal与旧内联编辑保持，不扩后端/模型调用。
- **验证：**已只读核对实现，未改生产/测试或执行本轮验收；Plan/Tasks仅模板、Awaiting Spec Approval。
- **结论：**交独立评测代理审Spec，再由root写Plan/Tasks，沿用用户授权，不需人工确认。

### 2026-10-18 — 独立代理规格审查通过

- **依据：**沿用用户已经明确授权的产品经理/评测阶段代理审查，复读现有AgentEditor、15项相关DOM与SF011已验收生命周期，再核对本轮6REQ/8AC；不重复请求人工确认。
- **结论：**批准Spec。三步边界、当前步校验/返回保草稿、前两步Enter/direct submit零创建、最终全schema与跨步挂载后首错、完整确认摘要、失败停末步及pending导航/关闭保护均有可观察预期；继续填写和同账户恢复保当前步并使用当前可用焦点，避免依赖未挂载的nameRef。
- **范围核对：**创建使用原API/契约；方形卡片与已有完整内联编辑/PUT/save-chat保持；未提交草稿不写浏览器持久存储，不自动调用模型。字段默认值与可选性仍沿用现有契约，不因分步而额外要求模型密钥、prompt或开场消息。
- **验证边界：**跨步防御性全量校验可在隔离测试控制验证结果或草稿，不为此增加生产调试入口；mock只证UI状态，最终创建重读仍须真实后端/持久化实证。具体测试分工及调度由下一阶段Plan规定。
- **阶段状态：**Spec为 Approved — Proxy Review Passed，允许root编写Plan/Tasks；本次未填写Plan/Tasks或修改生产/测试，全部AC仍NOT RUN，未提前验收。

### 2026-10-18 — 根编写实施计划与任务

- **变更：**根据已批准Spec填写Plan/Tasks，定义单份draft的3步条件字段、当前步校验/挂载后焦点、独立Next/确认DOM、IME/多行Enter、末步完整摘要、原生命周期和旧编辑兼容。
- **分工：**UI仅改两份Agent生产文件及UI规范；根适配原账户/Agent测试；评测适配独立Dialog回归并补必要防御用例；根统一真实浏览器/持久化与工程验收。
- **状态：**Plan/Tasks为Draft — Awaiting Proxy Review；批准前未修改本轮生产/测试，8AC仍NOT RUN。

### 2026-10-18 — 独立代理Plan/Tasks审查通过

- **依据：**复读已批准Spec与完整Plan/Tasks，依用户既有全部阶段代理授权审查，不再请求人工确认。
- **结论：**批准Plan/Tasks。三任务完整映射6REQ/8AC，单份父级draft和只读步骤指示、当前步错误过滤、独立Next/最终确认DOM与提交守卫、最终全schema及跨步挂载后焦点、当前可用焦点恢复、pending全导航/关闭互斥均有明确实现与验证路径。
- **兼容与证据：**方形卡片、完整内联编辑/PUT/save-chat与现有物理Portal嵌套保持；无新依赖/后端迁移/云调用或持久草稿。根与评测按不同测试文件分工，原生命周期断言保持；最多2项新增防御测试使用隔离schema故障注入，不增加生产后门。受控DOM与真实后端创建重读分别验收。
- **阶段状态：**Plan/Tasks均为 Approved — Proxy Review Passed，可开始实施；任务仍TODO、8AC仍NOT RUN。本次仅修改新feature阶段文件，未改生产/测试或旧已Accepted记录。

### 2026-10-18 — 按批准计划开始实施

- **状态：**Plan/Tasks已代理批准，T001/T002进入IN PROGRESS。UI修改3步生产交互，根与独立评测按不同文件适配原回归；无API/数据库改动。
- **验收：**全部AC仍待本轮实际运行证据，不沿用旧轮次通过结果。

### 2026-10-18 — 实现与分步回归完成

- **T001：**新建分3步，单份草稿/当前步校验/最终完整摘要、明确submitter确认与同步互斥；旧卡片/内联编辑/API不变，UI规范同步。局部type/lint/format/client13项通过。
- **实际修复：**真实IAB步骤切换后字段已卸载触发BaseUI二次focus恢复，原步骤RAF被覆盖，焦点落popup；改为先聚焦常驻stepHeading再切步，之后挂载字段焦点。真实name→prompt→opening及Back复验稳定。
- **T002：**原账户/Agent DOM9项通过 `/tmp/ai-harness-sf012-account-agent.log`；独立创建生命周期原6+新增2共8项通过 `/tmp/ai-harness-sf012-agent-create-acceptance.log`。最终强断言连续两RAF稳定焦点/跨步首错/503恢复，测试在包根tests。首轮测试selector误识摘要section已精确为textbox，不属于生产缺陷。
- **完整回归：**隔离PostgreSQL schema/本地S3运行完整Vitest，146套/2021项PASS，日志 `/tmp/ai-harness-sf012-full-tests.log`；最终焦点强断言更新后独立8项另跑PASS。Web/API typecheck、全仓lint/format退出0，日志同sf012前缀。
- **T003真实浏览器：**桌面1280×720与390×844三步可达、文档无横溢出、5开场/709字符prompt完整摘要可滚动，继续填写保第3步/首开场焦点；导航前零写请求。最终键盘确认仅1次POST201，返回真实ID `e0657827-fd03-4d1d-a795-062aa1f7524e`，刷新列表完整6字段逐项一致，未自动聊天或调用模型/工具。
- **本地证据：**`.local/sf012-ui-report.json`、`.local/sf012-agent-steps-desktop.png`、`.local/sf012-agent-steps-mobile.png`。仅非秘密验收Agent新增，原会话/密钥未修改。
- **状态：**T001/T002 DONE，T003 IN PROGRESS；生产构建和最终独立8AC审核完成后才终验。

### 2026-10-18 — 独立终审通过

- **审查：**复读已批准Spec/Plan与任务、生产步骤/校验/提交/焦点入口，独立执行原6项生命周期适配及新增2项防御测试，全部通过。另直接复核真实浏览器报告和桌面/390px截图、最终全量与类型/构建/lint/format日志。沿用既有阶段代理授权，没有重新请求人工确认或更改旧功能验收档案。
- **真实保存：**主站明确标识的非秘密“SF012 分步验收助手”，最终键盘确认仅一次POST201，ID为`e0657827-fd03-4d1d-a795-062aa1f7524e`。独立核对报告中的名称、简介、modelId、709字符systemPrompt（含原换行）、toolIds和5条openingMessages逐项严格相等；请求、有效响应及刷新重读均一致。前进/返回/摘要前无写入，创建没有启动聊天、模型或工具。此为当前账户真实服务正例，不冒称浏览器合成账户或stub。
- **焦点闭环：**保留真实IAB发现的卸载字段触发BaseUI恢复抢焦点及其修复历史；先聚焦常驻标题再切步，挂载后聚焦当前目标。生产修复经真实浏览器复验；独立8项最终增强Next/Back、跨步首错及恢复继续的两RAF后稳定焦点断言，未由测试代替生产主动聚焦。首轮摘要选择器误匹配仅为测试适配问题，不记为生产缺陷。
- **证据边界：**DOM只控制账户元数据和Agent客户端/一次schema故障，实际Editor、默认组件、键盘/提交事件和AuthBoundary/Portal保持；未加生产调试入口。完整回归实际复用`node .local/sf011-full-check.mjs`，其随机`sf011_full_*` schema与本地S3为隔离测试范围，结束后清理；本轮不存在另一个sf012-full-check文件。原HTTP内存用例与真实PG持久化回归及主站正例分别记录，mock不代替保存证明。
- **工程：**全量实际`pnpm exec vitest run --maxWorkers=2`为146套2021项PASS、无跳过（23:26:32，34.63s）；独立最终8项为23:27:38、8.21s，补强全量启动后更新的焦点断言，无新增生产变动，不重复累加测试数量。原账户/Agent9项、Web/API类型、Web生产构建、全仓lint/format和diff均通过。检查100份API/DB/contracts/runtime生产产物无test/spec suite，Next server无本轮测试标识；测试仍在同级tests。jsdom跨文档导航与上游缺失source-map提示如实保留，未当作真实浏览器导航或失败隐藏。
- **收尾：**主开发者构建后恢复主服务，新的本任务浏览器页正常读取2张真实卡片，新建回第1步并聚焦名称；旧构建停机临时错误页不当作最终页面。未停止DB/S3或改账户密钥。T-001–003全部DONE，AC-001–008全部PASS，最终Accepted，无本轮必需的遗留项。

## 验收矩阵

| 验收标准 | 状态 | 实际证据与结果                                                                                                                                                                                                                                      | 边界与说明                                                                                             |
| -------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| AC-001   | PASS | 独立实际Dialog检查只读“创建步骤”有序列表、无步骤按钮/链接，点击后步标题不会跳步；3组字段条件挂载，前后可达、无重复编辑字段。真实浏览器三步和构建后新建均从基本信息/名称焦点开始，字段完整可填写。                                                   | 旧方形卡片不重复；新开/放弃/成功后下一次新建重置第1步。                                                |
| AC-002   | PASS | 独立DOM空名称Next/Enter/direct submit留本步且零create、首错聚焦；合法前步可继续，不提前要求后步字段。IME composing/keyCode229不推进，prompt Enter保留换行，受控32001字符prompt被本步拒绝；早步submit只导航，末步无明确submitter也零POST。           | 原schema上限/可选性保持，未来未填写的开场不阻止前两步。                                                |
| AC-003   | PASS | 原生命周期适配含5条开场增删/排序，多次Back/Next逐字段核对稳定模型ID、prompt换行、工具与顺序；末步完整摘要包含公开模型名称及全部prompt/开场，修改前步名称后摘要更新而后步数据不丢。真实浏览器导航保留，六字段payload与预期一致，前确认写入0。        | 摘要为完整正文而非计数；导航与查看无模型/创建请求。                                                    |
| AC-004   | PASS | 独立新增用例在最终确认前仅注入一次共享schema的早步名称错误，零create，自动回第1步、真实名称字段挂载/aria-invalid正确并在连续两RAF后仍聚焦；修正后再前进，prompt与5条开场保留，摘要反映修改。                                                        | 隔离验证结果故障注入，不伪称正常用户可直接篡改隐藏草稿，不增加生产调试入口。                           |
| AC-005   | PASS | 最终deferred用例以明确confirm submitter同tick双SubmitEvent只有1次create；字段/Back/确定/取消/X禁用，Esc/遮罩不能关。失败仍在第3步、草稿完整可返回修正重试；有效响应后才关框/用返回ID和名称发布。真实主站唯一POST201，刷新重读同ID和六字段精确一致。 | 原POST只保证UI在途防重复，不扩展成丢响应后的持久exactly-once；主站未自动聊天或调用模型。               |
| AC-006   | PASS | 独立原case在第2步取消继续仍为prompt，在第3步Esc/X/遮罩继续保5条草稿；明确放弃才清理，重开第1步干净。实际AuthBoundary嵌套确认复验/503无浮层、同账号恢复仍为第3步，继续后首开场两RAF稳定聚焦；401清除私有树/两层/草稿。                               | 子Alert属于父Portal与privatehost、无hidden/inert祖先；不同用户/跨标签边界由全量既有实测用例保持。      |
| AC-007   | PASS | 独立已有Agent完整内联编辑脏稿切新建先确认，保留不丢；放弃后新建取消不写旧记录。随后保存调用原PUT且不跳聊天，保存并聊天才按保存ID跳转。原账户/Agent9项通过，方形卡片保单一真实按钮与选择入口，真实主站仍读到原卡片。                                 | 既有编辑不拆成创建步骤，原两类submitter和未保存保护保持。                                              |
| AC-008   | PASS | 直接复核桌面1280与390截图，三步指示/完整滚动正文和固定底部操作可达，390文档宽390。真实Next/Back及继续焦点复验、独立两RAF强断言均通过；全量146/2021、最终独立8/8、原9项DOM、Web/API类型、Web生产构建、lint/format/diff通过，UI规范同步SF012。        | 8项及9项为全量子集，新增强断言另跑不重复计数；测试在tests、产物无suite，真实持久化与mock证据明确分开。 |

## 证据索引

- **独立DOM：**`apps/web/tests/components/agent-create-dialog.test.tsx`，命令`pnpm exec vitest run apps/web/tests/components/agent-create-dialog.test.tsx --maxWorkers=1`，最终`/tmp/ai-harness-sf012-agent-create-acceptance.log`（23:27:38，8/8，含两RAF稳定焦点）。原账户/Agent日志`/tmp/ai-harness-sf012-account-agent.log`为9/9。
- **真实浏览器：**`.local/sf012-ui-report.json`含六字段完整expected/saved、payload/response/reloaded严格相等与唯一POST201；桌面/390截图`.local/sf012-agent-steps-desktop.png`、`.local/sf012-agent-steps-mobile.png`直接复核。POST201实际路由日志在`/tmp/ai-harness-sf011-dev.log`末尾，构建恢复后日志为`/tmp/ai-harness-sf012-dev.log`，最终交付截图为`.local/sf012-agent-steps-final.png`。
- **完整与工程：**`/tmp/ai-harness-sf012-full-tests.log`（146/2021、34.63s），实际复用私有`.local/sf011-full-check.mjs`；`sf012-web-types.log`、`sf012-api-types.log`、`sf012-web-build.log`、`sf012-lint.log`、`sf012-format.log`均同`/tmp/ai-harness-`前缀。本轮无API业务变动，不重复构建未改的API。

## 最终结论

- **结果：**Accepted，8 PASS / 0 FAIL / 0 NOT RUN，三项任务全部完成。
- **边界：**只改变新建呈现/校验时机，既有Agent/卡片/权限/字段契约与接口保持；未提交步骤不持久存储，不自动执行模型。本轮新建明确标识非秘密验收Agent保留供复核。
- **后续行动：**主开发者只做最终全仓格式/差异和交付页面确认；无本轮必需的待开发或待审批事项。
