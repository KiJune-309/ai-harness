# SF-014：同事与Agent上下游协作任务清单

## 元信息

| 字段     | 值                                     |
| -------- | -------------------------------------- |
| ID       | SF-014                                 |
| 状态     | Accepted — Composer and Contact Intent |
| 关联Spec | [spec.md](spec.md)                     |
| 关联Plan | [plan.md](plan.md)                     |

## 任务状态定义

- `TODO`：尚未开始。
- `IN PROGRESS`：正在实施。
- `BLOCKED`：有具体依赖/待决问题，原因写入changes，不以普通困难代替证据。
- `DONE`：本任务完成标准满足，指定验证已实际执行通过。

## 任务概览

| ID    | 任务                                         | 关联需求/验收                                                                                                   | 依赖                                            | 状态 |
| ----- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---- |
| T-001 | 公共协作协议与能力边界                       | REQ-005、007–012、014–015、018–026 / AC-006、009、010、014、027、028、031、032                                  | 无                                              | DONE |
| T-002 | PostgreSQL协作关系、私有CAS、journal与ledger | REQ-007、009–011、013–015、018–020、022–026 / AC-008、011、016、018、019、025、026、029、033                    | T-001                                           | DONE |
| T-003 | API授权、协作事务与本人节点                  | REQ-001、007–015、018–026 / AC-001、009–014、016、018–020、025–029、031–035                                     | T-001、T-002                                    | DONE |
| T-004 | Cordis持久协作工具和后台恢复                 | REQ-001、007、011–016、020、024–026 / AC-001、008、012、016、018、020、026、032、034、035                       | T-001、T-002、T-003                             | DONE |
| T-005 | Web客户端、代理与原问题稳定定位              | REQ-005、008、010、014、017–019、021–023、026 / AC-006、009、014、021、022、027–029、031、034                   | T-001、T-003                                    | DONE |
| T-006 | 项目与各人Task的上下游协作界面               | REQ-001、005、007、009–012、015、017、019–026 / AC-001、006、008、010、012–014、019、021、022、025–029、031–035 | T-004、T-005                                    | DONE |
| T-007 | 真实三人验收、兼容与边界文档                 | 首版22条REQ / 首版26条AC，含AC-030                                                                              | T-001–T-006                                     | DONE |
| T-008 | 全员默认模型免配置                           | REQ-027 / AC-036，兼容REQ-016、018、024 / AC-020                                                                | T-003、T-004、T-006                             | DONE |
| T-009 | 下游直接Agent开场与上下游回问                | REQ-028 / AC-037，兼容REQ-007、010、011、014、017、018、024、026及AC-021、032、034、036                         | T-003、T-004、T-006、T-008                      | DONE |
| T-010 | Agent跨人发送草稿与本人确认                  | REQ-012、014、017、018、029 / AC-038及受影响AC-014、027、034、037                                               | T-002、T-003、T-004、T-005、T-006、T-009        | DONE |
| T-011 | 普通Agent聊天直接接收与连续工作              | REQ-010、017、018、019、024、026、029、030 / AC-039及受影响AC-021、027、029、032、034、037、038                 | T-002、T-003、T-004、T-005、T-006、T-009、T-010 | DONE |
| T-012 | 主输入讨论与本人主动联络、精确答复审稿       | REQ-010、011、012、018、029、030、031 / AC-040及受影响AC-012、021、034、038、039                                | T-002、T-003、T-004、T-005、T-010、T-011        | DONE |

范围中的数字区间仅指Spec当前存在的有效ID，不重新启用延期REQ-002/003/004/006或延期设备AC。T-007记录首版验收；后续补充由T-008/T-009/T-010/T-011/T-012各自记录。不把延期9项当本轮门槛。T-003/T-006的历史接手前置以T-009修正为准，历史直接发送约定以T-010本人草稿确认修正为准，历史新接收Task/Project主路径以T-011普通聊天修正为准，历史轻量精确回复表单及默认回复语义以T-012主输入修正为准。

## 任务细节

### T-001：公共协作协议与能力边界

**文件：**新增`packages/contracts/src/collaboration.ts`和`tests/collaboration.test.ts`；扩展`src/index.ts`导出与发送输入，核对现有Task/Project/Agent严格schema。

