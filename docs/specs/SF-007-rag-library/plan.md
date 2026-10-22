# SF-007：实施计划

| 字段 | 值                             |
| ---- | ------------------------------ |
| 状态 | Approved — Proxy Review Passed |
| 关联 | [Spec](spec.md)                |
| 日期 | 2026-10-17                     |

## 技术方案与理由

2026-10-17 独立评测 agent 已依据用户阶段代理授权批准本计划及对应 Tasks。真实实现仍须通过逐项 AC 验收；本批准不预先承认产品完成。

复用当前Nest API、PostgreSQL共享池、真实会话及Next同源代理，替换/rag演示。core在现有chat-runtime包新增knowledge公共子路径，负责正文提取/Unicode字符分片和S3兼容对象客户端，不修改Cordis聊天执行器。原文件进入私有MinIO/S3，PG仅保存引用、摘要、参数、任务及分片。正常开发启动创建独立MinIO持久卷和稳定私有凭据，外部S3配置优先；没有配置时知识库明确不可用，不伪造内存数据；部分错误配置拒绝启动。

解析TXT/MD使用严格UTF-8，统一CRLF/CR为LF、去BOM/NUL并拒绝伪装二进制。PDF使用官方pdfjs-dist文本提取，限制500页/2m字符，不执行JS/外链/字体网络加载，扫描件无正文明确失败；DOCX使用mammoth.extractRawText，只返回纯文本，解析前检查ZIP central directory：拒绝加密、ZIP64/多盘、超多entry及展开后超32MiB，阻止压缩炸弹。复杂解析在Worker内，256MiB堆、30秒超时terminate，不影响API主进程。单文件10MiB、正文2m Unicode字符、总分片5000上限。按Unicode code points固定窗口分片，记录0-based起点/排他终点，1-based片序号，默认1000/200，重叠不超过min(500,size/2)；按偏移可精确重建规范化正文。PDF可从真实页边界推导页范围，无法定位不填。

上传使用multipart file/requestId/chunkSize/overlap；Web实际读取body限制10MiB+64KiB，不信任Content-Length，API路由受鉴权后再经Multer单文件/字段/part上限。原文件先按scope/动作/摘要构成的不可猜key写对象，再PG幂等插入queued；同动作同指纹返回原记录，不同内容/参数409。对象成功而DB失败不删可能已提交的对象，以稳定key保证重试，不虚报保存；无公开对象URL。

Web 代理及 API 文件接收各限制单进程同时 4 项上传，后台解析同时 1 项；并发准入只作为资源控制，不替代 PostgreSQL 幂等主记录。若对象写入置于 PostgreSQL 上传动作锁内，须在 10 秒内截止并回滚/释放锁，不能无限阻塞同一动作或共享连接池。

后台任务主记录、generation、leaseToken/expiresAt在PG。API进程单worker定期用FOR UPDATE SKIP LOCKED认领queued/到期processing；带租约token完成/失败，超时旧worker不覆盖新结果。分片与ready在单事务原子提交。重试带动作UUID，复用原对象/参数，PG记幂等动作，同次重试不能产生多个attempt或重复分片；处理中拒绝另开generation。启动自动扫描可恢复任务；停止时终止/等待当前Worker并释放租约，异常退出依靠过期恢复。进程Map/timer仅控制执行，不拥有任务主记录。

## 模块与接口

