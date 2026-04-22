import type { HudConfig } from './config.js';
import type { GitStatus } from './git.js';
import type { MiniMaxUsageData } from './minimax-types.js';
import { isMiniMaxUsageData } from './minimax-types.js';

export interface StdinData {
  transcript_path?: string;
  cwd?: string;
  model?: {
    id?: string;
    display_name?: string;
  };
  context_window?: {
    context_window_size?: number;
    total_input_tokens?: number | null;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    // Native percentage fields (Claude Code v2.1.6+)
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  };
  cost?: {
    total_cost_usd?: number | null;
    total_duration_ms?: number | null;
    total_api_duration_ms?: number | null;
    total_lines_added?: number | null;
    total_lines_removed?: number | null;
  } | null;
  rate_limits?: {
    five_hour?: {
      used_percentage?: number | null;
      resets_at?: number | null;
    } | null;
    seven_day?: {
      used_percentage?: number | null;
      resets_at?: number | null;
    } | null;
  } | null;
  // Future: Claude Code may expose effort level directly in stdin JSON
  effort?: string | null;
}

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed';
  startTime: Date;
  endTime?: Date;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface UsageData {
  planName: string | null;  // 'Max', 'Pro', 'MiniMax', or null for API users
  fiveHour: number | null;  // 0-100 percentage, null if unavailable
  sevenDay: number | null;  // 0-100 percentage, null if unavailable
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  apiUnavailable?: boolean;
  apiError?: string;
}

export interface UsageWindow {
  key: string;
  label: string;
  usedPercent: number | null;
  resetAt: Date | null;
}

export interface NormalizedUsageData {
  providerId: string;
  providerLabel: string;
  planName: string | null;
  windows: UsageWindow[];
  apiUnavailable?: boolean;
  apiError?: string;
}

export type UsageLikeData = NormalizedUsageData | UsageData | MiniMaxUsageData;

function isNormalizedUsageData(data: UsageLikeData): data is NormalizedUsageData {
  return 'windows' in data && Array.isArray(data.windows);
}

export interface ExternalUsageSnapshot {
  five_hour?: {
    used_percentage?: number | null;
    resets_at?: string | number | null;
  } | null;
  seven_day?: {
    used_percentage?: number | null;
    resets_at?: string | number | null;
  } | null;
  updated_at?: string | number | null;
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
}

/** Check if usage limit is reached (either window at 100% or MiniMax at 0% remaining) */
export function toNormalizedUsageData(data: UsageLikeData): NormalizedUsageData {
  if (isNormalizedUsageData(data)) {
    return data;
  }

  if (isMiniMaxUsageData(data)) {
    const normalized: NormalizedUsageData = {
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      planName: data.planName,
      windows: [
        {
          key: '5h',
          label: '5h',
          usedPercent: Math.max(0, 100 - data.utilization),
          resetAt: data.resetAt,
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

  const normalized: NormalizedUsageData = {
    providerId: 'claude',
    providerLabel: 'Claude',
    planName: data.planName,
    windows: [
      {
        key: '5h',
        label: '5h',
        usedPercent: data.fiveHour,
        resetAt: data.fiveHourResetAt,
      },
      {
        key: '7d',
        label: '7d',
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

/** Check if any usage window has reached its limit. */
export function isLimitReached(data: UsageLikeData): boolean {
  const normalized = toNormalizedUsageData(data);
  for (const window of normalized.windows) {
    if (window.usedPercent === 100) {
      return true;
    }
  }
  return false;
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
  sessionStart?: Date;
  sessionName?: string;
  lastAssistantResponseAt?: Date;
  sessionTokens?: SessionTokenUsage;
}

export interface RenderContext {
  stdin: StdinData;
  transcript: TranscriptData;
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
  sessionDuration: string;
  gitStatus: GitStatus | null;
  usageData: NormalizedUsageData | null;
  memoryUsage: MemoryInfo | null;
  config: HudConfig;
  extraLabel: string | null;
  outputStyle?: string;
  claudeCodeVersion?: string;
  effortLevel?: string;
  effortSymbol?: string;
}