**接口：**输入为人员绑定、来源、协作意图、版本化动作；输出为Project/责任节点安全投影、本人分派启用、事件/问题/答复、成果发布/采用、通知/阅读与动作查询schema。确定Plan接口族的精确路径/方法供T-003/005共用；私有core ports不放公开数据库客户端。

**关联：**沿任务概览中的REQ/AC。

**完成标准：**纯文本旧请求兼容；shared DTO不含私有Agent/推理/秘密；负责人/来源/问题/版本区分明确，个人projectId与协作归属不混用；不要求固定等待口令或永久唯一Agent。

**验证：**`pnpm exec vitest run packages/contracts/tests/collaboration.test.ts`及`pnpm --filter @ai-harness/contracts typecheck`，强断言非法/歧义/伪scope/过界版本不能被当授权，合法旧输入保持。

- [x] 固定最小公开协议并测试关键边界；记录变动，不修改延期ID用途。

### T-002：PostgreSQL协作关系、私有CAS、journal与ledger

**文件：**新增`packages/db/src/collaboration.ts`、`tests/collaboration.test.ts`、`tests/collaboration-persistence.integration.test.ts`；扩展`src/index.ts`初始化/store及私有写仲裁，必要时扩展`src/accounts.ts`的受限人员查询。

**接口：**消费T-001领域结构；提供同连接池协作事务、权限查询、节点绑定、原子事件/等待/通知/未读、成果发布/采用、动作槽/账本查证、私有revision/活动token、source-session唯一绑定、run与inbox/terminal投影、job claim/heartbeat/CAS和owner绑定journal读写。

**关联：**沿任务概览中的REQ/AC。

**完成标准：**创建/接入、本人启用、交接/回问、答复+唯一续跑、撤销/修订完整原子；根节点绑定原来源，私有Task不转移owner；同业务动作不重复写，失效token或grant/node授权代次拒绝日志/业务/结算，撤销同步fence已领取运行；旧全快照写不能覆盖协作新历史，正常运行无内存降级。测试fake仅显式DI。

**验证：**两份db测试和`pnpm --filter @ai-harness/db typecheck`。真实`TEST_DATABASE_URL`隔离schema验证回滚中间失败、重复动作、双worker/旧租约、丢响应查证、源私有过滤、首次绑定旧轮晚结算、领取/工具提交与撤销竞争及journal连续序号；跳过不记PASS。

- [x] 新增增量表/索引及事务操作；在真实PG证明幂等、权限和CAS，不仅mock查询字符串。

### T-003：API授权、协作事务与本人节点

**文件：**新增`apps/api/src/collaboration-service.ts`、`collaboration-controller.ts`及`tests/collaboration-service.test.ts`、`collaboration-api.test.ts`；扩展`account-service.ts`、`chat-service.ts`、`task-controller.ts`、`project-controller.ts`与`app.ts`必要接入。

**接口：**消费T-001/002；产出受真实ChatGuard保护的Plan接口族、core业务操作port及owner解析入口。原个人接口保持owner校验；新Project返回共享安全DTO，当前本人私有Task另读。

**关联：**沿任务概览中的REQ/AC。

**完成标准：**@委派自动创建/接入同一事项；简单转告不建Project。分派立即有受限站内内容，本人选择/确认Agent后启用，不擅自用对方模型。下游回问路由到上游原来源，答复绑定具体问题/版本并一次入队；成果/采用和人工决定可追溯，撤销阻止读取/续跑但不转移私有Task；所有消息/状态写与DB仲裁一致。

**验证：**两份API测试、原project/task/account-model适用回归及`pnpm typecheck:api`。真实会话A/B/C与跨workspace身份验证正向接力和负向共享/完整Task/模型读取，模型关闭时读信/人工回复仍可用。

- [x] 实现API事务与授权，错误真实保输入，动作查证不泄漏其他人的存在/结果。

### T-004：Cordis持久协作工具和后台恢复

**文件：**新增`packages/core/chat-runtime/src/collaboration.ts`、`collaboration-tools.ts`、`session-persistence.ts`、`tests/collaboration.spec.ts`；扩展现`index.ts`最小共用部分、包exports/直接依赖及必要Vitest别名。新增API`collaboration-worker.ts`，扩展`app.ts`、`chat-service.ts`、`config.ts`和`.env.example`。

