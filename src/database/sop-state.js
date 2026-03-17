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
