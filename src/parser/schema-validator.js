/**
 * SOP定义Schema验证
 * 基于V9战略文档的SOP YAML结构定义
 */

const Ajv = require('ajv');

const SOP_SCHEMA = {
    type: 'object',
    required: ['sop_id', 'version', 'name', 'stages'],
    properties: {
        sop_id: { type: 'string', pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$' },
        version: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        stages: {
            type: 'array',
            items: { $ref: '#/$defs/stage' },
            minItems: 1
        },
        sub_sops: {
            type: 'array',
            items: { $ref: '#/$defs/sop' }
        }
    },
    $defs: {
        stage: {
            type: 'object',
            required: ['stage_id'],
            properties: {
                stage_id: { type: 'string' },
                role: { type: 'string' },
                action: { type: 'string' },
                timeout: { type: 'integer', minimum: 1000 },
                parallel: { type: 'boolean' },
                max_parallel: { type: 'integer', minimum: 1 },
                decision_gate: { $ref: '#/$defs/decisionGate' },
                sub_sop: { $ref: '#/$defs/subSop' }
            },
            oneOf: [
                { required: ['role', 'action'] },
                { required: ['decision_gate'] },
                { required: ['sub_sop'] }
            ]
        },
        decisionGate: {
            type: 'object',
            required: ['mode'],
            properties: {
                mode: {
                    type: 'string',
                    enum: ['conditional', 'agent_evaluate', 'human_decision', 'metadata']
                },
                condition: { type: 'string' },
                evaluator_role: { type: 'string' },
                branches: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            condition: { type: 'string' },
                            next_stage: { type: 'string' },
                            sub_sop: { type: 'object' },
                            decision_gate: { type: 'object' }
                        }
                    }
                },
                timeout: { type: 'string' },
                options: {
                    type: 'array',
                    items: { type: 'string' }
                }
            }
        },
        subSop: {
            type: 'object',
            required: ['sop_id'],
            properties: {
                sop_id: { type: 'string' },
                inherit_context: { type: 'boolean' },
                context_mapping: { type: 'object' }
            }
        },
        sop: {
            type: 'object',
            required: ['sop_id', 'stages'],
            properties: {
                sop_id: { type: 'string' },
                stages: {
                    type: 'array',
                    items: { $ref: '#/$defs/stage' }
                }
            }
        }
    }
};

class SchemaValidator {
    constructor() {
        this.ajv = new Ajv({ allErrors: true });
        this.validate = this.ajv.compile(SOP_SCHEMA);
    }

    validateSOP(sopData) {
        const valid = this.validate(sopData);
        if (!valid) {
            const errors = this.validate.errors.map(e => 
                `${e.instancePath}: ${e.message}`
            ).join('; ');
            throw new Error(`SOP验证失败: ${errors}`);
        }
        return true;
    }
}

module.exports = SchemaValidator;
