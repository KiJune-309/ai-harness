# SF-019 参考与现状记录

## 官方参考

- [Syncless Skills](https://docs.syncless.ai/zh-Hans/core-concepts/skills/)，2026-10-20完整读取：技能沉淀长期工作规则、检查清单、常用方法和协作习惯，可跨工作持续复用。本期采用长期复用内容的目标，不复制设备/脚本能力，也不把文档内协作例子当成本系统自动外联授权。
- 官方未规定本项目技能字段、版本/快照协议、私有库或Agent绑定UI；这些是结合用户要求和现有系统的产品决定。

## 现状与实现切口

- `apps/web/components/message-composer.tsx` 的“添加Skill”实际只读本地文本进当次草稿，未保存技能记录；本期只更正文案，持久技能通过独立库创建。
- `AgentInput/AgentDefinition` 现有systemPrompt/toolIds/openingMessages，未绑定技能。Agent编辑器第2步已管理行为和工具，适合在该步加入有版本的技能选择。
- ChatConversation/PersonalTask嵌入AgentDefinition，个人清单在启动时解析Agent；可沿用已有不可漂移快照，不运行时回库拿最新版。
- `packages/core/chat-runtime/src/index.ts` 普通setup和 `src/collaboration.ts` 协作setup分别构建Cordis系统上下文；两者都要加入冻结Skill文本，不能只把字段保存在管理页。
- 现有toolIds只允许已注册能力，SF-018进一步将固定联络限定为本人持久请求及专用确认；Skill正文不能提供新工具或绕开这条边界。
- 项目/安全progress与其他人的普通开场已有私有投影边界；新增技能快照不能被对象整体展开到这些响应。

## 版本选择

首版明确不做归档/删除；Skill库升级、Agent显式升级绑定、工作实例冻结是三个不同动作。保留已选v1使普通改名、旧Task恢复和持久协作session都有一致可预期行为，避免只编辑库就改变历史执行。
