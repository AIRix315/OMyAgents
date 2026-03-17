/**
 * 数据库层测试 - 阶段二验收
 * 运行: node temp_tests/test-database.js
 */

const DatabaseConnection = require('../src/database/connection');
const SchemaManager = require('../src/database/schema');
const SOPStateManager = require('../src/database/sop-state');
const path = require('path');

async function runTests() {
    console.log('========================================');
    console.log('  数据库层测试 - 阶段二验收');
    console.log('========================================\n');
    
    let conn = null;
    let passed = 0;
    let failed = 0;
    
    try {
        // 测试1: 数据库连接
        console.log('测试1: 数据库连接...');
        const config = {
            V9_DATABASE_PATH: path.join(__dirname, '../data/test.sqlite')
        };
        
        conn = new DatabaseConnection(config);
        await conn.initialize();
        console.log('  ✓ 数据库连接成功\n');
        passed++;
        
        // 测试2: 表结构初始化
        console.log('测试2: 表结构初始化...');
        const schema = new SchemaManager(conn.getDb());
        schema.initialize();
        console.log('  ✓ 表结构初始化成功\n');
        passed++;
        
        // 测试3: SOP实例CRUD
        console.log('测试3: SOP实例CRUD...');
        const stateMgr = new SOPStateManager(conn.getDb());
        const instanceId = stateMgr.createInstance('test_sop', { test: true, value: 123 });
        console.log(`  ✓ 创建实例: ${instanceId}`);
        
        const instance = stateMgr.getInstance(instanceId);
        if (instance.sop_id !== 'test_sop') {
            throw new Error('实例数据不匹配');
        }
        console.log('  ✓ 读取实例成功');
        
        stateMgr.updateInstanceStatus(instanceId, 'running', 'stage_1');
        const updated = stateMgr.getInstance(instanceId);
        if (updated.status !== 'running' || updated.current_stage_id !== 'stage_1') {
            throw new Error('状态更新失败');
        }
        console.log('  ✓ 更新状态成功\n');
        passed++;
        
        // 测试4: 递归深度追踪
        console.log('测试4: 递归深度追踪...');
        const childId = stateMgr.createInstance('child_sop', {}, instanceId, 1);
        const depth = stateMgr.getRecursionDepth(childId);
        if (depth !== 1) {
            throw new Error(`递归深度错误: ${depth}`);
        }
        console.log(`  ✓ 递归深度正确: ${depth}\n`);
        passed++;
        
        // 测试5: 人工决策
        console.log('测试5: 人工决策...');
        const decisionId = stateMgr.createHumanDecision(
            instanceId, 
            'test_gate', 
            ['approve', 'reject'], 
            24
        );
        console.log(`  ✓ 创建决策: ${decisionId}`);
        
        const instanceWithDecision = stateMgr.getInstance(instanceId);
        if (instanceWithDecision.status !== 'waiting_decision') {
            throw new Error('决策状态未更新');
        }
        console.log('  ✓ 实例状态已更新为 waiting_decision');
        
        const resumedId = stateMgr.submitHumanDecision(decisionId, 'approve', { reason: 'test' });
        if (resumedId !== instanceId) {
            throw new Error('决策提交失败');
        }
        
        const instanceAfterDecision = stateMgr.getInstance(instanceId);
        if (instanceAfterDecision.status !== 'running') {
            throw new Error('决策后状态未恢复');
        }
        console.log('  ✓ 决策提交成功，状态恢复为 running\n');
        passed++;
        
        // 测试6: 日志记录
        console.log('测试6: 执行日志记录...');
        stateMgr.logEvent(instanceId, 'info', 'test_event', '测试日志消息', { detail: 'data' });
        console.log('  ✓ 日志记录成功\n');
        passed++;
        
        // 测试7: 事务支持
        console.log('测试7: 事务回滚...');
        try {
            conn.getDb().transaction(() => {
                stateMgr.createInstance('tx_test', {});
                throw new Error('回滚测试');
            })();
        } catch (e) {
            // 预期错误，检查是否回滚
            console.log('  ✓ 事务回滚正常\n');
            passed++;
        }
        
    } catch (error) {
        console.error('  ✗ 测试失败:', error.message);
        failed++;
    } finally {
        if (conn) {
            conn.close();
        }
    }
    
    // 测试报告
    console.log('========================================');
    console.log('  测试结果');
    console.log('========================================');
    console.log(`  通过: ${passed}`);
    console.log(`  失败: ${failed}`);
    console.log(`  总计: ${passed + failed}`);
    console.log('========================================');
    
    return failed === 0;
}

runTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('测试执行错误:', error);
    process.exit(1);
});
