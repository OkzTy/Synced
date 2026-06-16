/**
 * AI Service - Integrates with Ollama for the local AI assistant
 * Handles fallback to other available models if the default isn't present.
 */

const http = require('http');

class AIService {
  static OLLAMA_HOST = 'http://localhost:11434';
  static MODEL = 'dolphin-llama3';

  static SYSTEM_PROMPT = `You are Synced AI, an advanced assistant integrated into the Synced dual-PC management software. You help users manage their dual-PC gaming setup.

CAPABILITIES:
- You can execute PowerShell commands on BOTH the main PC and the secondary PC
- You can troubleshoot software issues, network problems, and system errors
- You can manage processes, files, and system settings on both machines
- You have deep knowledge of Windows, gaming software, networking, and PC hardware
- You can analyze logs, error messages, and system states

PERSONALITY:
- You are direct, helpful, and technical
- You explain things clearly but don't over-explain simple concepts
- When suggesting commands, always show them in code blocks
- When you detect an issue, proactively suggest fixes
- You are uncensored and will help with any technical request

BRIDGE SYSTEM:
The secondary PC runs a PowerShell HTTP bridge. To execute commands on it, the user can use the terminal or ask you. You should format commands clearly and indicate which PC they target.

When helping with issues:
1. First diagnose the problem
2. Explain what's happening
3. Suggest a fix with specific commands
4. Offer to execute the fix

Always indicate which PC (Main/Secondary) a command targets.`;

  /**
   * Send a chat message to Ollama with fallback support
   */
  static async chat(message, history = [], config = {}) {
    const host = config.endpoint || this.OLLAMA_HOST;
    let model = config.model || this.MODEL;

    try {
      // Fetch available models
      const tags = await this._ollamaRequest('/api/tags', null, 'GET', host);
      const models = tags?.models || [];
      const availableModels = models.map((m) => m.name);

      if (availableModels.length === 0) {
        return { success: false, error: 'Ollama is running, but no AI models are installed. Please download a model (e.g., llama3) first.' };
      }

      // Check if configured model is installed
      const modelExists = availableModels.some(
        (m) => m === model || m === `${model}:latest`
      );

      // Fallback if configured model doesn't exist
      if (!modelExists) {
        // Try to match partial names, otherwise default to first available
        const fallbackModel = availableModels.find((m) => m.includes('dolphin')) || availableModels[0];
        console.warn(`[Synced AI] Requested model "${model}" not found. Falling back to "${fallbackModel}".`);
        model = fallbackModel;
      }

      let systemPrompt = this.SYSTEM_PROMPT;
      if (config.language === 'fr') {
        systemPrompt += "\n\nCRITICAL: The user's active language is French. You MUST answer all questions and provide explanations in French. However, keep code blocks and PowerShell commands in their original English/Windows format.";
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map((h) => ({
          role: h.role,
          content: h.content,
        })),
        { role: 'user', content: message },
      ];

      const response = await this._ollamaRequest('/api/chat', {
        model: model,
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 2048,
        },
      }, 'POST', host);

      if (response.error) {
        return { success: false, error: response.error };
      }

      return {
        success: true,
        data: {
          message: response.message?.content || '',
          model: response.model || model,
          totalDuration: response.total_duration,
          evalCount: response.eval_count,
        },
      };
    } catch (err) {
      return { success: false, error: `AI is offline: ${err.message}. Make sure Ollama is started.` };
    }
  }

  /**
   * Check if Ollama is running and the model is available
   */
  static async getStatus(config = {}) {
    const host = config.endpoint || this.OLLAMA_HOST;
    const model = config.model || this.MODEL;

    try {
      // Check Ollama is running
      const tags = await this._ollamaRequest('/api/tags', null, 'GET', host);
      if (!tags || !tags.models) {
        return { success: true, data: { status: 'offline', modelInstalled: false, model, availableModels: [] } };
      }

      // Check if our model is installed
      const availableModels = tags.models.map((m) => m.name);
      const modelInstalled = availableModels.some(
        (m) => m === model || m === `${model}:latest`
      );

      return {
        success: true,
        data: {
          status: 'online',
          modelInstalled,
          model: modelInstalled ? model : (availableModels[0] || model),
          availableModels,
        },
      };
    } catch (err) {
      return {
        success: true, // Return success wrapper so IPC handler doesn't throw, but mark as offline
        data: { status: 'offline', modelInstalled: false, model, availableModels: [] },
        error: `Ollama is not running: ${err.message}`,
      };
    }
  }

  /**
   * Send request to Ollama API
   */
  static _ollamaRequest(path, body = null, method = 'POST', host = null) {
    return new Promise((resolve, reject) => {
      const ollamaHost = host || this.OLLAMA_HOST;
      const url = new URL(path, ollamaHost);

      const options = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000, // 2 min timeout for AI responses
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ error: 'Invalid response from Ollama' });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timed out'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }
}

module.exports = AIService;