- contracts/src/knowledge.ts：公开KnowledgeDocument/KnowledgeChunk、上传参数/分页/状态/重试Zod契约及限额常量，不含objectKey/sha凭据。
- db/src/knowledge.ts：KnowledgeStore，接入ChatStore.knowledge可选测试注入、共享pool初始化同原schema事务锁，scope过滤、上传/重试幂等、租约CAS、完成事务、列表/分页。测试fake仅显式注入。
- core/chat-runtime/src/knowledge.ts、knowledge-worker.ts、knowledge-parser.ts、knowledge-objects.ts：统一公共子路径@ai-harness/chat-runtime/knowledge。processKnowledgeDocument({file,format,chunkSize,overlap})返回{characterCount,pageCount?,chunks}；KnowledgeObjectStore提供put/get/close，进程初始化一份client，所有对象操作deadline及字节上限。
- API knowledge-controller/service：授权先行、上传协调、状态、worker、附件下载。ApiResources提供objectStore/processor隔离测试注入；缺知识配置不影响原聊天，知识写入503，配置完整时用真实对象服务。
- Web app/rag与/rag/[id]、library-workspace、knowledge-client/proxy及api/knowledge路由：真实上传/状态轮询/参数/分片分页/失败重试/附件下载；正文纯文本。移除supporting-views演示文件和相关假能力提示，保持公共导航样式。
- infra/object-storage.compose.yaml、scripts/local-object-storage.mjs/dev.mjs：私有凭据文件0600、目录0700，固定专属卷，loopback9002/9003；外部配置优先、不覆盖秘密、已有卷丢配置拒重新生成；普通stop不删卷。

HTTP前缀/api/knowledge（Web转同前缀API）：GET/status；GET/documents?page&pageSize&query；POST/documents multipart；GET/documents/:id；GET/documents/:id/chunks?page&pageSize；POST/documents/:id/retry JSON{requestId}；GET/documents/:id/file安全attachment+nosniff+no-store。文档状态queued/processing/ready/failed，字段fileName/format/size/chunkSize/overlap/attempt/characterCount/chunkCount/times/error?；片字段content/index/characterCount/charStart/charEnd/pageStart?/pageEnd?。下载原字节通过API再次授权，不发公开URL。

## 兼容与迁移

新增资料表/分片表/重试动作记录是增量schema，无旧真实文件迁移，不把演示资料写库。保留既有SF005/006未提交工作，禁止重置PG/私有key/旧卷；正常API已PG，不再存在待保全memory。只新增必要parser/S3依赖，测试仍在各模块tests，生产无测试产物。AGENTS及UI规范同步实际交付与未来检索边界。

## 风险与缓解

| 风险                   | 缓解                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| 解析资源耗尽/文档程序  | 原字节/ZIP展开/字符/页/片上限、隔离Worker内存与超时、纯文本、禁外链 |
| 上传/响应丢失/依赖故障 | 双层实际限额、稳定动作/对象key及指纹、真实存储、可重试、无假成功    |
| 进程中断/并发worker    | PG租约+generation/token CAS，整批原子提交，过期恢复                 |
| 账户泄露/脚本          | user+workspace逐路径过滤、附件安全头、React纯文本，无公开对象URL    |
| 新服务丢数据           | 固定卷、稳定私有凭据、外部优先、丢文件拒替换、实际重建保卷验证      |

## 验证策略

| 检查             | AC            | 方法与通过条件                                                                                                  |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| 上传和解析       | 001–004       | 四格式已知中文/emoji fixture、伪装/空/损坏/加密/扫描/ZIP炸弹/大文件/边界参数；真实内容与分片重建一致，无0片成功 |
| 生命周期和一致性 | 005–007       | 真PG/MinIO；原请求丢响应重试、并发上传/重试、旧租约CAS、部分结果不可见、存储故障、独立API中断后租约恢复         |
| 下载/权限        | 008–009       | 原始hash一致、附件/nosniff/no-store、A/B/不同workspace/匿名覆盖所有路径、对象匿名拒绝                           |
| UI               | 001、005、010 | 桌面及390px真实上传→详情分页→错误重试→下载，真实状态、纯文本不执行、无演示或向量假承诺                          |
| 工程和耐久       | 007、011      | API/DB/对象容器重建保卷恢复原ID/字节/分片；全适用测试、类型、API/Web构建、lint、format及无生产suite             |

## 实施顺序

T001公共契约先行；T002core/对象基础、T003DB/API、T004Web并行，接口固定；T005集成与真实环境切换依赖前四；T006独立逐AC验收并修复。主开发者负责Plan/Tasks；PM在批准后承担DB/API，评测代理审查并独立补验收用例，不自动批准自己未交叉审的实现。

## 变更记录

| 日期       | 变更     | 原因                                       |
| ---------- | -------- | ------------------------------------------ |
| 2026-10-17 | 首版计划 | 代理已批准Spec，用户已授权后续阶段代理评审 |
