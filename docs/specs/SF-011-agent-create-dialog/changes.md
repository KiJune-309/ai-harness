# SF-011：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-011     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-18 |

## 记录

### 2026-10-18 — 产品规格草案

- **变更内容：**按 sdd-spec 阅读AGENTS、现有Agent编辑/创建客户端/共享契约及UI规范，建立“新建Agent打开Dialog并真实保存”的6REQ/9AC规格及四件套。
- **原因：**用户明确要求弹窗确认创建；当前默认内联表单且null选择比较会令首次新建入口无效。
- **关联项：**REQ-001–006、AC-001–009。
- **边界：**保留完整配置/已有编辑、默认组件及私有Portal；只同步在途UI防重复，不新增后端幂等协议或自动模型调用。
- **验证：**已只读核对现有实现，尚未改生产/测试或执行本轮验收。Plan/Tasks仅模板、Awaiting Spec Approval。
- **结论：**交独立评测代理审Spec，再由主开发者编写Plan/Tasks；沿用用户已有代理授权，无需人工确认。

### 2026-10-18 — 独立代理规格审查通过

- **依据：**用户已明确授权产品经理与评测代理代为后续 SDD 阶段评审，本次由独立评测按该授权审核，不再请求人工确认。
- **审查范围：**只读核对现有 AgentEditor、创建/更新客户端、共享契约、API 保存与权限边界、已有 Agent DOM/客户端用例；逐项核对6项REQ和9项AC可验证且相互对应。
- **结论：**批准 Spec。初始不显示内联新建、独立 Dialog 完整配置、有效响应后才关闭与选中真实ID、失败草稿及首错、同步在途互斥与所有关闭路径、脏草稿/既有编辑保护、默认组件及私有 Portal/390px均有可观察预期。取消并明确放弃后重开干净、已有编辑两类保存保持，不需新增后端协议。
- **限制：**现有POST没有持久幂等契约，规格准确限定UI在途防重复，不承诺丢失响应后重试exactly-once；真实持久化必须另有隔离API/PG证据，DOM mock不得替代。
- **阶段状态：**Spec为 Approved — Proxy Review Passed；允许主开发者编写Plan/Tasks。Plan/Tasks本次仍未填写，尚未批准实施；AC-001–009保持NOT RUN，没有提前承认产品验收通过。

### 2026-10-18 — 主开发者编写Plan/Tasks

- 根据已批准Spec制定独立创建状态、单份Editor、默认Dialog/AlertDialog、原POST/PUT复用、同步互斥/失败草稿/取消焦点与私有边界方案。
- 三项任务覆盖6REQ/9AC，生产UI与既有/独立测试文件分工不交叉；真实PG浏览器重读、桌面/390px和工程实证与mock分开。
- Plan/Tasks为Draft — Awaiting Proxy Review，尚未修改本轮生产代码；交独立评测按用户已有代理授权审查。

### 2026-10-18 — 独立代理Plan/Tasks审查通过

- **依据：**复读已批准Spec及本轮四件套，依用户既有代理阶段授权审查方案与三任务覆盖，不再请求人工确认。
- **结论：**批准Plan/Tasks；三任务覆盖6REQ/9AC且保持依赖方向、原创建/更新协议及秘密边界。独立创建状态解决初始null入口，单份字段避免重复ID，提交ref及受控关闭防在途并发，失败/脏稿/原编辑和私有Portal恢复可逐项验证，无需生产共享组件或后端迁移。
- **验证分工：**主开发者适配原Agent DOM及真实后端/PG浏览器重读；独立评测仅在独立测试文件补生命周期/实际授权边界。延迟mock只证明UI状态，不替代真实持久化；长表单与390px由真实浏览器观察。旧数据/凭据不重写，无云模型调用。
- **阶段状态：**Plan和Tasks均为 Approved — Proxy Review Passed，允许实施。三任务仍TODO，全部9AC仍NOT RUN，尚未进行产品终验。

### 2026-10-18 — 开始实施

