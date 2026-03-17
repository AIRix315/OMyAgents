# OMyAgents 执行计划

> **文档编号**: 20260318A09V9-EXEC  
> **项目路径**: E:\\Projects\\OMyAgents  
> **插件类型**: VCP Service Plugin  
> **安装位置**: VCPToolBox/Plugin/OMyAgents/  
> **文档状态**: 待执行  

---

## 前置依赖

基于代码审查确认的技术栈：
- **VCP版本**: VCPToolBox (server.js, Plugin.js)
- **插件类型**: `service` (非 `hybridservice`)
- **存储**: better-sqlite3 (VCP原生)
- **调度**: CronTaskOrchestrator HTTP API (复用)
- **事件监听**: chokidar (VCP已包含，Plugin.js第9行，KnowledgeBaseManager.js第9行)
- **日志**: VCP logger.js

---

## 阶段一：基础框架搭建

**目标**：建立service插件骨架，完成基础依赖和配置

### 文件创建清单

1. **`E:\Projects\OMyAgents\plugin-manifest.json`**
```json
{
  "manifestVersion": "1.0.0",
  "name": "OMyAgents",
  "displayName": "OMyAgents SOP 编排器",
  "version": "1.0.0",
  "description": "基于SOP的Agent编排系统，支持决策门、递归调用和事件驱动",
  "author": "OMyAgents Team",
  "pluginType": "service",
  "entryPoint": {
    "script": "index.js"
  },
  "communication": {
    "protocol": "direct"
  },
  "hasApiRoutes": true,
  "configSchema": {
    "SOP_MAX_RECURSION_DEPTH": {
      "type": "integer",
      "description": "SOP最大递归深度",
      "default": 3
    },
    "SOP_MAX_STAGE_COUNT": {
      "type": "integer",
      "description": "单个SOP最大Stage数",
      "default": 20
    },
    "SOP_MAX_CONCURRENT_STAGES": {
      "type": "integer",
      "description": "最大并发Stage数",
      "default": 10
    },
    "SOP_CONTEXT_SIZE_LIMIT": {
      "type": "integer",
      "description": "上下文大小限制(字节)",
      "default": 10485760
    },
    "SOP_DECISION_TIMEOUT": {
      "type": "string",
      "description": "人工决策默认超时时间",
      "default": "24h"
    },
    "V9_DATABASE_PATH": {
      "type": "string",
      "description": "SQLite数据库路径",
      "default": "./Plugin/OMyAgents/data/sop_state.sqlite"
    },
    "V9_SOP_DEFINITIONS_PATH": {
      "type": "string",
      "description": "SOP定义YAML文件目录",
      "default": "./Plugin/OMyAgents/sop-definitions"
    },
    "CRON_TASKS_BASE_URL": {
      "type": "string",
      "description": "CronTaskOrchestrator API基础URL",
      "default": "http://localhost:5890"
    },
    "VCP_KEY": {
      "type": "string",
      "description": "VCP认证密钥"
    },
    "DebugMode": {
      "type": "boolean",
      "description": "调试模式",
      "default": false
    }
  },
  "capabilities": {
    "invocationCommands": [
      {
        "commandIdentifier": "ExecuteSOP",
        "description": "执行指定SOP流程。参数: sop_id(必需), initial_context(可选JSON对象)",
        "example": "<<<[TOOL_REQUEST]>>>\\ntool_name:\"始\"OMyAgents\"末\",\\ncommand:\"始\"ExecuteSOP\"末\",\\nsop_id:\"始\"news_analysis_pipeline\"末\",\\ninitial_context:\"始\"{\\\"source\\\": \\\"daily_news\\\"}\"末\"\\n<<<[END_TOOL_REQUEST]>>>"
      },
      {
        "commandIdentifier": "GetSOPStatus",
        "description": "查询SOP执行状态。参数: instance_id(必需)",
        "example": "<<<[TOOL_REQUEST]>>>\\ntool_name:\"始\"OMyAgents\"末\",\\ncommand:\"始\"GetSOPStatus\"末\",\\ninstance_id:\"始\"sop_inst_xxx\"末\"\\n<<<[END_TOOL_REQUEST]>>>"
      },
      {
        "commandIdentifier": "ListAvailableRoles",
        "description": "列出可用的Agent角色定义",
        "example": "<<<[TOOL_REQUEST]>>>\\ntool_name:\"始\"OMyAgents\"末\",\\ncommand:\"始\"ListAvailableRoles\"末\"\\n<<<[END_TOOL_REQUEST]>>>"
      }
    ]
  }
}
```

2. **`E:\Projects\OMyAgents\index.js`**
```javascript
/**
 * OMyAgents V9 - SOP编排器
 * Service类型插件：提供SOP执行、决策门、递归调用能力
 * 
 * 技术验证：
 * - 使用VCP原生better-sqlite3 (KnowledgeBaseManager.js:8,89)
 * - 复用CronTaskOrchestrator HTTP API (Plugin/CronTaskOrchestrator/src/api/routes.js)
 * - 自建chokidar监听 (KnowledgeBaseManager.js:166-171模式)
 */

const fs = require('fs').promises;
const path = require('path');
const express = require('express');

// 全局状态
let config = {};
let debugMode = false;
let pluginManager = null;
let knowledgeBaseManager = null;
let db = null;

/**
 * 初始化插件
 * @param {Object} initialConfig - 配置对象
 * @param {Object} dependencies - 依赖注入
 */
async function initialize(initialConfig, dependencies) {
    try {
        config = initialConfig;
        debugMode = config.DebugMode || false;

        console.log('[OMyAgents] 正在初始化...');

        // 获取PluginManager引用 (参考CronTaskOrchestrator/index.js:57-58)
        const PluginModule = require('../../Plugin.js');
        pluginManager = PluginModule;

        // 获取KnowledgeBaseManager (可选依赖)
        knowledgeBaseManager = dependencies?.vectorDBManager || global.knowledgeBaseManager;

        // 初始化数据库 (阶段二实现)
        await initializeDatabase();

        // 初始化事件监听 (阶段七实现)
        await initializeEventListeners();

        console.log('[OMyAgents] 初始化完成');
    } catch (error) {
        console.error('[OMyAgents] 初始化失败:', error);
        throw error;
    }
}

/**
 * 注册API路由
 * @param {Object} app - Express应用实例
 * @param {Object} serverConfig - 服务器配置
 * @param {string} projectBasePath - 项目根路径
 */
function registerRoutes(app, serverConfig, projectBasePath) {
    const router = express.Router();

    // V9 REST API端点 (参考CronTaskOrchestrator/src/api/routes.js)
    
    // POST /v1/sop/execute - 启动SOP
    router.post('/v1/sop/execute', async (req, res) => {
        try {
            const { sop_id, initial_context } = req.body;
            if (!sop_id) {
                return res.status(400).json({ success: false, error: '缺少sop_id参数' });
            }
            // TODO: 阶段四实现
            res.json({ success: true, message: 'SOP执行已启动', instance_id: 'temp_id' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /v1/sop/:id/status - 查询状态
    router.get('/v1/sop/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            // TODO: 阶段四实现
            res.json({ success: true, data: { instance_id: id, status: 'pending' } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /v1/sop/:id/pause - 暂停
    router.post('/v1/sop/:id/pause', async (req, res) => {
        try {
            const { id } = req.params;
            // TODO: 阶段四实现
            res.json({ success: true, message: 'SOP已暂停' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /v1/sop/:id/resume - 恢复
    router.post('/v1/sop/:id/resume', async (req, res) => {
        try {
            const { id } = req.params;
            // TODO: 阶段四实现
            res.json({ success: true, message: 'SOP已恢复' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /v1/sop/:id/decision - 提交人工决策
    router.post('/v1/sop/:id/decision', async (req, res) => {
        try {
            const { id } = req.params;
            const { decision, option } = req.body;
            // TODO: 阶段五实现
            res.json({ success: true, message: '决策已提交' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /v1/roles - 列出角色
    router.get('/v1/roles', async (req, res) => {
        try {
            // TODO: 阶段三实现
            res.json({ success: true, data: [] });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /v1/sop/definitions - 列出SOP定义
    router.get('/v1/sop/definitions', async (req, res) => {
        try {
            // TODO: 阶段三实现
            res.json({ success: true, data: [] });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 挂载路由到 /v9 前缀
    app.use('/v9', router);

    if (debugMode) {
        console.log('[OMyAgents] API路由已注册到 /v9');
    }
}

/**
 * 关闭插件
 */
async function shutdown() {
    try {
        console.log('[OMyAgents] 正在关闭...');
        
        // TODO: 关闭数据库连接
        // TODO: 关闭事件监听
        
        console.log('[OMyAgents] 已关闭');
    } catch (error) {
        console.error('[OMyAgents] 关闭时出错:', error);
    }
}

// 内部函数占位符 (各阶段实现)
async function initializeDatabase() {
    // 阶段二实现
    console.log('[OMyAgents] 数据库初始化占位符');
}

async function initializeEventListeners() {
    // 阶段七实现
    console.log('[OMyAgents] 事件监听初始化占位符');
}

module.exports = {
    initialize,
    registerRoutes,
    shutdown
};
```