**接口：**消费T-002私有journal/job/ledger与T-003授权业务port；产出stable session的运行/恢复入口和有界worker。core不导入API/NestJS，业务事务仍由可信注入port执行。

**关联：**沿任务概览中的REQ/AC。

**完成标准：**工具后续请求由AgentLoop推进；持久header/events/flush与durability barrier真实生效。发送/交接/回问先提交业务及结果账本，再回填；等待调用`concludeTurn()`，无长Promise/模型空转。恢复按服务端trigger→效果槽→actionId及指纹查已提交结果，不允许模型换nonce/call ID重新建槽；新用户触发才可合法再次发送。run固定映射inbox接纳/消费和terminal seq，已terminal只补结算；快速答复先存排队，旧轮不能写回waiting，下一job等同节点旧执行退出。每次写及结算验证当前token，同时校验grant/node授权代次；目标Task owner模型执行前解析、失效不换用他人或默认配置；自动循环/超时/重试预算有限。

**验证：**core测试、`pnpm typecheck:core`/API类型及实际Cordis+本地HTTP模型fixture，捕获原调用/结果、A/B不同模型身份；模拟发送已提交但tool/result未保存、等待重启、回复已存但job未领取、旧worker迟到、inbox消费后退出、terminal落盘job未complete、答复早于concludeTurn、撤销已claim执行，断言消息/答复/续跑各一次。

- [x] 实现durable工具/session/worker和资源关闭；从首次协作turn建立持久来源，绑定后无@的普通输入也归同一journal，后续不随机重建或与公开messages分叉。

### T-005：Web客户端、代理与原问题稳定定位

**文件：**新增`apps/web/lib/collaboration-client.ts`、`tests/lib/collaboration-client.test.ts`及`tests/server/collaboration-proxy.test.ts`；扩展`server/chat-proxy.ts`、`lib/chat-client.ts`/project/task客户端、`components/workspace.tsx`及必要路由参数。

**接口：**消费已固定API，集中动作ID/版本/错误/丢响应查询；提供原conversation根节点`/?conversation=...&event=...`、本人已绑定Task `/inbox/<taskId>?event=...`及未启用/他人安全节点`/projects/<projectId>?node=...`稳定入口，与私有导航取消和账户边界一致。

**关联：**沿任务概览中的REQ/AC。

**完成标准：**精确代理白名单/同源/真实会话，无通配转发；URL定位优先localStorage且重新授权读取，晚响应不覆盖新ID/身份。后台job不会因浏览器关闭被误取消；客户端保原动作/草稿，不把暂时故障当发信成功。

**验证：**两份新增测试、现chat-proxy/客户端与账户切换适用回归、`pnpm typecheck:web`；错误ID/跨身份/迟到响应、动作查询、原conversation根节点、分派启用前/后及他人安全节点直达/刷新有断言。

- [x] 建立共享客户端与真实来源深链，供T-006使用；不靠“最近聊天”恢复问题。

### T-006：项目与各人Task的上下游协作界面

**文件：**扩展`project-workspace.tsx`、`task-workspace.tsx`、`workspace.tsx`、`message-composer.tsx`及对应styles；新增小型协作事件/成果/分派组件与`apps/web/tests/components/collaboration.test.tsx`，必要时扩展现项目/任务路由。

**接口：**消费T-004持久状态和T-005客户端；项目入口按安全投影展示，任务内显示私有聊天与有来源事件；本人启用前走项目node稳定地址且只用分派元数据，启用后按真实taskId进入本人Task；原conversation根节点保持原对话入口，他人只读项目安全投影。

**关联：**沿任务概览中的REQ/AC。

**完成标准：**主路径为项目→各自Task→上下游问题；@稳定选人、简单转告与委派区分，保原导入/命令/IME。项目显示负责人/公开Agent名/上下游/状态/成果版本，他人节点无私有表单；问题卡精确回复，自己的Agent可接授权成果继续。通知/未读真实，390px/键盘/私有Portal/故障与401边界保持。

**验证：**新增DOM用例与原任务/项目/composer/账户边界适用回归、Web类型/构建；断言成果实际正文/采用版本、原事件聚焦、冲突保草稿、正常转告不建项目、模型建议不当人批准。