- Plan/Tasks已由独立代理批准，T001/T002置IN PROGRESS。UI代理只改AgentEditor/布局/UI规范；根适配原Agent DOM用例，评测新增独立创建/私有边界测试；文件不交叉。
- 复用现有创建客户端/持久接口，不改API/数据库/共享Dialog，不执行模型。实际结果待验证，9AC仍NOT RUN。

### 2026-10-18 — 实现完成与独立缺陷修复

- T001/T002完成，T003验证中。初始空态/真实列表不挂创建字段，新建打开单份完整表单和预览；受控默认Dialog固定标题和确认底部、中间滚动。同步saving ref防重复及全部关闭路径，创建有效返回才选真实ID/关框；原PUT/save-chat保持。
- 独立真实Editor/AuthBoundary DOM测试发现：创建与放弃确认同时恢复时，即使React Root/Content嵌套，账户容器中的物理兄弟Portal仍被BaseUI markOthers互相隐藏。按实际库源码，仅在本Agent的创建确认用PrivatePortalProvider把子Portal挂父Portal真实后代，并继承外层paused/空容器规则，不改共享组件或授权范围。恢复后确认层可访问/聚焦、属于父Portal和privatehost且无hidden/inert祖先。
- 随后修复继续填写的焦点回退到旧恢复按钮：创建确认明确回名称，放弃回新建入口，原编辑焦点规则保持。独立6项最终全部PASS；保留先失败后修复记录，不放宽断言。原9项账户/Agent DOM也PASS，测试均在包根tests。
- 浏览器：空首屏名称字段0；明确新建打开Dialog，唯一名称字段1/初始焦点及无效首错均为名称。配置960字符prompt、计算器与5条有序开场，在390px窗口内popup左右16px、正文scrollHeight3973/clientHeight595，确认始终可见且pageWidth390；取消→继续保完整草稿、聚焦名称，私有Portal外溢0。
- 真实确认发出一次POST `/api/chat/agents` 得201；成功关闭Dialog、已保存数0→1、选中返回真实ID且仍在/agents。刷新后首屏仍无创建字段，选择该验收Agent重读，同一ID、模型/960字符prompt/工具/5条排序均保持。未点击开始对话/使用Agent或测试模型连接，既有记录/密钥未改。此正例是主服务真实PG保存，不冒称浏览器stub隔离；其余PG回归另用独立schema。
- 最终全量145套2015项PASS、无skip（32.76s），含本轮6独立及原9项DOM；Web/API类型与全仓lint/format通过。Web生产构建进行中，逐9AC尚待独立终审。changes元状态同步为Verifying，先前阶段批准历史保留。
- 私有证据：`.local/sf011-created-agent.json`、`sf011-agent-reloaded.json`和桌面/390截图；日志 `/tmp/ai-harness-sf011-agent-create-acceptance.log`、`full-tests.log`、`types.log`、`api-types.log`、`lint.log`、`format.log`（均同SF011前缀）。

### 2026-10-18 — 工程收尾与终审交接

- Web生产构建exit0，原17个页面/代理路由产物正常；已恢复主Web/API服务，DB/S3未停。最终重新进入真实Agent页面、选已有记录后新建，干净默认草稿/唯一字段/名称焦点正确，创建内无旧Agent聊天入口，1280px无横溢出且控制台错误0。
- 浏览器/创建重读与工程报告已汇总`.local/sf011-ui-report.json`，最终截图`sf011-agent-dialog-final.png`，Web构建日志`/tmp/ai-harness-sf011-web-build.log`。原由Next自动切换的next-env导入恢复原生成状态，差异检查通过。
- 正式交独立评测逐9AC审核及更新最终状态/Tasks；root不提前宣布Accepted。终审文档修改后再全仓格式/差异检查，无新增源码或测试变动则不重复已通过全量。

### 2026-10-18 — 独立终审通过