3. **`E:\Projects\OMyAgents\config.env.example`**
```env
# OMyAgents V9 配置模板
# 复制为 config.env 并填入实际值

# 核心约束配置
SOP_MAX_RECURSION_DEPTH=3
SOP_MAX_STAGE_COUNT=20
SOP_MAX_CONCURRENT_STAGES=10
SOP_CONTEXT_SIZE_LIMIT=10485760
SOP_DECISION_TIMEOUT=24h

# 路径配置 (相对于VCPToolBox根目录)
V9_DATABASE_PATH=./Plugin/OMyAgents/data/sop_state.sqlite
V9_SOP_DEFINITIONS_PATH=./Plugin/OMyAgents/sop-definitions

# CronTasks集成配置
CRON_TASKS_BASE_URL=http://localhost:5890
VCP_KEY=your_vcp_key_here

# 调试模式
DebugMode=false
```

### 目录结构创建

```
E:\Projects\OMyAgents\
├── index.js                    # 主入口
├── plugin-manifest.json        # 插件清单
├── config.env.example          # 配置模板
├── package.json                # npm依赖 (阶段五添加json-logic-js)
├── src/
│   ├── database/               # 阶段二
│   ├── parser/                 # 阶段三
│   ├── engine/                 # 阶段四、六
│   ├── decision/               # 阶段五
│   ├── events/                 # 阶段七
│   ├── api/                    # 阶段八
│   ├── security/               # 阶段九
│   └── observability/          # 阶段十
├── sop-definitions/            # SOP定义YAML
└── data/                       # SQLite数据
```

### 验收标准

- [ ] 插件被VCP正确加载，控制台输出"[OMyAgents] 初始化完成"
- [ ] 访问 http://localhost:5890/v9/v1/sop/definitions 返回200
- [ ] 配置项正确从config.env读取（可在debug日志中验证）
- [ ] 日志输出到VCP日志系统（符合AGENTS.md标准）

---

## 阶段二：SQLite状态持久化层

**目标**：建立SOP状态管理数据库表结构，复用VCP better-sqlite3模式

### 参考代码

**KnowledgeBaseManager.js 模式** (E:\\Projects\\VCPToolBox\\KnowledgeBaseManager.js:8-91):
```javascript
const Database = require('better-sqlite3');
const dbPath = path.join(this.config.storePath, 'knowledge_base.sqlite');
this.db = new Database(dbPath);
this.db.pragma('journal_mode = WAL');
this.db.pragma('synchronous = NORMAL');
```

### 文件创建清单

1. **`E:\Projects\OMyAgents\src\database\connection.js`**
```javascript
/**
 * SQLite连接管理
 * 复用VCP better-sqlite3模式 (KnowledgeBaseManager.js:8-91)
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

class DatabaseConnection {
    constructor(config) {
        this.config = config;
        this.db = null;
    }

    async initialize() {
        const dbPath = path.resolve(this.config.V9_DATABASE_PATH);
        
        // 确保目录存在
        await fs.mkdir(path.dirname(dbPath), { recursive: true });

        // 创建连接 (better-sqlite3是同步API)
        this.db = new Database(dbPath);
        
        // 启用WAL模式 (参考KnowledgeBaseManager.js:90)
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');

        console.log('[OMyAgents] 数据库已连接:', dbPath);
    }

    getDb() {
        return this.db;
    }

    close() {
        if (this.db) {
            this.db.close();
            console.log('[OMyAgents] 数据库已关闭');
        }
    }
}

module.exports = DatabaseConnection;
```

2. **`E:\Projects\OMyAgents\src\database\schema.js`**
```javascript
/**
 * 数据库表结构定义
 * 设计原则: 支持SOP状态机、递归调用、人工决策
 */

const SCHEMA_SQL = `
-- SOP定义表 (YAML文件解析后存储)
CREATE TABLE IF NOT EXISTS sop_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    yaml_content TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- SOP执行实例表 (状态机核心)
CREATE TABLE IF NOT EXISTS sop_instances (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sop_definitions(id),
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'waiting_decision')),
    context_json TEXT NOT NULL DEFAULT '{}',
    current_stage_id TEXT,
    recursion_depth INTEGER NOT NULL DEFAULT 0,
    parent_instance_id TEXT REFERENCES sop_instances(id),
    root_instance_id TEXT REFERENCES sop_instances(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
);

-- Stage执行记录表
CREATE TABLE IF NOT EXISTS stage_executions (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES sop_instances(id),
    stage_id TEXT NOT NULL,
    stage_type TEXT NOT NULL CHECK(stage_type IN ('action', 'decision_gate', 'sub_sop')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    input_json TEXT,
    output_json TEXT,
    error_message TEXT,
    started_at INTEGER,
    completed_at INTEGER
);

-- 并行Stage组表 (用于聚合并行执行结果)
CREATE TABLE IF NOT EXISTS parallel_stage_groups (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES sop_instances(id),
    group_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'partial_complete', 'completed')),
    total_count INTEGER NOT NULL,
    completed_count INTEGER DEFAULT 0,
    results_json TEXT DEFAULT '[]'
);

-- 人工决策门表
CREATE TABLE IF NOT EXISTS human_decisions (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES sop_instances(id),
    gate_id TEXT NOT NULL,
    decision_type TEXT NOT NULL CHECK(decision_type IN ('approval', 'selection', 'custom']),
    options_json TEXT NOT NULL,
    selected_option TEXT,
    decision_data TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'decided', 'expired', 'rejected')),
    requested_at INTEGER NOT NULL,
    decided_at INTEGER,
    expires_at INTEGER NOT NULL
);

