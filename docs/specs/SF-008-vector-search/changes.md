# SF-008：变更记录

## 元信息

| 字段     | 值         |
| -------- | ---------- |
| ID       | SF-008     |
| 状态     | Accepted   |
| 最近更新 | 2026-10-18 |

## 记录

### 2026-10-18 — 产品规格草稿

- **变更内容：**阅读现有账户、持久化、资料库、加密模型及网络地址约束，编写独立 embedding 配置、真实 pgvector、手动索引和召回调试规格；初始化其他三个模板。
- **原因：**用户要求接入真实向量数据库和向量模型，并已选择 OpenAI 兼容云服务，希望知道如何配置。
- **关联项：**REQ-001–014、AC-001–015。
- **验证：**已阅读现有实现和规范；未写生产实现、未执行功能验证，所有 AC 保持 NOT RUN。真实云凭据不可在聊天中提供，fixture 不可代替真实云结果。
- **结论：**等待评测 agent 代理审查 Spec；Plan/Tasks 尚未填写技术方案及实施任务。

### 2026-10-18 — Spec 独立代理审查通过

- **审查依据：**用户此前授权产品经理/评测代理后续 SDD 阶段；独立评测读取现有账户 AES-GCM 加密、聊天模型隔离、core DNS 固定连接、知识作业租约与 PostgreSQL 边界后审查 REQ-001–014、AC-001–015。
- **结论：**批准，可进入 Plan/Tasks。明确单默认活跃模型空间、可选同范围文档筛选、路由/key 版本失效、固定 provider model/实际维度、float32 转换后有限且非零、embedding 密文用途隔离、重试不偷换默认以及租约恢复不丢持久批次。
- **实施验收重点：**真实 pgvector 类型与 SQL 余弦；保留当前 PG17 平台/数据卷及旧业务；全部外呼走现有 DNS 校验与固定 socket；新完整代才发布；当前用户/工作空间/模型版本/源分片身份逐层过滤。批次调用有界，内部幂等不等于外部计费 exactly-once。
- **证据约束：**现阶段未实现或验证功能，全部产品 AC 保持 NOT RUN；实际云连接测试与实际云索引/查询须有真实 provider 证据，缺凭据时不得以 fixture 改为 PASS。

### 2026-10-18 — Plan/Tasks 独立代理审查通过

- **结论：**批准。六项任务与全部 AC 有对应；core 协议、API 授权/密钥、真实 pgvector/持久作业、Web 确认和原业务保全边界明确，可进入实现。
- **关键审查：**开始/重建带用户已确认的模型 ID/revision 并与当前默认原子比较；网络在模型事务外、验证回写 CAS；真实向量使用 `public.vector`，MATERIALIZED 先过滤完整相容空间再算余弦，不混维度；批次 checkpoint 与索引 generation 持久，过期只换 lease/attempt，全部完成才公开。原 PG17-alpine 平台、locale、凭据和卷须先保全再启用扩展。
- **独立测试重点：**旧 probe/批次/query 返回、默认切换/删除、上溢/下溢全零、真实多维数据库排序、并发动作与 checkpoint 恢复、秘密用途隔离。创建动作在后续修改/删除后不能复活原配置或覆盖新状态；内部幂等不能声明外部计费去重。
- **状态：**仅阶段方案批准，全部产品 AC 继续 NOT RUN；实际云调用两项保持真实外部依赖状态。

### 2026-10-18 — 开始实施与core/真实扩展证据

