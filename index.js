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
