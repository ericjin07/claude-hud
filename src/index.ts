import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readStdin, getUsageFromStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getHudPluginDir } from "./claude-config-dir.js";
import { getGitStatus } from "./git.js";
import { loadConfig, DEFAULT_PROVIDER_DEFINITIONS } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { getMiniMaxUsage } from "./minimax-usage.js";
import { resolveEffortLevel } from "./effort.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot } from "./external-usage.js";
import { getUsage as getAnthropicUsage } from "./usage-api.js";
import { getConfiguredModelFromSettings } from "./provider-settings.js";
import { setLanguage, t } from "./i18n/index.js";
import type { RenderContext, StdinData, UsageData, NormalizedUsageData } from "./types.js";
import type { UsageProviderDefinition } from "./config.js";

export { getUsageFromExternalSnapshot } from "./external-usage.js";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export type MainDeps = {
  readStdin: typeof readStdin;
  getUsageFromStdin: typeof getUsageFromStdin;
  getUsageFromExternalSnapshot: typeof getUsageFromExternalSnapshot;
  getAnthropicUsage: typeof getAnthropicUsage;
  getConfiguredModel: () => string | null;
  parseTranscript: typeof parseTranscript;
  countConfigs: typeof countConfigs;
  getGitStatus: typeof getGitStatus;
  loadConfig: typeof loadConfig;
  parseExtraCmdArg: typeof parseExtraCmdArg;
  runExtraCmd: typeof runExtraCmd;
  getClaudeCodeVersion: typeof getClaudeCodeVersion;
  getMemoryUsage: typeof getMemoryUsage;
  getMiniMaxUsage: typeof getMiniMaxUsage;
  applyContextWindowFallback: typeof applyContextWindowFallback;
  render: typeof render;
  homeDir: () => string;
  now: () => number;
  log: (...args: unknown[]) => void;
};

export type ResolveUsageContextDeps = {
  stdin: StdinData;
  config: RenderContext["config"];
  getMiniMaxUsage: MainDeps["getMiniMaxUsage"];
  getUsageFromStdin: MainDeps["getUsageFromStdin"];
  getUsageFromExternalSnapshot: MainDeps["getUsageFromExternalSnapshot"];
  getAnthropicUsage?: MainDeps["getAnthropicUsage"];
  getConfiguredModel?: MainDeps["getConfiguredModel"];
  homeDir?: MainDeps["homeDir"];
  fetchJson?: (request: {
    endpoint: string;
    headers: Record<string, string>;
  }) => Promise<unknown>;
  now: () => number;
};

type HttpJsonCacheFile = {
  data: NormalizedUsageData | null;
  timestamp: number;
};

const HTTP_JSON_TIMEOUT_MS = 15_000;

function getHttpJsonCachePath(homeDir: string, providerId: string): string {
  const safeProviderId = providerId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getHudPluginDir(homeDir), `.usage-provider-cache-${safeProviderId}.json`);
}

function hydrateNormalizedUsageData(data: NormalizedUsageData | null): NormalizedUsageData | null {
  if (!data) {
    return null;
  }

  return {
    ...data,
    windows: data.windows.map((window) => ({
      ...window,
      resetAt: window.resetAt ? new Date(window.resetAt) : null,
    })),
  };
}

function readHttpJsonProviderCache(
  homeDir: string,
  providerId: string,
  now: number,
  ttls: { cacheTtlMs: number; failureCacheTtlMs: number },
): { data: NormalizedUsageData | null; isFresh: boolean } | null {
  try {
    const cachePath = getHttpJsonCachePath(homeDir, providerId);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as HttpJsonCacheFile;
    const ttl = cache.data ? ttls.cacheTtlMs : ttls.failureCacheTtlMs;

    return {
      data: hydrateNormalizedUsageData(cache.data),
      isFresh: now - cache.timestamp < ttl,
    };
  } catch {
    return null;
  }
}

function writeHttpJsonProviderCache(
  homeDir: string,
  providerId: string,
  data: NormalizedUsageData | null,
  timestamp: number,
): void {
  try {
    const cachePath = getHttpJsonCachePath(homeDir, providerId);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(cachePath, JSON.stringify({ data, timestamp }), "utf8");
  } catch {
    // Ignore cache write failures
  }
}