- **实施：**T-001契约由Web实现者完成并先行冻结；T-002 core与T-003 DB/API并行，T-004保全/扩展由主开发者执行，T-005 Web与T-006独立验证继续实施。未提前认定产品AC通过。
- **Core：**实际OpenAI兼容POST复用受保护网络；按字节完整分批、序号/同维/float32有效性、错误分类、真实HTTP超时。基础6项测试、chat-runtime build、定向ESLint通过；结果在本机 /tmp/ai-harness-sf008-core-tests.log 与 core-build.log，独立限额/并发验证另行继续。
- **保全：**切换前pg_dump成功，备份.local/before-pgvector-20261018.dump为0600；私有逐行快照包含原12表154行。旧PG17.11/Alpine3.24.2、编码、collation/ctype已记录。
- **真实向量库：**使用同一postgres:17-alpine编译官方pgvector0.8.7；源码SHA256 cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85，构建exit0。保原卷重建后原154行逐行完全保留，平台/locale完全一致；public.vector扩展0.8.7、真实[1,0]与[0,1]余弦距离1通过。证据 /tmp/ai-harness-sf008-vector-image.log、migration-before.log、migration-after.log；没有删卷或重置密钥。
- **边界：**T-001/002/004组件完成不等于最终AC接受；新向量作业与真实云端到端尚待后续验证，AC002/011继续NOT RUN。

### 2026-10-18 — 独立验收与修复闭环（首次，真实云配置前）

- **实现结果：**独立 embedding 配置、用途加密/版本确认、真实 pgvector、持久批次/租约、显式召回与来源定位已实现。T-001–006 的实施及可运行验收完成，真实云两项保留外部依赖，不能把任务完成解释为全部产品 AC 通过。
- **独立执行：**4 套 acceptance tests 共 22 项全部 PASS，无 skip。core 7 项实际 native HTTP 协议、API 6 项实际 HTTP 与真 PG、DB 6 项真 pgvector 与 2 项明确受控初始化故障、production OS 恢复 1 项。日志 `/tmp/ai-harness-sf008-independent-acceptance.log`。使用生产 core adapter；受控来源/响应明确为 fixture，不算真实云调用。
- **修复闭环：**独立发现合法 `3e38`/`1e-40` 在原生范数中产生 NaN；经代理批准后入库/query 一致稳定单位化，真 PG 同向/反向/正交距离通过，原 float32 上溢/全零下溢继续拒绝。另发现旧密文不能解密时无法用新 key 修复，现允许明确输入替换损坏旧凭据并验证升版本/清验证/实际使用新 key。
- **恢复实证：**真实生产 `lib/main.js` 子进程在首 16/18 片提交后 SIGKILL，新 PID/新池复用旧会话，租约到期仅补发剩余 2 片，保持 generation 1、attempt 2。普通 Nest 关闭取消实际 provider 请求并释放 lease；原 ready 向量文本、模型/默认/验证和查询来源精确一致。
- **容器实证：**保原卷 force-recreate 后，3072 维两条新向量及七张关联表逐行不变，真实距离 `[0,2]`，之后只清理自有证明 schema；迁移前原 12 表 154 行、PG17.11/aarch64/Alpine3.24.2 和 locale 也逐项保全。
- **浏览器实证：**独立 localhost 账户使用生产 API/Web 与受控真实 HTTP provider。save=0 调用，test=1、30 片 index=2、两次 query=2，共 5 次。桌面首条 chunk22，来源进入第 2 页并聚焦 `chunk-22`；390×844 下 innerWidth=scrollWidth=390，Top K 1 返回同一来源。改 model 后 revision2/清验证/旧代 stale，原 30 片可读。评测已直接复核配置、召回、来源桌面/移动截图及 report。
- **秘密证据边界：**保存后 key 输入框已清空；源码与 client/proxy tests 无 key 浏览器持久化路径。浏览器工具没有读取 localStorage/sessionStorage，不声称执行过隐藏状态检查。公开响应/快照/错误无 key/密文；同 owner/ID 的合法聊天密文不能用于 embedding，原聊天解密兼容性另有通过的单测。
- **原业务补验：**主服务恢复后，仅以 GET 对原 5 个资料核对 metadata/chunks，均与 SF-007 快照完全相同，原件下载 SHA256 全部匹配；foreign 15 次 GET 均 404，匿名 401。原 KiJune 浏览器会话仍可用，没有用隔离验收账户替换该会话。证据 `/tmp/ai-harness-sf008-original-rag-readonly.log`。
- **用户真实云配置：**用户已指定阿里云百炼及 `qwen3.7-text-embedding-flash`，非秘密字段已在私有界面预填；工作空间专属 Base URL 不写入仓库文档或示例。剩余外部依赖是用户本地填写并保存实际 key、明确测试/索引/查询；尚未执行云调用，维度与 provider model 必须由真实响应记录。
- **工程实证：**全量 132 套/1928 项 PASS 无 skip，独立后续补口最终 22 项另行 PASS，不相加充当去重总数。各包类型、API/Web production build、根 lint/format/diff 均通过；独立扫描本轮 lib 无 tests/suite。所有测试均在各模块 tests。

