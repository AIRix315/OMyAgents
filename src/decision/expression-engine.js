/**
 * 条件表达式引擎
 * 使用json-logic-js实现安全的表达式求值
 */

const jsonLogic = require('json-logic-js');

class ExpressionEngine {
    constructor() {
        // 注册自定义操作符
        this.registerCustomOperators();
    }

    registerCustomOperators() {
        // 递归深度检查
        jsonLogic.add_operation('recursion_depth_lt', (depth, max) => {
            return depth < max;
        });
        
        // 其他安全操作符...
    }

    // 求值条件表达式
    evaluate(condition, context) {
        try {
            // 将字符串条件解析为json-logic规则
            const rule = this.parseCondition(condition);
            return jsonLogic.apply(rule, context);
        } catch (error) {
            throw new Error(`表达式求值失败: ${error.message}`);
        }
    }

    parseCondition(condition) {
        // 支持简化语法到json-logic的转换
        // 例如: "score > 0.8" -> { ">": [{ "var": "score" }, 0.8] }
        if (typeof condition === 'string') {
            return this.parseStringCondition(condition);
        }
        return condition;
    }

    parseStringCondition(str) {
        // 简单解析: "has_high_value && recursion_depth < 3"
        // 转换为json-logic格式
        // 实际实现需要更健壮的解析器
        
        // 支持常见模式
        const patterns = [
            // recursion_depth < 3
            { regex: /recursion_depth\s*<\s*(\d+)/, fn: (m) => ({ '<': [{ 'var': 'recursion_depth' }, parseInt(m[1])] }) },
            // has_high_value
            { regex: /has_high_value/, fn: () => ({ 'var': 'has_high_value' }) },
            // no_high_value
            { regex: /no_high_value/, fn: () => ({ '!': { 'var': 'has_high_value' } }) },
            // max_depth_reached
            { regex: /max_depth_reached/, fn: () => ({ 'var': 'max_depth_reached' }) },
            // score > 0.8
            { regex: /(\w+)\s*>\s*([\d.]+)/, fn: (m) => ({ '>': [{ 'var': m[1] }, parseFloat(m[2])] }) },
            // score < 0.5
            { regex: /(\w+)\s*<\s*([\d.]+)/, fn: (m) => ({ '<': [{ 'var': m[1] }, parseFloat(m[2])] }) }
        ];
        
        for (const pattern of patterns) {
            const match = str.match(pattern.regex);
            if (match) {
                return pattern.fn(match);
            }
        }
        
        // 如果无法解析，返回原字符串作为变量名
        return { 'var': str };
    }
}

module.exports = ExpressionEngine;
