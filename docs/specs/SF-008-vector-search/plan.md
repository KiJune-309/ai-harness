# SF-008：实施计划

| 字段 | 值                                  |
| ---- | ----------------------------------- |
| 状态 | Approved — Proxy Review Passed      |
| 关联 | [Spec](spec.md) · [Tasks](tasks.md) |
| 日期 | 2026-10-18                          |

## 技术方案与理由

2026-10-18 独立评测 agent 已依据既有阶段代理授权批准本计划及对应 Tasks。此批准允许按依赖实施，实际云模型验收仍须真实凭据和实际调用证据；协议 fixture 不提前替代 AC-002、AC-011。

Spec已由独立评测代理批准。新增独立embedding配置和core稳定子入口，复用现有账户/密钥、固定DNS网络策略、PG连接池和文档分片，不改Cordis聊天路径、不增加服务包。API持有真实授权和解密能力，Web只使用contracts，向量及作业均为数据库主记录。

真实pgvector使用public.vector可变维度列、1–4096维产品限额；首版精确cosine，不建立受2000维限制的vector HNSW。SQL用MATERIALIZED CTE先限定user/workspace、当前默认模型空间和完整ready代，再用明确public操作符计算余弦距离，避免其他维度进入计算。score=1-distance，不表示概率。

本机已确认PG17.11/Alpine3.24.2且有server headers、无vector。infra在同一postgres:17-alpine基础上编译固定官方pgvector版本和校验摘要，便携编译，不切glibc、不升主版本或改PGDATA/卷。先保存0600私有备份、版本/locale和业务快照，构建成功才保原卷替换容器并核对。外部扩展缺失/无安装权限只禁用向量职责，原账户/聊天/资料仍可运行。

## 契约与接口

新增contracts/src/embeddings.ts，严格公开schema/type，无密钥、密文、指纹或原向量响应：

- EmbeddingModel：id/name/baseUrl/model/hasApiKey/isDefault/revision/createdAt/updatedAt；dimensions/providerModel/verifiedAt验证成功才同在，否则同缺。create有requestId和必填apiKey；update有预期revision，空key保留。
- EmbeddingModelTest：{success:true,message,model:EmbeddingModel}；列表{models:EmbeddingModel[]}。
- EmbeddingSpace：id/name/revision/model/providerModel/dimensions，name不参与空间相等判断。
- VectorStatus：{available:boolean,defaultModel:EmbeddingModel|null,reason?:string}。
- KnowledgeVectorIndex：documentId/status（none/queued/indexing/ready/failed/stale）/generation/attempt/completedChunks/totalChunks，可选model:EmbeddingSpace、error、createdAt/updatedAt；none代数/次数/完成数为0。
- KnowledgeIndexAction：requestId/modelId/revision。后两者是用户点击前所见默认配置的预期条件，API/DB必须与可信当前默认原子比较，变化409，不能静默按另一模型计费。动作指纹含此确认身份。
- KnowledgeSearch：去首尾空白query，1–2000 Unicode字符；topK1–20默认5；documentId可选。
- KnowledgeSearchResult：query/model:EmbeddingSpace/hits；hit为documentId/fileName/chunk:KnowledgeChunk/distance/score，完整原片不返回向量。

| 路径                                      | 方法                                           |
| ----------------------------------------- | ---------------------------------------------- |
| /api/account/embedding-models             | GET列表、POST幂等创建                          |
| /api/account/embedding-models/:id         | GET公开详情、PUT按revision更新、DELETE确认删除 |
| /api/account/embedding-models/:id/test    | POST显式可取消测试                             |
| /api/account/embedding-models/:id/default | POST原子默认，不调用provider                   |
| /api/knowledge/vector-status              | GET能力和当前默认                              |
| /api/knowledge/documents/:id/index        | GET状态、POST显式开始/重建                     |
| /api/knowledge/documents/:id/index/retry  | POST只重试相容失败代                           |
| /api/knowledge/search                     | POST显式召回，不生成回答                       |

Web同源代理显式扩方法/路径白名单、实际有界JSON和持久session规则。匿名/跨范围UUID统一拒绝；可选documentId先查授权，不因未建索引泄露是否存在。

## Core协议与模型身份

新增@ai-harness/chat-runtime/embeddings，src/embeddings.ts；EmbeddingConnection={baseUrl,apiKey,model}，EmbeddingResult={model,dimensions,vectors:number[][]}。createEmbeddings(connection,inputs,options?)与按字节规划批次的辅助入口；options含signal、管理员allowedLocalOrigins与显式测试transport，生产用createModelFetch。

API根地址去尾斜线补/embeddings，拒误填完整embeddings/chat endpoint。发送model、字符串input数组、encoding_format=float；不发dimensions、不添加query/document私有提示词。输入1–16条，实际JSON body≤64KiB、response≤2MiB、总截止30秒、每进程4外呼并发；按字节拆批，单片过大失败，不截断。检查response.model、全部唯一完整index和同维1–4096；float32转换后有限且非零，乱序归位；网络/协议错误安全分类，绝不反射provider原文。