### 2026-10-18 — 真实阿里云补充验收通过

- **前置与调用：**用户在本地保存真实 key 并回复已保存后，主开发者通过原用户界面明确点击测试。生产入口没有注入 generator，实际调用 core 的 `/embeddings` 适配；固定两条非秘密探针完整通过，实测并保存 `qwen3.7-text-embedding-flash`、1024 维、配置版本 1。维度来自实际响应，不是供应商默认值或手填数据。probe 没有产生资料向量。
- **真实资料索引：**通过真实界面上传 `SF008-真实云向量验收.txt`，正文为 1200 字符的非秘密虚构三主题内容，400 字符/overlap0 共三片；显式开始索引后 generation1/attempt1、3/3 ready。三条资料向量均实际来自当前阿里云连接，未使用此前的受控协议 provider。
- **独立真数据库复核：**评测 agent 用强制只读连接，仅 SELECT 这份新验收资料及对应空间，独立确认物理 `vector` 三条各 1024 维、分片 ID/配置版本/冻结 model/provider identity/generation 精确一致，单位范数及自身余弦距离有限，完整源正文拼接 SHA256 与原上传一致。没有 SELECT key、专属 Base URL 或 raw vector，没有再次请求 provider。证据 `.local/sf008-cloud-independent-db-report.json`、`/tmp/ai-harness-sf008-real-cloud-independent-db.log`。
- **真实语义查询与来源：**同一已验证云空间实际查询“图书馆可借几本/多久归还”，首条为分片1，UI余弦距离0.211406，正文含四本/二十一天；查询“观星几点/哪里集合”，首条为分片2，距离0.239742，正文含周六晚上八点/北门广场。两次顺序分别[1,2,3]、[2,3,1]。点击第二条查询来源，真实导航到 `?chunk=2#chunk-2`、聚焦 `chunk-2`，字符[400,800)、400字符正文与原片相同。评测直接查看连接、索引完成、两次召回和原片截图及公开AX结果。
- **证据与结论：**`.local/sf008-cloud-ui-report.json`、`sf008-cloud-db-report.json`，以及云连接/索引/两条查询/来源截图；AC-002、AC-011 由 NOT RUN 改为 PASS，其余13项沿用已有通过证据。全部15项 PASS，功能更新为 Accepted；旧的 Pending/未配置记录保留为历史。
- **证据边界：**这是一个虚构三主题资料和两条真实云查询的端到端示例，不能据此声称整体语义质量或质量基准达标。密钥未读取、未进入文档；工作空间专属 Base URL 仍仅保留私有配置/截图。普通聊天自动 RAG 仍在本轮范围之外。

## 证据索引

