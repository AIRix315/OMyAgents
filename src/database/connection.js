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
