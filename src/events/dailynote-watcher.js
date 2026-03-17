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
        
        console.log('[V9] DailyNote监听已启动');
    }

    handleNewEntry(filePath) {
        console.log(`[V9] 新日记条目: ${filePath}`);
        this.checkTriggers('dailynote_change', {
            file_path: filePath,
            event_type: 'add',
            timestamp: Date.now()
        });
    }

    handleModified(filePath) {
        console.log(`[V9] 日记条目修改: ${filePath}`);
        this.checkTriggers('dailynote_change', {
            file_path: filePath,
            event_type: 'change',
            timestamp: Date.now()
        });
    }

    // 检查触发器
    checkTriggers(triggerType, eventData) {
        // 获取所有激活的DailyNote触发器
        const triggers = this.triggerStore.getTriggersByType(triggerType);
        
        for (const trigger of triggers) {
            if (this.matchesTrigger(trigger, eventData)) {
                this.executeTrigger(trigger, eventData);
            }
        }
    }

    // 检查事件是否匹配触发器条件
    matchesTrigger(trigger, eventData) {
        const config = trigger.config_json || {};
        
        // 检查日记本名称匹配
        if (config.diary_name) {
            const diaryName = path.basename(path.dirname(eventData.file_path));
            if (diaryName !== config.diary_name) {
                return false;
            }
        }
        
        // 检查文件扩展名
        if (config.file_extension) {
            const ext = path.extname(eventData.file_path);
            if (ext !== config.file_extension) {
                return false;
            }
        }
        
        return true;
    }

    // 执行触发
    async executeTrigger(trigger, eventData) {
        console.log(`[V9] 触发SOP: ${trigger.sop_id}, 触发器: ${trigger.id}`);
        
        try {
            // 启动SOP，传递事件数据作为初始上下文
            await this.sopEngine.executeSOP(trigger.sop_id, {
                trigger: {
                    type: 'dailynote_change',
                    data: eventData
                }
            });
            
            // 更新最后触发时间
            this.triggerStore.updateLastTriggered(trigger.id);
        } catch (error) {
            console.error(`[V9] 触发SOP失败: ${trigger.sop_id}`, error);
        }
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
            console.log('[V9] DailyNote监听已停止');
        }
    }
}

module.exports = DailyNoteWatcher;
