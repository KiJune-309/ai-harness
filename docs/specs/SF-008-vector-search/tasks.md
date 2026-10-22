# SF-008：任务清单

| 字段 | 值                                |
| ---- | --------------------------------- |
| 状态 | Approved — Proxy Review Passed    |
| 关联 | [Spec](spec.md) · [Plan](plan.md) |

## 任务概览

| ID    | 任务                              | REQ / AC                                  | 依赖                       | 状态 |
| ----- | --------------------------------- | ----------------------------------------- | -------------------------- | ---- |
| T-001 | 公开embedding/索引/检索契约       | REQ001–014 / AC001–015                    | 无                         | DONE |
| T-002 | core真实embedding协议和批次边界   | REQ003–005、010、012 / AC002–005、010–012 | T001                       | DONE |
| T-003 | PG模型/向量作业/余弦检索及授权API | REQ001–012、014 / AC001–013、015          | T001、T002接口，T004真扩展 | DONE |
| T-004 | 保全旧数据后安装pgvector          | REQ006、014 / AC006、013、015             | Plan批准与迁移前保全       | DONE |
| T-005 | 账户配置/资料索引/召回调试Web     | REQ001、007–013 / AC001–002、005、007–014 | T001、T003接口             | DONE |
| T-006 | 独立协议/真DB/恢复/UI与工程验收   | REQ001–014 / AC001–015                    | T002–005                   | DONE |

## 任务细节

### T-001：公开契约

- 文件：contracts/src/embeddings.ts、index与tests。
- 产出：Plan明确的模型/空间/能力/动作/索引/查询及响应schema、共享限额。
- 完成标准：严格无秘密响应，验证字段一致、revision/Unicode/数值边界明确；消费者只引用workspace包。
- 验证：契约边界与types；覆盖所有REQ/AC公开边界，无前置依赖。

### T-002：core协议

- 文件：core/chat-runtime/src/embeddings.ts、exports/alias/tests。
- 消费T001，产出实际POST/校验/按字节分批入口，不依赖Nest或tools。
- 完成标准：固定DNS、16条/64KiB/2MiB/30秒/并发4、完整index/同维/float32校验及安全错误；不截断、不随机回退。
- 验证：实际受控HTTP与取消/资源/网络边界；AC003–005、010–012交叉验证；AC002真云独立。

### T-003：DB/API

- 文件：db/src/embeddings.ts/index/tests；API embedding/vector service/controller、app及tests。
- 消费T001/T002接口，产出独立加密模型和真实持久向量API。
- 完成标准：purpose密文/版本CAS/漂移/默认/幂等；public.vector/先空间过滤；lease/checkpoint/完整ready/相容retry/新代重建和生命周期；故障无假成功。
- 验证：真PG多维排序/并发/事务/旧worker/双scope；HTTP授权/确认竞态；独立进程重启。AC001–013、015，云凭据不足不虚报。

### T-004：原业务保全与扩展

- 文件：infra/postgres-vector.Dockerfile、postgres.compose.yaml、必要launcher/tests及私有备份快照。
- 产出：同PG17-alpine平台带固定官方pgvector的运行镜像。
- 完成标准：切换前备份/版本/locale/数据摘要，保持原卷和稳定凭据；旧数据可读且vector SQL真可运行，不能删卷换库。
- 验证：构建/扩展/类型/余弦查询、容器保卷重建、旧账户/原件/分片/向量比对。AC006、013、015。

### T-005：Web

- 文件：embedding-models及account导航、vector index/search组件与/rag/search、client/proxy/tests、详情chunk定位、UI规范/AGENTS。
- 消费T001/T003，产出独立账户配置、主动测试/默认、资料显式索引、召回和来源定位。
- 完成标准：key只写/错误保留/收费触发清楚；分片与索引状态分离，stale可修复，390px与键盘可用，保留最新上传与桌面布局，无聊天RAG假承诺。
- 验证：client/proxy/schema、types/lint、真实桌面/390px/来源。AC001–002、005、007–014，真云另记。

### T-006：交叉验收

- 文件：对应模块tests、SF008四件套、私有日志/截图。
- 消费前五项，产出逐AC实证及修复闭环。
- 完成标准：协议fixture与真实pgvector/进程/容器/权限/UI/工程分别有证据；无云配置AC002/011继续NOT RUN，不能全项接受。
- 验证：适用全量、contracts/db/core/api/web类型、API/Web生产build、lint/format/diff及tests不进生产，旧账户/Cordis/资料回归。REQ001–014/AC001–015。

## 阻塞与汇总

2026-10-18 独立评测 agent 已完成逐项验收，实施及计划内可运行验证任务 6，完成 6，待办 0。证据及逐 AC 裁决见 [Changes](changes.md)：全量132套1928项通过、独立4套22项通过、真实PG/OS进程/保卷容器及桌面390px验证均有实证；协议fixture与真实云分开记录。

首次验收时真实云 AC-002、AC-011 因用户尚未保存 key 保留 NOT RUN，功能曾为 Accepted with outstanding items；该阶段证据仍保留在 Changes 历史记录。

2026-10-18 用户在本地保存真实阿里云配置后，已完成固定两文本测试（实测1024维）、真实上传三片索引、两次真实语义查询与来源核对；评测通过强制只读SQL独立确认真实vector类型/维度/完整计数/冻结空间/源摘要。AC-002、AC-011 已 PASS，当前15项全部PASS，功能最终状态 Accepted，云配置外部依赖已解除。三主题两查询仅是端到端示例，不作整体质量基准承诺；密钥及专属BaseURL不写入仓库文档。
