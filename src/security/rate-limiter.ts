import { SecuritySeverity, StorageAdapter, SecurityEventCategory } from './storage-adapter.js';

interface UserStrikeState {
  strikes: number;
  blockedUntilMs: number;
  lastStrikeAtMs: number;
}

export class ConversationalRateLimiter {
  private userStrikeMap = new Map<string, UserStrikeState>();
  private readonly maxStrikes = 3;
  private readonly cooldownMs = 30_000; // 30 seconds lockout
  private readonly windowExpiryMs = 10 * 60 * 1000; // 10 minutes clean window

  constructor(private storage: StorageAdapter) {}

  /**
   * Checks whether a user is currently under temporary cooldown.
   */
  checkCooldown(userId: string): { isBlocked: boolean; remainingSeconds: number; strikes: number } {
    const state = this.userStrikeMap.get(userId);
    if (!state) return { isBlocked: false, remainingSeconds: 0, strikes: 0 };

    const now = Date.now();
    if (state.blockedUntilMs > now) {
      const remainingSeconds = Math.max(1, Math.ceil((state.blockedUntilMs - now) / 1000));
      return { isBlocked: true, remainingSeconds, strikes: state.strikes };
    }

    // Reset strikes if cooldown expired
    if (state.blockedUntilMs > 0 && state.blockedUntilMs <= now) {
      this.userStrikeMap.set(userId, { strikes: 0, blockedUntilMs: 0, lastStrikeAtMs: now });
      return { isBlocked: false, remainingSeconds: 0, strikes: 0 };
    }

    if (now - state.lastStrikeAtMs > this.windowExpiryMs) {
      this.userStrikeMap.delete(userId);
      return { isBlocked: false, remainingSeconds: 0, strikes: 0 };
    }

    return { isBlocked: false, remainingSeconds: 0, strikes: state.strikes };
  }

  /**
   * Resets strikes when user performs a legitimate interaction.
   */
  resetOnValidInteraction(userId: string): void {
    const state = this.userStrikeMap.get(userId);
    if (state && state.blockedUntilMs <= Date.now()) {
      this.userStrikeMap.delete(userId);
    }
  }

  /**
   * Records a strike, triggers 30s lock if >= 3 strikes, and logs to storage.
   */
  async recordStrike(params: {
    userId: string;
    userRole: string;
    category: SecurityEventCategory;
    severity: SecuritySeverity;
    reason: string;
    payloadExcerpt?: string;
    fileName?: string;
    mimeType?: string;
    currentView?: string;
    remoteAddress?: string;
    userAgent?: string;
    addStrike?: boolean;
  }): Promise<{ strikes: number; isBlocked: boolean; cooldownSeconds: number }> {
    const now = Date.now();
    const prev = this.userStrikeMap.get(params.userId) || { strikes: 0, blockedUntilMs: 0, lastStrikeAtMs: now };

    const shouldAddStrike = params.addStrike !== false;
    const newStrikes = shouldAddStrike
      ? params.severity === 'CRITICAL'
        ? Math.max(prev.strikes + 1, this.maxStrikes)
        : prev.strikes + 1
      : prev.strikes;

    let blockedUntilMs = prev.blockedUntilMs;
    if (newStrikes >= this.maxStrikes && blockedUntilMs <= now) {
      blockedUntilMs = now + this.cooldownMs;
    }

    this.userStrikeMap.set(params.userId, {
      strikes: newStrikes,
      blockedUntilMs,
      lastStrikeAtMs: now
    });

    const cooldownSeconds = blockedUntilMs > now ? Math.ceil((blockedUntilMs - now) / 1000) : 0;
    const blockedUntilDate = blockedUntilMs > now ? new Date(blockedUntilMs) : null;

    await this.storage.saveSecurityEvent({
      userId: params.userId,
      userRole: params.userRole,
      category: params.category,
      severity: params.severity,
      reason: params.reason,
      payloadExcerpt: params.payloadExcerpt?.slice(0, 500) || null,
      fileName: params.fileName?.slice(0, 180) || null,
      mimeType: params.mimeType?.slice(0, 100) || null,
      currentView: params.currentView?.slice(0, 60) || null,
      strikeCount: newStrikes,
      blockedUntil: blockedUntilDate,
      remoteAddress: params.remoteAddress || null,
      userAgent: params.userAgent?.slice(0, 250) || null
    });

    return {
      strikes: newStrikes,
      isBlocked: cooldownSeconds > 0,
      cooldownSeconds
    };
  }
}