-- 事件触发器表 (用于DailyNote监听)
CREATE TABLE IF NOT EXISTS event_triggers (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sop_definitions(id),
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('dailynote_change', 'cron', 'webhook', 'manual')),
    config_json TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_triggered_at INTEGER,
    created_at INTEGER NOT NULL
);

-- 执行日志表 (用于可观测性)
CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT REFERENCES sop_instances(id),
    level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT,
    timestamp INTEGER NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_instances_status ON sop_instances(status);
CREATE INDEX IF NOT EXISTS idx_instances_sop_id ON sop_instances(sop_id);
CREATE INDEX IF NOT EXISTS idx_stage_exec_instance ON stage_executions(instance_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON human_decisions(status);
CREATE INDEX IF NOT EXISTS idx_logs_instance ON execution_logs(instance_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON execution_logs(timestamp);
`;

class SchemaManager {
    constructor(db) {
        this.db = db;
    }

    initialize() {
        this.db.exec(SCHEMA_SQL);
        console.log('[OMyAgents] 数据库表结构已初始化');
    }
}

module.exports = SchemaManager;
```

3. **`E:\Projects\OMyAgents\src\database\sop-state.js`**
```javascript
/**
 * SOP状态管理CRUD
 * 参考KnowledgeBaseManager.js事务模式 (第1095行)
 */

class SOPStateManager {
    constructor(db) {
        this.db = db;
    }

    // 创建SOP实例
    createInstance(sopId, initialContext = {}, parentId = null, recursionDepth = 0) {
        const id = `sop_inst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        
        const stmt = this.db.prepare(`
            INSERT INTO sop_instances (id, sop_id, status, context_json, recursion_depth, 
                parent_instance_id, root_instance_id, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
        `);
        
        const rootId = parentId ? this.getRootInstanceId(parentId) : id;
        stmt.run(id, sopId, JSON.stringify(initialContext), recursionDepth, 
            parentId, rootId, now, now);
        
        return id;
    }

    // 获取实例状态
    getInstance(instanceId) {
        const stmt = this.db.prepare('SELECT * FROM sop_instances WHERE id = ?');
        return stmt.get(instanceId);
    }

    // 更新实例状态
    updateInstanceStatus(instanceId, status, currentStageId = null) {
        const stmt = this.db.prepare(`
            UPDATE sop_instances 
            SET status = ?, current_stage_id = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.run(status, currentStageId, Date.now(), instanceId);
    }

    // 获取根实例ID (用于递归追踪)
    getRootInstanceId(instanceId) {
        const stmt = this.db.prepare(`
            SELECT root_instance_id FROM sop_instances WHERE id = ?
        `);
        const row = stmt.get(instanceId);
        return row ? row.root_instance_id : instanceId;
    }

    // 获取递归深度
    getRecursionDepth(instanceId) {
        const stmt = this.db.prepare('SELECT recursion_depth FROM sop_instances WHERE id = ?');
        const row = stmt.get(instanceId);
        return row ? row.recursion_depth : 0;
    }

    // 创建人工决策请求
    createHumanDecision(instanceId, gateId, options, timeoutHours = 24) {
        const id = `decision_${Date.now()}`;
        const now = Date.now();
        const expiresAt = now + (timeoutHours * 60 * 60 * 1000);
        
        const stmt = this.db.prepare(`
            INSERT INTO human_decisions (id, instance_id, gate_id, decision_type, 
                options_json, status, requested_at, expires_at)
            VALUES (?, ?, ?, 'selection', ?, 'pending', ?, ?)
        `);
        stmt.run(id, instanceId, gateId, JSON.stringify(options), now, expiresAt);
        
        // 更新实例状态为等待决策
        this.updateInstanceStatus(instanceId, 'waiting_decision', gateId);
        
        return id;
    }

    // 提交人工决策
    submitHumanDecision(decisionId, selectedOption, decisionData = null) {
        const stmt = this.db.prepare(`
            UPDATE human_decisions 
            SET selected_option = ?, decision_data = ?, status = 'decided', decided_at = ?
            WHERE id = ?
        `);
        stmt.run(selectedOption, JSON.stringify(decisionData), Date.now(), decisionId);
        
        // 获取关联实例并恢复执行
        const getStmt = this.db.prepare('SELECT instance_id FROM human_decisions WHERE id = ?');
        const row = getStmt.get(decisionId);
        if (row) {
            this.updateInstanceStatus(row.instance_id, 'running');
        }
        
        return row ? row.instance_id : null;
    }

    // 记录执行日志
    logEvent(instanceId, level, eventType, message, data = null) {
        const stmt = this.db.prepare(`
            INSERT INTO execution_logs (instance_id, level, event_type, message, data_json, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(instanceId, level, eventType, message, 
            data ? JSON.stringify(data) : null, Date.now());
    }
}

module.exports = SOPStateManager;
```

### 临时测试代码

**`temp_tests/database.test.js`** (执行阶段二后删除):
```javascript
/**
 * 数据库层临时测试
 * 运行: node temp_tests/database.test.js
 */

const DatabaseConnection = require('../src/database/connection');
const SchemaManager = require('../src/database/schema');
const SOPStateManager = require('../src/database/sop-state');
const path = require('path');

async function test() {
    const config = {
        V9_DATABASE_PATH: path.join(__dirname, '../data/test.sqlite')
    };
    
    // 测试连接
    const conn = new DatabaseConnection(config);
    await conn.initialize();
    console.log('✓ 数据库连接成功');
    
    // 测试表创建
    const schema = new SchemaManager(conn.getDb());
    schema.initialize();
    console.log('✓ 表结构初始化成功');
    
    // 测试CRUD
    const stateMgr = new SOPStateManager(conn.getDb());
    const instanceId = stateMgr.createInstance('test_sop', { test: true });
    console.log('✓ 创建实例:', instanceId);
    
    const instance = stateMgr.getInstance(instanceId);
    console.log('✓ 读取实例:', instance.sop_id, instance.status);
    
    stateMgr.updateInstanceStatus(instanceId, 'running', 'stage_1');
    console.log('✓ 更新状态成功');
    
    stateMgr.logEvent(instanceId, 'info', 'test_event', '测试日志');
    console.log('✓ 日志记录成功');
    
    // 测试事务
    try {
        conn.getDb().transaction(() => {
            stateMgr.createInstance('tx_test', {});
            throw new Error('回滚测试');
        })();
    } catch (e) {
        console.log('✓ 事务回滚正常');
    }
    
    conn.close();
    console.log('\n所有数据库测试通过!');
}

test().catch(console.error);
```

### 验收标准

- [ ] 数据库文件创建在 `E:\\Projects\\OMyAgents\\data\\sop_state.sqlite`
- [ ] WAL模式启用 (检查SQLite journal_mode)
- [ ] 所有表结构正确创建 (可用DB Browser查看)
- [ ] 临时测试 `node temp_tests/database.test.js` 全部通过
- [ ] 删除临时测试代码

---

## 阶段三：YAML SOP定义解析器

**目标**：实现SOP YAML文件的加载、验证和规范化

### 技术选型

- **YAML解析**: 使用 `js-yaml` (轻量，广泛使用)
- **Schema验证**: 使用 `ajv` (JSON Schema验证)

### 文件创建清单

1. **`E:\Projects\OMyAgents\package.json`**
```json
{
  "name": "omyagents-v9",
  "version": "1.0.0",
  "description": "OMyAgents V9 SOP编排器",
  "main": "index.js",
  "dependencies": {
    "js-yaml": "^4.1.0",
    "ajv": "^8.12.0"
  }
}
```

2. **`E:\Projects\OMyAgents\src\parser\schema-validator.js`**
```javascript
/**
 * SOP定义Schema验证
 * 基于V9战略文档的SOP YAML结构定义
 */

const Ajv = require('ajv');

const SOP_SCHEMA = {
    type: 'object',
    required: ['sop_id', 'version', 'name', 'stages'],
    properties: {
        sop_id: { type: 'string', pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$' },
        version: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        stages: {
            type: 'array',
            items: { $ref: '#/$defs/stage' },
            minItems: 1
        },
        sub_sops: {
            type: 'array',
            items: { $ref: '#/$defs/sop' }
        }
    },
    $defs: {
        stage: {
            type: 'object',
            required: ['stage_id'],
            properties: {
                stage_id: { type: 'string' },
                role: { type: 'string' },
                action: { type: 'string' },
                timeout: { type: 'integer', minimum: 1000 },
                parallel: { type: 'boolean' },
                max_parallel: { type: 'integer', minimum: 1 },
                decision_gate: { $ref: '#/$defs/decisionGate' },
                sub_sop: { $ref: '#/$defs/subSop' }
            },
            oneOf: [
                { required: ['role', 'action'] },
                { required: ['decision_gate'] },
                { required: ['sub_sop'] }
            ]
        },
        decisionGate: {
            type: 'object',
            required: ['mode'],
            properties: {
                mode: {
                    type: 'string',
                    enum: ['conditional', 'agent_evaluate', 'human_decision', 'metadata']
                },
                condition: { type: 'string' },
                evaluator_role: { type: 'string' },
                branches: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            condition: { type: 'string' },
                            next_stage: { type: 'string' },
                            sub_sop: { type: 'object' },
                            decision_gate: { type: 'object' }
                        }
                    }
                },
                timeout: { type: 'string' },
                options: {
                    type: 'array',
                    items: { type: 'string' }
                }
            }
        },
        subSop: {
            type: 'object',
            required: ['sop_id'],
            properties: {
                sop_id: { type: 'string' },
                inherit_context: { type: 'boolean' },
                context_mapping: { type: 'object' }
            }
        },
        sop: {
            type: 'object',
            required: ['sop_id', 'stages'],
            properties: {
                sop_id: { type: 'string' },
                stages: {
                    type: 'array',
                    items: { $ref: '#/$defs/stage' }
                }
            }
        }
    }
};

