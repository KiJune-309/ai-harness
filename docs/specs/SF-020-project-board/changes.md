# SF-020：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-020     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-20 |

## 记录

### 2026-10-20 — 产品经理提出第六项看板需求

- **变更内容：**创建共享项目只读六列看板、真实开始/来源判定、全量筛选计数、等待与本人精确导航规格；初始化Plan/Tasks，未改业务代码。
- **原因：**SF-019已独立Accepted，需让团队从真实工作状态发现待本人处理和异常，不重复关系树或制造完成记录。
- **授权：**用户已授权六项需求→实现→独立测试顺序轮转，本项无需新确认。
- **关联项：**REQ-001–REQ-010、AC-001–AC-014。
- **验证：**已完整读取官方看板文档和当前安全progress/source元数据/项目UI，本期尚未实施和验收。
- **结论：**可规划实施，待独立验收完成六项轮转。

### 2026-10-20 — 明确旧 Task 实际完成的只读兼容

- **变更内容：**状态规则及 AC-002/AC-008 明确精确 Task 来源经原 API 保存为 completed 时，进度只读投影 completed、禁止继续及待处理端点，不写 aggregate。原 Task 恢复仅撤除这层展示覆盖，不清原节点终态/撤权或取消边界。
- **原因：**旧 Task 状态 API 与 aggregate 节点不同步，但实际 Task completed 仍是真实已有完成记录，不能让看板继续显示 ready/canContinue。
- **关联项：**REQ-002、REQ-003、REQ-005、AC-002、AC-008；保持 10 条 REQ、14 条 AC，无新增完成/恢复入口。
- **验证：**本次仅澄清文档。started 仍严格按持久本人 user 输入，禁止 OR 旧 Task.started；后续测试使用真实 Task 创建、delegate、执行和状态 API，不以数据库注入冒充用户动作。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                                                                                           | 备注                                                    |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| AC-001   | PASS | B-UI真实共享项目默认概览、view=board直达/刷新、未知view回概览，node=failed即使带view=board仍先进入原修复。组件真实Tabs切换保其他query/scroll:false、唯一progress读者、成员/共享资料仍在。SF016/017和个人项目/模板回归通过，本人精确空聊天无Board面板。                                                                             | 私人项目保原四状态，不增加全局入口。                    |
| AC-002   | PASS | T-PG精确workspace/owner/sourceId/kind：empty和assistant opening false、user true；同ID他人user不影响本人，错kind/仅外人有来源false/null，无链接。旧Task.started=true但只有assistant仍false。T-HTTP真实Task create→delegate→本人执行ready→PUT completed/restore验证展示完成与恢复，aggregate完全不改；白名单不含正文/来源ID/Skill。 | 历史源异常明确PG fixture；真实完成/恢复使用实际API。    |
| AC-003   | PASS | T-MODEL逐优先级验证授权失效/取消/历史完成先于来源异常，缺失/unknown/awaiting检查、failed、running、真实outgoing等待、未输入和ready，13节点唯一分列。generic waiting但无pending仅可继续，不假完成。真实UI六组50项分布42/1/1/1/2/3，文本标签可读。                                                                                   | 只读派生，不写node状态或完成率。                        |
| AC-004   | PASS | T-HTTP实际A Task本人输入后started=true/ready；B实际答复、B→C交接/C答复、B→A问题/A精确v1答复后合法wait自然出现/消失，普通确认不发送、不完成。旧PG终态fixture中answered/rejected/cancelled/expired均不进入pending；固定联络旧回归保持。                                                                                              | 回答终结与工作完成明确区分，终态fixture不冒称新UI动作。 |
| AC-005   | PASS | 真PG创建41个独立root全量返回且不按同人合并；模型41+重复ID只一张、过滤第41项且总数不变。组件20→40→41/清筛选重置20。B-UI实际50工作、未开始42项20→40→42，offbatch短ID匹配1/全部50；同名other owner 3张/0链接，pending与owner交集0仍正确总数。                                                                                         | 筛选/计数先于显示额度。                                 |
| AC-006   | PASS | 模型真实from/target关系，running与failed保留多入/出/self，非法方向/自称self/缺端点/终态授权失效过滤，self去重一次；待本人仅实际target.ownerId。组件5关联请求全展开；B-UI6项实际元数据含入1/出4/self1，Space展开后完整可达，待本人3卡、other owner交集0。                                                                           | 目标是工作ID，不因同名同人合并，不返回问题全文。        |
| AC-007   | PASS | 组件只给本人精确继续/终态历史/failed原node修复链接，外人及错href/缺source/awaiting无链接。真实UI b348…精确跳本人普通空源，无Board面板；failed仅导航既有修复页未执行。T-HTTP投毒所有模型cipher后10次progress零provider、aggregate/聊天/job计数及source session不变。                                                                | 项目owner不获他人来源，Board本身无retry/发送动作。      |
| AC-008   | PASS | PG错owner-kind/缺来源false/null，控制历史Task.completed覆盖仅投影、抑制pending端点且aggregate不变；取消/撤权优先不被Task完成覆盖。真实Task在无pending的ready后completed/restore仅撤展示覆盖；其后原node真实cancel，再恢复Task仍cancelled/canContinue=false。UI来源异常与原上游不可用明确，无新激活/重建入口。                      | pending期间尝试Task完成实际409，保留原业务guard。       |
| AC-009   | PASS | 模型待本人优先、最旧pending优先，其余updatedAt倒序/ID升序稳定。组件同项目Tabs保filter且1读者、换workspace清filter，A-B-A不复活旧snapshot；B-UI切概览/看板保query，刷新重开回全部、筛选后展示额度重置20，实际owner ID消歧。                                                                                                         | 列表展开和本地排序不持久保存。                          |
| AC-010   | PASS | 真实hook deferred连点6次仅1在途+1合并后续，不abort重启/重叠；隐藏9秒0请求，恢复可见单读；503保原snapshot/readAt、401/403/404清卡/链接/readAt，新retry正常，旧scope延迟响应丢弃。真实API来源表故障503/还原；B-UI真实测试列rename导致503，明确stale及上次readAt/50卡保留，恢复自动刷新原六计数且alert0。                             | 没有内存或空库fallback；真实视觉故障不是mock。          |
| AC-011   | PASS | T-PROCESS实际compiled main.js三次独立启动，空根/本人user/同事opening、真实pending和workflow实例progress逐字段一致；aggregate、source/header/session、聊天/job计数不变。投毒cipher后重启仍可读取，provider调用数不增，无Board表或重复创建。                                                                                         | 子进程真实provider只用于建立输入事实，Board读取不运行。 |
| AC-012   | PASS | 实际IAB 1280×720及390×844，50项/20+、owner/search/pending/clear、6wait及精确导航全部完成。已修初版长列把第二排推至y7583的问题：命名可聚焦滚动region+状态锚点，桌面第二排y598。390六组x29纵排、document/body390，列表332=scroll332；键盘Enter聚焦组标题、Tab滚动区及repair链接407..427可见，End到第42项，Space展开全部wait。        | 实际屏幕证据，不用jsdom证明几何。                       |
| AC-013   | PASS | T-HTTP真实Task源A→B→C原聊天/真实本地provider，B反向补问A与专用确认精确questionId/v1答复，Board wait方向正确、node仅3、session不换，普通分析/确认仍私有。读取响应无私人goal/context/messages/Skill/Agent，查看不访问解密或执行；前五项Skills/固定流程/任务模板全部选定回归通过。                                                    | 受控provider不冒称真实云模型理解质量。                  |
| AC-014   | PASS | T-FINAL同次63files/398tests全部PASS（26.89s，无skip）。新5suite19项、前五项与旧core/Agent/模板/权限回归；最新server、DB/API/Web/core types、根format/lint及最终Web production均exit0。四包lib test/spec产物0，3组件+纯模型与生产副本逐字节一致，AGENTS/UI已同步。                                                                  | 14AC全部有真实证据，六轮按实际范围完成。                |