- [x] 完成可读可操作的真实项目与各人Task协作，不用IM列表/演示卡片替代工作流。

### T-007：真实三人验收、兼容与边界文档

**文件：**新增`apps/api/tests/collaboration-api.integration.test.ts`及必要真实PG/HTTP fixture（均在tests）；同步`AGENTS.md`、`docs/ui-design-spec.md`、部署/使用说明及本目录`changes.md`/任务状态。无关工作树改动保持。

**接口：**消费前六任务全部功能；产出每条当前AC的实际证据、真实数据/进程范围、最终状态和必要残余说明。

**关联：**REQ-001、REQ-005、REQ-007、REQ-008、REQ-009、REQ-010、REQ-011、REQ-012、REQ-013、REQ-014、REQ-015、REQ-016、REQ-017、REQ-018、REQ-019、REQ-020、REQ-021、REQ-022、REQ-023、REQ-024、REQ-025、REQ-026；AC-001、AC-006、AC-008、AC-009、AC-010、AC-011、AC-012、AC-013、AC-014、AC-016、AC-018、AC-019、AC-020、AC-021、AC-022、AC-025、AC-026、AC-027、AC-028、AC-029、AC-030、AC-031、AC-032、AC-033、AC-034、AC-035。

**完成标准：**真实A/B/C分别提供场景、产品补问和工程评估，在一个Project使用各自Task/Agent/模型；问题回原对话、回答恢复正确节点、最终决定由人，零中转。离线/重启/崩溃窗口/模型删除/越权/旧版本/双worker有实证。所有当前AC有PASS/FAIL/NOT RUN，延期9项单列；未经证实不得Accepted。

**验证：**按Plan验证策略运行定向测试→真实独立进程/PG→桌面与390px浏览器→一次适用完整回归、类型、API/Web生产构建、lint/format/diff；只在失败或新修改后扩大/重跑。fixture为真实HTTP协议但不冒称真实云模型，跳过真实PG不算通过，日志不泄密，不停止用户拥有进程。

- [x] 更新真实证据和边界文档，按sdd-acceptance逐当前AC终验；仅全部必需完成才标DONE/Accepted。

### T-008：所有账户默认模型免配置（2026-10-19用户补充）

**关联：**REQ-027 / AC-036，兼容REQ-016/018/024及AC-020。

**范围：**协作发起/本人接手复用服务器系统模型，保留个人路由隔离；更新默认模型与个人可选连接界面、AGENTS和使用说明；验证无个人连接的真实账户普通聊天、原job恢复、接手与公开/私有快照无密钥。

**状态：**DONE。服务/core/Web定向、真实PG三账号免配置及独立进程个人模型兼容验收通过；最终完整回归2040 PASS、0 FAIL、62环境SKIP，构建/类型/lint/format通过，AC-036为PASS。首版T-001–T-007的历史验收保持独立，本补充证据记录在changes中。

### T-009：下游直接 Agent 开场与原上下游回问（2026-10-19用户修正）

**关联：**REQ-028 / AC-037，并复验AC-021、AC-032、AC-034、AC-036。

**范围：**API与worker的新委派提供收件人安全默认Agent快照；PG同事务创建本人Task、真实上游assistant/opening、来源绑定与通知，不伪造本人输入、不自动排接收人模型job。旧待接手链接仅开场恢复，并发打开幂等复用同一Task；入口直接进入本人对话，消息通知为辅助。本人输入请求Agent向明确上游补问，答案沿问题版本返回同一session续接。个人key、owner授权、人工判断、动作账本与lease保持。

**状态：**DONE。DB真实PG17项、core11项、API service/worker19项、两项真实PG/API与独立进程链路及Web定向通过；完整回归2047 PASS、0 FAIL、65环境SKIP。随后追加侧栏“同事发来的对话”，另由三套31项定向、Web类型和lint验证，不冒称该追加已重跑全仓。AC-037为PASS，具体证据见changes。

- [x] DB原子开场、nojob/所有权、动作重放、失败回滚、首次本人输入/回问答复、双pool旧链接恢复与撤销。
- [x] core真实关系回问提示与Web直接对话入口定向验证。
- [x] 同步当前AGENTS、使用说明、Spec/Plan及新需求追踪，保留历史记录。
- [x] API与真实进程终验、适用完整回归/工程检查及AC-037最终证据。

