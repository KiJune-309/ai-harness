# SF-005：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-005     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-17 |

## 记录

### 2026-10-17 — 用户需求与规格草案

- **来源：**用户要求完成登录注册、用户名/邮箱/密码修改，以及自己的OpenAI兼容LLM配置；沿用此前无需重复确认、PM和评测代理阶段审查的授权。
- **现状检查：**当前BFF为签名匿名cookie，API只验证服务token和身份header，缺真实账户/会话；模型为全局DeepSeek配置，既有Agent和任务冻结modelId及提示/工具/开场。
- **规格：**12REQ、16AC，覆盖账户闭环、全部会话撤销、个人多模型/默认/只写key/主动测试、真实Cordis路由、隔离与PG恢复；Plan/Tasks仅初始化。
- **收口选择：**根开发者确认显示名2–50、密码12–128、改邮箱/密码撤销全部会话；个人路由稳定ID随当前配置解析，编辑明示影响后续调用，删除拒绝旧引用而非回落；不迁移匿名数据，不虚构邮箱验证或找回。
- **待计划细化：**会话期限、登录频率、LLM目标地址限制及开发本地接口例外，由授权代表审查。
- **验证：**仅代码阅读与规格检查，业务代码未开始，本轮AC均NOT RUN。

### 2026-10-17 — 授权代表批准Spec

- **评审：**独立评测已完整审查12REQ/16AC，确认覆盖真实账户、会话撤销、个人模型Cordis路由及历史兼容，无必须修改Spec项，正式代理批准。
- **计划收口：**开发本地LLM接口例外仅允许管理员环境配置精确origin，不能给任意账户开放全部localhost/private端口；公网目标DNS校验后实际连接固定到已验证地址，禁止重定向。由Plan明确并验证。
- **授权：**依照用户既有PM/评测代审及免重复确认授权，不增加人确认步骤。
- **状态：**Spec Approved；Plan/Tasks仍Awaiting Spec Approval占位，交主开发者编写方案并提交代理审查。业务AC全部NOT RUN，规格批准不是验收通过。

### 2026-10-17 — Plan/Tasks代理批准与实施开始

- 根开发者编写Plan/Tasks，评测代理完整审查批准，无必须重写项；用户此前代理阶段授权有效，直接进入实现。
- 明确7天可撤销session、scrypt参数与频控、AES-GCM绑定范围、模型创建幂等、精确origin例外/DNS固定地址、Cordis临时provider清理及401卸载。
- 后端负责契约/存储/账户接口，Web负责认证与账户页面，根开发者负责模型协议、BFF、聊天Agent路由与集成验证；最终仍需逐项真实验收。

### 2026-10-17 — 实现、独立审查修复及验收证据

- **已实现：**真实注册/登录/登出、7天可撤销session、用户名及敏感邮箱/密码变更；账户范围模型CRUD/默认/只写key/测试，个人路由真正经Cordis执行。生产PG与私有加密key必需，开发memory有持续清空提示。测试仍在各模块tests。
- **权限与秘密：**移除匿名身份授权及user/workspace header信任；Web只发HttpOnly cookie对应session，API查库确定scope。密码scrypt、session SHA256、模型key AES-GCM AAD绑定owner/workspace/config；API/BFF不公开秘密。
- **模型及兼容：**新通用聊天/任务冻结默认路由；每次执行整条解析当前连接，编辑不混旧URL和新key，删除旧引用拒绝且历史可读；现有Agent prompt/tools/openings和模板幂等事务保留。UI显示公开模型名称而非内部路由UUID。
- **审查修复：**评测实际复现provider204/205导致Response构造逃逸，已安全拒绝、回调兜底并增加socket回归；跨tab退出/登录广播随机epoch并先卸载、focus/BFCache复验；个人模型错误引导当前账户设置。PG首次多进程DDL竞态改同client事务advisory lock，新schema四并发pool实际成功。
- **工程验证：**全量1799 PASS、8可选PG SKIP（/tmp/ai-harness-sf005-final-full-tests.log）；同8项已在实际PostgreSQL另行8/8 PASS（/tmp/ai-harness-sf005-final-pg.log），包括独立OS API重启、凭证原子撤销、密文/默认/历史恢复、并发初始化及模板失败回滚。API/Web生产构建、API/core/Web类型、lint和format通过。末尾显示名小修已再次Webbuild/typecheck/lint/format通过。
- **真实模型：**专用QA账户个人OpenAI兼容连接调用已有DeepSeek配置，连接测试成功、普通聊天Cedar22、计算器Agent任务Maple111→115，完成恢复后仍Maple115；goal/opening各1（/tmp/ai-harness-sf005-real-result.json，无密钥）。浏览器又实际立即停止生成显示已停止/保留部分回复，标记完成只读并恢复可续聊。第一次较晚停止时回复已完成，未将其计作取消证据。
- **浏览器：**注册确认不符就近报错并聚焦、真实注册/重新登录、用户名侧栏及刷新同步；模型地址安全拒绝、保存清key、blank-key编辑、删除确认取消、真实连接测试成功。模拟保存失败保留草稿并成功重试。A/B切换使其他tab立即清旧身份，B无A数据；390×844下window/document/body/main均390，导航和登录错误聚焦正常。证据索引/tmp/ai-harness-sf005-browser-evidence.json及其截图。
- **审批记录：**最初真实验收脚本因按名称删除配置的清理逻辑被自动审批拒绝；已完全移除删除动作，改为只新增专用验收数据后获批执行。没有删除已有配置，也没有把秘密打印、写公开文档或截图。
- **待最终裁决：**评测代理复审修复后无剩余必改代码项，正在补验邮箱并发修改和每邮箱登录限流，随后逐16AC裁决。

