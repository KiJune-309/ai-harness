# SF-015 参考与现状记录

## 官方参考

- [Workspace 与成员](https://docs.syncless.ai/zh-Hans/core-concepts/workspace-members/)，2026-10-20 读取。直接打开曾返回工具 Internal Error，随后通过官方快速开始页中的链接成功完整读取。
- [快速开始](https://docs.syncless.ai/zh-Hans/get-started/quick-start/)，2026-10-20 读取，补充第一次登录、选择空间、邀请同事再协作的使用顺序。
- [用户 API](https://docs.syncless.ai/zh-Hans/api-reference/users/)，2026-10-20 官方搜索结果读取：可查询当前工作空间的活跃用户，供模板负责人选择；未将该参考的 API 设计直接移植到本系统。

官方页面确认工作空间承载团队及资源权限；加入成员后才参与项目、被分配工作和被 @。页面未说明具体角色等级、邮件服务、加入协议和历史迁移。本规格的两级角色、站内邮箱邀请、主动接受、七天到期和默认兼容空间均是本项目产品选择，不声称为参考产品原功能。

## 当前系统事实

- `apps/web/components/workspace.tsx` 的 SidebarHeader 目前仅有 Logo，Logo 下是开始聊天/导航；SidebarFooter 是真实个人账户菜单，适合把团队切换器放在 Logo 下而保留账户入口。
- `docs/ui-design-spec.md` 要求官方 shadcn/ui Base Nova/Neutral 默认组件，桌面无共享顶部栏，移动 Sheet 保留完整导航；当前顶部与底部结构需要沿用。
- `apps/api/src/account-service.ts` 注册账户绑定服务配置的 `workspaceId`；账户/会话、模型配置由真实 API 管理，旧 scope 不宜重写。
- `packages/db/src/accounts.ts` 的模型表按 workspace/user 保存，加密绑定原 scope；个人模型不应被复制到团队或作为团队公用密钥。
- `packages/db/src/collaboration.ts` 的成员解析目前依赖账户 `workspace_id`，显式团队需改为有效成员关系；权限仍须保留来源/项目投影和本人私有所有权。
- SF-014 的最新规则要求真实普通聊天接收协作消息，Agent 只起草、本人专用确认才发送；本期不引入新的任务接手面板或自动同意机制。

## 顺序边界

本期只让用户形成团队、建立真实成员边界并在既有业务中选择空间。共享项目组织方式在第二项再写 Spec，上下游体验第三项，固定处理人和节点拖拽第四项，Skills 第五项，看板第六项。成员身份基础可以供后续引用，不能据此提前宣称后续能力已完成。