## 最终结论

- **结果：**Accepted，AC-001–AC-014全部PASS；新5文件19项、最终同次63文件398项测试全部通过。
- **未通过或未执行项：**无。Board保持只读；没有新增拖卡改状态、人工完成或自动执行能力，范围外内容不冒称已交付。
- **后续行动：**本项独立验收完成，Spec与Changes为Accepted、Plan与Tasks为Complete、6任务全部DONE；六项需求→实现→测试轮转完成，主agent汇总最终交付说明。

### 2026-10-20 — 独立功能测试与真实边界

- **新增文件：**`apps/web/tests/lib/project-board.test.ts`5项、`packages/db/tests/project-board.integration.test.ts`2项、`apps/api/tests/project-board.integration.test.ts`1项、`apps/api/tests/project-board-process.integration.test.ts`1项、`apps/web/tests/components/project-board.test.tsx`10项，共5文件19项。纯模型使用完整metadata，组件是真实React/默认组件事件，mock仅传输、路由/账户上下文和缺少的浏览器API，不冒充PG/真实布局。
- **真实持久与HTTP：**随机独立PostgreSQL schema、真实账户/会话/加密模型路由、实际Cordis及loopback OpenAI兼容SSE provider；未输出真实URL/秘密或修改用户数据。PG严格保留source FK，异常来源通过明确历史aggregate引用/种类fixtures构造，不以破坏约束冒充正常删除。
- **真实Task完成：**API真实创建Task、完整人工delegate到B（初始无user，started事实false）、B原question草稿/专用确认、本人持久输入并等待实际ready，再`PUT chat/tasks/:id/status` completed→progress completed/禁continue→restore回ready。两次状态写入前后collaboration aggregate逐字段不变。后续三人往返及精确答复后再次真实完成，原node人工cancel，再Task restore仍cancelled，绝不清旧fence。
- **pending限制如实记录：**有真实待答问题时原Task完成API拒绝409“请先处理或取消当前协作依赖”，测试保留该负例，没有放宽状态机。旧历史completed+pending抑制及撤权/取消优先在明确PG历史fixture验证，仅比较安全读取投影与原aggregate未变；不把SQL历史布置声称为实际用户完成操作。
- **实际三人链：**A Task原来源、B/C普通开场/聊天；通过真实原工具与专用草稿确认交接、回问、精确答复v1，普通确认无新草稿，问题终结后wait消失而非工作完成。后台答复会产生既有自动续跑，测试先观察source实际idle再提交新输入，避免将正常409执行互斥误报缺陷。
- **只读与故障：**全部本人模型cipher投毒后反复读取progress，真实provider数0增长、aggregate与聊天/job计数不变、原session保留。真实HTTP临时重命名本测试scope来源表得到503，恢复后完整原节点；外人和真实撤项目成员404。此是独立单schema（无public fallback）；与后述视觉fault方法如实区分。
- **三boot：**生产`main.js`在同一独立schema三次实际启动。初次真实provider输入建立user事实，之后保存空根、同事opening、合法pending和workflow实例；两次重启读取完全一致。cipher投毒不影响Board读取，来源header/session及所有计数不变，没有board平行主记录。
- **刷新与scope：**新hook测试使用deferred真实Promise和实际reader：同scope manual burst串行合并；隐藏暂停；503保上次成功时间与投影、401/403/404清旧链接；A→B→A不重新显示此前A旧快照，晚到B响应不覆盖新A。父组件单hook供两个keepMounted Tabs，切workspace重置本地filter与数据。

