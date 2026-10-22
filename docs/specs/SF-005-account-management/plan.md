# SF-005：登录注册与个人账户管理实施计划

## 元信息

| 字段      | 值                 |
| --------- | ------------------ |
| ID        | SF-005             |
| 状态      | Completed          |
| 关联 Spec | [spec.md](spec.md) |
| 创建日期  | 2026-10-17         |
| 最近更新  | 2026-10-17         |

## 技术方案与边界

用真实账户会话替换匿名授权。API保留Web/API私有Bearer认证，但用户身份仅从服务器持久化的opaque session确定；忽略浏览器和Web转发的user/workspace身份声明。注册/登录仅豁免账户session，不豁免私有Bearer。账户与配置存储在packages/db，共用既有PostgreSQL pool，开发memory使用等价独立Map；生产无PG或持久加密密钥启动失败。

contracts新增accounts模块，公开AccountUser、AccountModel、注册/登录/资料变更及模型输入schema；不公开密码hash、密文、session原文或API key回读。账户使用稳定UUID和部署workspace，邮箱trim/lowercase后全局唯一，数据库唯一约束兜底并发。密码不trim，12–128字符，scrypt N=131072/r=8/p=1/maxmem=256MiB，随机salt；最多4个并发hash，超额明确429，避免无界内存增长。账户版本与session创建原子校验，防止修改凭证后并发旧密码登录重新获得有效session。

## 会话与账户API

API /api/account提供POST register/login/logout、GET me、PUT username/email/password；POST register/login返回AccountUser且在私有响应header X-Harness-Session携带新token。BFF只把token变成harness_account_session HttpOnly、SameSite=Strict、Path=/、HTTPS Secure cookie，不返回该header。session32随机字节、仅存SHA256、7天绝对到期；每次登录新建会话，登出撤销当前，改邮箱/密码在同一事务中更新与撤销全部会话。资料修改错误不产生部分写入。登录失败邮箱存在与否采用相同提示和验证工作量。15分钟窗口每邮箱10次失败、每来源60次登录请求；注册每来源10次/15分钟；计数有界并清过期项。

BFF新增固定account白名单，所有mutation要求同源Origin，限制256KiB且禁止redirect；chat代理不再创建匿名身份，只转发账户session，剥离原身份header。Web AuthBoundary在私有数据组件挂载前读取me，未登录转/login；/login、/register为公开页面，安全站内returnTo；任何请求401发布全局失效事件，卸载私有组件并清空账户状态，避免跨账户旧页面残留。修改凭证及登出全页进入登录，密码及key不写localStorage。

## 私人模型及Cordis数据流

个人连接多条，稳定UUID、modelId=account:<uuid>，名称/模型/规范化BaseURL/hasApiKey/isDefault公开；apiKey创建必填、更新空白保留。创建使用requestId作为ID，存储原始规范化参数的服务器HMAC指纹以支持同参数重放返回当前记录，不同参数409，编辑不改原指纹。API AES-256-GCM随机IV，AAD绑定user/workspace/config ID，ACCOUNT_ENCRYPTION_KEY为64位hex；dev启动器在忽略的.local私有文件生成稳定密钥。PG存密文。模型写入不触网；默认切换在用户范围事务串行化，最多一个默认；删除默认后清空，不自动选另一条。

AccountService提供listModels(scope)、defaultModel(scope)、getModel(scope,UUID)返回当前公开配置及解密key（仅服务端）。AgentService目录及校验改为scope-aware，同时保留服务端模型。ChatService创建新通用聊天/任务时冻结默认路由；每次执行按原路由解析当前配置，删掉或跨账户引用明确拒绝，不回落。模板仍冻结实际Agent prompt/tools/openings和路由，创建/启动不调用模型。已有匿名数据不认领；现有服务器模型ID继续冻结模型字符串。

chat-runtime保持一个进程Cordis服务图，加入OpenAI-compatible适配器，单次执行将经过验证的一致连接注册为独立临时provider route，AgentLoop处理消息、工具、流与取消，结束移除注册；不为每条请求重建数据库或Cordis服务图。已有DeepSeek adapter保留。用户连接按BaseURL追加/chat/completions，不强制重复/v1；OpenAI-compatible不发送DeepSeek专有reasoning_content，支持标准流式text/tool_calls/usage。连通测试通过同样适配器发送最小测试prompt，最多32tokens/15秒，可取消，不生成业务数据；失败只返回安全类别。

## 地址安全

默认仅HTTPS公网地址，禁止URL凭据、query、hash与危险地址。OPENAI_ALLOWED_LOCAL_ORIGINS仅允许管理员环境显式列出的精确origin，允许受控HTTP或内网/loopback开发服务，非通配、非用户可改；link-local、metadata、unspecified、multicast永远禁止，包括IPv4映射IPv6。保存只做同步规范化、不DNS或触网。调用前解析全部DNS结果并验证，实际HTTP(S)连接lookup固定已验地址、TLS仍校验原hostname，禁止重定向；连接/响应超时有界，取消销毁socket，限制响应与SSE帧。故障不能反射key、URL中的秘密或provider原文。测试可明确注入受控transport/DNS，生产不能从请求开启绕过。

## Web与兼容

账户设置/account包含资料、安全、模型连接分区；注册/登录独立安静表单，沿用现有tokens，显式label、autocomplete、确认密码、就近错误、提交锁、失败保留非秘密输入。侧栏真实显示当前用户并可进入账户与登出。模型编辑说明影响原路由后续调用，key留空保留，删除确认，测试/设默认有独立反馈。没有配置时给账户模型页入口。390px、键盘和focus验收；现有工作台改为认证后挂载，旧API HTTP回归测试改为真实会话fixture，不为测试保留header后门。

## 实施顺序与验证

T-001契约/存储 → T-002账户认证 → T-003安全模型协议适配 → T-004个人模型与聊天Agent路由 → T-005BFF/登录账户UI → T-006回归、PG独立进程恢复与浏览器 → T-007独立验收。

验证账户边界/唯一邮箱并发/session过期撤销/改凭证竞争、密文AAD、默认并发及全部模型ownership；受控HTTP provider记录真实URL/model/key，覆盖当前路由更新/删除、工具多步/停止与没有自动请求；DNS pin/redirect/内部地址拒绝与精确开发例外；真实PG独立进程重启恢复并执行；用户本地已有DeepSeek密钥仅从私有环境取作受控真实个人连接，不打印或发聊天。执行全量测试、类型、生产构建、lint、format，检查src无suite及产物无tests。无新增服务或不必要依赖。

## 风险与取舍

- 无邮件服务，本轮不做邮箱验证或找回，不虚构可恢复能力。
- anonymous改authenticated是有意权限变化；旧匿名数据不显示，不自动归属新用户。
- 个人连接后续可编辑，稳定路由冻结而非具体地址/model；明确UI说明，取整条当前配置，避免旧地址接收新key。
- 临时memory开发重启会清空账户/模型/业务，UI持续提示；正式部署必须PG和稳定加密密钥。
- 会话失效不允许继续读取/写入；旧已开始流可能在原scope内结束，前端卸载取消，不交给新账户。

## 计划记录

- 2026-10-17：Spec经产品经理与独立评测代理批准后，根开发者完成Plan/Tasks，待代理审查。

- 2026-10-17：独立评测代理批准实施方案；全部任务及16AC已实际通过，完成实现、复审修复及最终验收。
