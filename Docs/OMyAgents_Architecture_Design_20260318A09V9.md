# OMyAgents V9 战略意图文档

> **文档编号**: 20260318A09V9  
> **重要程度**: 🔴 核心架构 - 影响VCP生态定位  
> **决策层级**: 战略层（用户负责方向，Agent负责执行）
> **验证状态**: 已验证（2026-03-18）

---

## ❌ 禁止清单（红线）

V9绝对不做以下功能，必须复用VCP或生态插件：

| 禁止项 | 原因 | 应复用 |
|--------|------|--------|
| **自建调度系统** | 与CronTasks重复 | CronTasks API |
| **Agent实例池** | 与VCP spawn模型冲突 | 无状态HTTP调用VCP |
| **独立存储系统** | 与DailyNote重复 | DailyNote日记系统 |
| **独立日志系统** | 与VCP logger重复 | logger.js |
| **独立Web管理界面** | 脱离VCP生态 | VCP AdminPanel + REST API |
| **WebSocket双向通信** | VCP协议不支持 | HTTP调用 |
| **hybridservice类型** | 不需要processToolCall语义 | service类型 |
| **复杂数据库Schema** | 与KnowledgeBase重复 | SQLite（VCP原生） |

**违背以上任何一条，视为架构失败。**

---

## ✅ 必须实现的三大核心机制

V9的核心价值在于以下编排能力，缺一不可：

### 机制Ⅰ: SOP嵌套与递归调用

```
能力:
- 父SOP可以调用子SOP（sub_sop定义）
- 支持递归调用（带深度限制max=3）
- 上下文继承与隔离机制

场景:
A搜集→B汇编→C评估→A再搜集的循环
复杂流程分解为可复用子流程
```

### 机制Ⅱ: 决策门（Decision Gate）

```
四种决策模式:
1. conditional: 条件逻辑分支（如 score > 0.8）
2. agent_evaluate: Agent评估决策（让AI判断走向）
3. human_decision: 人工介入决策（暂停等待用户）
4. metadata: 元数据检查（递归深度、超时等）

场景:
质量评估不通过→重试
敏感内容→人工审核
递归深度超限→终止循环
```

### 机制Ⅲ: 事件驱动触发

```
触发源:
- DailyNote变更监听（V9自行chokidar监听）
- CronTasks集成（通过HTTP API调用）
- HTTP/Webhook外部触发

场景:
知识库有新内容时自动触发SOP
定时执行周期性任务
外部系统调用触发流程
```

---

## 边界划分：V9与VCP/生态插件

明确责任边界，防止功能蔓延：

| 功能域 | V9负责（编排层） | 复用组件（执行层） |
|--------|-----------------|-------------------|
| **调度** | 调用CronTasks API创建触发器 | CronTasks处理定时/心跳 |
| **Agent执行** | 定义角色、构造请求、处理响应 | VCP /v1/chat/completions |
| **工具调用** | 编排工具调用顺序 | VCP PluginManager |
| **存储** | 约定日记格式、调用API | DailyNote处理文件存储 |
| **日志** | 调用logger函数 | VCP logger.js |
| **状态管理** | SOP执行状态机 | SQLite（VCP better-sqlite3）|
| **并行** | 控制并行度、聚合结果 | VCP处理实际并发 |
| **事件** | 使用chokidar监听文件变更 | 自行实现（不复用）|

---

## 技术验证结果

### 验证1：Service插件类型 ✅ 可行

**发现**：
- VCP支持`service`和`hybridservice`两种类型（Plugin.js:476-477）
- 通过`hasApiRoutes: true`注册REST API
- 初始化时注入config和dependencies（包含app实例）

**结论**：V9使用`service`类型可行，比`hybridservice`更纯粹。

---

### 验证2：CronTasks集成 ✅ 可行

**发现**：
- CronTasks提供HTTP API（/v1/cron_tasks/create等）
- 支持创建Cron定时任务和Heartbeat心跳任务
- Heartbeat支持条件判断（可检查日记内容）

**结论**：V9通过HTTP API调用CronTasks，无需自建调度。

---