独立embedding凭据复用稳定ACCOUNT_ENCRYPTION_KEY，AES-GCM AAD含embedding purpose+scope/id，不能与聊天密文互换；创建HMAC指纹幂等。URL/model/key真实变化单调加revision清验证，name变化不影响空间。更新revision CAS；测试外呼在事务外，回写锁行CAS拒旧结果。复测providerModel或维度变化须新revision后保存新验证。所有批次/查询检查验证的providerModel和维度，不能同名同维就跨配置混合。

## PG作业与数据流

新增独立模型/创建动作、向量作业/动作及vector批次表，挂ChatStore可选embeddings职责并复用池/schema初始化锁。扩展固定public，显式类型/操作符；随机测试schema不能拥有共享扩展。缺安装权限用savepoint隔离，只返回向量不可用，数据库连接故障仍传播，不用JSON/内存替代。

当前用户唯一default embedding决定活跃空间。删除默认不暗选其他连接；未验证不可建索引/查询。开始事务检查预期default、source ready并冻结源分片身份/摘要及空间；动作先查重放，不能重置后来状态。同动作不同资料/参数409。重建新generation使旧代立即不可召回，派生旧向量可同事务清理，原文/分片不动。

单worker用SKIP LOCKED认领；generation只随明确重建变化，租约过期换token/增加attempt，不改generation，复用已存checkpoint。每批有界取未完成片、调用provider、持token事务核对源和当前空间再写真实vector/进度。只在全部源片正确同代存在后原子ready。部分/失败代永不召回；全量向量不能常驻JS内存。旧token/过期租约结果拒绝。

失败retry只在当前default与旧冻结空间/源相容时同代queued并保留checkpoint；失配409要求明确重建新代。普通关闭先停worker/中止请求/释放lease，再由原ChatService关池；SIGKILL靠过期恢复。同步测试和查询断连取消，持久任务不随关页面消失。外部丢响应可有限重发，不承诺费用exactly-once。

DB共用vectorValues先验证float32有限且非零，再按最大绝对幅值缩放、以双精度求范数并单位化，最后转float32；入库与query完全同一策略，保留余弦方向，防止合法3e38/1e-40幅值导致pgvector范数溢出/下溢和NaN。core不改变合法协议原值；真实PG验证极大/极小正向、反向和正交距离。

查询先查scope、verified默认和相容ready数据；无索引零外呼并给建索引提示。调用前后、DB读取事务及返回前核对空间，变化拒绝不偷换；真实SQL距离排序加稳定tie-break，返回TopK原片和来源。

## Web

新embedding-models组件挂/account#embedding-models，独立卡片/编辑器/测试取消/验证元数据/唯一默认/删除确认；key只写、错误保留，解释根地址和专用embedding ID、自动维度、保存零调用与测试/索引/查询收费触发，不混聊天目录。

资料详情新增独立索引卡，读vector-status/index，展示默认空间、片数、真实进度；显式开始/重建/retry和待处理轮询。未ready/未验证/不可用均禁用并给修复入口，没有独立模型选择器。

新/rag/search和资料库入口，查询/TopK/可选文档范围、真实命中与分数含义、纯文本来源。来源携带chunk序号，详情据其定位正确分页/稳定锚点。保留长方形上传框、无桌面顶栏，验证390px/键盘/长内容；同步UI规范和AGENTS实际职责，明确尚未聊天RAG。

## 验证策略与风险

| 检查           | AC                | 方法                                                                                                                    |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 配置/秘密/版本 | 001–005、012      | 零隐式调用、幂等/并发默认/更新、purpose密文互换、旧probe CAS、漂移；真云测试独立记录                                    |
| 协议/网络限额  | 003–004           | 受控真实HTTP、乱序/非法/float32溢出下溢、大小/截止/并发/取消，所有路径复用固定DNS策略                                   |
| 真DB与迁移     | 006–007、010、013 | 原PG备份/平台/locale快照、实际vector列与已知cosine、多维/双scope隔离，原卷重建精确比对                                  |
| 作业/恢复      | 007–010、012–013  | 多批故障、动作重放/确认竞态/旧token、checkpoint/整代原子性、正常关闭和独立进程SIGKILL                                   |
| 真实云         | 002、011          | 用户本地配置后的真实probe、chunk/query和来源；未配保持NOT RUN，fixture不能替代                                          |
| UI/工程        | 014–015           | 桌面/390px/键盘/来源定位、全适用测试、各包类型、API/Web生产build、lint/format、旧账户/Cordis/资料回归，suite不入src/lib |

镜像/卷风险以同平台构建+先备份控制；混空间以版本冻结/CAS和materialized过滤控制；资源/计费以显式操作+硬限额+checkpoint控制；半批公开以完整事务发布控制。真实云凭据是外部依赖，不能把协议fixture结果当云语义效果。

## 顺序与职责

T001契约先行；T002 core与T003 DB/API按冻结接口并行，T004保全/安装由根负责；T005 Web消费同一契约；T006独立交叉验收。根写Plan/Tasks及core/infra，PM批准后写DB/API，Web实现者写contracts/Web，eval只代理审查与独立验证。

## 计划变更

| 日期       | 变更                         | 原因                                   |
| ---------- | ---------------------------- | -------------------------------------- |
| 2026-10-18 | Spec代理批准后首版Plan/Tasks | 用户已授权阶段代理；真实云依赖本地配置 |
