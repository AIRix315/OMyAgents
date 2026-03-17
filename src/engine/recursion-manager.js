/**
 * 递归管理器
 * 处理子SOP调用、递归深度限制、错误隔离
 */

class RecursionManager {
    constructor(config, engine) {
        this.maxDepth = config.SOP_MAX_RECURSION_DEPTH || 3;
        this.engine = engine;
    }

    async executeSubSOP(parentInstanceId, subSopConfig, parentContext) {
        // 获取父实例信息
        const parentDepth = this.getRecursionDepth(parentInstanceId);
        const newDepth = parentDepth + 1;
        
        // 检查递归深度
        if (newDepth > this.maxDepth) {
            throw new RecursionDepthExceededError(
                `递归深度超过限制: ${newDepth} > ${this.maxDepth}`
            );
        }
        
        console.log(`[V9] 执行子SOP: ${subSopConfig.sop_id}, 深度: ${newDepth}`);
        
        // 准备子SOP上下文
        let childContext = {};
        if (subSopConfig.inherit_context) {
            childContext = { ...parentContext };
        }
        if (subSopConfig.context_mapping) {
            childContext = this.mapContext(childContext, subSopConfig.context_mapping);
        }
        
        // 创建子实例
        const childInstanceId = this.engine.stateManager.createInstance(
            subSopConfig.sop_id,
            childContext,
            parentInstanceId,
            newDepth
        );
        
        try {
            // 执行子SOP
            await this.engine.executeInstance(childInstanceId);
            
            // 获取结果
            const childInstance = this.engine.stateManager.getInstance(childInstanceId);
            return {
                type: 'sub_sop',
                status: childInstance.status,
                data: JSON.parse(childInstance.context_json)
            };
        } catch (error) {
            // 错误隔离：子SOP错误不传播到父SOP
            console.error(`[V9] 子SOP失败: ${subSopConfig.sop_id}`, error);
            return {
                type: 'sub_sop',
                status: 'failed',
                error: error.message
            };
        }
    }

    getRecursionDepth(instanceId) {
        return this.engine.stateManager.getRecursionDepth(instanceId);
    }

    mapContext(context, mapping) {
        const mapped = {};
        for (const [target, source] of Object.entries(mapping)) {
            mapped[target] = context[source];
        }
        return mapped;
    }
}

class RecursionDepthExceededError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RecursionDepthExceededError';
    }
}

module.exports = { RecursionManager, RecursionDepthExceededError };