### 验证3：DailyNote存储 ⚠️ 部分可行

**发现**：
- DailyNote是stdio插件，**无事件广播机制**
- VCP没有全局事件总线
- KnowledgeBaseManager使用chokidar监听文件（KnowledgeBaseManager.js:9,66）

**结论**：
- ❌ 无法"复用VCP事件系统"（系统不存在）
- ✅ V9需**自行使用chokidar**监听dailynote目录
- ⚠️ 这是V9自建功能，非纯复用

---

### 验证4：SQLite持久化 ✅ 可行

**发现**：
- VCP使用better-sqlite3（KnowledgeBaseManager.js:8,89）
- 数据库文件位于VectorStore/knowledge_base.sqlite
- 插件可通过dependencies获取db实例

**结论**：V9应使用SQLite存储SOP状态，非DailyNote文件。

---

### 验证5：人工决策门 ✅ 可行

**发现**：
- VCP有`/plugin-callback/:pluginName/:taskId`路由（异步回调）
- HTTP无状态，需要轮询或WebSocket
- CronTasks的暂停/恢复机制可借鉴

**结论**：
- SOP进入waiting状态，持久化到SQLite
- 提供POST /v1/sop/:id/decision API提交决策
- 后台检查waiting状态并恢复执行

---

## 修正后的技术方案

### 状态持久化（修正）

```yaml
# 原方案（错误）
状态管理: SOP执行状态机 → 持久化到DailyNote

# 修正后（正确）
状态管理: SOP执行状态机 → 使用SQLite（VCP原生better-sqlite3）

原因:
- DailyNote是文件存储，不适合高频状态更新
- SQLite提供ACID保证，支持并发
- 崩溃后可恢复
```

### 事件监听（修正）

```yaml
# 原方案（错误）
机制Ⅲ: DailyNote变更监听（调用VCP事件系统）

# 修正后（正确）
机制Ⅲ: DailyNote变更监听（V9自行使用chokidar监听dailynote目录）

原因:
- VCP没有事件广播系统
- KnowledgeBaseManager使用chokidar，但未暴露事件
- V9需自建chokidar watcher

注意: 这是V9的自建功能，非复用VCP
```

### CronTasks集成（明确）

```yaml
# 原描述（模糊）
CronTasks集成（调用而非自建）

# 明确后（具体）
CronTasks集成（通过HTTP API调用）
- POST /v1/cron_tasks/create 创建定时任务
- POST /v1/cron_tasks/:id/pause 暂停
- POST /v1/cron_tasks/:id/resume 恢复

认证: 使用VCP_Key
```

---

## 验收标准

### 场景A：线性SOP编排
- 能通过YAML定义多Stage SOP
- Stage顺序执行，无错乱
- 调用VCP API正常，返回结果正确
- 日志输出到VCP日志系统

### 场景B：并行+决策门
- 同一Stage并行调用多个Agent
- 决策门根据条件正确路由分支
- Agent评估模式：AI能决定next_stage
- 条件模式：表达式判断正确

### 场景C：递归+人工决策
- 子SOP调用成功，继承父上下文
- 递归深度达到3自动终止
- 人工决策门暂停SOP执行
- 用户决策后SOP恢复并继续
- 超时自动降级（默认reject）

### 场景D：事件驱动
- V9 chokidar监听 DailyNote文件变更
- CronTasks定时任务触发SOP
- HTTP API能手动触发SOP
- 触发时能传递初始上下文

---

## 约束条件

### 性能约束
- 单节点并发Stage ≤ 10
- 单个SOP Stage数 ≤ 20
- 递归深度 ≤ 3（硬限制）
- 决策门响应时间 < 1s

### 安全约束
- YAML沙箱解析（防代码注入）
- 上下文数据大小限制（防内存溢出）
- 子SOP错误隔离（不传播到父SOP）
- 敏感操作（人工决策）需确认
- VCP_Key认证所有API调用
- 角色定义只读（运行时不可修改）

