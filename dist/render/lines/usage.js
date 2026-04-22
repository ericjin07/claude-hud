import { isLimitReached } from '../../types.js';
import { isMiniMaxUsageData } from '../../minimax-types.js';
import { getProviderLabel } from '../../stdin.js';
import { critical, warning, label, getQuotaColor, quotaBar, RESET } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { t } from '../../i18n/index.js';
import { progressLabel } from './label-align.js';
import { formatResetTime } from '../format-reset-time.js';
export function renderUsageLine(ctx, alignLabels = false) {
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
    const timeFormat = display?.timeFormat ?? 'relative';
    const showResetLabel = display?.showResetLabel ?? true;
    const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
    const usageCompact = display?.usageCompact ?? false;
    if (ctx.usageData.apiUnavailable && isMiniMaxUsageData(ctx.usageData)) {
        const errorHint = formatUsageError(ctx.usageData.apiError);
        return `${usageLabel} ${warning(`⚠${errorHint}`, colors)}`;
    }
    if (isLimitReached(ctx.usageData)) {
        const resetTime = isMiniMaxUsageData(ctx.usageData)
            ? formatResetTime(ctx.usageData.resetAt, timeFormat)
            : ctx.usageData.fiveHour === 100
                ? formatResetTime(ctx.usageData.fiveHourResetAt, timeFormat)
                : formatResetTime(ctx.usageData.sevenDayResetAt, timeFormat);
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
    if (isMiniMaxUsageData(ctx.usageData)) {
        const usedPercent = Math.max(0, 100 - ctx.usageData.utilization);
        if (usedPercent < threshold) {
            return null;
        }
        if (usageCompact) {
            return formatCompactWindowPart('5h', usedPercent, ctx.usageData.resetAt, timeFormat, colors);
        }
        const usageBarEnabled = display?.usageBarEnabled ?? true;
        const barWidth = getAdaptiveBarWidth();
        const minimaxPart = formatUsageWindowPart({
            label: '5h',
            percent: usedPercent,
            resetAt: ctx.usageData.resetAt,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
        });
        return `${usageLabel} ${minimaxPart}`;
    }
    const fiveHour = ctx.usageData.fiveHour;
    const sevenDay = ctx.usageData.sevenDay;
    const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
    if (effectiveUsage < threshold) {
        return null;
    }
    const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
    if (usageCompact) {
        const fiveHourPart = fiveHour !== null
            ? formatCompactWindowPart('5h', fiveHour, ctx.usageData.fiveHourResetAt, timeFormat, colors)
            : null;
        const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
            ? formatCompactWindowPart('7d', sevenDay, ctx.usageData.sevenDayResetAt, timeFormat, colors)
            : null;
        if (fiveHourPart && sevenDayPart) {
            return `${fiveHourPart} | ${sevenDayPart}`;
        }
        return fiveHourPart ?? sevenDayPart ?? null;
    }
    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const barWidth = getAdaptiveBarWidth();
    const syncingSuffix = ctx.usageData.apiError === 'rate-limited'
        ? ` ${label('(syncing...)', colors)}`
        : '';
    if (fiveHour === null && sevenDay !== null) {
        const weeklyOnlyPart = formatUsageWindowPart({
            label: t('label.weekly'),
            labelKey: 'label.weekly',
            percent: sevenDay,
            resetAt: ctx.usageData.sevenDayResetAt,
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
        resetAt: ctx.usageData.fiveHourResetAt,
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
            resetAt: ctx.usageData.sevenDayResetAt,
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
function formatCompactWindowPart(windowLabel, percent, resetAt, timeFormat, colors) {
    const usageDisplay = formatUsagePercent(percent, colors);
    const reset = formatResetTime(resetAt, timeFormat);
    const styledLabel = label(`${windowLabel}:`, colors);
    return reset
        ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
        : `${styledLabel} ${usageDisplay}`;
}
function formatUsagePercent(percent, colors) {
    if (percent === null) {
        return label('--', colors);
    }
    const color = getQuotaColor(percent, colors);
    return `${color}${percent}%${RESET}`;
}
function formatUsageError(error) {
    if (!error)
        return '';
    if (error === 'rate-limited')
        return ' (syncing...)';
    if (error.startsWith('http-'))
        return ` (${error.slice(5)})`;
    return ` (${error})`;
}
function formatUsageWindowPart({ label: windowLabel, labelKey, percent, resetAt, colors, usageBarEnabled, barWidth, timeFormat = 'relative', showResetLabel, forceLabel = false, alignLabels = false, }) {
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
//# sourceMappingURL=usage.js.map