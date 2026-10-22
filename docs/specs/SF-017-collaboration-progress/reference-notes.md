# SF-017 参考与现状记录

## 参考

- [Syncless 上下游](https://docs.syncless.ai/zh-Hans/core-concepts/upstream-downstream/)，2026-10-20 完整读取：参考的重点是责任人按顺序交换可行动的信息，下游可以回问原上游，每人保留自己的工作上下文，Agent 整理但不替人作决定。本项采用这些产品目标，具体进度投影和开始入口为本项目设计。

## SF-016 后重新核对

- `apps/web/components/team-project.tsx` 现有概览只平铺 node 的 title、ownerName、status，且仅本人 canWork/source 提供继续聊天；成员和共享资料已独立可用，本项复用位置与样式。
- `PrivateNode.upstreamNodeId` 已保存单上游，可形成多根/多分支；同人可有多个 source/node，不应按 userId 合并或默认复用第一条。
- delegate 将请求方/处理方保存为问题的 nodeId/targetNodeId，却可能把上游标为 waiting-owner；ask 向上游问或向本人判断也产生 pending。因此正确对象必须从真实问题关系派生，不能直接翻译状态。
- projectView 的他人 source 已为空，但 upstream owner 仍可能按原相关人权限得到 goal/context；完整 questions 则有 question/context/answer。项目关系需独立白名单，不应把已有响应整体展开成所有成员的公共进度。
- 新建共享项目没有责任工作时 nodes 为空。新增真实人工开始动作应同事务创建本人空普通聊天、根条目和 bound 来源；不伪造 Task、本人输入、Agent 承诺、通知或执行。
- SF-015/016 已完成失权仲裁与旧节点永久撤权；关系展示必须区别终态与有效工作，重加不能借新开始或查看复活旧 grant。
- 本人普通聊天由 SF-014 固定为正常输入器、来源消息与本人专用发送确认；项目是观察协作的位置，不能回退旧协作面板。

## 采用边界

本项补“看得懂、找得到、从项目开始本人工作”，并真实回归三人信息往返。手工图编辑、模板固定处理人、Skills、看板与自动催办均后置；不把“看到了责任关系”当成已配置自动流程。