### 维护约束
- 代码风格符合AGENTS.md（CommonJS、4空格缩进）
- SOP定义文件化（YAML），Git版本管理
- 集成VCP logger.js（JSON格式）
- 关键事件可观测（SOP启动/Stage完成/决策门触发）
- 热更新支持（SOP修改自动重载，执行中实例隔离）

---

## 接口概要（对外暴露）

V9作为service插件，提供以下接口：

### REST API
```
POST /v1/sop/execute              # 启动SOP
GET  /v1/sop/:id/status           # 查询状态
POST /v1/sop/:id/pause            # 暂停（人工决策时）
POST /v1/sop/:id/resume           # 恢复（人工决策后）
POST /v1/sop/:id/decision         # 提交人工决策
GET  /v1/roles                    # 列出角色
GET  /v1/sop/definitions          # 列出SOP定义
```

### VCP Tool Commands（AI可调用的指令）
```
ExecuteSOP
GetSOPStatus
ListAvailableRoles
```

---

## 与V8的关键差异

| 维度 | V8（错误方向） | V9（正确方向） |
|------|---------------|---------------|
| **Agent概念** | 可复用实例池 | 角色定义 |
| **并行实现** | 实例分身 | 多任务同时调用VCP |
| **调度系统** | 自建 | 复用CronTasks |
| **存储** | 自建数据库 | 复用SQLite |
| **事件监听** | 假设VCP有事件系统 | 自行chokidar监听 |
| **插件类型** | hybridservice | service |
| **核心能力** | 大而全平台 | 精准编排层 |

---

## 技术债务说明

以下功能**无法纯复用VCP**，需要V9自建：

1. **chokidar监听**（事件驱动）
   - 原因：VCP没有事件广播机制
   - 方案：V9自建chokidar watcher
   - 风险：增加一个依赖（已包含在VCP中）

2. **SQLite表结构**（状态持久化）
   - 原因：DailyNote文件存储不适合状态
   - 方案：V9创建自己的SQLite表
   - 风险：需要管理数据库迁移

3. **决策门表达式引擎**
   - 原因：VCP没有提供
   - 方案：使用json-logic-js或类似库
   - 风险：增加一个npm依赖

---

## 附录：参考场景实现

### 场景：A定时搜集→B汇编→C评估循环

```yaml
sop_id: news_analysis_pipeline

# 事件触发（V9 chokidar监听）
trigger:
  type: event
  source: dailynote_change
  diary: "原始新闻库"

stages:
  - stage_id: compile
    role: NewsCompiler(B)
    action: compile_new_entries
    
  - stage_id: evaluate
    role: ValueAnalyzer(C)
    action: evaluate_news_value
    
  - stage_id: value_decision
    decision_gate:
      mode: agent_evaluate
      evaluator_role: ValueAnalyzer
      branches:
        - condition: "has_high_value && recursion_depth < 3"
          sub_sop: 
            id: deep_dive_research
            inherit_context: true
            
        - condition: "has_high_value && max_depth_reached"
          decision_gate:
            mode: human_decision
            timeout: "24h"
            options: [approve, request_expansion, reject]
            
        - condition: "no_high_value"
          action: archive_report

sub_sops:
  - sop_id: deep_dive_research
    stages:
      - stage_id: expand_search
        role: SearchExpander(A)
        parallel: true
        action: search_related_topics
        
      - stage_id: reanalyze
        role: ValueAnalyzer(C)
        action: integrate_and_reanalyze
        
      - stage_id: recurse
        action: resume_parent_sop  # 递归回调主SOP
```

---

**文档版本**: V9.1-strategic-verified  
**创建日期**: 2026-03-18  
**验证日期**: 2026-03-18  
**验证结果**: 已修正3处技术误判  
**技术决策**: 完全融入VCPToolBox，事件监听需自建

---

**Agent执行检查清单**:
- [ ] 是否违背了禁止清单任何一条？
- [ ] 三大核心机制是否都实现了？
- [ ] SQLite状态持久化是否实现？
- [ ] chokidar监听是否实现？
- [ ] CronTasks HTTP API调用是否正确？
- [ ] 四个场景验收是否都能通过？
- [ ] 代码风格是否符合AGENTS.md？
