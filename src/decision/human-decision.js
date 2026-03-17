/**
 * 人工决策门管理
 * 处理waiting状态、超时、决策提交
 */

class HumanDecisionManager {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.stateManager = new (require('../database/sop-state'))(db);
        this.activeTimeouts = new Map(); // 跟踪活动的超时定时器
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
        // 取消超时定时器
        if (this.activeTimeouts.has(decisionId)) {
            clearTimeout(this.activeTimeouts.get(decisionId));
            this.activeTimeouts.delete(decisionId);
        }
        
        const instanceId = this.stateManager.submitHumanDecision(
            decisionId, selectedOption, decisionData
        );
        
        if (!instanceId) {
            throw new Error('决策不存在或已过期');
        }
        
        console.log(`[V9] 人工决策已提交: ${decisionId}, 选择: ${selectedOption}`);
        
        // 恢复SOP执行
        // 触发实例恢复 (实际实现中需要调用引擎恢复)
        
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
        const timeoutId = setTimeout(() => {
            this.handleTimeout(decisionId);
        }, ms);
        
        this.activeTimeouts.set(decisionId, timeoutId);
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
            
            // 更新实例状态
            const getStmt = this.db.prepare(
                'SELECT instance_id FROM human_decisions WHERE id = ?'
            );
            const result = getStmt.get(decisionId);
            if (result) {
                this.stateManager.updateInstanceStatus(result.instance_id, 'running');
            }
            
            console.log(`[V9] 人工决策超时: ${decisionId}, 自动拒绝`);
        }
        
        this.activeTimeouts.delete(decisionId);
    }

    // 清理所有活动的超时定时器
    cleanup() {
        for (const [decisionId, timeoutId] of this.activeTimeouts) {
            clearTimeout(timeoutId);
        }
        this.activeTimeouts.clear();
    }
}

module.exports = HumanDecisionManager;
