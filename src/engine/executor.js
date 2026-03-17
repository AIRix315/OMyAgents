/**
 * SOP执行引擎
 * 核心执行逻辑：顺序执行Stage，管理状态转换
 */

const ContextManager = require('./context-manager');
const VPCCaller = require('./vcp-caller');

class SOPEngine {
    constructor(config, db, pluginManager) {
        this.config = config;
        this.db = db;
        this.contextManager = new ContextManager(config);
        this.vcpCaller = new VPCCaller(config, pluginManager);
        this.stateManager = new (require('../database/sop-state'))(db);
        this.sopDefinitions = new Map(); // 缓存SOP定义
    }

    // 加载SOP定义
    loadSOPDefinition(sopId) {
        if (this.sopDefinitions.has(sopId)) {
            return this.sopDefinitions.get(sopId);
        }
        
        // 从数据库加载 (简化实现，实际应从数据库或文件加载)
        const stmt = this.db.prepare('SELECT * FROM sop_definitions WHERE id = ?');
        const row = stmt.get(sopId);
        
        if (row) {
            const definition = JSON.parse(row.parsed_json);
            this.sopDefinitions.set(sopId, definition);
            return definition;
        }
        
        throw new Error(`SOP定义不存在: ${sopId}`);
    }

    // 主执行入口
    async executeSOP(sopId, initialContext = {}) {
        // 创建实例
        const instanceId = this.stateManager.createInstance(sopId, initialContext);
        console.log(`[V9] 启动SOP: ${sopId}, 实例: ${instanceId}`);
        
        try {
            await this.executeInstance(instanceId);
        } catch (error) {
            console.error(`[V9] SOP执行失败: ${instanceId}`, error);
            this.stateManager.updateInstanceStatus(instanceId, 'failed');
            throw error;
        }
        
        return instanceId;
    }

    // 执行实例
    async executeInstance(instanceId) {
        const instance = this.stateManager.getInstance(instanceId);
        const sop = this.loadSOPDefinition(instance.sop_id);
        
        this.stateManager.updateInstanceStatus(instanceId, 'running');
        
        let context = JSON.parse(instance.context_json);
        
        for (const stage of sop.stages) {
            // 检查是否暂停
            if (this.checkPaused(instanceId)) {
                console.log(`[V9] SOP暂停: ${instanceId}`);
                return;
            }
            
            // 执行Stage
            const result = await this.executeStage(instanceId, stage, context);
            
            // 更新上下文
            context = this.contextManager.addStageResult(context, stage.stage_id, result);
            this.updateInstanceContext(instanceId, context);
            
            // 如果是决策门，可能中断执行
            if (result.type === 'decision_gate') {
                if (result.status === 'waiting_decision') {
                    return; // 等待人工决策
                }
                // 根据决策结果跳转
                if (result.next_stage) {
                    // 找到对应的stage继续执行
                    // TODO: 实现跳转逻辑
                }
            }
        }
        
        // 完成
        this.stateManager.updateInstanceStatus(instanceId, 'completed');
        console.log(`[V9] SOP完成: ${instanceId}`);
    }

    // 执行单个Stage
    async executeStage(instanceId, stage, context) {
        console.log(`[V9] 执行Stage: ${stage.stage_id}`);
        
        // 确定stage类型
        let stageType = 'action';
        if (stage.decision_gate) stageType = 'decision_gate';
        if (stage.sub_sop) stageType = 'sub_sop';
        
        // 创建Stage执行记录
        const stageExecutionId = this.stateManager.createStageExecution(
            instanceId, stage.stage_id, stageType
        );
        
        // 记录Stage开始
        this.stateManager.logEvent(instanceId, 'info', 'stage_start', 
            `Stage ${stage.stage_id} 开始`);
        
        try {
            let result;
            if (stage.decision_gate) {
                result = await this.executeDecisionGate(instanceId, stage, context);
            } else if (stage.sub_sop) {
                result = await this.executeSubSOP(instanceId, stage, context);
            } else {
                result = await this.executeAction(instanceId, stage, context);
            }
            
            // 更新Stage为完成状态
            this.stateManager.updateStageExecution(stageExecutionId, 'completed', result);
            
            return result;
        } catch (error) {
            // 更新Stage为失败状态
            this.stateManager.updateStageExecution(stageExecutionId, 'failed', { error: error.message });
            
            this.stateManager.logEvent(instanceId, 'error', 'stage_failed',
                `Stage ${stage.stage_id} 失败: ${error.message}`);
            throw error;
        }
    }

