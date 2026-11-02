import { Router, Request, Response } from 'express';
import { MetaAiClient } from '../client/meta-ai-client.js';
import { SecurityGuardrail, SecurityGuardrailConfig } from '../security/security-guardrail.js';
import { StorageAdapter, MemoryStorageAdapter } from '../security/storage-adapter.js';
import { RagEngine, RagArticle } from '../rag/rag-engine.js';
import { ToolDefinition } from '../client/types.js';

export interface MetaGuardOptions {
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  storage?: StorageAdapter;
  guardrailConfig?: SecurityGuardrailConfig;
  initialKnowledge?: RagArticle[];
  tools?: ToolDefinition[];
  toolHandlers?: Record<string, (args: any, req: Request) => Promise<any>>;
  getUserContext?: (req: Request) => { userId: string; userRole: string; userName?: string };
}

export function createMetaGuardMiddleware(options: MetaGuardOptions = {}): Router {
  const router = Router();
  const storage = options.storage || new MemoryStorageAdapter();
  const guardrail = new SecurityGuardrail(storage, options.guardrailConfig);
  const ragEngine = new RagEngine(options.initialKnowledge || []);
  const metaClient = new MetaAiClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });

  const defaultSystemPrompt =
    options.systemPrompt ||
    `You are MetaGuard Assistant, an authorized AI agent. You assist users with platform navigation and configurations. Follow strict security policies. Do not output raw source code.`;

  const getUser = (req: Request) => {
    if (options.getUserContext) return options.getUserContext(req);
    // fallback test user
    return {
      userId: (req.headers['x-user-id'] as string) || 'demo_user',
      userRole: (req.headers['x-user-role'] as string) || 'USER',
      userName: 'Demo User'
    };
  };

  /**
   * POST /api/agent/chat
   * Core chat conversation with guardrail pre-screening, RAG, and tool execution.
   */
  router.post('/chat', async (req: Request, res: Response): Promise<void> => {
    const { userId, userRole, userName } = getUser(req);
    const { message, history = [], attachment, currentView } = req.body;

    // 1. Check conversational lockout cooldown
    const cooldownCheck = guardrail.getRateLimiter().checkCooldown(userId);
    if (cooldownCheck.isBlocked) {
      res.status(429).json({
        success: false,
        blocked: true,
        cooldownSeconds: cooldownCheck.remainingSeconds,
        strikes: cooldownCheck.strikes,
        reply: `You are temporarily locked out due to repeated security policy violations. Please retry in ${cooldownCheck.remainingSeconds} seconds.`
      });
      return;
    }

    // 2. Pre-LLM Prompt Guardrail check (<5ms)
    const promptEval = guardrail.evaluatePrompt(message || '');
    if (!promptEval.allowed) {
      if (promptEval.isStrike) {
        await guardrail.getRateLimiter().recordStrike({
          userId,
          userRole,
          category: promptEval.category || 'OFF_TOPIC',
          severity: promptEval.severity || 'LOW',
          reason: promptEval.reason || 'Guardrail blocked prompt',
          payloadExcerpt: message,
          currentView,
          remoteAddress: req.ip
        });
      }

      res.json({
        success: true,
        reply: promptEval.immediateReply,
        category: promptEval.category,
        strike: promptEval.isStrike
      });
      return;
    }

    // 3. Attachment Malware & Indirect Prompt Injection Scanning
    let injectedAttachmentContext = '';
    if (attachment && attachment.data) {
      const scanResult = guardrail.getScanner().scan(attachment.data, attachment.name);
      if (!scanResult.safe) {
        await guardrail.getRateLimiter().recordStrike({
          userId,
          userRole,
          category: scanResult.category || 'MALICIOUS_ATTACHMENT',
          severity: scanResult.severity,
          reason: scanResult.reason || 'Malicious attachment signature',
          fileName: attachment.name,
          currentView,
          remoteAddress: req.ip
        });

        res.json({
          success: false,
          securityAlert: true,
          reply: `Attachment rejected: ${scanResult.reason}`
        });
        return;
      }

      // If text/doc attachment, apply Level 2 Spotlight Delimiters
      if (attachment.extractedText) {
        const shieldResult = guardrail.getShield().inspectAndSpotlightContent(attachment.extractedText);
        if (!shieldResult.allowed) {
          await guardrail.getRateLimiter().recordStrike({
            userId,
            userRole,
            category: 'PROMPT_INJECTION',
            severity: 'CRITICAL',
            reason: shieldResult.reason || 'Indirect prompt injection in file content',
            fileName: attachment.name,
            currentView,
            remoteAddress: req.ip
          });

          res.json({
            success: false,
            securityAlert: true,
            reply: `Attachment blocked: indirect prompt injection attempt detected.`
          });
          return;
        }
        injectedAttachmentContext = `\n\n[Attached File Data (${attachment.name || 'document'})]:\n${shieldResult.sanitizedText}`;
      }
    }

    // 4. Retrieve RAG Articles
    const ragArticles = ragEngine.search(message || '', userRole, 2);
    const ragContext =
      ragArticles.length > 0
        ? `\n\n[Knowledge Base]:\n${ragArticles.map(a => `- ${a.title}: ${a.content}`).join('\n')}`
        : '';

    // 5. Construct Messages for Meta Model API (muse-spark-1.3)
    const messages: any[] = [
      {
        role: 'system',
        content: `${defaultSystemPrompt}\nUser Context: { id: "${userId}", role: "${userRole}", view: "${currentView || 'default'}" }${ragContext}`
      },
      ...history.slice(-4),
      {
        role: 'user',
        content: (message || '') + injectedAttachmentContext
      }
    ];

    const startTime = Date.now();
    try {
      const response = await metaClient.chatCompletion({
        model: 'muse-spark-1.3',
        messages,
        tools: options.tools
      });

      const choice = response.choices?.[0];
      let assistantReply = choice?.message?.content || '';

      // 6. Handle Tool Calls if any
      const toolCalls = choice?.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0 && options.toolHandlers) {
        for (const tc of toolCalls) {
          const fnName = tc.function.name;
          const handler = options.toolHandlers[fnName];

          // Level 3 Intent Verification against chat prompt
          const intentCheck = guardrail.getShield().verifyToolCallAgainstUserIntent({
            toolName: fnName,
            toolArguments: JSON.parse(tc.function.arguments || '{}'),
            userPrompt: message || ''
          });

          if (!intentCheck.allowed) {
            await guardrail.getRateLimiter().recordStrike({
              userId,
              userRole,
              category: 'UNAUTHORIZED_ACTION',
              severity: 'CRITICAL',
              reason: intentCheck.reason || 'Unverified tool invocation',
              currentView,
              remoteAddress: req.ip
            });
            assistantReply = `Action blocked: tool '${fnName}' requires explicit direct confirmation in the user prompt.`;
            break;
          }

          if (handler) {
            const toolResult = await handler(JSON.parse(tc.function.arguments || '{}'), req);
            messages.push(choice.message);
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult).slice(0, 1400)
            });

            // Follow-up completion after tool execution
            const secondPass = await metaClient.chatCompletion({
              model: 'muse-spark-1.3',
              messages
            });
            assistantReply = secondPass.choices?.[0]?.message?.content || assistantReply;
          }
        }
      }

      // 7. Enforce Zero-Code Output Policy
      assistantReply = guardrail.enforceZeroCodeOutput(assistantReply);

      // 8. Log Telemetry
      const durationMs = Date.now() - startTime;
      const usage = response.usage || {};
      await storage.saveUsageLog({
        userId,
        taskType: 'chat',
        model: response.model || 'muse-spark-1.3',
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        fastTrack: false,
        toolsExecuted: toolCalls ? toolCalls.map((t: any) => t.function.name) : [],
        durationMs,
        success: true
      });

      // Valid interaction resets strike streak
      guardrail.getRateLimiter().resetOnValidInteraction(userId);

      res.json({
        success: true,
        reply: assistantReply,
        usage: {
          totalTokens: usage.total_tokens || 0,
          cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/agent/computer-use
   * Visual coordinate inspection and navigation using muse-wonder-1.0.
   */
  router.post('/computer-use', async (req: Request, res: Response): Promise<void> => {
    const { userId } = getUser(req);
    const { screenshot, task, previousResponseId, callId } = req.body;

    if (!screenshot) {
      res.status(400).json({ success: false, error: 'A screenshot data URL is required for Computer Use.' });
      return;
    }

    try {
      const cuaResult = await metaClient.computerUse({
        screenshotDataUrl: screenshot,
        systemPrompt: defaultSystemPrompt,
        task,
        previousResponseId,
        callId
      });

      await storage.saveUsageLog({
        userId,
        taskType: 'computer-use',
        model: 'muse-wonder-1.0',
        promptTokens: 800,
        completionTokens: 120,
        cachedTokens: 0,
        totalTokens: 920,
        fastTrack: false,
        toolsExecuted: ['computer_action'],
        durationMs: 1200,
        success: true
      });

      res.json({ success: true, ...cuaResult });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/agent/security-events
   * Audit trail of blocked threats, prompt injections, and strikes.
   */
  router.get('/security-events', async (req: Request, res: Response): Promise<void> => {
    const limit = Number(req.query.limit) || 50;
    const events = await storage.getSecurityEvents({ limit });
    res.json({ success: true, events });
  });

  /**
   * GET /api/agent/analytics
   * KPI observability on token consumption, cache hit rate, and agent tasks.
   */
  router.get('/analytics', async (req: Request, res: Response): Promise<void> => {
    const range = (req.query.range as any) || '24h';
    const summary = await storage.getUsageSummary(range);
    res.json({ success: true, summary });
  });

  return router;
}