### 2026-10-20 — 最终统一回归与工程

- **实际命令：**私有环境注入`TEST_DATABASE_URL`，本地已有依赖运行`node node_modules/vitest/vitest.mjs run --testTimeout=15000`及下列63文件，同次63files/398tests全部PASS，26.89s，无skip。3条jsdom跨文档导航未实现提示不影响测试；实际导航另有浏览器证据，不把提示当真实导航完成。
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
    - `apps/web/tests/lib/project-board.test.ts`
    - `apps/web/tests/components/project-board.test.tsx`
    - `packages/db/tests/project-board.integration.test.ts`
    - `apps/api/tests/project-board.integration.test.ts`
    - `apps/api/tests/project-board-process.integration.test.ts`
- **工程门：**主agent最终server build（73362）exit0，DB/API/Web/core类型与根format/lint（4668）全部exit0；新5文件ESLint、DB/Web types和Prettier亦独立exit0。已读取`/private/tmp/sf020-format-check.log`明确全部匹配，`/private/tmp/sf020-lint.log`无错误。
- **Web生产：**完整源码外部隔离副本`/private/tmp/ai-harness-sf020-web`，现有依赖不安装，运行`node /Users/kijune/Documents/code/ai-harness/apps/web/node_modules/next/dist/bin/next build --webpack` exit0（20963），日志`/private/tmp/sf020-web-build.log`含完整路由和构建traces，BUILD_ID存在。临时副本关闭webpack缓存规避环境路径缓存问题，原Next配置未改；已实际逐字节核对`project-board.tsx`、`project-progress.tsx`、`team-project.tsx`和`lib/project-board.ts`与最终副本一致。
- **产物与约定：**扫描API/DB/contracts/core运行lib，test/spec产物均0；已读取AGENTS Board只读所有权段和UI规范SF020节，源元数据SQL不加载完整他人Chat/Task/Agent用于推断。