class SchemaValidator {
    constructor() {
        this.ajv = new Ajv({ allErrors: true });
        this.validate = this.ajv.compile(SOP_SCHEMA);
    }

    validateSOP(sopData) {
        const valid = this.validate(sopData);
        if (!valid) {
            const errors = this.validate.errors.map(e => 
                `${e.instancePath}: ${e.message}`
            ).join('; ');
            throw new Error(`SOP验证失败: ${errors}`);
        }
        return true;
    }
}

module.exports = SchemaValidator;
```

3. **`E:\Projects\OMyAgents\src\parser\yaml-loader.js`**
```javascript
/**
 * YAML文件加载器
 * 安全加载SOP定义，防止代码注入
 */

const yaml = require('js-yaml');
const fs = require('fs').promises;
const path = require('path');

class YAMLLoader {
    constructor(definitionsPath) {
        this.definitionsPath = definitionsPath;
    }

    async loadAll() {
        const files = await fs.readdir(this.definitionsPath);
        const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        
        const definitions = [];
        for (const file of yamlFiles) {
            const content = await this.loadFile(path.join(this.definitionsPath, file));
            definitions.push(content);
        }
        return definitions;
    }

    async loadFile(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        return this.parseSafe(content, filePath);
    }

    parseSafe(content, filePath = 'unknown') {
        try {
            // 使用安全模式解析 (schema: 'core' 仅标准YAML，无自定义类型)
            const doc = yaml.load(content, {
                schema: yaml.CORE_SCHEMA,
                filename: filePath,
                onWarning: (warning) => {
                    console.warn(`[YAML警告] ${filePath}: ${warning.message}`);
                }
            });

            // 安全检查：拒绝包含函数的YAML
            this.validateNoCode(doc);

            return doc;
        } catch (error) {
            throw new Error(`YAML解析失败 ${filePath}: ${error.message}`);
        }
    }

    validateNoCode(obj, path = '') {
        if (typeof obj === 'function') {
            throw new Error(`YAML包含非法代码: ${path}`);
        }
        if (obj && typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                this.validateNoCode(value, `${path}.${key}`);
            }
        }
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => {
                this.validateNoCode(item, `${path}[${i}]`);
            });
        }
    }
}

module.exports = YAMLLoader;
```

4. **`E:\Projects\OMyAgents\sop-definitions\news_analysis.yaml`**
```yaml
# 新闻分析流程示例
# 参考V9战略文档附录场景

sop_id: news_analysis_pipeline
version: 1
name: 新闻分析流程
description: A搜集→B汇编→C评估→A再搜集的循环

stages:
  - stage_id: compile
    role: NewsCompiler
    action: compile_new_entries
    timeout: 30000
    
  - stage_id: evaluate
    role: ValueAnalyzer
    action: evaluate_news_value
    timeout: 60000
    
  - stage_id: value_decision
    decision_gate:
      mode: agent_evaluate
      evaluator_role: ValueAnalyzer
      branches:
        - condition: "has_high_value && recursion_depth < 3"
          sub_sop:
            sop_id: deep_dive_research
            inherit_context: true
            
        - condition: "has_high_value && max_depth_reached"
          decision_gate:
            mode: human_decision
            timeout: "24h"
            options: [approve, request_expansion, reject]
            
        - condition: "no_high_value"
          next_stage: archive
          
  - stage_id: archive
    role: NewsArchiver
    action: archive_report

sub_sops:
  - sop_id: deep_dive_research
    stages:
      - stage_id: expand_search
        role: SearchExpander
        action: search_related_topics
        parallel: true
        max_parallel: 3
        timeout: 120000
        
      - stage_id: reanalyze
        role: ValueAnalyzer
        action: integrate_and_reanalyze
        timeout: 60000
```

### 临时测试代码

**`temp_tests/parser.test.js`**:
```javascript
const YAMLLoader = require('../src/parser/yaml-loader');
const SchemaValidator = require('../src/parser/schema-validator');
const path = require('path');

async function test() {
    const loader = new YAMLLoader(path.join(__dirname, '../sop-definitions'));
    const validator = new SchemaValidator();
    
    // 加载所有YAML
    const definitions = await loader.loadAll();
    console.log(`✓ 加载了 ${definitions.length} 个SOP定义`);
    
    // 验证每个定义
    for (const def of definitions) {
        validator.validateSOP(def);
        console.log(`✓ 验证通过: ${def.sop_id} v${def.version}`);
        
        // 检查递归深度限制
        if (def.sub_sops) {
            console.log(`  - 包含 ${def.sub_sops.length} 个子SOP`);
        }
    }
    
    console.log('\n所有解析器测试通过!');
}

