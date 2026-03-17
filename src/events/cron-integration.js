/**
 * CronTasks集成
 * 通过HTTP API调用CronTaskOrchestrator创建定时任务
 */

const fetch = require('node-fetch');

class CronIntegration {
    constructor(config) {
        this.baseUrl = config.CRON_TASKS_BASE_URL || 'http://localhost:5890';
        this.vcpKey = config.VCP_KEY;
        this.createdTasks = new Map(); // 跟踪创建的任务
    }

    // 创建Cron定时任务
    async createCronTask(sopId, cronExpression, initialContext = {}) {
        const url = `${this.baseUrl}/v1/cron_tasks/create`;
        
        const taskConfig = {
            name: `SOP-${sopId}`,
            cron: cronExpression,
            task_type: 'sop_trigger',
            payload: {
                sop_id: sopId,
                initial_context: initialContext
            }
        };
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.vcpKey}`
                },
                body: JSON.stringify(taskConfig)
            });
            
            if (!response.ok) {
                throw new Error(`Cron任务创建失败: ${response.status}`);
            }
            
            const result = await response.json();
            this.createdTasks.set(sopId, result.task_id);
            
            console.log(`[V9] Cron任务已创建: ${result.task_id} for SOP ${sopId}`);
            return result.task_id;
        } catch (error) {
            console.error('[V9] 创建Cron任务失败:', error);
            throw error;
        }
    }

    // 创建Heartbeat任务（带条件检查）
    async createHeartbeatTask(sopId, interval, condition = null, initialContext = {}) {
        const url = `${this.baseUrl}/v1/cron_tasks/create`;
        
        const taskConfig = {
            name: `SOP-Heartbeat-${sopId}`,
            task_type: 'heartbeat',
            interval: interval, // 秒
            condition: condition, // 条件表达式
            payload: {
                sop_id: sopId,
                initial_context: initialContext
            }
        };
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.vcpKey}`
                },
                body: JSON.stringify(taskConfig)
            });
            
            if (!response.ok) {
                throw new Error(`Heartbeat任务创建失败: ${response.status}`);
            }
            
            const result = await response.json();
            this.createdTasks.set(`${sopId}_heartbeat`, result.task_id);
            
            console.log(`[V9] Heartbeat任务已创建: ${result.task_id} for SOP ${sopId}`);
            return result.task_id;
        } catch (error) {
            console.error('[V9] 创建Heartbeat任务失败:', error);
            throw error;
        }
    }

    // 暂停任务
    async pauseTask(taskId) {
        const url = `${this.baseUrl}/v1/cron_tasks/${taskId}/pause`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.vcpKey}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`暂停任务失败: ${response.status}`);
            }
            
            console.log(`[V9] 任务已暂停: ${taskId}`);
            return true;
        } catch (error) {
            console.error('[V9] 暂停任务失败:', error);
            throw error;
        }
    }

    // 恢复任务
    async resumeTask(taskId) {
        const url = `${this.baseUrl}/v1/cron_tasks/${taskId}/resume`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.vcpKey}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`恢复任务失败: ${response.status}`);
            }
            
            console.log(`[V9] 任务已恢复: ${taskId}`);
            return true;
        } catch (error) {
            console.error('[V9] 恢复任务失败:', error);
            throw error;
        }
    }

    // 删除任务
    async deleteTask(taskId) {
        const url = `${this.baseUrl}/v1/cron_tasks/${taskId}`;
        
        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.vcpKey}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`删除任务失败: ${response.status}`);
            }
            
            console.log(`[V9] 任务已删除: ${taskId}`);
            return true;
        } catch (error) {
            console.error('[V9] 删除任务失败:', error);
            throw error;
        }
    }

    // 列出所有任务
    async listTasks() {
        const url = `${this.baseUrl}/v1/cron_tasks`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.vcpKey}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`获取任务列表失败: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('[V9] 获取任务列表失败:', error);
            throw error;
        }
    }

    // 清理所有创建的任务
    async cleanup() {
        console.log('[V9] 清理Cron任务...');
        
        for (const [key, taskId] of this.createdTasks) {
            try {
                await this.deleteTask(taskId);
            } catch (error) {
                console.warn(`[V9] 清理任务失败: ${taskId}`, error.message);
            }
        }
        
        this.createdTasks.clear();
        console.log('[V9] Cron任务清理完成');
    }
}

module.exports = CronIntegration;
