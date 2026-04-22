import type { RenderContext } from '../types.js';
import { isLimitReached, toNormalizedUsageData } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, formatModelName, getProviderLabel, getTotalTokens } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, critical, warning, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, getContextColor, getQuotaColor, quotaBar, custom as customColor, RESET } from './colors.js';
import { getAdaptiveBarWidth } from '../utils/terminal.js';
import { renderCostEstimate } from './lines/cost.js';
import { renderPromptCacheLine } from './lines/prompt-cache.js';
import { t } from '../i18n/index.js';
import type { TimeFormatMode } from '../config.js';
import { formatResetTime } from './format-reset-time.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export function renderSessionLine(ctx: RenderContext): string {
  const model = formatModelName(getModelName(ctx.stdin), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);

  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;

  if (DEBUG && autocompactMode === 'disabled') {
    console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const colors = ctx.config?.colors;
  const barWidth = getAdaptiveBarWidth();
  const bar = coloredBar(percent, barWidth, colors);

  const parts: string[] = [];
  const display = ctx.config?.display;
  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}`;

  // Model and context bar (FIRST)
  const providerLabel = getProviderLabel(ctx.stdin);
  const modelQualifier = providerLabel ?? undefined;
  let modelDisplay = modelQualifier ? `${model} | ${modelQualifier}` : model;
  if (ctx.effortLevel && ctx.effortSymbol) {
    modelDisplay += ` ${ctx.effortSymbol}${ctx.effortLevel}`;
  } else if (ctx.effortLevel) {
    modelDisplay += ` ${ctx.effortLevel}`;
  }

  if (display?.showModel !== false && display?.showContextBar !== false) {
    parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${bar} ${contextValueDisplay}`);
  } else if (display?.showModel !== false) {
    parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${contextValueDisplay}`);
  } else if (display?.showContextBar !== false) {
    parts.push(`${bar} ${contextValueDisplay}`);
  } else {
    parts.push(contextValueDisplay);
  }

  // Project path + git status (SECOND)
  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
    projectPart = projectColor(projectPath, colors);
  }

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;
  const branchOverflow = gitConfig?.branchOverflow ?? 'truncate';

  if (showGit && ctx.gitStatus) {
    const gitParts: string[] = [ctx.gitStatus.branch];

    if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
      gitParts.push('*');
    }

    if (gitConfig?.showAheadBehind) {
      if (ctx.gitStatus.ahead > 0) {
        gitParts.push(` ↑${ctx.gitStatus.ahead}`);
      }
      if (ctx.gitStatus.behind > 0) {
        gitParts.push(` ↓${ctx.gitStatus.behind}`);
      }
    }

    if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
      const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
      const statParts: string[] = [];
      if (modified > 0) statParts.push(`!${modified}`);
      if (added > 0) statParts.push(`+${added}`);
      if (deleted > 0) statParts.push(`✘${deleted}`);
      if (untracked > 0) statParts.push(`?${untracked}`);
      if (statParts.length > 0) {
        gitParts.push(` ${statParts.join(' ')}`);
      }
    }

    gitPart = `${gitColor('git:(', colors)}${gitBranchColor(gitParts.join(''), colors)}${gitColor(')', colors)}`;
  }

  if (projectPart && gitPart) {
    if (branchOverflow === 'wrap') {
      parts.push(projectPart);
      parts.push(gitPart);
    } else {
      parts.push(`${projectPart} ${gitPart}`);
    }
  } else if (projectPart) {
    parts.push(projectPart);
  } else if (gitPart) {
    parts.push(gitPart);
  }

  // Session name (custom title from /rename, or auto-generated slug)
  if (display?.showSessionName && ctx.transcript.sessionName) {
    parts.push(label(ctx.transcript.sessionName, colors));
  }

  // Claude version
  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    parts.push(label(`CC v${ctx.claudeCodeVersion}`, colors));
  }

  // Config counts (respects environmentThreshold)
  if (display?.showConfigCounts !== false) {
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;

    if (totalCounts > 0 && totalCounts >= envThreshold) {
      if (ctx.claudeMdCount > 0) {
        parts.push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
      }
      if (ctx.rulesCount > 0) {
        parts.push(label(`${ctx.rulesCount} ${t('label.rules')}`, colors));
      }
      if (ctx.mcpCount > 0) {
        parts.push(label(`${ctx.mcpCount} MCPs`, colors));
      }
      if (ctx.hooksCount > 0) {
        parts.push(label(`${ctx.hooksCount} ${t('label.hooks')}`, colors));
      }
    }
  }

  // Usage limits display (shown when enabled in config, respects usageThreshold)
  if (display?.showUsage !== false && ctx.usageData && !providerLabel) {
    const usageData = toNormalizedUsageData(ctx.usageData);
    const fiveHourWindow = usageData.windows.find((window) => window.key === '5h') ?? null;
    const sevenDayWindow = usageData.windows.find((window) => window.key === '7d') ?? null;
    const primaryWindow = usageData.windows[0] ?? null;
    const usageCompact = display?.usageCompact ?? false;
    const showResetLabel = display?.showResetLabel ?? true;

    if (usageData.apiUnavailable && usageData.providerId === 'minimax') {
      const errorHint = formatUsageError(usageData.apiError);
      parts.push(warning(`usage: ⚠${errorHint}`, colors));
    } else if (isLimitReached(usageData)) {
      const limitWindow = usageData.windows.find((window) => window.usedPercent === 100) ?? primaryWindow;
      const resetTime = formatResetTime(limitWindow?.resetAt ?? null, timeFormat);

      if (usageCompact) {
        parts.push(critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`, colors));
      } else {
        const resetSuffix = resetTime
          ? showResetLabel
            ? ` (${t(resetsKey)} ${resetTime})`
            : ` (${resetTime})`
          : '';
        parts.push(critical(`⚠ ${t('status.limitReached')}${resetSuffix}`, colors));
      }
    } else {
      const usageThreshold = display?.usageThreshold ?? 0;

      if (usageData.providerId === 'minimax') {
        const usedPercent = primaryWindow?.usedPercent ?? null;
        const resetAt = primaryWindow?.resetAt ?? null;
        if (usedPercent !== null && usedPercent >= usageThreshold) {
          if (usageCompact) {
            parts.push(formatCompactWindowPart('5h', usedPercent, resetAt, timeFormat, colors));
          } else {
            const usageBarEnabled = display?.usageBarEnabled ?? true;
            const minimaxPart = formatUsageWindowPart({
              label: '5h',
              percent: usedPercent,
              resetAt,
              colors,
              usageBarEnabled,
              barWidth,
              timeFormat,
              showResetLabel,
            });
            parts.push(`${label(t('label.usage'), colors)} ${minimaxPart}`);
          }
        }
      } else {
        const fiveHour = fiveHourWindow?.usedPercent ?? null;
        const sevenDay = sevenDayWindow?.usedPercent ?? null;
        const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);

        if (effectiveUsage >= usageThreshold) {
          const usageBarEnabled = display?.usageBarEnabled ?? true;
          const syncingSuffix = usageData.apiError === 'rate-limited'
            ? ` ${label('(syncing...)', colors)}`
            : '';

          if (usageCompact) {
            const fiveHourPart = fiveHour !== null
              ? formatCompactWindowPart('5h', fiveHour, fiveHourWindow?.resetAt ?? null, timeFormat, colors)
              : null;
            const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
            const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
              ? formatCompactWindowPart('7d', sevenDay, sevenDayWindow?.resetAt ?? null, timeFormat, colors)
              : null;

            if (fiveHourPart && sevenDayPart) {
              parts.push(`${fiveHourPart}${syncingSuffix}`);
              parts.push(sevenDayPart);
            } else if (fiveHourPart) {
              parts.push(`${fiveHourPart}${syncingSuffix}`);
            } else if (sevenDayPart) {
              parts.push(sevenDayPart);
            }
          } else if (fiveHour === null && sevenDay !== null) {
            const weeklyOnlyPart = formatUsageWindowPart({
              label: t('label.weekly'),
              percent: sevenDay,
              resetAt: sevenDayWindow?.resetAt ?? null,
              colors,
              usageBarEnabled,
              barWidth,
              timeFormat,
              showResetLabel,
              forceLabel: true,
            });
            parts.push(`${weeklyOnlyPart}${syncingSuffix}`);
          } else {
            const fiveHourPart = formatUsageWindowPart({
              label: '5h',
              percent: fiveHour,
              resetAt: fiveHourWindow?.resetAt ?? null,
              colors,
              usageBarEnabled,
              barWidth,
              timeFormat,
              showResetLabel,
            });

            const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
            if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
              const sevenDayPart = formatUsageWindowPart({
                label: t('label.weekly'),
                percent: sevenDay,
                resetAt: sevenDayWindow?.resetAt ?? null,
                colors,
                usageBarEnabled,
                barWidth,
                timeFormat,
                showResetLabel,
                forceLabel: true,
              });
              parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}${syncingSuffix}`);
              parts.push(sevenDayPart);
            } else {
              parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}${syncingSuffix}`);
            }
          }
        }
      }
    }
  }

  // Session token usage (cumulative)
  if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
    const st = ctx.transcript.sessionTokens;
    const total = st.inputTokens + st.outputTokens + st.cacheCreationTokens + st.cacheReadTokens;
    if (total > 0) {
      parts.push(label(`tok: ${formatTokens(total)} (in: ${formatTokens(st.inputTokens)}, out: ${formatTokens(st.outputTokens)})`, colors));
    }
  }

  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
  }

  const promptCacheLine = renderPromptCacheLine(ctx);
  if (promptCacheLine) {
    parts.push(promptCacheLine);
  }

  const costEstimate = renderCostEstimate(ctx);
  if (costEstimate) {
    parts.push(costEstimate);
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      parts.push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors));
    }
  }

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  // Custom line (static user-defined text)
  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  let line = parts.join(' | ');

  // Token breakdown at high context
  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, colors);
    }
  }

  return line;
}

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string {
  const totalTokens = getTotalTokens(ctx.stdin);
  const size = ctx.stdin.context_window?.context_window_size ?? 0;

  if (mode === 'tokens') {
    if (size > 0) {
      return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
    }
    return formatTokens(totalTokens);
  }

  if (mode === 'both') {
    if (size > 0) {
      return `${percent}% (${formatTokens(totalTokens)}/${formatTokens(size)})`;
    }
    return `${percent}%`;
  }

  if (mode === 'remaining') {
    return `${Math.max(0, 100 - percent)}%`;
  }

  return `${percent}%`;
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  timeFormat: TimeFormatMode,
  colors?: RenderContext['config']['colors'],
): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) {
    return label('--', colors);
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error === 'rate-limited') return ' (syncing...)';
  if (error.startsWith('http-')) return ` (${error.slice(5)})`;
  return ` (${error})`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat = 'relative',
  showResetLabel,
  forceLabel = false,
}: {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext['config']['colors'];
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat?: TimeFormatMode;
  showResetLabel: boolean;
  forceLabel?: boolean;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(windowLabel, colors);
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';

  if (usageBarEnabled) {
    const barReset = timeFormat === 'relative'
      ? (reset ? `${reset} / ${windowLabel}` : null)
      : (reset ? (showResetLabel ? `${t(resetsKey)} ${reset}` : reset) : null);
    const body = barReset
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} (${barReset})`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  const resetSuffix = reset
    ? showResetLabel
      ? `(${t(resetsKey)} ${reset})`
      : `(${reset})`
    : '';

  return resetSuffix
    ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
    : `${styledLabel} ${usageDisplay}`;
}