### T-010：Agent跨人发送草稿与本人确认

**关联：**REQ-012、REQ-014、REQ-017、REQ-018、REQ-029 / AC-038，并复验AC-014、AC-027、AC-034、AC-037。

**范围：**message/delegate/跨人ask先写PostgreSQL发送草稿和稳定动作结果，在源聊天展示实际收件人与完整正文/共享范围；模型只起草，`pending-confirmation`立即停轮。本人专用确认动作绑定draftId/version并重验当前源/节点权限，使用已存command一次投递。取消、新输入supersede、版本冲突及撤权阻止旧稿。原自我judgment及已有完整预览的人工表单保持，不增加发送确认模型工具。

**完成标准：**未确认零收件人消息/通知/未读/Task/问题；本人确认后原文/收件人精确一次。真实PG/API覆盖重启、并发确认、取消、新输入、撤权/旧版本和丢响应；Web源聊天展示完整草稿、绑定确认与失败恢复、清私有层。终态恢复不调模型/凭据或重建草稿，旧发送链路与人工表单适用回归通过。

**当前状态：**DONE。真实PG确认事务、真实多账户API/独立进程、core15项、worker12项及Web预览/取消/恢复通过；完整回归2075 PASS、0 FAIL、71环境SKIP，API/Web生产构建、类型及工程检查通过。AC-038及受影响标准为PASS，具体证据和测试边界见changes。

- [x] core待确认状态停轮、三类工具及系统原则，终态重启和结果丢失恢复定向验证。
- [x] 同步AGENTS、使用说明及Spec/Plan/Tasks/Changes，保留历史验收。
- [x] PostgreSQL私有草稿、确认/取消/替代及一次投递的真实事务验证。
- [x] API真会话权限、模型无确认能力及端到端适用链路验证。
- [x] Web源聊天预览/确认/失败恢复、人工表单兼容与适用工程检查。
- [x] 汇总实际跨层证据，评估AC-038及受影响AC后更新最终状态。

### T-011：普通Agent聊天直接接收与连续工作

**关联：**REQ-010、REQ-017、REQ-018、REQ-019、REQ-024、REQ-026、REQ-029、REQ-030 / AC-039，并复验AC-021、AC-027、AC-029、AC-032、AC-034、AC-037、AC-038。

**范围：**确认交接与转告原子创建收件人普通ChatConversation及实际同事来信，普通聊天列表/读取/输入统一；问题与真实答案投影为原聊天可见消息，旧Task/节点入口幂等导向普通聊天。去掉接收主路径的Task/Project/上下游面板和额外收件对话分类，仅保留发送确认与精确问题答复轻量入口。runtime跳过opening/relay的assistant历史种子，worker用当前授权receivedMessages作有来源参考；首条本人输入才执行本人模型，同session连续工作，原私有历史/权限与审稿保持。

**完成标准：**真实PG/API证明新交接与转告直接存在于普通ChatConversation、普通列表可读，正文不是仅存通知/元数据；精确问答双方可见并只恢复原聊天一次，旧入口幂等、第三人拒绝。Web正常聊天列表与输入可用且没有任务/项目/上下游面板，发送前确认仍有效。真实AgentLoop证明同事投影不冒充Agent承诺/本人指令，两轮正常聊天保留本人历史和同session。适用回归/构建/类型/格式与lint实际通过，证据汇总后再Accepted。

**当前状态：**DONE。真实PG26、真实多账户API/独立进程2、core16、ChatService12及service11通过；完整回归2080 PASS、0 FAIL、74环境SKIP。全量后Web追加由四套50项、最终workspace14/collaboration27项定向验证；最终API/Web生产构建、类型和全仓lint/format/diff检查通过。localhost隔离真实浏览器确认普通列表、开场原文、正常输入及轻量审稿，未发送真实同事消息；测试cookie失误和纠正如实保留在changes。AC-039及本轮受影响标准为PASS。

