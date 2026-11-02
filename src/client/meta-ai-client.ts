import { ChatMessage, ComputerUseResponse, ToolDefinition } from './types.js';

export interface MetaClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class MetaAiClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: MetaClientOptions = {}) {
    const key = options.apiKey || process.env.META_MODEL_API_KEY;
    if (!key || !key.trim()) {
      throw new Error(
        'MetaAiClient requires a valid META_MODEL_API_KEY. Provide it in constructor options or via process.env.META_MODEL_API_KEY.'
      );
    }
    this.apiKey = key.trim();
    this.baseUrl = (options.baseUrl || process.env.META_MODEL_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || 45000;
  }

  /**
   * Invokes Meta Chat Completions API with tools and reasoning effort.
   * Default model: muse-spark-1.3
   */
  async chatCompletion(params: {
    messages: ChatMessage[];
    model?: string;
    tools?: ToolDefinition[];
    maxTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
  }): Promise<any> {
    const body: Record<string, any> = {
      model: params.model || 'muse-spark-1.3',
      messages: params.messages,
      max_tokens: params.maxTokens || 2048,
      reasoning_effort: params.reasoningEffort || 'low'
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || `Meta Model API error (${res.status})`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Invokes Meta Computer Use API (CUA) via muse-wonder-1.0.
   * Supports both starting a visual trajectory and continuing an existing call.
   */
  async computerUse(params: {
    screenshotDataUrl: string;
    systemPrompt: string;
    task?: string;
    previousResponseId?: string;
    callId?: string;
    acknowledgedSafetyChecks?: Array<{ id: string; code?: string; message?: string }>;
  }): Promise<ComputerUseResponse> {
    const cleanDataUrl = params.screenshotDataUrl.startsWith('data:image/')
      ? params.screenshotDataUrl
      : `data:image/png;base64,${params.screenshotDataUrl}`;

    let inputPayload: any[];

    if (params.previousResponseId && params.callId) {
      inputPayload = [
        {
          type: 'computer_call_output',
          call_id: params.callId,
          output: {
            type: 'screenshot',
            image_url: cleanDataUrl
          },
          acknowledged_safety_checks: params.acknowledgedSafetyChecks || []
        }
      ];
    } else {
      inputPayload = [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'text',
              text: params.task || 'Analyze the visual interface and perform the requested navigation.'
            },
            {
              type: 'image_url',
              image_url: { url: cleanDataUrl }
            }
          ]
        }
      ];
    }

    const body: Record<string, any> = {
      model: 'muse-wonder-1.0',
      tools: [{ type: 'computer' }],
      input: inputPayload
    };

    if (params.previousResponseId) {
      body.previous_response_id = params.previousResponseId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const data = await res.json();
      if (!res.ok) {
        return this.fallbackChatComputerUse(params);
      }

      return this.parseResponsesCuaOutput(data);
    } catch {
      return this.fallbackChatComputerUse(params);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fallback using standard /chat/completions with structured computer tool definition.
   */
  private async fallbackChatComputerUse(params: {
    screenshotDataUrl: string;
    systemPrompt: string;
    task?: string;
  }): Promise<ComputerUseResponse> {
    const cleanDataUrl = params.screenshotDataUrl.startsWith('data:image/')
      ? params.screenshotDataUrl
      : `data:image/png;base64,${params.screenshotDataUrl}`;

    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'computer_action',
          description: 'Executes a mouse or keyboard action on the user screen coordinates.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['click', 'move', 'type', 'scroll'],
                description: 'The GUI action to perform.'
              },
              coordinate: {
                type: 'array',
                items: { type: 'number' },
                description: '[x, y] coordinates in viewport pixels.'
              },
              text: {
                type: 'string',
                description: 'Text to type if action is type.'
              }
            },
            required: ['action']
          }
        }
      }
    ];

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `${params.systemPrompt}\nInspect the provided screenshot and invoke computer_action to click or navigate.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: params.task || 'Please locate and click the target element on the screen.' },
          { type: 'image_url', image_url: { url: cleanDataUrl } }
        ]
      }
    ];

    const result = await this.chatCompletion({
      model: 'muse-wonder-1.0',
      messages,
      tools,
      maxTokens: 512
    });

    const choice = result.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    if (toolCall && toolCall.function?.name === 'computer_action') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        const [x, y] = args.coordinate || [0, 0];
        return {
          id: result.id || `fallback_${Date.now()}`,
          callId: toolCall.id,
          actions: [{ type: args.action || 'click', x, y, text: args.text }],
          explanation: choice?.message?.content || undefined,
          raw: result
        };
      } catch {
        // failed parse
      }
    }

    return {
      id: result.id || `fallback_${Date.now()}`,
      actions: [],
      explanation: choice?.message?.content || 'No visual action determined.',
      raw: result
    };
  }

  private parseResponsesCuaOutput(data: any): ComputerUseResponse {
    const actions: any[] = [];
    const outputList = data.output || [];

    for (const item of outputList) {
      if (item.type === 'computer_call' || item.call_type === 'computer') {
        const rawAction = item.action || item.call?.action;
        if (rawAction) actions.push(rawAction);
      }
    }

    return {
      id: data.id || `cua_${Date.now()}`,
      responseId: data.id,
      callId: outputList.find((i: any) => i.call_id)?.call_id,
      actions,
      pendingSafetyChecks: data.pending_safety_checks || [],
      raw: data
    };
  }
}