### 2026-10-17 — 最终独立验收通过

- 评测代理复核16项AC、最终日志及11张浏览器截图，正式裁决Accepted，无剩余必改项。
- 评测追加两项安全回归：每邮箱跨来源10次登录失败后第11次429、15分钟窗口后恢复；两个账户并发修改同一新邮箱，唯一成功者撤销旧session、失败者资料及会话不变。新增回归已持久放在各模块tests。
- 最终全量1799 PASS、8项optional另行真实PG8 PASS；源目录无测试suite，生产构建不产出测试。模型名称最后UI修正后Web build/types/lint/format再次通过。
- 独立复审日志：/tmp/ai-harness-sf005-independent-recheck.log、independent-routing.log、independent-boundaries.log；最终工程日志见上文。

## 验收矩阵

| 验收标准 | 状态 | 证据                                                                                                                                                         | 备注                                  |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| AC-001   | PASS | contracts/accounts与API account-api/account-service、DB唯一邮箱并发；注册UI确认不符与合法注册。                                                              | 唯一稳定账户。                        |
| AC-002   | PASS | account-service/API账户测试、真实PG进程恢复与浏览器重登录/跨tab登出；独立新增每邮箱10失败后第11次429及15分钟窗口恢复实测通过。                               | 服务端session查库与撤销。             |
| AC-003   | PASS | 26项既有HTTP真实session回归、账户API与模型routing跨owner测试、B浏览器空历史。                                                                                | 匿名cookie/header不可绕过。           |
| AC-004   | PASS | 浏览器用户名侧栏/刷新/重登录；账户PG独立进程资料和原task稳定ID恢复。                                                                                         | 归属保持。                            |
| AC-005   | PASS | 账户HTTP双session撤销、PG邮箱已占用rollback与独立进程新邮箱重登录；独立新增真实PG并发争同一新邮箱，仅一成功，失败方原资料/session保持，成功方旧session撤销。 | 仅新邮箱登录。                        |
| AC-006   | PASS | service/API敏感变更及真实PG独立进程新密码登录、旧session全失效；DB仅scrypt。                                                                                 | 原子改密/撤销。                       |
| AC-007   | PASS | 模型routing两项与账户API/service/DB测试；浏览器真实保存、blank-key编辑、只显示已配置。                                                                       | key不回读，CRUD不调用。               |
| AC-008   | PASS | core openai-compatible7项、DNS4项、BFF取消测试；浏览器真实连接成功。                                                                                         | HTTPS/DNS pin/精确origin/拒redirect。 |
| AC-009   | PASS | account-model-routing真实API+Cordis/provider记录默认切换、Agent、template启动；真实DeepSeek结果。                                                            | 按创建时路由执行。                    |
| AC-010   | PASS | routing实际变更URL/model/key后原聊天/任务调用新整条配置；旧历史/goal/opening/prompt不漂移。                                                                  | 没有旧地址接收新key。                 |
| AC-011   | PASS | routing删除后旧历史可读、执行503且零请求；默认清空新内容回服务端；UI取消删除保留。                                                                           | 不静默切换模型。                      |
| AC-012   | PASS | 账户API/DB/路由隔离、AAD密文测试、BFF secret剥离；A/B跨tab截图。                                                                                             | 无密钥/token本地存储。                |
| AC-013   | PASS | 真实PG8项包括独立API关闭重启执行；生产无DB/key拒绝；memory重启旧session401。                                                                                 | 正式持久化已验证。                    |
| AC-014   | PASS | 故障保存截图/重试、注册/登录输入错误、真实390布局、跨tab清理；BFF/body/origin tests。                                                                        | 无假成功，无横溢。                    |
| AC-015   | PASS | 真实个人DeepSeek结果文件+browser task stopped/completed截图和恢复状态。                                                                                      | Cordis真实工具/续聊/停止/恢复。       |
| AC-016   | PASS | 1799全量自动测试及另8真实PG；API/Web build、types/lint/format；src无suite。                                                                                  | 全部通过。                            |

## 最终结论

- **结果：**Accepted，AC-001–AC-016全部PASS，无剩余必改项。
- **状态：**Spec Accepted；Plan/Tasks Completed，T-001–T-007全部DONE。专用验收账户已退出，临时浏览器标签、viewport/CDP注入已恢复，临时测试数据库完成后移除；不删除用户现有配置。
- **运行说明：**当前本地仍为显式memory开发模式，重启会清空账户及配置；正式PG持久化、秘密配置约束与独立API重启恢复已实际验证。邮件验证与找回密码不在本轮范围。
