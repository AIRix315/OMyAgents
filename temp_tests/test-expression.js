/**
 * 表达式引擎测试 - 阶段五验收
 * 运行: node temp_tests/test-expression.js
 */

const ExpressionEngine = require('../src/decision/expression-engine');

function runTests() {
    console.log('========================================');
    console.log('  表达式引擎测试 - 阶段五验收');
    console.log('========================================\n');
    
    const engine = new ExpressionEngine();
    let passed = 0;
    let failed = 0;
    
    const testCases = [
        {
            name: '递归深度检查',
            condition: 'recursion_depth < 3',
            context: { recursion_depth: 1 },
            expected: true
        },
        {
            name: '递归深度超限',
            condition: 'recursion_depth < 3',
            context: { recursion_depth: 3 },
            expected: false
        },
        {
            name: 'has_high_value为真',
            condition: 'has_high_value',
            context: { has_high_value: true },
            expected: true
        },
        {
            name: 'has_high_value为假',
            condition: 'has_high_value',
            context: { has_high_value: false },
            expected: false
        },
        {
            name: 'no_high_value为真',
            condition: 'no_high_value',
            context: { has_high_value: false },
            expected: true
        },
        {
            name: 'score大于阈值',
            condition: 'score > 0.8',
            context: { score: 0.9 },
            expected: true
        },
        {
            name: 'score小于阈值',
            condition: 'score > 0.8',
            context: { score: 0.7 },
            expected: false
        }
    ];
    
    for (const test of testCases) {
        try {
            const result = engine.evaluate(test.condition, test.context);
            if (result === test.expected) {
                console.log(`  ✓ ${test.name}: ${result}`);
                passed++;
            } else {
                console.log(`  ✗ ${test.name}: 期望 ${test.expected}, 得到 ${result}`);
                failed++;
            }
        } catch (error) {
            console.log(`  ✗ ${test.name}: ${error.message}`);
            failed++;
        }
    }
    
    console.log();
    console.log('========================================');
    console.log('  测试结果');
    console.log('========================================');
    console.log(`  通过: ${passed}`);
    console.log(`  失败: ${failed}`);
    console.log(`  总计: ${passed + failed}`);
    console.log('========================================');
    
    return failed === 0;
}

const success = runTests();
process.exit(success ? 0 : 1);
