import { SecuritySeverity, SecurityEventCategory } from './storage-adapter.js';

export interface ShieldInspectionResult {
  allowed: boolean;
  sanitizedText: string;
  riskScore: number;
  severity: SecuritySeverity;
  category?: SecurityEventCategory;
  reason?: string;
  hasSpotlight: boolean;
  spotlightTag?: string;
}

export class PromptShield {
  /**
   * Level 1: Ultra-fast CPU inspection for Unicode tags, BiDi overrides,
   * zero-width character bursts, and invisible text smuggling (<1 ms).
   */
  inspectUnicodeSmuggling(text: string): { safe: boolean; reason?: string } {
    // Unicode Tags (U+E0000 to U+E007F) used for hidden LLM instructions
    if (/[\u{E0000}-\u{E007F}]/u.test(text)) {
      return { safe: false, reason: 'Steganographic Unicode tag characters detected (U+E0000-U+E007F).' };
    }

    // Bidirectional Overrides (U+202A-U+202E, U+2066-U+2069)
    if (/[\u202A-\u202E\u2066-\u2069]/.test(text)) {
      return { safe: false, reason: 'BiDi directional override characters detected.' };
    }

    // Zero-width space bursts (> 5 consecutive zero-width chars)
    if (/[\u200B\u200C\u200D\uFEFF\u2060]{6,}/.test(text)) {
      return { safe: false, reason: 'Excessive zero-width character burst detected.' };
    }

    return { safe: true };
  }

  /**
   * Level 2: Inspects extracted file content (OCR/PDF/Audio) and wraps it
   * in dynamic spotlight delimiters `<untrusted_file_data_${id}>` to ensure
   * the LLM treats it as raw passive reference data, never executable instructions.
   */
  inspectAndSpotlightContent(extractedText: string): ShieldInspectionResult {
    let riskScore = 0;
    const lower = extractedText.toLowerCase();

    // High-risk prompt injection phrases inside file text
    const jailbreakSignatures = [
      'ignore previous instructions',
      'ignore all previous instructions',
      'disregard all instructions',
      'system prompt override',
      'you are now in developer mode',
      'dan mode enabled',
      'new system instructions:',
      'from now on you must',
      'developer message:',
      'reveal system prompt',
      'print your system prompt'
    ];

    for (const sig of jailbreakSignatures) {
      if (lower.includes(sig)) riskScore += 45;
    }

    // Suspicious privilege or tool execution invocations
    if (lower.includes('call tool') || lower.includes('execute tool') || lower.includes('mcp_')) {
      riskScore += 30;
    }

    if (riskScore >= 70) {
      return {
        allowed: false,
        sanitizedText: '',
        riskScore,
        severity: 'CRITICAL',
        category: 'PROMPT_INJECTION',
        reason: 'Malicious indirect prompt injection instructions detected inside file content.',
        hasSpotlight: false
      };
    }

    // Sanitize high risk lines if moderate risk
    let sanitized = extractedText;
    if (riskScore > 0) {
      const lines = extractedText.split('\n');
      sanitized = lines
        .filter(l => !jailbreakSignatures.some(sig => l.toLowerCase().includes(sig)))
        .join('\n');
    }

    // Dynamic unique spotlight tag delimiter
    const spotlightId = Math.random().toString(36).slice(2, 10);
    const spotlightTag = `untrusted_file_data_${spotlightId}`;
    const wrappedContent = `<${spotlightTag}>\n${sanitized.slice(0, 8000)}\n</${spotlightTag}>`;

    return {
      allowed: true,
      sanitizedText: wrappedContent,
      riskScore,
      severity: riskScore > 30 ? 'MEDIUM' : 'LOW',
      hasSpotlight: true,
      spotlightTag
    };
  }

  /**
   * Level 3: Verifies that sensitive tool calls originated from explicit user intent
   * in the chat message, rather than being triggered indirectly by an untrusted document.
   */
  verifyToolCallAgainstUserIntent(params: {
    toolName: string;
    toolArguments: Record<string, any>;
    userPrompt: string;
    sensitiveTools?: string[];
  }): { allowed: boolean; reason?: string } {
    const sensitive = params.sensitiveTools || [
      'manage_credentials',
      'configure_webhook',
      'delete_resource',
      'transfer_ownership',
      'update_permissions'
    ];

    if (!sensitive.includes(params.toolName)) {
      return { allowed: true };
    }

    const lowerPrompt = params.userPrompt.toLowerCase();
    const actionKeywords: Record<string, string[]> = {
      manage_credentials: ['credencial', 'credential', 'api key', 'token', 'generar clave', 'borrar clave'],
      configure_webhook: ['webhook', 'endpoint', 'url', 'notificacion'],
      delete_resource: ['borrar', 'eliminar', 'delete', 'remove'],
      transfer_ownership: ['transferir', 'transfer', 'owner', 'dueño'],
      update_permissions: ['permiso', 'permission', 'role', 'rol']
    };

    const expectedKeywords = actionKeywords[params.toolName] || [params.toolName];
    const userExplicitlyRequested = expectedKeywords.some(kw => lowerPrompt.includes(kw));

    if (!userExplicitlyRequested) {
      return {
        allowed: false,
        reason: `Indirect invocation blocked: tool '${params.toolName}' was not explicitly requested in the user prompt.`
      };
    }

    return { allowed: true };
  }
}
