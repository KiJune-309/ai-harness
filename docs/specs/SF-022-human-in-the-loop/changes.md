# SF-022：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-022     |
| 状态     | Complete   |
| 最近更新 | 2026-10-22 |

## 记录

### 2026-10-22 — 首版范围与需求草案

- **用户确认：**同时覆盖 Agent 主动提问与执行操作前审批；问题展示在聊天内，答案用原底部聊天框；只对发送、写入、删除等操作审批，读取与计算自动执行。
- **只读发现：**工具执行器有 ask/approval seam，但应用未接通且上游服务仅支持同进程即时等待；普通聊天无通用持久 waiting/resume。协作已有发送草稿、专用确认、source 版本/租约和私有 journal 可供边界参考，不能借用旧项目依赖恢复已关闭能力。
- **变更内容：**新增 REQ-001–018、AC-001–020；明确精确请求/版本、一次人工决定、等待不空转、原执行恢复、权限失效及外部结果不明时停止自动重试。初始化四文档，Plan/Tasks 保持 Awaiting Spec Approval。
- **范围说明：**生产只读工具自动执行，生产发送沿用原专用确认；不新增写入/删除工具，通用审批执行边界须由明确标注的隔离工具验证，不冒称生产能力。
- **验证：**完成仓库现状只读调研；尚未实施或运行功能测试，全部功能 AC 为 NOT RUN。文档格式与独立复核结果待补充。
- **结论：**Spec 为 Draft — Awaiting User Review；三个产品选择不等于整份规格或实施计划批准。

### 2026-10-22 — 需求独立复核与文档检查

- **独立复核：**API/数据与聊天交互两个代理分别复核，发现相同两处歧义：发送范围不能仅限新收件人；新增单请求约束不能隐式改变已有多份发送草稿。
- **修订：**REQ-005 明确向聊天外任何收件人发送均需该次精确确认；REQ-003 明确单个新增阻塞请求与既有各自独立的发送草稿边界；REQ-014 和 AC-016 明确问题答案属于新本人输入，沿原规则使旧待发草稿失效，不能代替发送确认，并覆盖再次向同一收件人发送。
- **验证：**四文档 Prettier 格式检查及需求追踪检查完成；18 项 REQ 均有 AC 覆盖，20 项 AC 均进入验收矩阵，无重复编号。只运行文档检查，全部业务验收仍 NOT RUN。
- **结论：**需求草案可供用户审阅，Plan/Tasks 继续保持 Awaiting Spec Approval，未改业务代码。

### 2026-10-22 — 用户确认规格并授权实施

- **授权：**完整需求稿呈交后，用户明确“开始执行”，据此确认规格并授权完整实施；本轮补齐Plan/Tasks，不重复请求已授权范围许可，不声称用户审阅了随后计划全文。
- **分工：**契约/DB、core、Web三路并行，主开发负责API/worker及整体集成。
- **开始状态：**T-001–004 IN PROGRESS，T-005 TODO。全部业务AC仍NOT RUN。

### 2026-10-22 — 实现、独立复核与故障修复

- **T-001：**新增共享 human-loop 契约及 PostgreSQL 请求/决定/效果状态；wait 保留 writer 到 journal flush，决定与原 job queued、真实答案消息及旧发送草稿失效同事务。来源/权限代次、版本、动作身份与执行租约均受服务端仲裁。
- **T-002：**持久 runtime 提供 ask-human 和真实工具审批；读取自动，有影响操作冻结实际参数、目标与范围；同批后续调用 deferred。恢复使用原调用位置和 native ID，可信元数据区分基础设施等待与不可信工具正文。可核验结果通过只读 lookupResult 恢复，未知效果不重放。
- **T-003：**普通生产聊天走既有持久队列，不创建 Task/旧项目；API 底部精确回答及专用批准/拒绝/取消路由、worker 租约端口接通。每个恢复阶段使用稳定独立 assistant 身份，保留暂停前分析及真实答案顺序。
- **T-004：**新增聊天问题/完整审批预览与真实终态，唯一底部输入器、建议追加保稿、中文输入法、旧题身份、断线核验及后台活动轮询。真实浏览器发现并修复空回复假停止、底部重复长问题和结果展示内部 JSON 三处问题。
- **独立复核修复：**旧 job 等待标记不得阻断新 job；连续第二题在 wait 提交/result flush 之间故障须修复最新未闭合调用；同源/同 job 复用 native ID 以真实 journal 位置消歧。API/数据代理复核这些修复和只读取证路径，无额外人工批准范围。
- **快照竞态：**统一验收实际抓到 succeeded/noactive 与旧 assistant 混合返回。修复 loadSource 为取得精确 source 锁后重读消息；确定性真实 PG 锁步测试先完成另一 worker settle 再放行旧读，验证同一返回的消息/请求/活动一致。没有放宽严格 API 断言来掩盖问题。