- 独立协议：[embedding-acceptance.spec.ts](../../../packages/core/chat-runtime/tests/embedding-acceptance.spec.ts)；独立 DB：[vector-acceptance.integration.test.ts](../../../packages/db/tests/vector-acceptance.integration.test.ts)；HTTP：[vector-acceptance.integration.test.ts](../../../apps/api/tests/vector-acceptance.integration.test.ts)；OS：[vector-process-acceptance.integration.test.ts](../../../apps/api/tests/vector-process-acceptance.integration.test.ts)。统一日志 `/tmp/ai-harness-sf008-independent-acceptance.log`。
- 基础协议、共享 DNS/socket/redirect、purpose 秘密、HTTP 授权、实际 S3 原件与旧账户/Cordis/项目/资料回归：`/tmp/ai-harness-sf008-full-tests-final.log`。
- 原账户与资料恢复后的只读补验：`/tmp/ai-harness-sf008-original-rag-readonly.log`，5 个原件 SHA256、原 metadata/chunks、foreign/anonymous 权限均通过；不重新上传或重试修改原记录。
- 真实阿里云：`.local/sf008-cloud-ui-report.json`、`sf008-cloud-db-report.json`、`sf008-cloud-independent-db-report.json`；`/tmp/ai-harness-sf008-real-cloud-db.log`、`real-cloud-independent-db.log`；截图 `.local/sf008-cloud-{connection,index-ready,query-library,query-astronomy,source}.png` 与查询 AX `.local/sf008-cloud-query-astronomy.ax.txt`。独立 SQL 强制只读，原始向量、秘密 key 和专属连接地址不进入这些报告或仓库文档。
- 迁移/容器：`/tmp/ai-harness-sf008-migration-{before,after}.log`、`vector-image.log`、`container-{before,after,cleanup}.log`。备份及逐行快照在忽略的 `.local`，不提交数据库原文或连接秘密。
- 浏览器：`.local/sf008-browser-report.json` 及 `sf008-embedding-settings-mobile.png`、`sf008-browser-retrieval-{desktop,mobile}.png`、`sf008-browser-source-{desktop,mobile}.png`、`sf008-browser-stale-index.png`。report 明确 cloud=false；这套浏览器 fixture 不覆盖原件下载。
- 工程：`/tmp/ai-harness-sf008-api-build-final.log`、`web-build.log`、`{core,api,db,web}-types-final.log`、`full-lint-final.log`、`full-format-final.log`；省略前缀均为 `ai-harness-sf008-`。

## 验收矩阵

