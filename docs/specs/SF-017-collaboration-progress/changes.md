# SF-017：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-017     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-20 |

## 记录

### 2026-10-20 — 产品经理提出第三项上下游需求

- **变更内容：**新增项目本人工作入口、安全责任关系/待处理投影、流程说明及可验收标准；初始化 Plan/Tasks，未修改业务代码。
- **原因：**主 agent 确认 SF-016 全部验收及生产构建通过；既有上下游虽可执行，用户难辨关系、等待对象和启动路径。
- **授权：**按用户已授权的“产品经理提出 → 主 agent 实现 → 测试 agent 验收”轮转实施，无额外审批。
- **关联项：**REQ-001–REQ-010、AC-001–AC-014。
- **验证：**已重新读取官方上下游正文、最新 SF-016 UI、节点/问题/来源及撤权实现；本期行为尚未实施和测试。
- **结论：**可规划实施；本项独立验收前不提出第四项模板需求。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                                                                                      | 备注                                                                                   |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AC-001   | PASS | T-FINAL真PG双pool同动作并发仅一个空普通chat、根node、bound source及ledger；messages为空、无Task/job/notification/个人project壳。API真实非成员404、伪造owner400，DB Agent身份拒绝，成员无他人chat读取权。                                                                                                                      | 新开始不提前执行。                                                                     |
| AC-002   | PASS | PG/API/组件分别测试空白、121/32001非法，120/32000合法完整保存；同requestId并发与丢响应重试同ID，改内容冲突，新动作同名创建另一个node/chat。组件双击只提交一次、失败保留全文和requestId，409明确重读后再次人工提交。                                                                                                           | 边界通过真实API/PG及组件，没有冒充浏览器手工输入。                                     |
| AC-003   | PASS | 实际组件逐一断言同名本人工作对应不同准确href；完成/取消/撤权进入历史分组、只“查看我的聊天”，无他人继续链接。开始Dialog列每个已有工作，名称/目标初始空白且始终明确新建，不自动选择第一项。                                                                                                                                     | 私有历史查看不恢复执行。                                                               |
| AC-004   | PASS | T-PROVIDER把A持久加密key投毒后仍可创建、重放和读取空chat，零provider调用及jobs；恢复key后首次原始输入经真实Cordis使用A本人model/key，包含显式goal，全部provider输入无独有项目说明/notes标记。A确认交B沿原Project和上游。                                                                                                      | 并非mock解密方法；实际无效cipher负例。                                                 |
| AC-005   | PASS | PG三人投影逐字段断言白名单、3节点/原上下游，秘密goal/context/question/answer/prompt/key均不出现，仅各人真实归属chat有ownHref；Workspace owner无项目资格也拒绝。API D猜progress与A猜C聊天404；多根/分支由独立组件/helper保全。                                                                                                 | 不复用完整node/question作项目公开响应。                                                |
| AC-006   | PASS | PG由真实delegate及受控历史pending分别派生downstream/upstream/self；waiting-owner不改变真实目标。组件实际点筛选并核对目标负责人/方向，只有目标本人有处理链接，请求人只能看自己chat，第三方无链接。                                                                                                                             | B向A真实补问的反向wait由T-PROVIDER执行。                                               |
| AC-007   | PASS | PG同Project四项合法wait同时保留（两条真实delegate、反向及self历史facts），已回答和其他Project记录不混入；逐项终结退出。组件四项请求计数及待我/我等/其他切换，不用node.status覆盖多对象。                                                                                                                                      | 既有执行仍每node一个outgoing；多等待历史fixture如实区别于真实三人往返。                |
| AC-008   | PASS | PG将各问题分别answered/rejected/cancelled/expired后waits=[]，原waiting-owner保持；缺失真实source则不列wait。组件无依赖只写当前无请求，不声称项目完成；撤权历史与失败执行状态明确。                                                                                                                                            | 永久撤权及旧草稿/job回归通过。                                                         |
| AC-009   | PASS | 组件多根/分支/同人多工作/缺失引用/环每节点一次；helper 5000层/重复ID有限遍历。B-UI实际390的21个关系li含3根、分支、12层历史深链、缺失引用和双环，逐项clientWidth=scrollWidth=356，无横向溢出；异常组不猜上游、不写回修复。                                                                                                     | 实际长英文Badge局部裁切已修复并复验，非只量document宽度。                              |
| AC-010   | PASS | T-PROVIDER真实账户/PG/运行时完成A开始→起草交B并专用确认→B私人分析及普通“确认”无草稿→B起草向A补问/确认→A普通“确认”不发送→A精确答复草稿/确认→B同session继续并起草交C/确认。问题回A原chat、精确答案B只一条；重复确认同result，同Project真实A→B→C。                                                                               | 受控本地OpenAI兼容SSE provider，未声称真实云模型。普通聊天UI另由B-UI及旧协作组件验收。 |
| AC-011   | PASS | PG项目移除后progress/旧start重放拒绝，重加仅可历史读取，旧node永久unauthorized/canContinue=false；再新建明确新node。Workspace移除/重入重复验证，成员ID残留不绕过，重放返回原ID而不复活旧grant；旧dispatch/lease/job由SF016实测回归。hook实际轮询403清旧数据、过时响应不覆盖新项目；实际API状态表不可用503，恢复后原记录保留。 | 不把旧revision冲突代替永久撤权。                                                       |
| AC-012   | PASS | T-PROCESS生产main.js真实三次独立启动，原空chat、两节点责任链、真实pending、bound source及session_id全部原样恢复；原start/delegate重放结果相同，chat不重复，无Task/job。PG触发器在source插入抛错，chat/node/action全部回滚，恢复后同动作合法完成。                                                                             | PostgreSQL隔离schema，无进程内fake替代。                                               |
| AC-013   | PASS | B-UI实际desktop/390完成开始、首错focus、Escape取消回主按钮、新建第二根空chat、逐项继续、待我处理跳原chat与关系刷新，普通chat无协作面板。最后Tab名称→目标→取消自动滚Dialog34px，取消/创建完整可见，继续Tab聚焦创建；Enter取消关闭且焦点回开始。组件保稿/防双击/冲突重读亦PASS。                                                | 最终Footer额外真实复验，截图与操作均已记录。                                           |
| AC-014   | PASS | T-FINAL25files/166tests全部PASS；最终UI样式后5files/30tests再次PASS。最新server build、db/api/web types、root lint/format全部exit0；最终外部相同源Next生产构建含/projects/[id]成功，日志/BUILD_ID亲读确认；生产lib无tests。AGENTS/UI已同步。                                                                                  | 受控provider与真实云模型的证据边界如实记录。                                           |