### 2026-10-22 — 最终自动化与实际浏览器验收

- **统一自动化：**18 文件、168 测试全部通过。文件为 contracts/human-loop；db/human-loop、workspaces；api/human-loop、human-loop-process、project-folders、chat-service、chat-agents、api；core/human-loop、collaboration、project-knowledge、skills；web/human-request、workspace-new-chat、chat-client、chat-proxy、collaboration。实际命令为 `pnpm exec vitest run <上述18文件完整路径>`，由本机私有配置仅向环境传入 TEST_DATABASE_URL，全部业务数据在隔离 schema；不记录真实连接串。
- **核心专项：**12 条真实 Cordis 用例，包括秘密参数在 preview/wait/body 之前拒绝且不回显、前置只读在两次审批与终态重放后仍一次、连续审批、同 job 复用 ID、第二题 flush 故障、旧 job 替代、只读自动、冻结目标及核验/未知结果分支。
- **数据库专项：**9 条真实 PostgreSQL 用例，包括两池决定竞争、回答及账本一次、旧审批失效、效果与超长结果 unknown、取消、团队撤权重加、回答使旧发送草稿失效及锁内一致快照。
- **原发送补验：**单独运行 collaboration-dispatch 中现行独立消息案例（1 通过、8 个退役案例跳过）：首次发送后，同源向同一收件人再次起草产生新 draftId；重放旧确认不会投递新稿，新稿保持 pending；只有确认新稿才新增第二条消息与通知。该测试的格式及定向 ESLint 通过。
- **真正进程重启：**human-loop-process 用生产 main.js 子进程建立待问题后 SIGKILL，另一进程沿同 schema、稳定 key、原登录会话读回同请求，并发重复底部答案只留一个决定/答案/原 job；原 session 连续，provider 总两次，无新旧项目创建。
- **工程：**根 `pnpm format:check`、`pnpm lint`、`pnpm typecheck:core`、`pnpm --filter @ai-harness/db typecheck`、`pnpm typecheck:api`、`pnpm build:api`、`pnpm build:web` 通过；Web 生产构建也执行 TypeScript 检查。四个服务端包生产产物未发现 tests 或 test/spec 文件。
- **真实浏览器：**CUA 控制 Chrome 桌面 1470px 与 390×844，真实隔离 PG/API/Cordis/worker 和受控 HTTP 模型。实际完成建议保稿、唯一底部答案、IME 组合输入+Return 不误发、回答恢复、长审批全文/末尾范围/按钮、Tab/Shift+Tab 焦点、键盘批准、拒绝、取消后新讨论、原站内发送一次确认。390px 页面宽度为390，无横溢。
- **对应数据库核验：**测试业务效果1；问题answered，保留原草稿+建议+中文补充；批准succeeded、拒绝rejected、取消cancelled；取消后普通讨论完成且无 active；原发送sent1、投递消息1、收件人普通聊天1/消息1。
- **本地证据：**[浏览器过程](../../../.local/sf022-visual/ui-evidence.json)、[实际数据库计数](../../../.local/sf022-visual/db-evidence.json)、[手机问题](../../../.local/sf022-visual/question-mobile.jpg)、[键盘审批](../../../.local/sf022-visual/approval-mobile-keyboard.jpg)、[实际成功](../../../.local/sf022-visual/approval-succeeded-mobile.jpg)、[原发送回执](../../../.local/sf022-visual/send-succeeded-desktop.jpg)。这些是忽略目录下的本地验收材料，不是仓库内提交资产。
- **清理：**已关闭仅本轮临时浏览器标签并恢复 viewport；fixture 独占进程/API/Web 端口关闭，唯一临时 visual schema 删除，截图与非秘密证据保留。未操作其他开发服务或真实用户业务数据。
- **证据边界：**未调用真实云模型、未安装生产写入/删除工具；通用有影响操作用明确标注的隔离工具验证。未启用 VoiceOver，检查了浏览器 AX 与键盘；手机为真实 Chrome 的390px视口，不是真手机硬件。
- **额外历史回归：**另运行的 collaboration-default-model 中8项及 collaboration-worker 中4项旧节点/交接/精确回问期望仍失败；这些场景已由 SF-021 退役，部分收到明确410，不为修旧期望而恢复旧项目能力。未声称全仓全部历史测试全绿；当前生产独立消息、一次发送确认及本期18文件验收均有实际通过证据。