test().catch(console.error);
```

### 验收标准

- [ ] 运行 `npm install` 安装js-yaml和ajv
- [ ] `news_analysis.yaml` 正确加载和验证
- [ ] 包含非法代码的YAML被拒绝
- [ ] Schema验证正确识别缺失字段
- [ ] 临时测试通过

---

## 阶段四：SOP执行引擎（核心）

**目标**：实现线性SOP的顺序执行，支持上下文传递

### 文件创建清单

1. **`E:\Projects\OMyAgents\src\engine\context-manager.js`**
```javascript
/**
 * SOP上下文管理器
 * 处理上下文继承、隔离和大小限制
 */

class ContextManager {
    constructor(config) {
        this.maxSize = config.SOP_CONTEXT_SIZE_LIMIT || 10485760; // 10MB
    }

    createInitialContext(initialData = {}) {
        return {
            _meta: {
                created_at: Date.now(),
                version: '1.0'
            },
            ...initialData
        };
    }

    // 继承父上下文
    inheritContext(parentContext, inheritKeys = null) {
        if (!inheritKeys) {
            // 全量继承
            return { ...parentContext };
        }
        
        // 选择性继承
        const inherited = {};
        for (const key of inheritKeys) {
            if (parentContext[key] !== undefined) {
                inherited[key] = parentContext[key];
            }
        }
        return inherited;
    }

    // 添加Stage结果到上下文
    addStageResult(context, stageId, result) {
        const newContext = {
            ...context,
            [stageId]: result
        };
        
        // 大小检查
        const size = JSON.stringify(newContext).length;
        if (size > this.maxSize) {
            throw new Error(`上下文大小超过限制: ${size} > ${this.maxSize}`);
        }
        
        return newContext;
    }

    // 提取决策门需要的变量
    extractDecisionVariables(context) {
        return {
            recursion_depth: context._meta?.recursion_depth || 0,
            ...context
        };
    }
}

module.exports = ContextManager;
```

2. **`E:\Projects\OMyAgents\src\engine\vcp-caller.js`**
```javascript
/**
 * VCP API调用器
 * 调用VCP /v1/chat/completions 或其他插件
 * 
 * 参考: Plugin.js processToolCall 模式
 */

const fetch = require('node-fetch');

class VPCCaller {
    constructor(config, pluginManager) {
        this.baseUrl = `http://localhost:${config.PORT || 5890}`;
        this.vcpKey = config.VCP_KEY || config.Key;
        this.pluginManager = pluginManager;
    }

    // 调用Agent (通过PluginManager)
    async callAgent(role, action, context) {
        // 构建VCP工具调用请求
        const toolCall = {
            tool_name: role,
            action: action,
            context: JSON.stringify(context)
        };

        // 使用PluginManager直接调用 (如果可用)
        if (this.pluginManager && this.pluginManager.processToolCall) {
            return await this.pluginManager.processToolCall(role, toolCall);
        }

        // 回退到HTTP调用
        return await this.callViaHTTP(role, toolCall);
    }

    async callViaHTTP(toolName, args) {
        const response = await fetch(`${this.baseUrl}/v1/human/tool`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.vcpKey}`
            },
            body: JSON.stringify({
                tool_name: toolName,
                arguments: args
            })
        });

        if (!response.ok) {
            throw new Error(`VCP调用失败: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }
}

module.exports = VPCCaller;
```

3. **`E:\Projects\OMyAgents\src\engine\executor.js`**
```javascript
/**
 * SOP执行引擎
 * 核心执行逻辑：顺序执行Stage，管理状态转换
 */

const ContextManager = require('./context-manager');
const VPCCaller = require('./vcp-caller');

class SOPEngine {
    constructor(config, db, pluginManager) {
        this.config = config;
        this.db = db;
        this.contextManager = new ContextManager(config);
        this.vcpCaller = new VPCCaller(config, pluginManager);
        this.stateManager = new (require('../database/sop-state'))(db);
    }

    // 主执行入口
    async executeSOP(sopId, initialContext = {}) {
        // 创建实例
        const instanceId = this.stateManager.createInstance(sopId, initialContext);
        console.log(`[V9] 启动SOP: ${sopId}, 实例: ${instanceId}`);
        
        try {
            await this.executeInstance(instanceId);
        } catch (error) {
            console.error(`[V9] SOP执行失败: ${instanceId}`, error);
            this.stateManager.updateInstanceStatus(instanceId, 'failed');
            throw error;
        }
        
        return instanceId;
    }

    // 执行实例
    async executeInstance(instanceId) {
        const instance = this.stateManager.getInstance(instanceId);
        const sop = this.loadSOPDefinition(instance.sop_id);
        
        this.stateManager.updateInstanceStatus(instanceId, 'running');
        
        let context = JSON.parse(instance.context_json);
        
        for (const stage of sop.stages) {
            // 检查是否暂停
            if (this.checkPaused(instanceId)) {
                console.log(`[V9] SOP暂停: ${instanceId}`);
                return;
            }
            
            // 执行Stage
            const result = await this.executeStage(instanceId, stage, context);
            
            // 更新上下文
            context = this.contextManager.addStageResult(context, stage.stage_id, result);
            this.updateInstanceContext(instanceId, context);
            
            // 如果是决策门，可能中断执行
            if (result.type === 'decision_gate') {
                if (result.status === 'waiting_decision') {
                    return; // 等待人工决策
                }
                // 根据决策结果跳转
                if (result.next_stage) {
                    // 找到对应的stage继续执行
                    // TODO: 实现跳转逻辑
                }
            }
        }
        
        // 完成
        this.stateManager.updateInstanceStatus(instanceId, 'completed');
        console.log(`[V9] SOP完成: ${instanceId}`);
    }

    // 执行单个Stage
    async executeStage(instanceId, stage, context) {
        console.log(`[V9] 执行Stage: ${stage.stage_id}`);
        
        // 记录Stage开始
        this.stateManager.logEvent(instanceId, 'info', 'stage_start', 
            `Stage ${stage.stage_id} 开始`);
        
        try {
            if (stage.decision_gate) {
                return await this.executeDecisionGate(instanceId, stage, context);
            } else if (stage.sub_sop) {
                return await this.executeSubSOP(instanceId, stage, context);
            } else {
                return await this.executeAction(instanceId, stage, context);
            }
        } catch (error) {
            this.stateManager.logEvent(instanceId, 'error', 'stage_failed',
                `Stage ${stage.stage_id} 失败: ${error.message}`);
            throw error;
        }
    }

    // 执行Action (调用VCP Agent)
    async executeAction(instanceId, stage, context) {
        const result = await this.vcpCaller.callAgent(stage.role, stage.action, context);
        
        return {
            type: 'action',
            status: 'completed',
            data: result
        };
    }

    // 检查暂停状态
    checkPaused(instanceId) {
        const instance = this.stateManager.getInstance(instanceId);
        return instance.status === 'paused';
    }

    // 更新实例上下文
    updateInstanceContext(instanceId, context) {
        const stmt = this.db.prepare(
            'UPDATE sop_instances SET context_json = ? WHERE id = ?'
        );
        stmt.run(JSON.stringify(context), instanceId);
    }

