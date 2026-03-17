/**
 * YAML文件加载器
 * 安全加载SOP定义，防止代码注入
 */

const yaml = require('js-yaml');
const fs = require('fs').promises;
const path = require('path');

class YAMLLoader {
    constructor(definitionsPath) {
        this.definitionsPath = definitionsPath;
    }

    async loadAll() {
        const files = await fs.readdir(this.definitionsPath);
        const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        
        const definitions = [];
        for (const file of yamlFiles) {
            const content = await this.loadFile(path.join(this.definitionsPath, file));
            definitions.push(content);
        }
        return definitions;
    }

    async loadFile(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        return this.parseSafe(content, filePath);
    }

    parseSafe(content, filePath = 'unknown') {
        try {
            // 使用安全模式解析 (schema: 'core' 仅标准YAML，无自定义类型)
            const doc = yaml.load(content, {
                schema: yaml.CORE_SCHEMA,
                filename: filePath,
                onWarning: (warning) => {
                    console.warn(`[YAML警告] ${filePath}: ${warning.message}`);
                }
            });

            // 安全检查：拒绝包含函数的YAML
            this.validateNoCode(doc);

            return doc;
        } catch (error) {
            throw new Error(`YAML解析失败 ${filePath}: ${error.message}`);
        }
    }

    validateNoCode(obj, path = '') {
        if (typeof obj === 'function') {
            throw new Error(`YAML包含非法代码: ${path}`);
        }
        if (obj && typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                this.validateNoCode(value, `${path}.${key}`);
            }
        }
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => {
                this.validateNoCode(item, `${path}[${i}]`);
            });
        }
    }
}

module.exports = YAMLLoader;