    // 执行Action (调用VCP Agent)
    async executeAction(instanceId, stage, context) {
        const result = await this.vcpCaller.callAgent(stage.role, stage.action, context);
        
        return {
            type: 'action',
            status: 'completed',
            data: result
        };
    }

    // 执行决策门
    async executeDecisionGate(instanceId, stage, context) {
        const gate = stage.decision_gate;
        
        // 根据决策模式处理
        switch (gate.mode) {
            case 'conditional':
                return await this.executeConditionalGate(instanceId, stage, context);
            case 'agent_evaluate':
                return await this.executeAgentEvaluateGate(instanceId, stage, context);
            case 'human_decision':
                return await this.executeHumanDecisionGate(instanceId, stage, context);
            case 'metadata':
                return await this.executeMetadataGate(instanceId, stage, context);
            default:
                throw new Error(`未知的决策模式: ${gate.mode}`);
        }
    }

    // 条件决策门
    async executeConditionalGate(instanceId, stage, context) {
        const ExpressionEngine = require('../decision/expression-engine');
        const engine = new ExpressionEngine();
        
        const variables = this.contextManager.extractDecisionVariables(context);
        const condition = stage.decision_gate.condition;
        
        const result = engine.evaluate(condition, variables);
        
        // 找到匹配的分支
        const branches = stage.decision_gate.branches || [];
        for (const branch of branches) {
            if (engine.evaluate(branch.condition, variables)) {
                return {
                    type: 'decision_gate',
                    status: 'completed',
                    decision: branch.condition,
                    next_stage: branch.next_stage,
                    sub_sop: branch.sub_sop
                };
            }
        }
        
        return {
            type: 'decision_gate',
            status: 'completed',
            decision: 'no_match',
            next_stage: null
        };
    }

    // Agent评估决策门
    async executeAgentEvaluateGate(instanceId, stage, context) {
        const evaluatorRole = stage.decision_gate.evaluator_role;
        const result = await this.vcpCaller.callAgent(
            evaluatorRole, 
            'evaluate_decision', 
            { ...context, decision_gate: stage.decision_gate }
        );
        
        return {
            type: 'decision_gate',
            status: 'completed',
            decision: result.decision,
            next_stage: result.next_stage
        };
    }

    // 人工决策门
    async executeHumanDecisionGate(instanceId, stage, context) {
        const HumanDecisionManager = require('../decision/human-decision');
        const manager = new HumanDecisionManager(this.config, this.db);
        
        return await manager.createDecision(instanceId, stage.decision_gate);
    }

    // 元数据决策门
    async executeMetadataGate(instanceId, stage, context) {
        const depth = this.stateManager.getRecursionDepth(instanceId);
        const maxDepth = this.config.SOP_MAX_RECURSION_DEPTH || 3;
        
        return {
            type: 'decision_gate',
            status: 'completed',
            metadata: {
                recursion_depth: depth,
                max_depth_reached: depth >= maxDepth
            }
        };
    }

    // 执行子SOP
    async executeSubSOP(instanceId, stage, context) {
        const RecursionManager = require('./recursion-manager');
        const manager = new RecursionManager(this.config, this);
        
        return await manager.executeSubSOP(instanceId, stage.sub_sop, context);
    }

    // 检查暂停状态
    checkPaused(instanceId) {
        const instance = this.stateManager.getInstance(instanceId);
        return instance.status === 'paused';
    }

    // 更新实例上下文
    updateInstanceContext(instanceId, context) {
        const stmt = this.db.prepare(
            'UPDATE sop_instances SET context_json = ? WHERE id = ?'
        );
        stmt.run(JSON.stringify(context), instanceId);
    }
}

module.exports = SOPEngine;