## 最终结论

- **结果：**Accepted，2026-10-20，AC-001–AC-014全部PASS。
- **未通过或未执行项：**无必需验收项遗留。真实云模型未作为本轮测试目标，provider证据明确为受控服务；人数/极限长度/多pending/环等自动化或历史fixture没有冒称手工真实协作生成。
- **后续行动：**可按用户顺序进入第四项任务模板；本轮不将拖拽节点、固定处理人、Skills或看板记为已交付。

### 2026-10-20 — 主agent规划与开始实施

- 已读取全部四文档，填写可追溯Plan/Tasks，按用户预授权轮转实施；后端与Web按文件并行，独立测试在实现后执行。
- 不提前实现第四项模板；AC在实际验收前保持NOT RUN。

### 2026-10-20 — 独立测试与自动化验收

- **新用例：**[真实PG](../../../packages/db/tests/project-progress.integration.test.ts)3项、[真实受控provider HTTP](../../../apps/api/tests/project-progress.integration.test.ts)1项、[独立生产进程](../../../apps/api/tests/project-progress-process.integration.test.ts)1项、[组件交互](../../../apps/web/tests/components/project-progress.test.tsx)7项，共12项；另外适配SF016项目组件从独立safe progress读取精确本人链接。Web agent的[关系helper](../../../apps/web/tests/lib/project-relations.test.ts)3项也在最终独立组合执行。
- **隔离策略：**所有持久用例使用真实本地PostgreSQL随机schema，HTTP及受控provider仅测试自有loopback端口；进程用实际built main.js独立启动三次。私有连接通过环境注入，未打印秘密或改用户业务数据。先前试跑仅修正fixture的用户名长度、严格mention真实姓名、source外键删除顺序、Task存储表查询与历史sent草稿过滤，没有放宽生产权限。
- **T-FINAL实际命令：**私有`TEST_DATABASE_URL`下运行`node node_modules/vitest/vitest.mjs run`，参数为下列25文件；结果25files/166tests全部PASS（21.24s）。未将重叠的多次试跑累加为唯一用例数。
    - SF017：`packages/db/tests/project-progress.integration.test.ts`、`apps/api/tests/project-progress.integration.test.ts`、`apps/api/tests/project-progress-process.integration.test.ts`、`apps/web/tests/components/project-progress.test.tsx`、`apps/web/tests/lib/project-relations.test.ts`。
    - SF016：`packages/db/tests/team-projects.integration.test.ts`、`apps/api/tests/team-projects.integration.test.ts`、`apps/api/tests/team-projects-process.integration.test.ts`、`apps/web/tests/components/team-projects.test.tsx`。
    - SF015：`packages/db/tests/workspaces.integration.test.ts`、`apps/api/tests/workspace-api.integration.test.ts`、`apps/api/tests/workspace-process.integration.test.ts`、`apps/web/tests/components/team-workspaces.test.tsx`、`apps/web/tests/components/workspace-switch-acceptance.test.tsx`。
    - 旧协作及任务/模板：`packages/db/tests/collaboration-persistence.integration.test.ts`、`packages/db/tests/collaboration-dispatch.integration.test.ts`、`packages/db/tests/collaboration-races.integration.test.ts`、`apps/api/tests/project-api.test.ts`、`apps/api/tests/template-api.test.ts`、`apps/api/tests/task-api.test.ts`、`apps/api/tests/collaboration-worker.test.ts`、`apps/api/tests/collaboration-default-model.test.ts`、`apps/web/tests/components/collaboration.test.tsx`、`apps/web/tests/components/project-template-shadcn.test.tsx`、`packages/contracts/tests/collaboration.test.ts`。