    // 加载SOP定义 (从数据库或文件)
    loadSOPDefinition(sopId) {
        // TODO: 从sop_definitions表加载
        // 临时从内存加载
        const defs = require('../../sop-definitions/news_analysis.yaml');
        return defs;
    }
}

module.exports = SOPEngine;
```

### 临时测试代码

**`temp_tests/engine.test.js`**:
```javascript
const SOPEngine = require('../src/engine/executor');
const DatabaseConnection = require('../src/database/connection');
const path = require('path');

async function test() {
    const config = {
        V9_DATABASE_PATH: path.join(__dirname, '../data/test.sqlite'),
        SOP_CONTEXT_SIZE_LIMIT: 10485760
    };
    
    // 初始化数据库
    const conn = new DatabaseConnection(config);
    await conn.initialize();
    
    // 创建引擎
    const engine = new SOPEngine(config, conn.getDb(), null);
    
    // 测试线性执行
    console.log('测试线性SOP执行...');
    // TODO: 需要mock VCP调用
    
    conn.close();
    console.log('引擎测试完成');
}

test().catch(console.error);
```

### 验收标准

- [ ] 单SOP顺序执行成功
- [ ] 上下文在Stage间正确传递
- [ ] 状态正确持久化到SQLite
- [ ] 暂停/恢复功能正常

---

## 阶段五：并行执行与决策门

**目标**：实现并行Stage执行和四种决策门模式

### 新依赖

```bash
cd E:\Projects\OMyAgents
npm install json-logic-js
```

### 文件创建清单

1. **`E:\Projects\OMyAgents\src\decision\expression-engine.js`**
```javascript
/**
 * 条件表达式引擎
 * 使用json-logic-js实现安全的表达式求值
 */

const jsonLogic = require('json-logic-js');

class ExpressionEngine {
    constructor() {
        // 注册自定义操作符
        this.registerCustomOperators();
    }

    registerCustomOperators() {
        // 递归深度检查
        jsonLogic.add_operation('recursion_depth_lt', (depth, max) => {
            return depth < max;
        });
        
        // 其他安全操作符...
    }

    // 求值条件表达式
    evaluate(condition, context) {
        try {
            // 将字符串条件解析为json-logic规则
            const rule = this.parseCondition(condition);
            return jsonLogic.apply(rule, context);
        } catch (error) {
            throw new Error(`表达式求值失败: ${error.message}`);
        }
    }

    parseCondition(condition) {
        // 支持简化语法到json-logic的转换
        // 例如: "score > 0.8" -> { ">": [{ "var": "score" }, 0.8] }
        if (typeof condition === 'string') {
            return this.parseStringCondition(condition);
        }
        return condition;
    }

    parseStringCondition(str) {
        // 简单解析: "has_high_value && recursion_depth < 3"
        // 转换为json-logic格式
        // 实际实现需要更健壮的解析器
        const vars = {};
        const pattern = /(\w+)\s*(>|<|=|>=|<=)\s*([^\s&|]+)/g;
        let match;
        
        while ((match = pattern.exec(str)) !== null) {
            const [_, left, op, right] = match;
            const val = isNaN(right) ? right : parseFloat(right);
            vars[left] = val;
        }
        
        return vars;
    }
}

module.exports = ExpressionEngine;
```

2. **`E:\Projects\OMyAgents\src\decision\human-decision.js`**
```javascript
/**
 * 人工决策门管理
 * 处理waiting状态、超时、决策提交
 */

class HumanDecisionManager {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.stateManager = new (require('../database/sop-state'))(db);
    }

    // 创建人工决策请求
    async createDecision(instanceId, gateConfig) {
        const options = gateConfig.options || ['approve', 'reject'];
        const timeout = this.parseTimeout(gateConfig.timeout);
        
        const decisionId = this.stateManager.createHumanDecision(
            instanceId,
            gateConfig.gate_id || 'human_gate',
            options,
            timeout
        );
        
        console.log(`[V9] 人工决策创建: ${decisionId}, 实例: ${instanceId}`);
        
        // 设置超时定时器
        this.scheduleTimeout(decisionId, timeout);
        
        return {
            type: 'decision_gate',
            status: 'waiting_decision',
            decision_id: decisionId,
            options: options,
            expires_at: Date.now() + (timeout * 60 * 60 * 1000)
        };
    }

    // 提交决策
    async submitDecision(decisionId, selectedOption, decisionData = null) {
        const instanceId = this.stateManager.submitHumanDecision(
            decisionId, selectedOption, decisionData
        );
        
        if (!instanceId) {
            throw new Error('决策不存在或已过期');
        }
        
        console.log(`[V9] 人工决策已提交: ${decisionId}, 选择: ${selectedOption}`);
        
        // 恢复SOP执行
        // TODO: 触发实例恢复
        
        return { success: true, instance_id: instanceId };
    }

    // 解析超时字符串 (如 "24h", "30m")
    parseTimeout(timeoutStr) {
        if (!timeoutStr) return 24; // 默认24小时
        
        const match = timeoutStr.match(/(\d+)(h|m|s)/);
        if (!match) return 24;
        
        const [, num, unit] = match;
        switch (unit) {
            case 'h': return parseInt(num);
            case 'm': return parseInt(num) / 60;
            case 's': return parseInt(num) / 3600;
            default: return 24;
        }
    }

    scheduleTimeout(decisionId, hours) {
        const ms = hours * 60 * 60 * 1000;
        setTimeout(() => {
            this.handleTimeout(decisionId);
        }, ms);
    }

    handleTimeout(decisionId) {
        // 检查决策是否仍未决定
        const stmt = this.db.prepare(
            'SELECT status FROM human_decisions WHERE id = ?'
        );
        const row = stmt.get(decisionId);
        
        if (row && row.status === 'pending') {
            // 标记为过期/自动拒绝
            const update = this.db.prepare(
                'UPDATE human_decisions SET status = ?, selected_option = ? WHERE id = ?'
            );
            update.run('expired', 'reject', decisionId);
            
            console.log(`[V9] 人工决策超时: ${decisionId}, 自动拒绝`);
        }
    }
}

module.exports = HumanDecisionManager;
```

### 验收标准

- [ ] 并行Stage并发数不超过配置上限
- [ ] 条件表达式正确求值
- [ ] 人工决策门正确暂停SOP
- [ ] 决策提交后SOP正确恢复
- [ ] 超时自动降级为reject

---

## 阶段六：递归调用与子SOP

**目标**：实现SOP嵌套调用和递归深度限制

### 文件创建清单

**`E:\Projects\OMyAgents\src\engine\recursion-manager.js`**:
```javascript
/**
 * 递归管理器
 * 处理子SOP调用、递归深度限制、错误隔离
 */

class RecursionManager {
    constructor(config, engine) {
        this.maxDepth = config.SOP_MAX_RECURSION_DEPTH || 3;
        this.engine = engine;
    }