- [x] core普通聊天系统原则、opening/relay参考边界与连续两轮真实AgentLoop验证。
- [x] 同步AGENTS、使用说明和Spec/Plan/Tasks/Changes，以用户最新授权为准。
- [x] PostgreSQL普通ChatConversation接收、问答消息投影、旧入口及幂等/权限实际验证。
- [x] API普通列表/读写、真实多账户接力与旧入口跨层验证。
- [x] Web普通聊天主路径、可见正文、轻量审稿/答复定向验证，Web类型及相关lint通过。
- [x] 最终页面QA、全仓lint/format及Web生产构建。
- [x] 汇总实际证据，评估AC-039及受影响标准，更新最终状态。

### T-012：主输入与自己的Agent讨论，主动联络后才起草

**关联：**REQ-010、REQ-011、REQ-012、REQ-018、REQ-029、REQ-030、REQ-031 / AC-040，并复验AC-012、AC-021、AC-034、AC-038、AC-039。

**范围：**删除普通聊天独立问题回复区、输入框、发送/取消回复按钮，不增加收件人输入、上下游操作或默认回复模式。底部输入用于与自己的Agent理解需求、讨论和安排执行；只有本人主动要求联系、向上游补信息或回传，才在当前授权范围起草。同源未消费且未取消的本人联络请求在补齐澄清后可续接，不扩大收件人或共享范围；收到正文“请回复”和普通“确认/知道了/请先分析”不授权。所有worker移除共享artifact能力，API/数据库拒绝Agent publish；私人分析/产出留在聊天，已有完整预览的人工发布保持。精确answer草稿绑定实际待答问题和版本，模型不能直接answer或confirm，只有真实来源本人确认后作为可信人工动作推进原问题。

**完成标准：**pendingquestion也不产生额外回复区域，轮询仍及时同步正常聊天正文；受控普通讨论/分析/工作安排回归无对外草稿、投递或共享成果；后台唤醒无新外联槽，未声明/篡改槽和字段及越权工具尝试拒绝，真实投递始终由本人专用草稿确认动作约束；所有worker无artifact，API/数据库拒绝Agent publish，人工完整预览发布回归通过。明确本人回传才形成完整预览，经本人确认后仅精确当前问题一次投递与回接；旧版本、多问题歧义、取消/替代/撤权/重复提交和重启恢复维持安全边界。真实PG/API、真实受控AgentLoop、Web适用回归及工程检查分别实际执行并记录，不把前轮Accepted当新证据。

**当前状态：**DONE。Web51、API worker/service27、core22、真实PG三套29、独立API进程四账户场景1、system-model与contracts合计6通过；最终全仓JSON实际核对161文件2094 PASS、77环境SKIP、0 FAIL。最后追加仅lease的Agent publish拒绝由dispatch9项重跑与API最终构建验证。API构建、临时独立Web生产构建、core/Web类型、全仓lint/format/diff通过；浏览器只读确认用户当前聊天原文仍在，仅一个正常composer，无额外回复按钮，未发送真实消息。自然语言意图受Agent策略约束，受控provider不证明任意恶意模型在合法槽内绝不生成草稿；服务端能力槽/版本/权限及真人专用确认是实际投递硬边界。具体证据与时间顺序见changes，AC-040及受影响标准为PASS。

- [x] Web删除独立回复区，保留正常输入/历史刷新与真实草稿确认，51项适用回归及Web类型、定向lint/格式通过。
- [x] 同步AGENTS、使用说明、Spec/Plan/Tasks/Changes，明确用户最新授权及历史覆盖关系。
- [x] core/API受控普通讨论/主动回传回归、背景无外联槽和未声明/篡改能力拒绝；自然语言意图由策略约束，不夸大为任意恶意模型证明。
- [x] DB/API精确answer草稿、可信本人确认、并发/旧版本/撤权与持久恢复实际验证。
- [x] 共享artifact封口后的API/数据库拒绝Agent publish（含agent+lease与仅lease）、所有worker无artifact及人工预览发布适用回归。
- [x] 最终全仓回归、工程检查及浏览器只读验证，AC-040/受影响标准证据汇总与终验。

## 阻塞项

- 用户已要求完整阅读官方文档后实现；已按该指令进入实施。真实PostgreSQL已可用，验收仅使用隔离schema与本次自建子进程，不停止用户服务。

## 完成汇总

- 总任务：12
- 已完成：12
- 进行中：0
- 阻塞：0
- 待办：0