function normalizeProviderUsage(
  provider: UsageProviderDefinition,
  data: UsageData,
): NormalizedUsageData {
  const normalized = normalizeUsageData(data);
  return {
    ...normalized,
    providerId: provider.id,
    providerLabel: provider.label,
  };
}

function normalizeRuntimeProviderDefinition(provider: Partial<UsageProviderDefinition>): UsageProviderDefinition | null {
  if (!provider.id || !provider.usageSource?.kind) {
    return null;
  }

  return {
    id: provider.id,
    label: provider.label ?? provider.id,
    enabled: provider.enabled !== false,
    modelMatchers: Array.isArray(provider.modelMatchers)
      ? provider.modelMatchers.filter((matcher): matcher is string => typeof matcher === 'string' && matcher.trim().length > 0)
      : [],
    usageSource: {
      kind: provider.usageSource.kind,
      ...(provider.usageSource.endpoint ? { endpoint: provider.usageSource.endpoint } : {}),
      ...(provider.usageSource.path ? { path: provider.usageSource.path } : {}),
      ...(provider.usageSource.auth ? { auth: provider.usageSource.auth } : {}),
      ...(provider.usageSource.responseMapping ? { responseMapping: provider.usageSource.responseMapping } : {}),
    },
  };
}

function modelMatchesProvider(
  provider: UsageProviderDefinition,
  sessionSignals: string[],
  configuredModel: string | null,
): boolean {
  // Empty matchers = catch-all provider (matches any model)
  if (provider.modelMatchers.length === 0) {
    return true;
  }

  const signalsToCheck = sessionSignals.length > 0
    ? sessionSignals
    : (configuredModel ? [configuredModel] : []);

  // No model signals available — only catch-all providers can match
  if (signalsToCheck.length === 0) {
    return false;
  }

  return provider.modelMatchers.some((matcher) => {
    const normalizedMatcher = matcher.toLowerCase();
    return signalsToCheck.some((signal) => signal.toLowerCase().includes(normalizedMatcher));
  });
}

