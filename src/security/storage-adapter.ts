export type SecurityEventCategory =
  | 'MALICIOUS_ATTACHMENT'
  | 'PROMPT_INJECTION'
  | 'OFF_TOPIC'
  | 'CODE_REQUEST'
  | 'IRRELEVANT_ATTACHMENT'
  | 'RATE_LIMIT_COOLDOWN'
  | 'UNAUTHORIZED_ACTION';

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SecurityEventRecord {
  id: string;
  userId: string;
  userRole: string;
  category: SecurityEventCategory;
  severity: SecuritySeverity;
  reason: string;
  payloadExcerpt?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  currentView?: string | null;
  strikeCount: number;
  blockedUntil?: Date | null;
  remoteAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

export interface UsageLogRecord {
  id: string;
  userId: string;
  taskType: 'chat' | 'computer-use' | 'transcribe' | 'fast-track';
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  fastTrack: boolean;
  toolsExecuted: string[];
  durationMs: number;
  success: boolean;
  createdAt: Date;
}

export interface StorageAdapter {
  saveSecurityEvent(event: Omit<SecurityEventRecord, 'id' | 'createdAt'>): Promise<SecurityEventRecord>;
  getSecurityEvents(filter?: { userId?: string; severity?: SecuritySeverity; limit?: number }): Promise<SecurityEventRecord[]>;
  saveUsageLog(log: Omit<UsageLogRecord, 'id' | 'createdAt'>): Promise<UsageLogRecord>;
  getUsageSummary(range?: '24h' | '7d' | '30d'): Promise<any>;
}

/**
 * Default in-memory storage adapter.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private securityEvents: SecurityEventRecord[] = [];
  private usageLogs: UsageLogRecord[] = [];

  async saveSecurityEvent(data: Omit<SecurityEventRecord, 'id' | 'createdAt'>): Promise<SecurityEventRecord> {
    const record: SecurityEventRecord = {
      ...data,
      id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date()
    };
    this.securityEvents.unshift(record);
    if (this.securityEvents.length > 2000) this.securityEvents.pop();
    return record;
  }

  async getSecurityEvents(filter?: { userId?: string; severity?: SecuritySeverity; limit?: number }): Promise<SecurityEventRecord[]> {
    let result = [...this.securityEvents];
    if (filter?.userId) result = result.filter(e => e.userId === filter.userId);
    if (filter?.severity) result = result.filter(e => e.severity === filter.severity);
    if (filter?.limit) result = result.slice(0, filter.limit);
    return result;
  }

  async saveUsageLog(data: Omit<UsageLogRecord, 'id' | 'createdAt'>): Promise<UsageLogRecord> {
    const record: UsageLogRecord = {
      ...data,
      id: `use_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date()
    };
    this.usageLogs.unshift(record);
    if (this.usageLogs.length > 5000) this.usageLogs.pop();
    return record;
  }

  async getUsageSummary(range: '24h' | '7d' | '30d' = '24h'): Promise<any> {
    const now = Date.now();
    const rangeMs = range === '24h' ? 86400000 : range === '7d' ? 7 * 86400000 : 30 * 86400000;
    const filtered = this.usageLogs.filter(l => now - l.createdAt.getTime() <= rangeMs);

    let totalTokens = 0;
    let cachedTokens = 0;
    let fastTrackCount = 0;

    for (const log of filtered) {
      totalTokens += log.totalTokens;
      cachedTokens += log.cachedTokens;
      if (log.fastTrack) fastTrackCount++;
    }

    return {
      range,
      totalRequests: filtered.length,
      fastTrackRequests: fastTrackCount,
      fastTrackRatioPct: filtered.length > 0 ? Number(((fastTrackCount / filtered.length) * 100).toFixed(1)) : 0,
      totalTokens,
      cachedTokens,
      promptCacheHitRatePct: totalTokens > 0 ? Number(((cachedTokens / totalTokens) * 100).toFixed(1)) : 0
    };
  }
}
