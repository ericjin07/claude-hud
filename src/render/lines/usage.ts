import type { RenderContext, NormalizedUsageData, UsageWindow } from '../../types.js';
import { isLimitReached } from '../../types.js';
import type { MessageKey } from '../../i18n/types.js';
import { getProviderLabel } from '../../stdin.js';
import { critical, warning, label, getQuotaColor, quotaBar, RESET } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { t } from '../../i18n/index.js';
import { progressLabel } from './label-align.js';
import type { TimeFormatMode } from '../../config.js';
import { formatResetTime } from '../format-reset-time.js';

export function renderUsageLine(
  ctx: RenderContext,
  alignLabels = false,
): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  const usageLabel = progressLabel('label.usage', colors, alignLabels);
  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const showResetLabel = display?.showResetLabel ?? true;
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
  const usageCompact = display?.usageCompact ?? false;
  const normalizedUsage: NormalizedUsageData = ctx.usageData;
  const fiveHourWindow = normalizedUsage.windows.find((window) => window.key === '5h') ?? null;
  const sevenDayWindow = normalizedUsage.windows.find((window) => window.key === '7d') ?? null;
  const primaryWindow = normalizedUsage.windows[0] ?? null;
  const hasSingleWindow = normalizedUsage.windows.length === 1;

  if (normalizedUsage.apiUnavailable) {
    const errorHint = formatUsageError(normalizedUsage.apiError);
    return `${usageLabel} ${warning(`⚠${errorHint}`, colors)}`;
  }

  if (isLimitReached(normalizedUsage)) {
    const limitWindow = normalizedUsage.windows.find((window) => window.usedPercent === 100) ?? primaryWindow;
    const resetTime = formatResetTime(limitWindow?.resetAt ?? null, timeFormat);

    if (usageCompact) {
      return critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`, colors);
    }

    const resetSuffix = resetTime
      ? showResetLabel
        ? ` (${t(resetsKey)} ${resetTime})`
        : ` (${resetTime})`
      : '';
    return `${usageLabel} ${critical(`⚠ ${t('status.limitReached')}${resetSuffix}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;

  // Single-window providers (e.g. MiniMax, GLM, or any custom http-json with one window)
  if (hasSingleWindow) {
    // Balance window — render as text (e.g. "¥9.18")
    if (primaryWindow?.balance != null) {
      const balancePart = formatBalancePart(primaryWindow, colors);
      return `${usageLabel} ${balancePart}`;
    }

    const usedPercent = primaryWindow?.usedPercent ?? null;
    const resetAt = primaryWindow?.resetAt ?? null;
    if (usedPercent === null || usedPercent < threshold) {
      return null;
    }

    if (usageCompact) {
      return formatCompactWindowPart(primaryWindow!.label, usedPercent, resetAt, timeFormat, colors);
    }

    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const barWidth = getAdaptiveBarWidth();
    const windowPart = formatUsageWindowPart({
      label: primaryWindow!.label,
      percent: usedPercent,
      resetAt,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
    });
    return `${usageLabel} ${windowPart}`;
  }

  // Multi-window providers (e.g. Claude with 5h + 7d)
  const fiveHour = fiveHourWindow?.usedPercent ?? null;
  const sevenDay = sevenDayWindow?.usedPercent ?? null;
  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;

  if (usageCompact) {
    const fiveHourPart = fiveHour !== null
      ? formatCompactWindowPart('5h', fiveHour, fiveHourWindow?.resetAt ?? null, timeFormat, colors)
      : null;
    const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
      ? formatCompactWindowPart('7d', sevenDay, sevenDayWindow?.resetAt ?? null, timeFormat, colors)
      : null;

    if (fiveHourPart && sevenDayPart) {
      return `${fiveHourPart} | ${sevenDayPart}`;
    }
    return fiveHourPart ?? sevenDayPart ?? null;
  }

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const barWidth = getAdaptiveBarWidth();
  const syncingSuffix = normalizedUsage.apiError === 'rate-limited'
    ? ` ${label('(syncing...)', colors)}`
    : '';

  if (fiveHour === null && sevenDay !== null) {
    const weeklyOnlyPart = formatUsageWindowPart({
      label: t('label.weekly'),
      labelKey: 'label.weekly',
      percent: sevenDay,
      resetAt: sevenDayWindow?.resetAt ?? null,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
      forceLabel: true,
      alignLabels,
    });
    return `${usageLabel} ${weeklyOnlyPart}${syncingSuffix}`;
  }

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

  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayPart = formatUsageWindowPart({
      label: t('label.weekly'),
      labelKey: 'label.weekly',
      percent: sevenDay,
      resetAt: sevenDayWindow?.resetAt ?? null,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
      forceLabel: true,
      alignLabels,
    });
    return `${usageLabel} ${fiveHourPart} | ${sevenDayPart}${syncingSuffix}`;
  }

  return `${usageLabel} ${fiveHourPart}${syncingSuffix}`;
}

function formatBalancePart(
  window: UsageWindow,
  colors?: RenderContext['config']['colors'],
): string {
  const unit = window.balanceUnit ?? '';
  const value = window.balance ?? 0;
  return label(`${window.label}: ${unit}${value}`, colors);
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

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext['config']['colors'],
): string {
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
  labelKey,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat = 'relative',
  showResetLabel,
  forceLabel = false,
  alignLabels = false,
}: {
  label: string;
  labelKey?: MessageKey;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext['config']['colors'];
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat?: TimeFormatMode;
  showResetLabel: boolean;
  forceLabel?: boolean;
  alignLabels?: boolean;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = labelKey
    ? progressLabel(labelKey, colors, alignLabels)
    : label(windowLabel, colors);
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';

  const resetSuffix = reset
    ? showResetLabel
      ? `(${t(resetsKey)} ${reset})`
      : `(${reset})`
    : '';

  if (usageBarEnabled) {
    const body = resetSuffix
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} ${resetSuffix}`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  return resetSuffix
    ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
    : `${styledLabel} ${usageDisplay}`;
}
