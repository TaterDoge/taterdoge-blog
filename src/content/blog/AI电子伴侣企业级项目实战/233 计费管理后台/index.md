---
title: "233 计费管理后台"
pubDate: 2026-08-05
description: "计费后台既服务运营，也承担财务和风险控制。只展示今日 Token 和收入还不够，管理员需要管理价格版本、用户额度、异常预占、对账差异和余额调整。"
tags: [AI编程, 计费系统, 企业级实战]
category: AI电子伴侣企业级项目实战
draft: false
visibility: "public"
updatedDate: 2026-08-05
---
原文链接：[https://aicompanion.usehook.cn/14billing-admin-operation/](https://aicompanion.usehook.cn/14billing-admin-operation/)

## 1. 管理后台不是几张统计卡片

计费后台既服务运营，也承担财务和风险控制。只展示今日 Token 和收入还不够，管理员需要管理价格版本、用户额度、异常预占、对账差异和余额调整。

这些功能会直接影响用户资金，权限和审计要求高于普通内容管理。页面上一个“修改余额”按钮，背后必须调用受控业务接口，不能让前端提交新的最终余额。

## 2. 后台需要哪些工作区

价格工作区展示模型、渠道、计费模式、生效时间和价格来源，支持创建候选版本、查看差异和发布。已生效版本不可直接编辑，只能创建下一版本。

用量工作区按用户、API Key、模型、渠道、请求状态和时间筛选，能够展开 Token 桶、价格快照、倍率、上游成本和用户售价。余额工作区展示账本，而不是只展示当前余额。

异常工作区集中处理超时 hold、缺失 usage、幂等冲突、负余额、死信任务和对账差异。每一项都应给出证据链接和可执行动作，避免运维人员到数据库里手动拼查询。

## 3. 用户看到的账单要能解释

用户端至少提供当前可用余额、冻结余额、周期额度、按日消费趋势和逐请求明细。逐请求明细不需要暴露内部上游账号，但要显示请求时间、API Key 别名、请求模型、实际计费模型、Token 明细、倍率和金额。

user-usage-row.ts

```typescript
export interface UserUsageRow {
  requestId: string
  createdAt: string
  apiKeyName: string
  requestedModel: string
  billingModel: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  chargedMicroUsd: string
  status: 'settled' | 'pending' | 'refunded'
}
```

金额展示要同时给出币种和统一小数位，不能有的页面显示美元、有的页面把“充值 1 元”解释成 1 美元额度而不说明换算关系。下载 CSV 时保留整数最小单位或十进制字符串，避免表格软件再次引入浮点误差。

## 4. 余额调整必须走业务动作

管理员调账接口接收用户、方向、金额、原因码、备注和幂等键。服务端根据当前账户计算新余额，写入账本和审计日志，再返回结果。

adjust-balance.contract.ts

```typescript
export interface AdjustBalanceInput {
  userId: string
  direction: 'credit' | 'debit'
  amountMicroUsd: string
  reasonCode: 'manual_refund' | 'compensation' | 'correction'
  note: string
  operationId: string
}
```

大额调账采用双人审批。发起人不能审批自己的操作，审批通过前不改变余额。紧急情况下的超级管理员操作也要记录更高等级审计事件，而不是绕开日志。

API Key、用户和上游账号只允许停用或轮换，历史账单中的关联标识不能物理删除。展示层可以隐藏敏感信息，但数据库必须保留审计关系。

## 5. 充值与 Token 计费的边界

支付系统负责让外部资金变成用户余额，Token 计费系统负责消费余额。两者通过一条充值账本记录衔接，不应该共享订单状态机。

支付订单通常经历 `pending`、`paid`、`completed`、`failed`、`refunded`。收到支付回调后先验签，再用支付平台交易号做幂等；只有订单从 paid 履约为 completed 时，才向钱包写入充值账本。

Sub2API 的内置支付也将支付回调、订单状态和自动充值分开，并提供超时查询补单。课程不展开支付宝、微信和 Stripe 的 SDK 接入，只保留这条边界，避免把 Token 计费章节变成支付教程。

退款同样要区分支付退款和账务冲正。用户尚未消费的充值退款可能需要同时减少钱包余额；模型错扣产生的补偿只写账本，不一定调用支付渠道。

## 6. 权限与审计

可以把权限拆成 `billing.viewer`、`pricing.editor`、`pricing.publisher`、`balance.adjuster`、`reconciliation.operator` 和 `billing.auditor`。角色只是权限集合，不要在接口里只判断 `role === 'admin'`。

高风险接口要求重新验证身份，例如 TOTP 或短时 step-up token。审计日志记录操作人、目标对象、变更前后、原因、IP、User-Agent 和关联审批单，但密钥和支付签名不得进入日志。

后台查询也需要限流和分页。用量导出可能扫描大量数据，应该创建异步导出任务并生成短时下载链接，而不是让浏览器请求一直占用数据库连接。

## 7. 总结

计费后台围绕价格发布、用量解释、账本查询、异常处理和受控调账展开。用户端要看得懂每笔费用，管理员端则要确保任何资金变化都有权限、原因和审计记录。

最后一篇会为整套系统建立测试与上线门禁。计费代码看起来可以通过几个示例验证，真正危险的错误往往只在并发、重复投递和依赖故障时出现。
