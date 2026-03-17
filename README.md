# OMyAgents

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-20%2F20%20passing-brightgreen)]()

**基于SOP的Agent编排系统 | SOP-based Agent Orchestration System**

**Version**: V9 (Strategic Release)

[中文](#中文) | [English](#english)

</div>

---

<a name="中文"></a>
## 🇨🇳 中文

### 📖 介绍

OMyAgents V9 是 [VCPToolBox](https://github.com/AIRix315/VCPToolBox) 的插件，提供基于**标准操作程序（SOP）**的Agent编排能力。

#### 核心特性

- **🎯 SOP编排**: 通过YAML定义多阶段流程，支持顺序和并行执行
- **🚪 决策门**: 四种决策模式（条件分支、Agent评估、人工决策、元数据检查）
- **🔄 递归调用**: 支持子SOP嵌套，最大递归深度3层
- **⚡ 事件驱动**: 支持DailyNote监听、Cron定时任务、HTTP触发
- **🔐 安全设计**: YAML沙箱解析，防止代码注入

### 🏗️ 架构设计

```
OMyAgents
├── index.js                 # 插件入口
├── plugin-manifest.json     # VCP插件配置
├── src/
│   ├── database/            # SQLite状态管理
│   ├── engine/              # SOP执行引擎
│   ├── decision/            # 决策门系统
│   ├── events/              # 事件监听
│   └── parser/              # YAML解析器
└── sop-definitions/         # SOP定义文件
```

### 🚀 使用方法

#### 1. 安装

```bash
cd VCPToolBox/Plugin
git clone https://github.com/AIRix315/OMyAgents.git
cd OMyAgents
npm install
```

#### 2. 配置

在 `VCPToolBox/config.env` 中添加：

```env
# OMyAgents 配置
SOP_MAX_RECURSION_DEPTH=3
SOP_MAX_STAGE_COUNT=20
SOP_MAX_CONCURRENT_STAGES=10
SOP_CONTEXT_SIZE_LIMIT=10485760
SOP_DECISION_TIMEOUT=24h
V9_DATABASE_PATH=./VectorStore/knowledge_base.sqlite
V9_SOP_DEFINITIONS_PATH=./Plugin/OMyAgents/sop-definitions
CRON_TASKS_BASE_URL=http://localhost:5890
```

#### 3. 创建SOP定义

创建 `sop-definitions/my_workflow.yaml`：

```yaml
sop_id: my_workflow
version: 1
name: 我的工作流
description: 示例SOP流程

stages:
  - stage_id: collect
    role: DataCollector
    action: fetch_data
    timeout: 30000
    
  - stage_id: analyze
    role: DataAnalyzer
    action: process_data
    timeout: 60000
    
  - stage_id: decision
    decision_gate:
      mode: conditional
      condition: "score > 0.8"
      branches:
        - condition: "score > 0.8"
          next_stage: report
        - condition: "score <= 0.8"
          sub_sop:
            sop_id: deep_analysis
            inherit_context: true
            
  - stage_id: report
    role: ReportGenerator
    action: generate_report
```

#### 4. 启动SOP

通过HTTP API：

```bash
curl -X POST http://localhost:5890/v9/v1/sop/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sop_id": "my_workflow",
    "initial_context": {"source": "daily_data"}
  }'
```

或通过VCP Tool Command：

```
<<<[TOOL_REQUEST]>>>
tool_name:"OMyAgents",
command:"ExecuteSOP",
sop_id:"my_workflow",
initial_context:"{\"source\": \"daily_data\"}"
<<<[END_TOOL_REQUEST]>>>
```

#### 5. 查询状态

```bash
curl http://localhost:5890/v9/v1/sop/{instance_id}/status
```

### 🧪 测试

```bash
# 运行所有测试
node temp_tests/test-parser.js
node temp_tests/test-expression.js
node temp_tests/test-engine.js
```

### 📚 API文档

| 端点 | 方法 | 描述 |
|------|------|------|
| `/v9/v1/sop/execute` | POST | 启动SOP |
| `/v9/v1/sop/:id/status` | GET | 查询状态 |
| `/v9/v1/sop/:id/pause` | POST | 暂停SOP |
| `/v9/v1/sop/:id/resume` | POST | 恢复SOP |
| `/v9/v1/sop/:id/decision` | POST | 提交人工决策 |
| `/v9/v1/sop/definitions` | GET | 列出SOP定义 |

---

<a name="english"></a>
## 🇺🇸 English

### 📖 Introduction

OMyAgents V9 is a plugin for [VCPToolBox](https://github.com/AIRix315/VCPToolBox) that provides **Standard Operating Procedure (SOP)** based agent orchestration capabilities.

#### Core Features

- **🎯 SOP Orchestration**: Define multi-stage workflows via YAML, supporting sequential and parallel execution
- **🚪 Decision Gates**: Four decision modes (conditional, agent evaluation, human decision, metadata check)
- **🔄 Recursive Calls**: Support nested sub-SOPs with max recursion depth of 3
- **⚡ Event-Driven**: Support DailyNote monitoring, Cron scheduling, HTTP triggers
- **🔐 Security**: YAML sandbox parsing to prevent code injection

### 🏗️ Architecture

```
OMyAgents
├── index.js                 # Plugin entry
├── plugin-manifest.json     # VCP plugin config
├── src/
│   ├── database/            # SQLite state management
│   ├── engine/              # SOP execution engine
│   ├── decision/            # Decision gate system
│   ├── events/              # Event listeners
│   └── parser/              # YAML parser
└── sop-definitions/         # SOP definition files
```

### 🚀 Usage

#### 1. Installation

```bash
cd VCPToolBox/Plugin
git clone https://github.com/AIRix315/OMyAgents.git
cd OMyAgents
npm install
```

#### 2. Configuration

Add to `VCPToolBox/config.env`:

```env
# OMyAgents Configuration
SOP_MAX_RECURSION_DEPTH=3
SOP_MAX_STAGE_COUNT=20
SOP_MAX_CONCURRENT_STAGES=10
SOP_CONTEXT_SIZE_LIMIT=10485760
SOP_DECISION_TIMEOUT=24h
V9_DATABASE_PATH=./VectorStore/knowledge_base.sqlite
V9_SOP_DEFINITIONS_PATH=./Plugin/OMyAgents/sop-definitions
CRON_TASKS_BASE_URL=http://localhost:5890
```

#### 3. Create SOP Definition

Create `sop-definitions/my_workflow.yaml`:

```yaml
sop_id: my_workflow
version: 1
name: My Workflow
description: Example SOP workflow

stages:
  - stage_id: collect
    role: DataCollector
    action: fetch_data
    timeout: 30000
    
  - stage_id: analyze
    role: DataAnalyzer
    action: process_data
    timeout: 60000
    
  - stage_id: decision
    decision_gate:
      mode: conditional
      condition: "score > 0.8"
      branches:
        - condition: "score > 0.8"
          next_stage: report
        - condition: "score <= 0.8"
          sub_sop:
            sop_id: deep_analysis
            inherit_context: true
            
  - stage_id: report
    role: ReportGenerator
    action: generate_report
```

#### 4. Execute SOP

Via HTTP API:

```bash
curl -X POST http://localhost:5890/v9/v1/sop/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sop_id": "my_workflow",
    "initial_context": {"source": "daily_data"}
  }'
```

Or via VCP Tool Command:

```
<<<[TOOL_REQUEST]>>>
tool_name:"OMyAgents",
command:"ExecuteSOP",
sop_id:"my_workflow",
initial_context:"{\"source\": \"daily_data\"}"
<<<[END_TOOL_REQUEST]>>>
```

#### 5. Check Status

```bash
curl http://localhost:5890/v9/v1/sop/{instance_id}/status
```

### 🧪 Testing

```bash
# Run all tests
node temp_tests/test-parser.js
node temp_tests/test-expression.js
node temp_tests/test-engine.js
```

### 📚 API Documentation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v9/v1/sop/execute` | POST | Execute SOP |
| `/v9/v1/sop/:id/status` | GET | Get status |
| `/v9/v1/sop/:id/pause` | POST | Pause SOP |
| `/v9/v1/sop/:id/resume` | POST | Resume SOP |
| `/v9/v1/sop/:id/decision` | POST | Submit human decision |
| `/v9/v1/sop/definitions` | GET | List SOP definitions |

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

- [VCPToolBox](https://github.com/AIRix315/VCPToolBox) - The host platform
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite integration
- [js-yaml](https://github.com/nodeca/js-yaml) - YAML parsing
- [json-logic-js](https://github.com/jwadhams/json-logic-js) - Expression evaluation

---

<div align="center">

**Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)**

</div>