- **依据与范围：**复读已批准Spec/Plan及任务、实现与阶段记录；独立执行的6项真实Editor/AuthBoundary/默认组件DOM用例全部通过，并直接复核主开发者真实浏览器报告、创建与重读结果、390px/创建完成/最终桌面截图以及工程日志。沿用用户既有阶段代理授权，不再请求人工确认。
- **实际创建证据：**主站明确标识的非秘密“SF011 弹窗验收助手”经真实同源POST返回201，列表由0变1、关闭Dialog并选中真实ID；刷新重新读取仍为同一ID、模型、960字符prompt、计算器和五条有序开场。构建后重读的prompt与原始非秘密字面量严格相等，报告仅保存比较布尔值。该记录保留供复核，属于当前账户真实服务正例，不是合成账户或浏览器stub。主站未执行聊天、工具或模型连接测试。
- **隔离与测试证据：**新6项DOM只控制账户元数据与Agent客户端结果，保留真实AuthBoundary/Portal/事件；HTTP控制器单测的内存fake与真实PG回归分别核对。全量由私有launcher在随机`sf011_full_*` schema与本地S3测试范围执行，结束清理该schema；其中账户持久化集成测试实际创建Agent，重启API后GET完整对象相等。不能把DOM mock或HTTP内存用例称为真实持久化。
- **缺陷闭环：**保留先失败后修复历史；最终同一独立用例确认嵌套Alert在父Portal与账户边界内、复验/故障期间无浮层、恢复可访问且焦点在最高层，继续填写后焦点回父名称、草稿保留，401清除全部私有层。没有放宽断言或更改共享组件。
- **工程核对：**实际全量`pnpm exec vitest run --maxWorkers=2`为145套2015项PASS、0跳过；新6项与原9项账户/Agent DOM均是其中子集，不重复累加。Web/API类型、Web生产构建、lint/format及差异检查通过；检查100份API/DB/contracts/runtime生产产物无test/spec suite，Next server无新增测试标识，测试仍在包根tests。现有jsdom跨文档导航和上游缺失source-map提示不影响测试结果，也不作为真实浏览器跳转证据。
- **裁决：**AC-001–009全部PASS，T-001–003全部DONE，最终Accepted；未发现本轮必需的遗留或未执行项。

## 验收矩阵

| 验收标准 | 状态 | 实际证据与结果                                                                                                                                                                                                                                                                | 边界与说明                                                                                                              |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AC-001   | PASS | 独立DOM从空态显式新建、空取消/重开，及已有记录编辑后新建均可达；真实主站初始名称字段0、打开后1且聚焦名称，保存/刷新/选已有再新建仍为干净默认表单。见UI报告与独立6项日志。                                                                                                     | 不默认挂内联新建；已有记录仍可内联编辑，没有null入口提前返回。                                                          |
| AC-002   | PASS | 独立真实Input/NativeSelect/Checkbox、开场增删/排序及完整prompt输入，断言载荷中稳定modelId、toolIds、原换行与开场顺序正确、字段唯一且无key输入。真实浏览器填写960字符prompt/计算器/5开场并排序；重读模型与顺序一致，构建后原prompt严格相等比较为true。                         | 原共享校验和目录复用；精确比较只回布尔值，完整字段保留另有DOM载荷及真实PG完整对象回归佐证。                             |
| AC-003   | PASS | 实读主站日志最后一次`POST /api/chat/agents`返回201；创建后Dialog为0、已保存0→1、选中真实ID `c8114ff4-d433-4feb-889b-d3dad2f34fe6`，刷新重读ID与配置一致。独立PG/API持久化回归另在随机schema创建Agent并重启API后GET完整相等。                                                  | 主站正例不是隔离stub；延迟DOM另证响应前无乐观条目/数量，确认创建不跳聊天或执行模型。                                    |
| AC-004   | PASS | 独立DOM先提交空名称，再填合法名称但添加空开场，均零create调用，aria-invalid/关联错误正确，焦点分别在Dialog内名称和开场。真实浏览器首错焦点也为agent-name。                                                                                                                    | 单一字段实例，未聚焦背景编辑器；错误后可继续修正。                                                                      |
| AC-005   | PASS | 独立deferred创建，同tick连续submit只调用一次；确认/字段/取消/X禁用，Esc/遮罩不能关闭，响应前0条目。受控失败完整名称/简介/模型/prompt/工具/排序保持；再次确定成功返回后才关框、用返回名称与ID合并并选中。                                                                      | 这是UI在途互斥，不扩展为现有POST没有提供的丢响应后exactly-once保证。                                                    |
| AC-006   | PASS | 独立DOM空取消零POST并回新建入口；同一完整脏稿逐次取消/Esc/X/遮罩均先确认，继续后全部字段保留；明确放弃才关两层、回入口、重开默认干净。真实390px取消→继续保草稿，名称聚焦且无私有Portal外溢。                                                                                  | 创建失败后仍保留脏稿；关闭动画不产生第二份字段或残留可操作遮罩。                                                        |
| AC-007   | PASS | 独立已有Agent编辑改名→新建先确认，继续保编辑；明确放弃后新建再取消不调用create/update，原记录仍原名。随后保存调用原PUT且不跳转，保存并聊天才跳该保存ID。原三条Agent DOM经新入口适配，所在9项套件全部通过。                                                                    | 既有编辑和两类submitter语义保持，不以创建确认启动聊天。                                                                 |
| AC-008   | PASS | 真实390px窗口popup左右各16px、正文3973/595可纵滚，五条开场/确认取消可达，pageWidth390；804/1280桌面正常、最终consoleErrors0。独立实际AuthBoundary下创建+确认等待/503均无Portal，同账户恢复草稿/最高层焦点、继续回名称，401卸载两层；全量原边界用例另覆盖不同用户/跨标签失效。 | 子Alert物理包含于父DialogPortal且均在privatehost，无hidden/inert祖先；账户失败由受控DOM元数据验证，未撤销主站用户会话。 |
| AC-009   | PASS | 最终全量145套2015项/0跳过（32.76s），包含独立6项及原账户/Agent9项；Web/API类型、Web生产构建、全仓lint/format和diff通过。UI规范已同步SF011、保留SF010及composer局部例外；生产产物无suite，测试在同级tests。                                                                    | 原Agent客户端/HTTP权限/独立PG持久化与聊天回归沿用全量；没有新增后端协议/依赖/云调用。                                   |