### 2026-10-20 — 最终实际桌面与390验收

- **B-UI真实环境：**主agent使用CUA IAB实际渲染1280×720和390×844（Chrome在Mac锁屏时控制不稳，改用同CUA IAB，并非以组件mock替代）。独立测试schema/API，8个workflow节点、41个project-start及1个历史root，共50；历史running/failed/ended与6wait为明确SQL历史fixture，不冒称provider执行，真实协作执行另由T-HTTP覆盖。
- **计数/交集：**列数42/1/1/1/2/3，20→40→42全部可达；搜索首root短号即使原在后续批仍匹配1/全部50；other同名负责人76c…有3卡且0源链接；待本人3卡，叠加other负责人为0并有清除入口，清除重新20。切概览/Board保query，新打开/刷新默认全部；未知view回概览，显式node深链优先原修复页，私人项目与普通聊天未增加Board。
- **只读导航：**本人emptycard准确href `/?conversation=b34840c1-de9b-46a4-b4be-5d46f211db46`进入既有本人普通空源、未发送模型输入、无Board/额外panel；failed只导航原修复，没有执行retry或切换Agent。
- **实际布局缺陷与修复：**初版首列20长卡把桌面第二排推到y7583，已改为每列有名字/提示/tabIndex=0的有限高度滚动region，以及6状态锚点/h3可聚焦。最终桌面三列两排，第二排y598，列表高432/宽289=scroll289；390六组x29纵向，document/body均390，列表高506/宽332=scroll332。第42项scrollHeight13632/scrollTop13125.5仍可达；6请求全展开后scrollHeight1186/scrollTop679.5，宽332无局部横溢。
- **实际键盘：**Space展开6wait且self仅1；Enter状态锚点聚焦对应h3；Tab进入命名滚动region再Tab精确本人repair链接，407..427px在视口内可见；End到全列表底部。长工作名、同名负责人、完整方向文本均实际换行。
- **真实视觉503：**仅对测试scope临时重命名chat的messages列，实际progress 503，UI保上次成功readAt/50卡并明确“刷新失败，当前仅上次成功读取的数据”；恢复列后自动恢复原42/1/1/1/2/3并清alert。先前尝试整个表rename因视觉fixture search_path的public fallback仅产生sourceUnavailable/47检查，未误计为503证据，原表已恢复。
- **最终截图与数据：**`/private/tmp/sf020-visual/desktop-columns-final.jpg`、`mobile-check-final.jpg`、`mobile-repair-focus-final.jpg`、`mobile-42-final.jpg`、`mobile-waits-final.jpg`、`own-empty-chat-final.jpg`、`mobile-real-503.jpg`；精确动作和几何在同目录`evidence.json`。独立测试agent已实际查看全部7张最终截图及JSON，主agent亦实际复核。初版`desktop-board.jpg`仅记录已修布局缺陷，不用作最终PASS证明。
- **清理：**实际IAB viewport已恢复、测试IAB与Chrome标签均关闭；主agent向测试fixture21978发送SIGTERM，日志确认仅移除本fixture测试schema与listeners，state.ready=false、stoppedAt=2026-10-20T06:17:49.960Z，3100/3101无listener。原用户3000/3001未改动。
- **结论：**14项AC全部PASS，Accepted；实际持久/受控provider/纯模型/组件/浏览器的证据与范围分别记录，六轮交付不包含范围外能力。
