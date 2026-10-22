# SF-020 参考与现状记录

## 官方参考

- [Syncless 看板](https://docs.syncless.ai/zh-Hans/core-concepts/board/)，2026-10-20完整读取：看板用于观察Project节点状态、负责人和阻塞，不替代本人对话；重点是发现等待人处理的工作。文档提及设备/文件，本项目当前没有对应完整能力，不在本期伪造。
- 官方未要求本期拖卡改状态或定义本项目六列。本Spec按既有真实状态设计只读聚合、筛选和精确导航，符合当前生命周期而非复制传统完成率看板。

## 当前实现重新核对

- `TeamProjectOverview` 目前顶部操作后渲染 `ProjectProgressView`，下方成员/共享内容已稳定，可在此加概览/看板而不新增全局入口。
- progress只有nodeId/title/owner/upstream/status/authorized/canContinue/ownHref/时间及安全waits。source查询现已限定workspace和引用ID并校验owner/kind，但还没有started字段；需在该元数据路径计算，不读取私有正文到响应。
- `authorized`不等于source存在，`canContinue=false`也可能仅表示别人工作，不能据此判断缺失或未开始。
- ready包括空chat、普通回复结束和可继续的工作；waiting-owner曾涵盖多种真实目标，必须以合法pending关系说明谁等谁。
- 普通chat节点本期没有新的人工完成入口。历史completed/cancelled与永久撤权必须分别标识，不为补“已完成”列临时造状态机。
- SF-017/018已提供固定/动态责任关系、精确来源及失权不复活；SF-019增加私有Skills快照。Board不能把这些私有目标、问答、Skill或来源全文公开，也不能在查看时执行retry/model。

## 产品取舍

首版只对共享Project提供看板，私人项目继续其原四类Task状态。六列按事实归组，移动端纵向分组；筛选和展开帮助处理大量卡片，关系细节留概览、判断留本人聊天。不重复制造完整树或新的业务主记录。