- **T-PROVIDER范围：**实际Cordis/worker、真实来源/journal/session、加密个人连接、真实工具调用和持久发送草稿，provider为测试自有本地OpenAI兼容SSE服务；记录每次model/key与消息，按明确测试prompt返回确定工具调用。它验证完整应用路由/审稿/投递/恢复边界，不评价真实云模型的自然语言质量。API查看空chat和收件人开场均未调用模型，C首次输入前始终零C模型调用。
- **T-PROCESS范围：**独立生产进程仅创建/读取/人工交接/重放，不输入工作要求；三次启动后chat与session绑定、两节点及pending稳定，jobs/Task均0。原子故障通过真实PG触发器抛错注入，没有模拟“事务失败”结果。
- **组件证据范围：**使用真实组件及Portal、表单/点击/键盘事件，mock传输与仅jsdom缺失浏览器API；不能由此认定真实几何或provider通过。多pending与环的旧数据fixture也没有冒称由正常单outgoing交互同时创建。

### 2026-10-20 — 最终浏览器复验及工程证据

- **B-UI实际操作：**Web agent在独立验收session/隔离fixture中完成desktop与真实390px：开始按钮Enter打开且初始focus工作名称；空提交聚焦名称，填名称后Enter聚焦目标，Escape回开始按钮；实际新建第二根工作后进入新空普通chat，原工作仍精确进入自己的原chat，待我处理筛选只列B向A反问，Enter处理进入A原chat，普通聊天保持底部输入器且无协作面板。目标字段不预填说明/资料。
- **真实布局及发现修复：**初次390px暴露默认inline-flex/h-5 Badge对长连续英文姓名的局部文字裁切；新进度组件改为可变高度、内部min-width:0文本span及overflow-wrap:anywhere后重新操作。最终document/body宽390、Dialog client/scroll宽358、长Badge client/scroll 298×68、21个责任li client/scroll宽356、待处理段落client/scroll宽326；不是只依靠document宽度认定通过。12层历史深链宽度不随深度增大，缺失引用及双环在关系待整理组仍可读。
- **最终截图：**[desktop-progress-final](/private/tmp/sf017-visual/desktop-progress-final.jpg)、[desktop-start-validation](/private/tmp/sf017-visual/desktop-start-validation.jpg)、[mobile-start-final](/private/tmp/sf017-visual/mobile-start-final.jpg)、[mobile-long-wait](/private/tmp/sf017-visual/mobile-long-wait.jpg)、[mobile-relations](/private/tmp/sf017-visual/mobile-relations.jpg)、[mobile-deep-chain](/private/tmp/sf017-visual/mobile-deep-chain.jpg)、[mobile-invalid-relations](/private/tmp/sf017-visual/mobile-invalid-relations.jpg)、[mobile-created-empty-chat](/private/tmp/sf017-visual/mobile-created-empty-chat.jpg)、[mobile-own-original-chat](/private/tmp/sf017-visual/mobile-own-original-chat.jpg)。测试agent亲自查看其中desktop、移动start/long-wait/relations/deep/invalid及empty-chat共7张最终图；初次失败截图未作为PASS证据。
- **最终UI增量：**Web agent最终运行新progress组件7项、既有team-project11项、helper/client/BFF12项，合计5files/30tests全部PASS；旧Agent8项独立15s deadline运行PASS。几何证据来自真实browser，不由这些组件mock推断。
- **生产及工程门：**主agent最新`node scripts/build-server.mjs`、db/api/web类型检查、`pnpm --config.verify-deps-before-run=false lint`及`pnpm --config.verify-deps-before-run=false format:check`全部退出0。最终长文修复同步到`/private/tmp/ai-harness-sf017-web`相同完整源码隔离副本后，再次执行Next `build --webpack`退出0；仅临时副本webpack cache=false规避环境嵌套缓存路径问题，正式Next配置未改。测试agent亲读[最终构建日志](/private/tmp/sf017-web-build.log)及`.next/BUILD_ID`，16静态页、/projects/[id]及build traces成功。新测试/changes的Prettier和独立ESLint、Web类型检查亦通过。

- **Footer最终补验：**真实390px Tab从名称到目标再到取消时，Dialog自动滚动34px；取消按钮754..786、创建按钮714..746均完整可见，再Tab聚焦创建，回取消按Enter后dialogs=0且焦点返回开始我的工作。补充[mobile-start-footer](/private/tmp/sf017-visual/mobile-start-footer.jpg)由测试agent亲自查看。验收tab已关闭、viewport已恢复，全部AC最终PASS。