function parseMappedResetAt(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value > 1_000_000_000_000 ? value : value * 1000);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getPathValue(source: unknown, dottedPath?: string): unknown {
  if (!dottedPath) {
    return undefined;
  }

  let current: unknown = source;
  for (const segment of dottedPath.split('.')) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }

    // Support array filter syntax: "items[key=value]"
    const filterMatch = segment.match(/^([^[]+)\[([^=]+)=([^\]]+)\]$/);
    if (filterMatch) {
      const [, arrayKey, filterKey, filterValue] = filterMatch;
      const arr = (current as Record<string, unknown>)[arrayKey!];
      if (!Array.isArray(arr)) {
        return undefined;
      }
      const found = arr.find(
        (item) => item && typeof item === 'object' && String((item as Record<string, unknown>)[filterKey!]) === filterValue,
      );
      current = found ?? undefined;
      if (current === undefined) return undefined;
      continue;
    }

    // Support numeric segments as array indices: "items.0.name"
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (segment in current) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function parseMappedPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseMappedBalance(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildHttpJsonHeaders(provider: UsageProviderDefinition): Record<string, string> | null {
  const headers: Record<string, string> = {};
  const auth = provider.usageSource.auth;

  if (!auth || auth.type === 'none') {
    return headers;
  }

  const token = auth.envName ? process.env[auth.envName]?.trim() : '';
  if (!token) {
    return null;
  }

  if (auth.type === 'bearer-env') {
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  if (auth.type === 'header-env' && auth.headerName) {
    headers[auth.headerName] = token;
    return headers;
  }

  return null;
}

async function fetchHttpJsonUsage(
  provider: UsageProviderDefinition,
  fetchJson: NonNullable<ResolveUsageContextDeps['fetchJson']>,
): Promise<NormalizedUsageData | null> {
  if (!provider.usageSource.endpoint || !provider.usageSource.responseMapping?.windows?.length) {
    return null;
  }

  const headers = buildHttpJsonHeaders(provider);
  if (headers === null) {
    return null;
  }

  const response = await fetchJson({
    endpoint: provider.usageSource.endpoint,
    headers,
  });

  const windows = provider.usageSource.responseMapping.windows.map((window) => {
    const usedPercent = window.usedPercentPath
      ? parseMappedPercent(getPathValue(response, window.usedPercentPath))
      : null;
    const remainingPercent = window.remainingPercentPath
      ? parseMappedPercent(getPathValue(response, window.remainingPercentPath))
      : null;
    const balance = window.balancePath
      ? parseMappedBalance(getPathValue(response, window.balancePath))
      : null;

    return {
      key: window.key,
      label: window.label,
      usedPercent: usedPercent ?? (remainingPercent === null ? null : Math.max(0, 100 - remainingPercent)),
      resetAt: parseMappedResetAt(getPathValue(response, window.resetAtPath)),
      ...(balance !== null ? { balance, balanceUnit: window.balanceUnit ?? null } : {}),
    };
  });

  if (!windows.some((window) => window.usedPercent !== null || window.balance != null)) {
    return null;
  }

  return {
    providerId: provider.id,
    providerLabel: provider.label,
    planName: (() => {
      const planName = getPathValue(response, provider.usageSource.responseMapping.planNamePath);
      return typeof planName === 'string' ? planName : null;
    })(),
    windows,
  };
}

async function defaultFetchJson(request: { endpoint: string; headers: Record<string, string> }): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_JSON_TIMEOUT_MS);

  try {
    const response = await fetch(request.endpoint, {
      method: 'GET',
      headers: request.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUsageData(data: UsageData): NormalizedUsageData {
  const normalized: NormalizedUsageData = {
    providerId: "claude",
    providerLabel: "Claude",
    planName: data.planName,
    windows: [
      {
        key: "5h",
        label: "5h",
        usedPercent: data.fiveHour,
        resetAt: data.fiveHourResetAt,
      },
      {
        key: "7d",
        label: "7d",
        usedPercent: data.sevenDay,
        resetAt: data.sevenDayResetAt,
      },
    ],
  };

  if (data.apiUnavailable !== undefined) {
    normalized.apiUnavailable = data.apiUnavailable;
  }

  if (data.apiError !== undefined) {
    normalized.apiError = data.apiError;
  }

  return normalized;
}

export async function resolveUsageContext(
  deps: ResolveUsageContextDeps,
): Promise<NormalizedUsageData | null> {
  const providerDefinitions = (deps.config.usage.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS)
    .map((provider) => normalizeRuntimeProviderDefinition(provider))
    .filter((provider): provider is UsageProviderDefinition => provider !== null);
  const configuredModel = deps.getConfiguredModel?.() ?? null;
  const homeDir = deps.homeDir?.() ?? os.homedir();
  const cacheTtls = {
    cacheTtlMs: deps.config.usage.cacheTtlSeconds * 1000,
    failureCacheTtlMs: deps.config.usage.failureCacheTtlSeconds * 1000,
  };
  const sessionSignals = [
    deps.stdin.model?.id,
    deps.stdin.model?.display_name,
  ].filter((signal): signal is string => typeof signal === 'string' && signal.trim().length > 0);

  for (const provider of providerDefinitions) {
    if (!provider.enabled || !modelMatchesProvider(provider, sessionSignals, configuredModel)) {
      continue;
    }

    if (provider.usageSource.kind === 'minimax') {
      const miniMaxUsage = await deps.getMiniMaxUsage({
        ttls: cacheTtls,
      });

      if (miniMaxUsage) {
        const normalized: NormalizedUsageData = {
          providerId: provider.id,
          providerLabel: provider.label,
          planName: miniMaxUsage.planName,
          windows: [
            {
              key: '5h',
              label: '5h',
              usedPercent: Math.max(0, 100 - miniMaxUsage.utilization),
              resetAt: miniMaxUsage.resetAt,
            },
          ],
        };

        if (miniMaxUsage.apiUnavailable !== undefined) {
          normalized.apiUnavailable = miniMaxUsage.apiUnavailable;
        }

        if (miniMaxUsage.apiError !== undefined) {
          normalized.apiError = miniMaxUsage.apiError;
        }

        return normalized;
      }
      continue;
    }

    if (provider.usageSource.kind === 'stdin') {
      const stdinUsage = deps.getUsageFromStdin(deps.stdin);
      if (stdinUsage) {
        return normalizeProviderUsage(provider, stdinUsage);
      }
      continue;
    }

    if (provider.usageSource.kind === 'external-file') {
      const externalUsage = deps.getUsageFromExternalSnapshot(
        deps.config,
        deps.now(),
        provider.usageSource.path,
      );
      if (externalUsage) {
        return normalizeProviderUsage(provider, externalUsage);
      }
      continue;
    }

    if (provider.usageSource.kind === 'anthropic-oauth' && deps.getAnthropicUsage) {
      const anthropicUsage = await deps.getAnthropicUsage({
        homeDir: () => homeDir,
        now: deps.now,
        ttls: cacheTtls,
      });
      if (anthropicUsage) {
        return normalizeProviderUsage(provider, anthropicUsage);
      }
      continue;
    }

    if (provider.usageSource.kind === 'http-json' && deps.fetchJson) {
      const cached = readHttpJsonProviderCache(homeDir, provider.id, deps.now(), cacheTtls);
      if (cached?.isFresh) {
        if (cached.data) {
          return cached.data;
        }
        continue;
      }

      try {
        const mappedUsage = await fetchHttpJsonUsage(provider, deps.fetchJson);
        writeHttpJsonProviderCache(homeDir, provider.id, mappedUsage, deps.now());
        if (mappedUsage) {
          return mappedUsage;
        }
      } catch {
        writeHttpJsonProviderCache(homeDir, provider.id, null, deps.now());
      }

      continue;
    }
  }

  return null;
}

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  const deps: MainDeps = {
    readStdin,
    getUsageFromStdin,
    getUsageFromExternalSnapshot,
    getAnthropicUsage,
    getConfiguredModel: () => getConfiguredModelFromSettings(),
    parseTranscript,
    countConfigs,
    getGitStatus,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    getClaudeCodeVersion,
    getMemoryUsage,
    getMiniMaxUsage,
    applyContextWindowFallback,
    render,
    homeDir: () => os.homedir(),
    now: () => Date.now(),
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      // Running without stdin - this happens during setup verification
      const config = await deps.loadConfig();
      setLanguage(config.language);
      const isMacOS = process.platform === "darwin";
      deps.log(t("init.initializing"));
      if (isMacOS) {
        deps.log(t("init.macosNote"));
      }
      return;
    }

    const transcriptPath = stdin.transcript_path ?? "";
    const transcript = await deps.parseTranscript(transcriptPath);

    deps.applyContextWindowFallback(stdin, {}, transcript.sessionName);

    const { claudeMdCount, rulesCount, mcpCount, hooksCount, outputStyle } =
      await deps.countConfigs(stdin.cwd);

    const config = await deps.loadConfig();
    setLanguage(config.language);
    const gitStatus = config.gitStatus.enabled
      ? await deps.getGitStatus(stdin.cwd)
      : null;

    let usageData: RenderContext["usageData"] = null;
    if (config.display.showUsage !== false) {
      usageData = await resolveUsageContext({
        stdin,
        config,
        getMiniMaxUsage: deps.getMiniMaxUsage,
        getUsageFromStdin: deps.getUsageFromStdin,
        getUsageFromExternalSnapshot: deps.getUsageFromExternalSnapshot,
        getAnthropicUsage: deps.getAnthropicUsage,
        getConfiguredModel: deps.getConfiguredModel,
        homeDir: deps.homeDir,
        fetchJson: defaultFetchJson,
        now: deps.now,
      });
    }

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(
      transcript.sessionStart,
      deps.now,
    );
    const claudeCodeVersion = config.display.showClaudeCodeVersion
      ? await deps.getClaudeCodeVersion()
      : undefined;
    const effortInfo = config.display.showEffortLevel
      ? resolveEffortLevel(stdin.effort)
      : null;
    const memoryUsage =
      config.display.showMemoryUsage && config.lineLayout === "expanded"
        ? await deps.getMemoryUsage()
        : null;

    const ctx: RenderContext = {
      stdin,
      transcript,
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
      sessionDuration,
      gitStatus,
      usageData,
      memoryUsage,
      config,
      extraLabel,
      outputStyle,
      claudeCodeVersion,
      effortLevel: effortInfo?.level,
      effortSymbol: effortInfo?.symbol,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log(
      "[claude-hud] Error:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

export function formatSessionDuration(
  sessionStart?: Date,
  now: () => number = () => Date.now(),
): string {
  if (!sessionStart) {
    return "";
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
  void main();
}
