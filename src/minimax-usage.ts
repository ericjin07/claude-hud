import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { getHudPluginDir, getClaudeConfigDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import type { MiniMaxUsageResponse, MiniMaxUsageData } from './minimax-types.js';
import { getConfiguredModelFromSettings } from './provider-settings.js';

const debug = createDebug('minimax-usage');

const CACHE_TTL_MS = 60_000;
const CACHE_FAILURE_TTL_MS = 15_000;
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_POLL_MS = 50;
const CACHE_LOCK_WAIT_MS = 2_000;
const MINIMAX_API_TIMEOUT_MS = 15_000;

export type { MiniMaxUsageData } from './minimax-types.js';

interface MiniMaxCacheFile {
  data: MiniMaxUsageData;
  timestamp: number;
}

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.minimax-usage-cache.json');
}

function getCacheLockPath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.minimax-usage-cache.lock');
}

// Parse ANTHROPIC_MODEL from settings.json
export function getAnthropicModelFromSettings(homeDir: string): string | null {
  return getConfiguredModelFromSettings(homeDir);
}

export function isMiniMaxConfigured(model?: string | null): boolean {
  if (!model) return false;
  return model.toLowerCase().includes('minimax');
}

export function parseUtilization(total: number, remaining: number): number {
  if (total <= 0) return 0;
  const raw = ((total - remaining) / total) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function readCacheState(
  homeDir: string,
  now: number,
  ttls: { cacheTtlMs: number; failureCacheTtlMs: number },
): { data: MiniMaxUsageData; isFresh: boolean } | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const cache: MiniMaxCacheFile = JSON.parse(content);
    const ttl = cache.data.apiUnavailable ? ttls.failureCacheTtlMs : ttls.cacheTtlMs;
    const isFresh = now - cache.timestamp < ttl;
    // Re-hydrate resetAt from string back to Date
    if (cache.data.resetAt && typeof cache.data.resetAt === 'string') {
      cache.data.resetAt = new Date(cache.data.resetAt);
    }
    return { data: cache.data, isFresh };
  } catch {
    return null;
  }
}

function tryAcquireCacheLock(homeDir: string): boolean {
  const lockPath = getCacheLockPath(homeDir);
  const cacheDir = path.dirname(lockPath);
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, String(Date.now()), 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

function releaseCacheLock(homeDir: string): void {
  try {
    const lockPath = getCacheLockPath(homeDir);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore
  }
}

function writeCache(homeDir: string, data: MiniMaxUsageData, timestamp: number): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify({ data, timestamp }), 'utf8');
  } catch {
    // Ignore cache write failures
  }
}

function fetchMiniMaxApi(apiKey: string): Promise<{ data: MiniMaxUsageResponse | null; error?: string }> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.minimaxi.com',
      path: '/v1/api/openplatform/coding_plan/remains',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: MINIMAX_API_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ data: null, error: `http-${res.statusCode}` });
          return;
        }
        try {
          const parsed = JSON.parse(data) as MiniMaxUsageResponse;
          // Check MiniMax API error response (status_code !== 0 means error)
          if (parsed.base_resp?.status_code !== 0) {
            const msg = parsed.base_resp?.status_msg ?? 'unknown';
            resolve({ data: null, error: msg });
            return;
          }
          resolve({ data: parsed });
        } catch {
          resolve({ data: null, error: 'parse' });
        }
      });
    });

    req.on('error', () => resolve({ data: null, error: 'network' }));
    req.on('timeout', () => { req.destroy(); resolve({ data: null, error: 'timeout' }); });
    req.end();
  });
}

export type MiniMaxUsageDeps = {
  apiKey: () => string | null;
  fetchApi: (key: string) => Promise<{ data: MiniMaxUsageResponse | null; error?: string }>;
  homeDir: () => string;
  now: () => number;
  ttls: { cacheTtlMs: number; failureCacheTtlMs: number };
  getAnthropicModelFromSettings: (homeDir: string) => string | null;
};

const defaultDeps: MiniMaxUsageDeps = {
  apiKey: () => process.env.MINIMAX_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? null,
  fetchApi: fetchMiniMaxApi,
  homeDir: () => os.homedir(),
  now: () => Date.now(),
  ttls: { cacheTtlMs: CACHE_TTL_MS, failureCacheTtlMs: CACHE_FAILURE_TTL_MS },
  getAnthropicModelFromSettings,
};

export async function getMiniMaxUsage(overrides: Partial<MiniMaxUsageDeps> = {}): Promise<MiniMaxUsageData | null> {
  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();

  // Check if MiniMax is configured
  const anthropicModel = deps.getAnthropicModelFromSettings(deps.homeDir());
  if (!isMiniMaxConfigured(anthropicModel)) {
    return null;
  }

  // Check cache
  const cached = readCacheState(homeDir, now, deps.ttls);
  if (cached?.isFresh) {
    return cached.data;
  }

  // Acquire lock
  let holdsLock = false;
  if (tryAcquireCacheLock(homeDir)) {
    holdsLock = true;
  } else if (cached?.isFresh) {
    return cached.data;
  }

  try {
    // Re-check cache after acquiring lock
    const recheck = readCacheState(homeDir, now, deps.ttls);
    if (recheck?.isFresh) {
      return recheck.data;
    }

    const apiKey = deps.apiKey();
    if (!apiKey) {
      return null;
    }

    const apiResult = await deps.fetchApi(apiKey);
    if (!apiResult.data) {
      const result: MiniMaxUsageData = {
        planName: 'MiniMax',
        utilization: 0,
        resetAt: null,
        apiUnavailable: true,
        apiError: apiResult.error,
      };
      writeCache(homeDir, result, now);
      return result;
    }

    const resp = apiResult.data;
    // Find the model entry matching our ANTHROPIC_MODEL
    const modelEntry = resp.model_remains.find(m => m.model_name === anthropicModel)
      ?? resp.model_remains[0]; // Fallback to first entry if exact match not found

    // MiniMax API: current_interval_usage_count is the REMAINING count (not used!)
    // utilization = usage_count / total * 100 = percentage of quota remaining
    const utilization = Math.round((modelEntry.current_interval_usage_count / modelEntry.current_interval_total_count) * 100);

    // Use remains_time for accurate reset time (end_time can have clock drift)
    const resetAt = modelEntry.remains_time > 0 ? new Date(Date.now() + modelEntry.remains_time) : null;

    const result: MiniMaxUsageData = {
      planName: 'MiniMax',
      utilization,
      resetAt,
    };
    writeCache(homeDir, result, now);
    return result;
  } finally {
    if (holdsLock) {
      releaseCacheLock(homeDir);
    }
  }
}
