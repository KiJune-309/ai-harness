# Agent 平台功能时序图

状态：待评审。本文描述拟实现的交互，仓库中的 API、存储和页面目前尚未实现。每个操作使用一张独立的 Mermaid `sequenceDiagram`；Agent 执行回合的时序图见[多用户 Agent Harness 设计](./2026-10-01-agent-harness-design.md#运行流程时序图)。

## 范围和约定

- “插件列表”指当前用户上传的个人插件修订版及启用状态。列表由 API 按已认证用户过滤，使用分页；用户标识不从查询参数取得。
- “对话列表”指当前用户在当前工作空间内可访问的会话摘要，按最近活动时间分页。列表读取 PostgreSQL 中的会话元数据；完整消息从会话事件读取。
- 身份验证首版按账号密码设计。API 保存密码验证材料，不保存明文密码；成功登录后签发服务端会话凭证，浏览器通过 `Secure`、`HttpOnly`、`SameSite` Cookie 携带。Redis 保存短期登录会话，PostgreSQL 保存用户主记录。
- 图中的“失败”表示该操作的直接失败分支；具体错误码、字段校验和页面文案在接口设计时确定。注册成功不自动登录。

## 1. 用户获取插件列表

```mermaid
sequenceDiagram
    actor User as 用户
    participant Web as Web
    participant API as API
    participant Auth as 身份验证
    participant DB as PostgreSQL

    User->>Web: 打开个人插件页面
    Web->>API: 请求个人插件列表，附分页参数
    API->>Auth: 验证会话凭证
    alt 凭证无效或过期
        Auth-->>API: 未认证
        API-->>Web: 返回未认证
        Web-->>User: 显示登录入口
    else 已认证
        Auth-->>API: 返回可信 userId
        API->>DB: 按 userId 查询修订版与安装状态，分页
        DB-->>API: 插件摘要、版本、状态、下一页游标
        API-->>Web: 返回个人插件列表
        Web-->>User: 展示插件及启用状态
    end
```

列表只返回展示所需的元数据，不返回插件包、服务端凭据或其他用户的插件。

## 2. 用户上传插件

```mermaid
sequenceDiagram
    actor User as 用户
    participant Web as Web
    participant API as API
    participant Auth as 身份验证
    participant Storage as 对象存储
    participant DB as PostgreSQL

    User->>Web: 选择插件包并填写基本信息
    Web->>API: 上传插件包与元数据
    API->>Auth: 验证会话凭证
    alt 凭证无效或过期
        Auth-->>API: 未认证
        API-->>Web: 拒绝上传
    else 已认证
        Auth-->>API: 返回可信 userId
        API->>API: 校验大小、格式、清单和修订版摘要
        alt 包无效
            API-->>Web: 返回校验错误
        else 包有效
            API->>Storage: 保存不可变插件包
            Storage-->>API: 返回对象引用
            API->>DB: 保存 userId、元数据、对象引用和摘要
            alt 元数据保存失败
                DB-->>API: 返回错误
                API->>Storage: 清理已上传对象或登记待清理任务
                API-->>Web: 返回上传失败
            else 保存成功
                DB-->>API: 返回插件修订版 ID
                API-->>Web: 返回修订版 ID 和未启用状态
                Web-->>User: 显示上传结果
            end
        end
    end
```

上传成功只产生不可变修订版；启用和在个人沙箱装载属于后续独立操作。API 对插件包做结构校验，不运行其中的代码。

## 3. 用户注册

```mermaid
sequenceDiagram
    actor User as 用户
    participant Web as Web
    participant API as API
    participant Auth as 身份验证
    participant DB as PostgreSQL

    User->>Web: 输入账号资料和密码
    Web->>API: 提交注册资料
    API->>Auth: 校验字段并处理密码
    alt 输入不符合规则
        Auth-->>API: 返回校验错误
        API-->>Web: 返回可修正的错误
    else 输入有效
        Auth-->>API: 返回规范化账号与密码验证材料
        API->>DB: 创建用户，账号标识有唯一约束
        alt 账号不可创建
            DB-->>API: 返回冲突或存储错误
            API-->>Web: 返回注册失败
        else 创建成功
            DB-->>API: 返回用户 ID
            API-->>Web: 返回注册成功
            Web-->>User: 提示登录
        end
    end
```

账号标识唯一性由数据库约束保证；密码处理在服务端完成。

## 4. 用户登录

```mermaid
sequenceDiagram
    actor User as 用户
    participant Web as Web
    participant API as API
    participant Auth as 身份验证
    participant DB as PostgreSQL
    participant Redis as Redis

    User->>Web: 输入账号和密码
    Web->>API: 提交登录凭据
    API->>Auth: 执行登录校验和限流检查
    Auth->>DB: 查询用户及密码验证材料
    DB-->>Auth: 返回用户记录或未找到
    Auth->>Auth: 验证密码和账号状态
    alt 凭据无效或登录受限
        Auth-->>API: 登录失败
        API-->>Web: 返回统一登录失败响应
        Web-->>User: 显示登录失败
    else 登录成功
        Auth->>Redis: 保存短期登录会话
        Redis-->>Auth: 返回会话标识
        Auth-->>API: 返回用户 ID 与会话标识
        API-->>Web: 设置安全 Cookie 并返回登录成功
        Web-->>User: 进入已登录页面
    end
```

登录失败响应不区分“账号不存在”和“密码错误”。会话标识只由服务端签发，前端脚本不读取 Cookie 内容。

## 5. 用户获取个人信息

```mermaid
sequenceDiagram
    actor User as 用户
    participant Web as Web
    participant API as API
    participant Auth as 身份验证
    participant DB as PostgreSQL

    User->>Web: 打开个人信息页面
    Web->>API: 请求当前用户信息
    API->>Auth: 验证会话凭证
    alt 凭证无效或过期
        Auth-->>API: 未认证
        API-->>Web: 返回未认证
    else 已认证
        Auth-->>API: 返回可信 userId
        API->>DB: 按 userId 查询可公开的个人资料
        DB-->>API: 返回用户资料
        API-->>Web: 返回用户 ID、展示名等公开字段
        Web-->>User: 展示个人信息
    end
```

响应不包含密码验证材料、会话标识或插件凭据。

## 6. 用户获取对话列表

```mermaid
sequenceDiagram
    actor User as 用户
    participant Web as Web
    participant API as API
    participant Auth as 身份验证与授权
    participant DB as PostgreSQL

    User->>Web: 打开对话页面
    Web->>API: 请求工作空间内的对话列表，附分页参数
    API->>Auth: 验证会话与工作空间权限
    alt 未认证或无权访问工作空间
        Auth-->>API: 拒绝访问
        API-->>Web: 返回未认证或无权限
        Web-->>User: 显示相应提示
    else 已授权
        Auth-->>API: 返回可信 userId 和 workspaceId
        API->>DB: 按 ownerUserId 和 workspaceId 查询会话摘要，分页
        DB-->>API: 返回会话 ID、标题、最近活动时间、下一页游标
        API-->>Web: 返回对话列表
        Web-->>User: 展示对话摘要
    end
```

列表查询同时限定用户和工作空间；客户端提供的会话 ID 或工作空间 ID 不能代替服务端授权检查。

## 核对点

1. 未登录用户不能读取插件列表、个人信息或对话列表，也不能上传插件。
2. 用户 A 的插件及对话不会出现在用户 B 的列表；切换工作空间后重新验证会话列表范围。
3. 上传失败不会留下可启用的插件修订版；上传成功不会执行插件代码。
4. 注册、登录和获取个人信息的响应不泄露密码验证材料或服务端凭据。

## 参考

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：会话 Cookie 和服务端会话管理。
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)：认证处理。
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)：上传文件校验和隔离存储。
