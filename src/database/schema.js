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
    decision_type TEXT NOT NULL CHECK(decision_type IN ('approval', 'selection', 'custom')),
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
