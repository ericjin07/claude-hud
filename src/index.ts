import { readStdin, getUsageFromStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { getMiniMaxUsage } from "./minimax-usage.js";
import type { MiniMaxUsageData } from "./minimax-types.js";
import { resolveEffortLevel } from "./effort.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
import type { RenderContext, StdinData, UsageData, NormalizedUsageData } from "./types.js";

export { getUsageFromExternalSnapshot } from "./external-usage.js";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export type MainDeps = {
  readStdin: typeof readStdin;
  getUsageFromStdin: typeof getUsageFromStdin;
  getUsageFromExternalSnapshot: typeof getUsageFromExternalSnapshot;
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
  now: () => number;
  log: (...args: unknown[]) => void;
};

export type ResolveUsageContextDeps = {
  stdin: StdinData;
  config: RenderContext["config"];
  getMiniMaxUsage: MainDeps["getMiniMaxUsage"];
  getUsageFromStdin: MainDeps["getUsageFromStdin"];
  getUsageFromExternalSnapshot: MainDeps["getUsageFromExternalSnapshot"];
  now: () => number;
};

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

function toLegacyUsageData(data: NormalizedUsageData): RenderContext["usageData"] {
  if (data.providerId === "minimax") {
    const primaryWindow = data.windows.find((window) => window.key === "5h") ?? data.windows[0];
    if (!primaryWindow) {
      return null;
    }

    const legacyMiniMaxUsage: MiniMaxUsageData = {
      planName: "MiniMax" as const,
      utilization: Math.max(0, 100 - (primaryWindow.usedPercent ?? 0)),
      resetAt: primaryWindow.resetAt,
    };

    if (data.apiUnavailable !== undefined) {
      legacyMiniMaxUsage.apiUnavailable = data.apiUnavailable;
    }

    if (data.apiError !== undefined) {
      legacyMiniMaxUsage.apiError = data.apiError;
    }

    return legacyMiniMaxUsage;
  }

  const fiveHourWindow = data.windows.find((window) => window.key === "5h") ?? null;
  const sevenDayWindow = data.windows.find((window) => window.key === "7d") ?? null;
  const legacyUsage: UsageData = {
    planName: data.planName,
    fiveHour: fiveHourWindow?.usedPercent ?? null,
    sevenDay: sevenDayWindow?.usedPercent ?? null,
    fiveHourResetAt: fiveHourWindow?.resetAt ?? null,
    sevenDayResetAt: sevenDayWindow?.resetAt ?? null,
  };

  if (data.apiUnavailable !== undefined) {
    legacyUsage.apiUnavailable = data.apiUnavailable;
  }

  if (data.apiError !== undefined) {
    legacyUsage.apiError = data.apiError;
  }

  return legacyUsage;
}

export async function resolveUsageContext(
  deps: ResolveUsageContextDeps,
): Promise<NormalizedUsageData | null> {
  const miniMaxUsage = await deps.getMiniMaxUsage({
    ttls: {
      cacheTtlMs: deps.config.usage.cacheTtlSeconds * 1000,
      failureCacheTtlMs: deps.config.usage.failureCacheTtlSeconds * 1000,
    },
  });

  if (miniMaxUsage) {
    const normalized: NormalizedUsageData = {
      providerId: "minimax",
      providerLabel: "MiniMax",
      planName: miniMaxUsage.planName,
      windows: [
        {
          key: "5h",
          label: "5h",
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

  const stdinUsage = deps.getUsageFromStdin(deps.stdin);
  if (stdinUsage) {
    return normalizeUsageData(stdinUsage);
  }

  const externalUsage = deps.getUsageFromExternalSnapshot(deps.config, deps.now());
  if (externalUsage) {
    return normalizeUsageData(externalUsage);
  }

  return null;
}

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  const deps: MainDeps = {
    readStdin,
    getUsageFromStdin,
    getUsageFromExternalSnapshot,
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
      const normalizedUsage = await resolveUsageContext({
        stdin,
        config,
        getMiniMaxUsage: deps.getMiniMaxUsage,
        getUsageFromStdin: deps.getUsageFromStdin,
        getUsageFromExternalSnapshot: deps.getUsageFromExternalSnapshot,
        now: deps.now,
      });

      if (normalizedUsage) {
        usageData = toLegacyUsageData(normalizedUsage);
      }
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