## 证据索引

- 独立6项：`apps/web/tests/components/agent-create-dialog.test.tsx`，实际命令`pnpm exec vitest run apps/web/tests/components/agent-create-dialog.test.tsx --maxWorkers=1`，最终日志`/tmp/ai-harness-sf011-agent-create-acceptance.log`（22:32:02）。物理Portal故障回归/安全诊断保留于`sf011-agent-create-recovery-regression.log`及`sf011-agent-create-recovery-diagnostic.log`（同`/tmp/ai-harness-`前缀），仅作为修复前历史。
- 真实浏览器：`.local/sf011-ui-report.json`、`.local/sf011-created-agent.json`、`.local/sf011-agent-reloaded.json`；直接复核`.local/sf011-agent-dialog-mobile.png`、`.local/sf011-agent-created.png`、`.local/sf011-agent-dialog-final.png`。真实POST/重读路由日志为`/tmp/ai-harness-sf010-dev-final.log`末尾对应Agent请求；恢复后服务日志为`/tmp/ai-harness-sf011-dev.log`。
- 真实PG完整对象回归：`apps/api/tests/account-persistence.integration.test.ts`创建Agent并重启API后重读，另有任务/项目/模板PG用例；本轮全量配置见私有`.local/sf011-full-check.mjs`。`apps/api/tests/agent.test.ts`是显式内存fake的HTTP权限/协议验证，不替代上述持久化证据。
- 最终工程：`/tmp/ai-harness-sf011-full-tests.log`（22:33:19，145/2015）、`sf011-types.log`、`sf011-api-types.log`、`sf011-web-build.log`、`sf011-lint.log`、`sf011-format.log`（均同`/tmp/ai-harness-`前缀）。本轮只改UI，无需重建未改的API业务；Web生产构建与类型检查覆盖最终嵌套修复。

## 最终结论

- **结果：**Accepted，9 PASS / 0 FAIL / 0 NOT RUN；三项任务全部完成。
- **保留边界：**创建仅保存配置，未调用真实模型或工具；当前POST只保证UI同轮在途互斥。主站验收记录为明确标识的新建非秘密Agent，保留供用户复核，未改旧记录或密钥。
- **后续行动：**主开发者做最终全仓格式/差异收尾并交付；没有本轮必需的后续开发或审批。