    async executeSubSOP(parentInstanceId, subSopConfig, parentContext) {
        // 获取父实例信息
        const parentDepth = this.getRecursionDepth(parentInstanceId);
        const newDepth = parentDepth + 1;
        
        // 检查递归深度
        if (newDepth > this.maxDepth) {
            throw new RecursionDepthExceededError(
                `递归深度超过限制: ${newDepth} > ${this.maxDepth}`
            );
        }
        
        console.log(`[V9] 执行子SOP: ${subSopConfig.sop_id}, 深度: ${newDepth}`);
        
        // 准备子SOP上下文
        let childContext = {};
        if (subSopConfig.inherit_context) {
            childContext = { ...parentContext };
        }
        if (subSopConfig.context_mapping) {
            childContext = this.mapContext(childContext, subSopConfig.context_mapping);
        }
        
        // 创建子实例
        const childInstanceId = this.engine.stateManager.createInstance(
            subSopConfig.sop_id,
            childContext,
            parentInstanceId,
            newDepth
        );
        
        try {
            // 执行子SOP
            await this.engine.executeInstance(childInstanceId);
            
            // 获取结果
            const childInstance = this.engine.stateManager.getInstance(childInstanceId);
            return {
                type: 'sub_sop',
                status: childInstance.status,
                data: JSON.parse(childInstance.context_json)
            };
        } catch (error) {
            // 错误隔离：子SOP错误不传播到父SOP
            console.error(`[V9] 子SOP失败: ${subSopConfig.sop_id}`, error);
            return {
                type: 'sub_sop',
                status: 'failed',
                error: error.message
            };
        }
    }

    getRecursionDepth(instanceId) {
        return this.engine.stateManager.getRecursionDepth(instanceId);
    }

    mapContext(context, mapping) {
        const mapped = {};
        for (const [target, source] of Object.entries(mapping)) {
            mapped[target] = context[source];
        }
        return mapped;
    }
}

class RecursionDepthExceededError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RecursionDepthExceededError';
    }
}

module.exports = { RecursionManager, RecursionDepthExceededError };
```

### 验收标准

- [ ] 子SOP正确继承父上下文
- [ ] 递归深度超过3时自动终止
- [ ] 子SOP错误不导致父SOP崩溃
- [ ] 子SOP完成结果正确返回

---

## 阶段七：事件监听系统集成

**目标**：实现DailyNote监听和CronTasks集成

### 参考代码

**KnowledgeBaseManager.js chokidar使用** (E:\\Projects\\VCPToolBox\\KnowledgeBaseManager.js:960-984):
```javascript
this.watcher = chokidar.watch(this.config.rootPath, { 
    ignored: /(^|[\/\])\../, 
    ignoreInitial: !this.config.fullScanOnStartup 
});
this.watcher.on('add', handleFile)
            .on('change', handleFile)
            .on('unlink', fp => this._handleDelete(fp));
```

### 文件创建清单

**`E:\Projects\OMyAgents\src\events\dailynote-watcher.js`**:
```javascript
/**
 * DailyNote文件监听
 * 使用chokidar监听日记变更 (参考KnowledgeBaseManager.js:960-984)
 */

const chokidar = require('chokidar');
const path = require('path');

class DailyNoteWatcher {
    constructor(config, triggerStore, sopEngine) {
        this.dailynotePath = path.resolve(config.DAILYNOTE_PATH || './dailynote');
        this.triggerStore = triggerStore;
        this.sopEngine = sopEngine;
        this.watcher = null;
    }

    start() {
        console.log(`[V9] 启动DailyNote监听: ${this.dailynotePath}`);
        
        this.watcher = chokidar.watch(this.dailynotePath, {
            ignored: /(^|[\/\])\../,  // 忽略隐藏文件
            ignoreInitial: true,       // 忽略初始扫描
            depth: 2,                  // 监听子目录（日记本层级）
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });
        
        this.watcher
            .on('add', filePath => this.handleNewEntry(filePath))
            .on('change', filePath => this.handleModified(filePath))
            .on('error', error => console.error('[V9] 监听错误:', error));
    }

    handleNewEntry(filePath) {
        const diaryName = this.extractDiaryName(filePath);
        console.log(`[V9] 检测到新日记: ${diaryName}`);
        
        // 查找触发器
        const triggers = this.triggerStore.findByDiary(diaryName);
        for (const trigger of triggers) {
            this.sopEngine.executeSOP(trigger.sop_id, {
                trigger_type: 'dailynote_change',
                trigger_file: filePath,
                diary_name: diaryName,
                event_type: 'new_entry'
            });
        }
    }

    handleModified(filePath) {
        // 类似处理...
    }

    extractDiaryName(filePath) {
        const relative = path.relative(this.dailynotePath, filePath);
        return path.dirname(relative).split(path.sep)[0];
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
            console.log('[V9] DailyNote监听已停止');
        }
    }
}

module.exports = DailyNoteWatcher;
```

**`E:\Projects\OMyAgents\src\events\cron-integrator.js`**:
```javascript
/**
 * CronTaskOrchestrator集成
 * 通过HTTP API调用 (参考Plugin/CronTaskOrchestrator/src/api/routes.js)
 */

const fetch = require('node-fetch');

class CronIntegrator {
    constructor(config) {
        this.baseUrl = config.CRON_TASKS_BASE_URL || 'http://localhost:5890';
        this.vcpKey = config.VCP_KEY;
        this.v9BaseUrl = `http://localhost:${config.PORT || 5890}/v9`;
    }

    async registerSOPTrigger(sopId, cronExpression, name) {
        const response = await fetch(`${this.baseUrl}/v1/cron_tasks/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.vcpKey}`
            },
            body: JSON.stringify({
                type: 'cron',
                name: name || `V9_${sopId}`,
                cronExpression: cronExpression,
                executor: {
                    type: 'http',
                    target: `${this.v9BaseUrl}/v1/sop/execute`,
                    method: 'POST',
                    payload: { sop_id: sopId }
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Cron任务创建失败: ${response.status}`);
        }

        return await response.json();
    }

    async pauseTask(taskId) {
        const response = await fetch(`${this.baseUrl}/v1/cron_tasks/${taskId}/pause`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.vcpKey}` }
        });
        return response.ok;
    }

