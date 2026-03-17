# OMyAgents V9 更新日志

## [1.0.0] - 2026-03-18

### 初始版本发布

基于VCP 6.4插件生态的SOP编排器，支持决策门、递归调用和事件驱动。

---

## 测试驱动修正记录

### 2026-03-18 集成测试修正

在真实VCPToolBox环境测试中发现并修正以下问题：

#### 1. 外键约束处理 [src/database/sop-state.js]

**问题**: 创建`sop_instances`时，外键`sop_id`引用的`sop_definitions`记录可能不存在，导致`FOREIGN KEY constraint failed`错误。

**修正**: 增强`createInstance`方法，自动检查并创建`sop_definitions`占位符记录：
```javascript
createInstance(sopId, initialContext = {}, parentId = null, recursionDepth = 0) {
    // 检查sop_definitions是否存在，不存在则创建占位符
    const checkStmt = this.db.prepare('SELECT id FROM sop_definitions WHERE id = ?');
    const existing = checkStmt.get(sopId);
    
    if (!existing) {
        // 自动创建sop_definitions占位符记录
        const now = Date.now();
        const insertDef = this.db.prepare(`
            INSERT INTO sop_definitions (id, name, yaml_content, parsed_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertDef.run(sopId, sopId, '', '{}', now, now);
    }
    // ... 原逻辑
}
```

**注意事项**: 
- 生产环境中应确保`sop_definitions`在实例创建前已正确定义
- 占位符记录仅用于满足外键约束，不包含完整YAML内容

#### 2. Stage执行记录方法缺失 [src/database/sop-state.js]

**问题**: 测试发现缺少`createStageExecution`和`updateStageExecution`方法，无法记录Stage执行状态。

**修正**: 添加以下方法：
```javascript
// 创建Stage执行记录
createStageExecution(instanceId, stageId, stageType) {
    const id = `stage_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = Date.now();
    
    const stmt = this.db.prepare(`
        INSERT INTO stage_executions (id, instance_id, stage_id, stage_type, status, started_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
    `);
    stmt.run(id, instanceId, stageId, stageType, now);
    
    return id;
}

// 更新Stage执行状态
updateStageExecution(stageId, status, output = null) {
    const stmt = this.db.prepare(`
        UPDATE stage_executions 
        SET status = ?, output_json = ?, completed_at = ?
        WHERE id = ?
    `);
    stmt.run(status, output ? JSON.stringify(output) : null, Date.now(), stageId);
}
```

#### 3. 级联删除实现 [src/database/sop-state.js]

**问题**: 删除`sop_instances`时，由于外键约束，必须先删除关联的子表记录。

**修正**: 添加`deleteInstance`方法，按正确顺序级联删除：
```javascript
deleteInstance(instanceId) {
    // 先删除子表数据（注意顺序）
    this.db.prepare('DELETE FROM parallel_stage_groups WHERE instance_id = ?').run(instanceId);
    this.db.prepare('DELETE FROM human_decisions WHERE instance_id = ?').run(instanceId);
    this.db.prepare('DELETE FROM stage_executions WHERE instance_id = ?').run(instanceId);
    this.db.prepare('DELETE FROM execution_logs WHERE instance_id = ?').run(instanceId);
    // 最后删除主表
    this.db.prepare('DELETE FROM sop_instances WHERE id = ?').run(instanceId);
}
```

**外键依赖链**: 
```
sop_instances (主表)
├── stage_executions (外键: instance_id)
├── human_decisions (外键: instance_id)
├── parallel_stage_groups (外键: instance_id)
└── execution_logs (外键: instance_id)
```

#### 4. 执行器Stage记录集成 [src/engine/executor.js]

**问题**: `executeStage`方法执行Stage时未创建执行记录，无法追踪Stage状态。

**修正**: 在`executeStage`中集成Stage记录：
```javascript
async executeStage(instanceId, stage, context) {
    // 确定stage类型
    let stageType = 'action';
    if (stage.decision_gate) stageType = 'decision_gate';
    if (stage.sub_sop) stageType = 'sub_sop';
    
    // 创建Stage执行记录
    const stageExecutionId = this.stateManager.createStageExecution(
        instanceId, stage.stage_id, stageType
    );
    
    try {
        let result;
        // ... 执行逻辑
        
        // 更新Stage为完成状态
        this.stateManager.updateStageExecution(stageExecutionId, 'completed', result);
        return result;
    } catch (error) {
        // 更新Stage为失败状态
        this.stateManager.updateStageExecution(stageExecutionId, 'failed', { error: error.message });
        throw error;
    }
}
```

---

## VCP集成规范

### 数据库使用规范

OMyAgents遵循VCP数据库使用模式：

1. **通过KnowledgeBaseManager获取数据库实例**:
   ```javascript
   // index.js
   knowledgeBaseManager = dependencies?.vectorDBManager || global.knowledgeBaseManager;
   if (knowledgeBaseManager && knowledgeBaseManager.db) {
       db = knowledgeBaseManager.db;
   }
   ```

2. **使用better-sqlite3的prepare/run/get模式**:
   ```javascript
   // 查询
   const stmt = db.prepare('SELECT * FROM sop_instances WHERE id = ?');
   const row = stmt.get(instanceId);
   
   // 插入/更新
   const stmt = db.prepare('INSERT INTO ... VALUES (?, ?)');
   stmt.run(value1, value2);
   ```

3. **Schema初始化在initialize中完成**:
   ```javascript
   // index.js
   async function initializeDatabase() {
       if (knowledgeBaseManager && knowledgeBaseManager.db) {
           db = knowledgeBaseManager.db;
           const SchemaManager = require('./src/database/schema');
           const schema = new SchemaManager(db);
           schema.initialize(); // 执行CREATE TABLE IF NOT EXISTS
       }
   }
   ```

### 表结构说明

```sql
-- SOP定义表
CREATE TABLE sop_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    yaml_content TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- SOP执行实例表
CREATE TABLE sop_instances (
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
CREATE TABLE stage_executions (
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

-- 并行Stage组表
CREATE TABLE parallel_stage_groups (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES sop_instances(id),
    group_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'partial_complete', 'completed')),
    total_count INTEGER NOT NULL,
    completed_count INTEGER DEFAULT 0,
    results_json TEXT DEFAULT '[]'
);

-- 人工决策门表
CREATE TABLE human_decisions (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES sop_instances(id),
    gate_id TEXT NOT NULL,
    decision_type TEXT NOT NULL CHECK(decision_type IN ('approval', 'selection', 'custom')),
    options_json TEXT NOT NULL,
    selected_option TEXT,
    decision_data TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'decided', 'expired', 'rejected')),
    requested_at INTEGER NOT NULL,
    decided_at INTEGER,
    expires_at INTEGER NOT NULL
);

-- 事件触发器表
CREATE TABLE event_triggers (
    id TEXT PRIMARY KEY,
    sop_id TEXT NOT NULL REFERENCES sop_definitions(id),
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('dailynote_change', 'cron', 'webhook', 'manual')),
    config_json TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_triggered_at INTEGER,
    created_at INTEGER NOT NULL
);

-- 执行日志表
CREATE TABLE execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT REFERENCES sop_instances(id),
    level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT,
    timestamp INTEGER NOT NULL
);
```

---

## 测试方法

### 标准集成测试

位置: `Plugin/OMyAgents/test_sop.js`

运行:
```bash
cd E:/projects/VCPToolBox
node Plugin/OMyAgents/test_sop.js
```

测试内容:
1. 数据库Schema初始化验证
2. SOP状态管理（实例CRUD）
3. Stage执行记录（创建、更新）
4. YAML SOP定义解析（安全加载、Schema验证）
5. 决策表达式引擎（条件求值）
6. 上下文管理（创建、传递、继承）
7. 递归深度管理（深度追踪、限制检测）

---

## 已知限制

### 当前版本限制

1. **事件驱动**: DailyNote监听和Cron集成尚未实现（TODO）
2. **VCP调用**: VCPCaller.callAgent方法尚未实现实际HTTP调用
3. **API路由**: REST API端点已实现但返回占位符数据

### 后续版本计划

- [ ] 实现VCP HTTP API调用
- [ ] 实现DailyNote文件监听(chokidar)
- [ ] 实现Cron任务调度集成
- [ ] 实现SOP执行状态机完整逻辑
- [ ] 实现人工决策门的超时降级

---

## 版本历史

### [1.0.0] - 2026-03-18
- 初始版本发布
- 数据库Schema实现
- YAML解析器实现
- 表达式引擎实现
- 上下文管理器实现
- 递归管理器实现
- SOP执行引擎框架实现
- VCP集成（通过KnowledgeBaseManager复用数据库）
- 7项标准集成测试全部通过

---

## 开发者注意事项

### 新增方法必须添加单元测试

每次修改`src/`下的源码，应同步更新测试确保功能正确。

### 数据库操作必须使用事务

对于多表操作，建议使用事务保证原子性：
```javascript
const transaction = db.transaction(() => {
    // 多个SQL操作
});
transaction();
```

### 错误处理必须记录到execution_logs

所有业务错误应记录到`execution_logs`表便于排查：
```javascript
stateManager.logEvent(instanceId, 'error', 'operation_failed', error.message);
```

---

**文档维护者**: OMyAgents Team  
**最后更新**: 2026-03-18 05:45 CST