## 验收矩阵

| 验收标准 | 状态 | 证据                                                                                     | 备注                           |
| -------- | ---- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| AC-001   | PASS | 真实API问题→底部答案→原job/session；首次分析仍在可见历史，进程测试无Task/项目。          | 无项目及文件夹路径均验证。     |
| AC-002   | PASS | Web组件及CUA建议追加既有草稿；实际IME组合+Return不提交，显式发送才answered。             | Chrome 390×844。               |
| AC-003   | PASS | 契约/DB/API旧请求、错误身份及重复决定冲突；Web保原题草稿，不改投新题。                   | 确认文字只作答案。             |
| AC-004   | PASS | core真实calculator/clock自动；API文件夹计算408及项目资料查找/读取回归通过。              | 读取仍受本人/项目授权。        |
| AC-005   | PASS | 真实Cordis+PG/API隔离写工具批准前0，冻结正文批准后1；CUA计数再核验1。                    | 仅隔离工具。                   |
| AC-006   | PASS | 原目标/参数篡改拒绝；schema允许apiKey的实际调用仍在preview/wait/body前拒绝，结果不回显。 | 专用人工动作strict字段。       |
| AC-007   | PASS | core/API拒绝零效果并回到原模型；CUA拒绝/取消实际通过，模型无人工决定工具。               | 替代操作仍需新审批。           |
| AC-008   | PASS | 真实PG/API新输入supersede旧approval，旧版专用批准409；Web改要求正常处理。                | 两标签/迟到提交保护。          |
| AC-009   | PASS | DB单pending约束；core同批两审批串行deferred、连续两题、复用ID回归通过。                  | 同事参考不授人工权。           |
| AC-010   | PASS | 生产main.js SIGKILL后新进程沿原session读同请求；等待期间无额外provider调用。             | 重建API图另覆盖审批。          |
| AC-011   | PASS | 真实PG两池决定竞争和进程HTTP并发答案；账本1、答案1、原job1、provider2。                  | 异内容同动作冲突。             |
| AC-012   | PASS | core前置read计数在两次审批恢复及终态replay均1；原两写各一次。                            | journal位置恢复，无重拟。      |
| AC-013   | PASS | core真实效果后故障：lookupResult按原身份核验不重做；无证据unknown；PG超长结果unknown。   | 不承诺普遍恰好一次。           |
| AC-014   | PASS | 真实PG撤权/重加不复活；API陌生人读取/批准404；执行/结算复核租约与代次。                  | 同空间非本人无处理权。         |
| AC-015   | PASS | 普通/文件夹聊天、持久源测试；旧源取消后新问题同聊天正常恢复，不新建旧项目。              | SF-021资料回归通过。           |
| AC-016   | PASS | CUA原发送仅一确认；实际PG回答替代旧稿，同收件人再次发送须新draft确认，旧确认重放不投递。 | 旧项目发送不重开。             |
| AC-017   | PASS | 机制性保存/ask无递归审批；冻结Skills与协作回归、原独立发送确认、私有投影检查通过。       | 无Agent共享发布/批准权。       |
| AC-018   | PASS | Web真正挂载Workspace的409/断线/丢响应保稿与同actionId核验，身份变化清旧私有状态。        | 不自动答新题。                 |
| AC-019   | PASS | CUA桌面1470/390×844，长问题/参数/末尾范围可达、Tab焦点/IME通过、单textarea。             | 未启用VoiceOver。              |
| AC-020   | PASS | 最终18文件168测试通过；格式/lint/相关类型/API和Web构建通过；生产产物无测试。             | 历史退役用例另列，非全仓全绿。 |

## 最终结论

- **结果：**Accepted。
- **未通过或未执行项：**本期 AC-001–020 无；范围外历史退役用例及设备/读屏/真实云模型限制如上，未隐瞒或冒称通过。
- **任务：**T-001–005 全部 DONE。
- **后续行动：**无本期必需工作；未来生产写入/删除工具须各自声明真实影响、可靠预览及核验能力后另行接入。
