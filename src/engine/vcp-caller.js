/**
 * VCP API调用器
 * 调用VCP /v1/chat/completions 或其他插件
 * 
 * 参考: Plugin.js processToolCall 模式
 */

class VPCCaller {
    constructor(config, pluginManager) {
        this.baseUrl = `http://localhost:${config.PORT || 5890}`;
        this.vcpKey = config.VCP_KEY || config.Key;
        this.pluginManager = pluginManager;
    }

    // 调用Agent (通过PluginManager)
    async callAgent(role, action, context) {
        // 构建VCP工具调用请求
        const toolCall = {
            tool_name: role,
            action: action,
            context: JSON.stringify(context)
        };

        // 使用PluginManager直接调用 (如果可用)
        if (this.pluginManager && this.pluginManager.processToolCall) {
            return await this.pluginManager.processToolCall(role, toolCall);
        }

        // 回退到HTTP调用
        return await this.callViaHTTP(role, toolCall);
    }

    async callViaHTTP(toolName, args) {
        const fetch = require('node-fetch');
        const response = await fetch(`${this.baseUrl}/v1/human/tool`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.vcpKey}`
            },
            body: JSON.stringify({
                tool_name: toolName,
                arguments: args
            })
        });

        if (!response.ok) {
            throw new Error(`VCP调用失败: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }
}

module.exports = VPCCaller;
