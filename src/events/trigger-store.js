/**
 * 触发器存储
 * 管理事件触发器的CRUD操作
 */

class TriggerStore {
    constructor(db) {
        this.db = db;
    }

    // 创建触发器
    createTrigger(sopId, triggerType, config) {
        const id = `trigger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        
        const stmt = this.db.prepare(`
            INSERT INTO event_triggers (id, sop_id, trigger_type, config_json, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
        `);
        
        stmt.run(id, sopId, triggerType, JSON.stringify(config), now);
        
        return id;
    }

    // 获取触发器
    getTrigger(triggerId) {
        const stmt = this.db.prepare('SELECT * FROM event_triggers WHERE id = ?');
        return stmt.get(triggerId);
    }

    // 获取SOP的所有触发器
    getTriggersBySOP(sopId) {
        const stmt = this.db.prepare(
            'SELECT * FROM event_triggers WHERE sop_id = ? AND is_active = 1'
        );
        return stmt.all(sopId);
    }

    // 按类型获取触发器
    getTriggersByType(triggerType) {
        const stmt = this.db.prepare(
            'SELECT * FROM event_triggers WHERE trigger_type = ? AND is_active = 1'
        );
        return stmt.all(triggerType);
    }

    // 更新触发器配置
    updateTrigger(triggerId, config) {
        const stmt = this.db.prepare(
            'UPDATE event_triggers SET config_json = ? WHERE id = ?'
        );
        stmt.run(JSON.stringify(config), triggerId);
    }

    // 更新最后触发时间
    updateLastTriggered(triggerId) {
        const stmt = this.db.prepare(
            'UPDATE event_triggers SET last_triggered_at = ? WHERE id = ?'
        );
        stmt.run(Date.now(), triggerId);
    }

    // 启用/禁用触发器
    setTriggerActive(triggerId, isActive) {
        const stmt = this.db.prepare(
            'UPDATE event_triggers SET is_active = ? WHERE id = ?'
        );
        stmt.run(isActive ? 1 : 0, triggerId);
    }

    // 删除触发器
    deleteTrigger(triggerId) {
        const stmt = this.db.prepare('DELETE FROM event_triggers WHERE id = ?');
        stmt.run(triggerId);
    }

    // 获取所有激活的触发器
    getAllActiveTriggers() {
        const stmt = this.db.prepare('SELECT * FROM event_triggers WHERE is_active = 1');
        return stmt.all();
    }
}

module.exports = TriggerStore;
