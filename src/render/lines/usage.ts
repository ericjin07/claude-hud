import type { RenderContext } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { isMiniMaxUsageData } from '../../minimax-types.js';
import { getProviderLabel } from '../../stdin.js';
import { critical, warning, dim, getQuotaColor, quotaBar, RESET } from '../colors.js';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData?.planName) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  // Check for MiniMax
  if (isMiniMaxUsageData(ctx.usageData)) {
    const minimaxData = ctx.usageData;
    const label = dim('Usage');

    if (minimaxData.apiUnavailable) {
      const errorHint = formatUsageError(minimaxData.apiError);
      return `${label} ${warning(`⚠${errorHint}`, colors)}`;
    }

    if (minimaxData.utilization === 0) {
      const resetTime = formatResetTime(minimaxData.resetAt);
      return `${label} ${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
    }

    const threshold = display?.usageThreshold ?? 0;
    if (minimaxData.utilization < threshold) {
      return null;
    }

    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const usedPercent = 100 - minimaxData.utilization;
    const resetTime = formatResetTime(minimaxData.resetAt);

    if (usageBarEnabled) {
      const bar = quotaBar(usedPercent, 10, colors);
      const percentDisplay = formatUsagePercent(usedPercent, colors);
      const timeStr = resetTime ? ` (${resetTime} / quota)` : '';
      return `${label} ${bar} ${percentDisplay}${timeStr}`;
    } else {
      const percentDisplay = formatUsagePercent(usedPercent, colors);
      const timeStr = resetTime ? ` (${resetTime})` : '';
      return `${label} ${percentDisplay}${timeStr}`;
    }
  }

  const label = dim('Usage');
  const usageData = ctx.usageData;

  if (usageData.apiUnavailable) {
    const errorHint = formatUsageError(usageData.apiError);
    return `${label} ${warning(`⚠${errorHint}`, colors)}`;
  }

  if (isLimitReached(usageData)) {
    const resetTime = usageData.fiveHour === 100
      ? formatResetTime(usageData.fiveHourResetAt)
      : formatResetTime(usageData.sevenDayResetAt);
    return `${label} ${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;

  // Handle Anthropic usage data
  const fiveHour = usageData.fiveHour;
  const sevenDay = usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const fiveHourDisplay = formatUsagePercent(usageData.fiveHour, colors);
  const fiveHourReset = formatResetTime(usageData.fiveHourResetAt);

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const fiveHourPart = usageBarEnabled
    ? (fiveHourReset
        ? `${quotaBar(fiveHour ?? 0, 10, colors)} ${fiveHourDisplay} (${fiveHourReset} / 5h)`
        : `${quotaBar(fiveHour ?? 0, 10, colors)} ${fiveHourDisplay}`)
    : (fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`);

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  const syncingSuffix = usageData.apiError === 'rate-limited'
    ? ` ${dim('(syncing...)')}`
    : '';
  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayDisplay = formatUsagePercent(sevenDay, colors);
    const sevenDayReset = formatResetTime(usageData.sevenDayResetAt);
    const sevenDayPart = usageBarEnabled
      ? (sevenDayReset
          ? `${quotaBar(sevenDay, 10, colors)} ${sevenDayDisplay} (${sevenDayReset} / 7d)`
          : `${quotaBar(sevenDay, 10, colors)} ${sevenDayDisplay}`)
      : (sevenDayReset
          ? `7d: ${sevenDayDisplay} (${sevenDayReset})`
          : `7d: ${sevenDayDisplay}`);
    return `${label} ${fiveHourPart} | ${sevenDayPart}${syncingSuffix}`;
  }

  return `${label} ${fiveHourPart}${syncingSuffix}`;
}

function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) {
    return dim('--');
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

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