| 验收标准 | 状态 | 证据（命令、结果或观察）                                                                                                                                                                                                                                         | 备注                                                        |
| -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| AC-001   | PASS | 独立 DB 8 并发创建/唯一默认/tombstone，HTTP 创建/编辑/列表/空 key 保留/替换/重放零隐式调用；浏览器 saveCalls=0/key 清空。独立聊天与 embedding 路径、旧账户/Cordis 回归通过。                                                                                     | 删除不暗选替代；未验证不能索引/查询。                       |
| AC-002   | PASS | 用户本地保存真实阿里云key后，实际UI明确测试；生产core两固定非秘密文本请求成功，实际provider model为qwen3.7-text-embedding-flash，实测并持久保存1024维/revision1/verifiedAt。评测复核连接截图、生产路径与只读PG模型信息；资料向量仅有三条原片，无probe向量。      | 真实云证据，不使用fixture或文档默认维度。                   |
| AC-003   | PASS | core 真实 HTTP 乱序、畸形 index/model/维度/值、401/429/500、超大响应和 deadline；API 真实 429 中间批失败不发布半代，错误无秘密哨兵；真 PG 极值稳定余弦、非法 float32 拒绝。                                                                                      | 无伪成功、NaN 补零或截断。                                  |
| AC-004   | PASS | 独立 16 输入/64 KiB/2 MiB、硬截止、并发4、取消释放及禁止地址零连接；共享网络实现的混合 DNS、固定 socket、metadata/redirect 回归全量通过，所有外呼复用生产 adapter。                                                                                              | 浏览器不能放宽网络策略。                                    |
| AC-005   | PASS | DB 名称不升版、route/key 升版清验证、旧 CAS 拒绝；HTTP 旧 probe 编辑后409、旧 query 默认切换409、provider 漂移拒绝/重测 revision2/旧代 stale，迟到 batch/异空间 retry 拒绝。                                                                                     | 浏览器配置修改复验，旧响应不复活向量。                      |
| AC-006   | PASS | 真 public.vector0.8.7/SQL cosine、同 PG17 平台保原卷与原154行。受控42501/58P01只回滚 optional savepoint、08006原错误传播；真实 API 仅注入 false vector 能力后 start/search503、零外呼，账户及原 ready 分片不变。                                                 | 故障是明确测试注入，未破坏共享扩展或停主数据库。            |
| AC-007   | PASS | 未验证/无相容索引/未满足状态零外呼；确认 modelId/revision 与当前默认原子比较；真 DB 同表2D/3D、foreign相同model UUID隔离；浏览器仅明确动作索引30片。                                                                                                             | 保存/加载/切默认不自动索引。                                |
| AC-008   | PASS | 真 DB 首批16/18不可召回、SQL第二片故障整批回滚、重建旧代立即退出；HTTP中间批429→failed16，原chunk精确不变，显式相容retry仅补2片再完整ready；并发重放不新增代。                                                                                                   | 进度来自持久行，部分代不可见。                              |
| AC-009   | PASS | 双claim/到期换token、旧heartbeat/fail/release/save全拒；普通Nest关闭释放；实际OS SIGKILL→新PID同代attempt2仅补剩余2片；相容retry同代、异空间retry409要求明确新代。                                                                                               | 不承诺第三方计费 exactly-once。                             |
| AC-010   | PASS | HTTP trim/Unicode/Top K/单文档、越权/不存在/无索引零外呼；真PG距离[0,1,2]、score[1,0,-1]及极值方向正确，混维先过滤、稳定次序；浏览器原片序号/正文/位置吻合。                                                                                                     | 当前完整相容代；分数不是概率或置信度。                      |
| AC-011   | PASS | 真实UI上传1200字符虚构三主题TXT→3个400字符片→显式阿里云索引3/3 ready；独立只读PG确认真实vector三条1024维、同model/revision1/generation1及源SHA。两条真实查询首片分别1/2，UI距离0.211406/0.239742，来源定位chunk2/[400,800)正文一致。报告与截图见真实云证据索引。 | 一个三主题两查询端到端示例，不是整体语义质量benchmark。     |
| AC-012   | PASS | 持久会话 HTTP 覆盖模型读/改/删/test/default和索引读/开始/retry/query匿名401、foreign404；DB双scope；purpose密文拒与旧chat解密兼容；公开响应无秘密，client/proxy/失效会话回归通过。                                                                               | key保存后清空；storage未实读，仅源码/测试证明无持久化路径。 |
| AC-013   | PASS | 真实OS重启保持session/model/default/验证/ready元数据、向量文本及查询来源；真实容器保原卷重建，3072维两向量/七表精确保留；原154行/平台/locale保全。主服务恢复后原5资料metadata/chunks与旧快照精确一致、原件SHA256全部匹配，旧KiJune会话仍可用。                   | 浏览器fixture不覆盖原件下载；原始对象沿用持久S3。           |
| AC-014   | PASS | 实际桌面/390×844配置空校验/错误保留/保存清key→测试→默认→30片索引→查询→来源第2页chunk22焦点；移动宽390无横溢出，model变更stale/修复指引。评测直接复核截图及report。                                                                                               | 受控本地provider，费用触发与尚未聊天RAG明确。               |
| AC-015   | PASS | 全量132套1928 PASS无skip，独立4套22 PASS无skip；各包types、API/Web build、根lint/format/diff通过；本轮lib无suite，旧账户/Cordis/项目/资料回归通过。                                                                                                              | 两组计数不相加；真实云后续补验另列独立证据。                |

## 最终结论

- **验收日期：**2026-10-18。
- **结果：**Accepted；15 项 PASS、0 NOT RUN、0 FAIL。实施任务6项全部完成，原真实云外部依赖已解除。
- **真实云闭环：**阿里云百炼 `qwen3.7-text-embedding-flash` 实测1024维，两固定文本测试、真实上传/三片云索引、两次语义查询与来源均通过，评测独立只读真PG复核通过。
- **结论边界：**当前示例证明真实云接入、物理向量落库和来源闭环；不等于全面检索质量基准，也不表示普通聊天自动使用资料库。密钥与专属 Base URL 不进入公开文档；此前受控 fixture 证据继续单独保留。
