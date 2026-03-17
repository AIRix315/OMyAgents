/**
 * YAML解析器测试 - 阶段三验收
 * 运行: node temp_tests/test-parser.js
 */

const YAMLLoader = require('../src/parser/yaml-loader');
const SchemaValidator = require('../src/parser/schema-validator');
const path = require('path');

async function runTests() {
    console.log('========================================');
    console.log('  YAML解析器测试 - 阶段三验收');
    console.log('========================================\n');
    
    let passed = 0;
    let failed = 0;
    
    try {
        // 测试1: YAML加载
        console.log('测试1: YAML文件加载...');
        const loader = new YAMLLoader(path.join(__dirname, '../sop-definitions'));
        const definitions = await loader.loadAll();
        
        if (definitions.length === 0) {
            throw new Error('没有加载到SOP定义');
        }
        console.log(`  ✓ 加载了 ${definitions.length} 个SOP定义\n`);
        passed++;
        
        // 测试2: Schema验证
        console.log('测试2: Schema验证...');
        const validator = new SchemaValidator();
        
        for (const def of definitions) {
            validator.validateSOP(def);
            console.log(`  ✓ 验证通过: ${def.sop_id} v${def.version}`);
        }
        console.log();
        passed++;
        
        // 测试3: 安全检查 - 拒绝代码注入
        console.log('测试3: YAML安全 - 拒绝代码注入...');
        const maliciousYAML = `
sop_id: test_malicious
version: 1
name: Test
stages:
  - stage_id: test
    role: TestRole
    action: !!js/function "function() { return 'evil'; }"
`;
        
        try {
            loader.parseSafe(maliciousYAML, 'malicious.yaml');
            console.log('  ✗ 未检测到恶意代码\n');
            failed++;
        } catch (e) {
            if (e.message.includes('非法代码') || e.message.includes('function')) {
                console.log('  ✓ 正确拒绝包含函数的YAML\n');
                passed++;
            } else {
                console.log('  ✗ 错误类型不正确:', e.message, '\n');
                failed++;
            }
        }
        
        // 测试4: 验证失败检测
        console.log('测试4: 验证失败检测...');
        const invalidSOP = {
            sop_id: 'invalid',
            version: 1,
            name: 'Test',
            stages: [] // 空stages应该失败
        };
        
        try {
            validator.validateSOP(invalidSOP);
            console.log('  ✗ 未检测到无效SOP\n');
            failed++;
        } catch (e) {
            console.log('  ✓ 正确检测到无效SOP\n');
            passed++;
        }
        
        // 测试5: 复杂SOP结构解析
        console.log('测试5: 复杂SOP结构解析...');
        const newsAnalysisDef = definitions.find(d => d.sop_id === 'news_analysis_pipeline');
        
        if (!newsAnalysisDef) {
            throw new Error('未找到news_analysis_pipeline定义');
        }
        
        if (!newsAnalysisDef.stages || newsAnalysisDef.stages.length === 0) {
            throw new Error('stages解析失败');
        }
        console.log(`  ✓ stages数量: ${newsAnalysisDef.stages.length}`);
        
        const decisionStage = newsAnalysisDef.stages.find(s => s.decision_gate);
        if (!decisionStage) {
            throw new Error('决策门解析失败');
        }
        console.log(`  ✓ 决策门stage: ${decisionStage.stage_id}`);
        
        if (!newsAnalysisDef.sub_sops || newsAnalysisDef.sub_sops.length === 0) {
            throw new Error('sub_sops解析失败');
        }
        console.log(`  ✓ sub_sops数量: ${newsAnalysisDef.sub_sops.length}\n`);
        passed++;
        
    } catch (error) {
        console.error('  ✗ 测试失败:', error.message);
        failed++;
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