    async resumeTask(taskId) {
        const response = await fetch(`${this.baseUrl}/v1/cron_tasks/${taskId}/resume`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.vcpKey}` }
        });
        return response.ok;
    }
}

module.exports = CronIntegrator;
```

### 验收标准

- [ ] chokidar正确监听dailynote目录
- [ ] 新增日记文件时触发对应SOP
- [ ] CronTasks HTTP API调用成功
- [ ] 定时任务正确触发SOP

---

## 阶段八：REST API与VCP集成

**目标**：完善API路由和VCP工具命令

### API端点汇总

已在阶段一的 `index.js` 中创建基础路由，本阶段需完善实现。

### 更新 `index.js`

将TODO替换为实际实现：
```javascript
// 引入各模块
const SOPEngine = require('./src/engine/executor');
const HumanDecisionManager = require('./src/decision/human-decision');

// 初始化时创建引擎实例
let sopEngine;
let decisionManager;

async function initialize(initialConfig, dependencies) {
    // ...现有代码...
    
    // 初始化引擎
    sopEngine = new SOPEngine(config, db, pluginManager);
    decisionManager = new HumanDecisionManager(config, db);
}

// 更新路由实现
router.post('/v1/sop/execute', async (req, res) => {
    try {
        const { sop_id, initial_context } = req.body;
        if (!sop_id) {
            return res.status(400).json({ success: false, error: '缺少sop_id参数' });
        }
        
        const instanceId = await sopEngine.executeSOP(sop_id, initial_context);
        res.json({ success: true, instance_id: instanceId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/v1/sop/:id/decision', async (req, res) => {
    try {
        const { id } = req.params;
        const { option, data } = req.body;
        
        const result = await decisionManager.submitDecision(id, option, data);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
```

### 验收标准

- [ ] 所有API端点返回正确数据
- [ ] 认证中间件检查VCP_Key
- [ ] 错误处理返回标准JSON格式
- [ ] VCP Tool Commands可被AI调用

---

## 阶段九：安全加固与错误处理

**目标**：实现YAML沙箱、上下文限制、错误隔离

### 文件创建清单

**`E:\Projects\OMyAgents\src\security\yaml-sandbox.js`**:
```javascript
/**
 * YAML沙箱解析
 * 防止代码注入攻击
 */

const yaml = require('js-yaml');

class YAMLSandbox {
    static parse(content, filename = 'unknown') {
        // 使用CORE_SCHEMA (无自定义类型)
        const doc = yaml.load(content, {
            schema: yaml.CORE_SCHEMA,
            filename: filename,
            json: true, // 禁止函数
            onWarning: (w) => console.warn(`[YAML] ${w.message}`)
        });
        
        // 递归检查函数
        this.checkForFunctions(doc);
        
        // 检查循环引用
        this.checkCircularRefs(doc);
        
        return doc;
    }

    static checkForFunctions(obj, path = '') {
        if (typeof obj === 'function') {
            throw new Error(`YAML包含非法函数: ${path}`);
        }
        if (obj && typeof obj === 'object') {
            for (const [k, v] of Object.entries(obj)) {
                this.checkForFunctions(v, `${path}.${k}`);
            }
        }
        if (Array.isArray(obj)) {
            obj.forEach((v, i) => this.checkForFunctions(v, `${path}[${i}]`));
        }
    }

    static checkCircularRefs(obj) {
        const seen = new WeakSet();
        const check = (o) => {
            if (o && typeof o === 'object') {
                if (seen.has(o)) throw new Error('YAML包含循环引用');
                seen.add(o);
                Object.values(o).forEach(check);
            }
        };
        check(obj);
    }
}

module.exports = YAMLSandbox;
```

### 验收标准

- [ ] 包含函数的YAML被拒绝
- [ ] 上下文超过限制时正确报错
- [ ] 子SOP错误不传播到父SOP
- [ ] 所有外部输入验证

---

## 阶段十：热更新与观测性

**目标**：实现SOP定义热更新和事件可观测

### 文件创建清单

**`E:\Projects\OMyAgents\src\hotreload\sop-reloader.js`**:
```javascript
/**
 * SOP定义热重载
 * 参考KnowledgeBaseManager.js:166-171模式
 */

const chokidar = require('chokidar');
const path = require('path');
const YAMLLoader = require('../parser/yaml-loader');

class SOPReloader {
    constructor(definitionsPath, db) {
        this.definitionsPath = definitionsPath;
        this.db = db;
        this.watcher = null;
        this.loader = new YAMLLoader(definitionsPath);
    }

    start() {
        console.log('[V9] 启动SOP定义热重载监听');
        
        this.watcher = chokidar.watch(this.definitionsPath, {
            ignored: /(^|[\/\])\../,
            persistent: true
        });
        
        this.watcher
            .on('change', filePath => this.reloadFile(filePath))
            .on('add', filePath => this.loadNewFile(filePath))
            .on('unlink', filePath => this.deactivateSOP(filePath));
    }

    async reloadFile(filePath) {
        const sopId = path.basename(filePath, path.extname(filePath));
        console.log(`[V9] 热重载SOP: ${sopId}`);
        
        try {
            const content = await this.loader.loadFile(filePath);
            
            // 更新数据库中的定义
            // 正在执行的实例使用旧定义，新实例使用新定义
            const stmt = this.db.prepare(`
                UPDATE sop_definitions 
                SET yaml_content = ?, parsed_json = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND is_active = 1
            `);
            stmt.run(
                content, 
                JSON.stringify(content), 
                Date.now(), 
                content.sop_id
            );
            
            console.log(`[V9] SOP定义已更新: ${content.sop_id}`);
        } catch (error) {
            console.error(`[V9] 热重载失败: ${filePath}`, error);
        }
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
        }
    }
}

module.exports = SOPReloader;
```

### 验收标准

- [ ] YAML修改后热重载
- [ ] 执行中实例使用旧定义
- [ ] 事件日志记录到VCP
- [ ] 支持统计指标导出

---

## 阶段十一：集成测试与验收

### 测试场景执行清单

**场景A：线性SOP编排**
```bash
# 1. 创建测试SOP
curl -X POST http://localhost:5890/v9/v1/sop/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_VCP_KEY" \
  -d '{"sop_id": "test_linear", "initial_context": {"test": true}}'

# 2. 查询状态
curl http://localhost:5890/v9/v1/sop/{instance_id}/status
```

**场景B：并行+决策门**
- 验证并发数限制
- 验证条件表达式
- 验证Agent评估

**场景C：递归+人工决策**
- 验证子SOP调用
- 验证深度限制
- 验证人工决策流程

**场景D：事件驱动**
- 在dailynote目录创建测试文件
- 验证Cron定时触发
- 验证HTTP手动触发

### 质量检查

```bash
# 代码风格检查
cd E:\Projects\VCPToolBox
npx eslint Plugin/OMyAgents/

# LSP诊断
# 检查所有.js文件无错误
```

### 最终验收标准

- [ ] 场景A-D全部通过
- [ ] 性能指标：决策门响应<1s，并发Stage≤10
- [ ] 代码风格符合AGENTS.md
- [ ] 无安全漏洞（YAML沙箱、上下文限制）
- [ ] 删除所有temp_tests/临时代码

---

## 附录：关键代码参考

### VCP Plugin.js 插件加载模式 (E:\Projects\VCPToolBox\Plugin.js:476-494)

```javascript
// 插件类型判断
const isPreprocessor = manifest.pluginType === 'messagePreprocessor' || manifest.pluginType === 'hybridservice';
const isService = manifest.pluginType === 'service' || manifest.pluginType === 'hybridservice';

// Service插件初始化
if (isService) {
    this.serviceModules.set(manifest.name, { manifest, module });
}

// 调用registerRoutes (Plugin.js初始化流程)
// 在server.js中通过 pluginModule.registerRoutes(app, config, projectBasePath) 调用
```

### KnowledgeBaseManager chokidar使用 (E:\Projects\VCPToolBox\KnowledgeBaseManager.js:960-984)

```javascript
this.watcher = chokidar.watch(this.config.rootPath, { 
    ignored: /(^|[\/\])\../, 
    ignoreInitial: !this.config.fullScanOnStartup 
});
```

### CronTaskOrchestrator HTTP API (E:\Projects\VCPToolBox\Plugin\CronTaskOrchestrator\src\api\routes.js)

```javascript
// 创建任务
router.post('/v1/cron_tasks/create', async (req, res) => { ... });

// 暂停/恢复
router.post('/v1/cron_tasks/:id/pause', async (req, res) => { ... });
router.post('/v1/cron_tasks/:id/resume', async (req, res) => { ... });
```

---

**文档版本**: V9.1-EXEC  
**最后更新**: 2026-03-18  
**执行状态**: 待开始
