/**
 * SOP上下文管理器
 * 处理上下文继承、隔离和大小限制
 */

class ContextManager {
    constructor(config) {
        this.maxSize = config.SOP_CONTEXT_SIZE_LIMIT || 10485760; // 10MB
    }

    createInitialContext(initialData = {}) {
        return {
            _meta: {
                created_at: Date.now(),
                version: '1.0'
            },
            ...initialData
        };
    }

    // 继承父上下文
    inheritContext(parentContext, inheritKeys = null) {
        if (!inheritKeys) {
            // 全量继承
            return { ...parentContext };
        }
        
        // 选择性继承
        const inherited = {};
        for (const key of inheritKeys) {
            if (parentContext[key] !== undefined) {
                inherited[key] = parentContext[key];
            }
        }
        return inherited;
    }

    // 添加Stage结果到上下文
    addStageResult(context, stageId, result) {
        const newContext = {
            ...context,
            [stageId]: result
        };
        
        // 大小检查
        const size = JSON.stringify(newContext).length;
        if (size > this.maxSize) {
            throw new Error(`上下文大小超过限制: ${size} > ${this.maxSize}`);
        }
        
        return newContext;
    }

    // 提取决策门需要的变量
    extractDecisionVariables(context) {
        return {
            recursion_depth: context._meta?.recursion_depth || 0,
            ...context
        };
    }
}

module.exports = ContextManager;
