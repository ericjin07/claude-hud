import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
export const DEFAULT_ELEMENT_ORDER = [
    'project',
    'context',
    'usage',
    'promptCache',
    'memory',
    'environment',
    'tools',
    'agents',
    'todos',
];
export const DEFAULT_MERGE_GROUPS = [
    ['context', 'usage'],
];
const KNOWN_ELEMENTS = new Set(DEFAULT_ELEMENT_ORDER);
export const DEFAULT_PROVIDER_DEFINITIONS = [
    {
        id: 'minimax',
        label: 'MiniMax',
        enabled: true,
        modelMatchers: ['minimax'],
        usageSource: { kind: 'minimax' },
    },
    {
        id: 'claude',
        label: 'Claude',
        enabled: true,
        modelMatchers: [],
        usageSource: { kind: 'stdin' },
    },
    {
        id: 'external-fallback',
        label: 'External Fallback',
        enabled: true,
        modelMatchers: [],
        usageSource: { kind: 'external-file' },
    },
];
function cloneProviderDefinition(provider) {
    return {
        id: provider.id,
        label: provider.label,
        enabled: provider.enabled,
        modelMatchers: [...provider.modelMatchers],
        usageSource: {
            kind: provider.usageSource.kind,
            ...(provider.usageSource.endpoint ? { endpoint: provider.usageSource.endpoint } : {}),
            ...(provider.usageSource.path ? { path: provider.usageSource.path } : {}),
            ...(provider.usageSource.auth
                ? {
                    auth: {
                        type: provider.usageSource.auth.type,
                        ...(typeof provider.usageSource.auth.envName === 'string' && provider.usageSource.auth.envName.trim().length > 0
                            ? { envName: provider.usageSource.auth.envName.trim() }
                            : {}),
                        ...(typeof provider.usageSource.auth.headerName === 'string' && provider.usageSource.auth.headerName.trim().length > 0
                            ? { headerName: provider.usageSource.auth.headerName.trim() }
                            : {}),
                    },
                }
                : {}),
            ...(provider.usageSource.responseMapping
                ? {
                    responseMapping: {
                        ...(provider.usageSource.responseMapping.planNamePath
                            ? { planNamePath: provider.usageSource.responseMapping.planNamePath }
                            : {}),
                        ...(provider.usageSource.responseMapping.windows
                            ? {
                                windows: provider.usageSource.responseMapping.windows.map((window) => ({
                                    ...window,
                                })),
                            }
                            : {}),
                    },
                }
                : {}),
        },
    };
}
export const DEFAULT_CONFIG = {
    language: 'en',
    lineLayout: 'expanded',
    showSeparators: false,
    pathLevels: 1,
    maxWidth: null,
    elementOrder: [...DEFAULT_ELEMENT_ORDER],
    gitStatus: {
        enabled: true,
        showDirty: true,
        showAheadBehind: false,
        showFileStats: false,
        branchOverflow: 'truncate',
        pushWarningThreshold: 0,
        pushCriticalThreshold: 0,
    },
    display: {
        showModel: true,
        showProject: true,
        showContextBar: true,
        contextValue: 'percent',
        showConfigCounts: false,
        showCost: false,
        showDuration: false,
        showSpeed: false,
        showTokenBreakdown: true,
        showUsage: true,
        usageBarEnabled: true,
        showResetLabel: true,
        usageCompact: false,
        showTools: false,
        showAgents: false,
        showTodos: false,
        showSessionName: false,
        showClaudeCodeVersion: false,
        showEffortLevel: false,
        showMemoryUsage: false,
        showPromptCache: false,
        promptCacheTtlSeconds: 300,
        showSessionTokens: false,
        showOutputStyle: false,
        mergeGroups: DEFAULT_MERGE_GROUPS.map(group => [...group]),
        autocompactBuffer: 'enabled',
        usageThreshold: 0,
        sevenDayThreshold: 80,
        environmentThreshold: 0,
        externalUsagePath: '',
        externalUsageFreshnessMs: 300000,
        modelFormat: 'full',
        modelOverride: '',
        customLine: '',
        timeFormat: 'relative',
    },
    usage: {
        cacheTtlSeconds: 60,
        failureCacheTtlSeconds: 15,
        providerDefinitions: DEFAULT_PROVIDER_DEFINITIONS.map(cloneProviderDefinition),
    },
    colors: {
        context: 'green',
        usage: 'brightBlue',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
        model: 'cyan',
        project: 'yellow',
        git: 'magenta',
        gitBranch: 'cyan',
        label: 'dim',
        custom: 208,
    },
};
export function getConfigPath() {
    const homeDir = os.homedir();
    return path.join(getHudPluginDir(homeDir), 'config.json');
}
function validatePathLevels(value) {
    return value === 1 || value === 2 || value === 3;
}
function validateLineLayout(value) {
    return value === 'compact' || value === 'expanded';
}
function validateAutocompactBuffer(value) {
    return value === 'enabled' || value === 'disabled';
}
function validateGitBranchOverflow(value) {
    return value === 'truncate' || value === 'wrap';
}
function validateContextValue(value) {
    return value === 'percent' || value === 'tokens' || value === 'remaining' || value === 'both';
}
function validateLanguage(value) {
    return value === 'en' || value === 'zh';
}
function validateModelFormat(value) {
    return value === 'full' || value === 'compact' || value === 'short';
}
function validateTimeFormat(value) {
    return value === 'relative' || value === 'absolute' || value === 'both';
}
function validateColorName(value) {
    return value === 'dim'
        || value === 'red'
        || value === 'green'
        || value === 'yellow'
        || value === 'magenta'
        || value === 'cyan'
        || value === 'brightBlue'
        || value === 'brightMagenta';
}
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function validateColorValue(value) {
    if (validateColorName(value))
        return true;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255)
        return true;
    if (typeof value === 'string' && HEX_COLOR_PATTERN.test(value))
        return true;
    return false;
}
function validateElementOrder(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return [...DEFAULT_ELEMENT_ORDER];
    }
    const seen = new Set();
    const elementOrder = [];
    for (const item of value) {
        if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item)) {
            continue;
        }
        const element = item;
        if (seen.has(element)) {
            continue;
        }
        seen.add(element);
        elementOrder.push(element);
    }
    return elementOrder.length > 0 ? elementOrder : [...DEFAULT_ELEMENT_ORDER];
}
function validateMergeGroups(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_MERGE_GROUPS.map(group => [...group]);
    }
    if (value.length === 0) {
        return [];
    }
    const usedElements = new Set();
    const mergeGroups = [];
    for (const group of value) {
        if (!Array.isArray(group)) {
            continue;
        }
        const seenInGroup = new Set();
        const normalizedGroup = [];
        const pendingElements = [];
        for (const item of group) {
            if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item)) {
                continue;
            }
            const element = item;
            if (seenInGroup.has(element) || usedElements.has(element)) {
                continue;
            }
            seenInGroup.add(element);
            normalizedGroup.push(element);
            pendingElements.push(element);
        }
        if (normalizedGroup.length >= 2) {
            for (const element of pendingElements) {
                usedElements.add(element);
            }
            mergeGroups.push(normalizedGroup);
        }
    }
    return mergeGroups.length > 0
        ? mergeGroups
        : DEFAULT_MERGE_GROUPS.map(group => [...group]);
}
function migrateConfig(userConfig) {
    const migrated = { ...userConfig };
    if ('layout' in userConfig && !('lineLayout' in userConfig)) {
        if (typeof userConfig.layout === 'string') {
            // Legacy string migration (v0.0.x → v0.1.x)
            if (userConfig.layout === 'separators') {
                migrated.lineLayout = 'compact';
                migrated.showSeparators = true;
            }
            else {
                migrated.lineLayout = 'compact';
                migrated.showSeparators = false;
            }
        }
        else if (typeof userConfig.layout === 'object' && userConfig.layout !== null) {
            // Object layout written by third-party tools — extract nested fields
            const obj = userConfig.layout;
            if (typeof obj.lineLayout === 'string')
                migrated.lineLayout = obj.lineLayout;
            if (typeof obj.showSeparators === 'boolean')
                migrated.showSeparators = obj.showSeparators;
            if (typeof obj.pathLevels === 'number')
                migrated.pathLevels = obj.pathLevels;
        }
        delete migrated.layout;
    }
    return migrated;
}
function validateThreshold(value, max = 100) {
    if (typeof value !== 'number')
        return 0;
    return Math.max(0, Math.min(max, value));
}
function validateCountThreshold(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.floor(value));
}
function validateDurationSeconds(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
}
function validateOptionalPath(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function validateFreshnessMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_CONFIG.display.externalUsageFreshnessMs;
    }
    return Math.max(0, Math.floor(value));
}
function validateProviderKind(value) {
    return value === 'minimax'
        || value === 'stdin'
        || value === 'external-file'
        || value === 'http-json'
        || value === 'anthropic-oauth';
}
function validateProviderAuthType(value) {
    return value === 'none' || value === 'bearer-env' || value === 'header-env';
}
function normalizeProviderWindows(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return undefined;
    }
    const windows = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const windowMapping = entry;
        const key = typeof windowMapping.key === 'string'
            ? windowMapping.key.trim()
            : '';
        const label = typeof windowMapping.label === 'string'
            ? windowMapping.label.trim()
            : '';
        if (!key || !label) {
            continue;
        }
        windows.push({
            key,
            label,
            ...(typeof windowMapping.usedPercentPath === 'string' && windowMapping.usedPercentPath.trim().length > 0
                ? { usedPercentPath: windowMapping.usedPercentPath.trim() }
                : {}),
            ...(typeof windowMapping.remainingPercentPath === 'string' && windowMapping.remainingPercentPath.trim().length > 0
                ? { remainingPercentPath: windowMapping.remainingPercentPath.trim() }
                : {}),
            ...(typeof windowMapping.resetAtPath === 'string' && windowMapping.resetAtPath.trim().length > 0
                ? { resetAtPath: windowMapping.resetAtPath.trim() }
                : {}),
        });
    }
    return windows.length > 0 ? windows : undefined;
}
function isSemanticallyValidProviderDefinition(provider) {
    switch (provider.usageSource.kind) {
        case 'http-json': {
            if (!provider.usageSource.endpoint || !provider.usageSource.responseMapping?.windows?.length) {
                return false;
            }
            const windows = provider.usageSource.responseMapping.windows;
            if (!windows.every((window) => Boolean(window.usedPercentPath || window.remainingPercentPath))) {
                return false;
            }
            const auth = provider.usageSource.auth;
            if (!auth || auth.type === 'none') {
                return true;
            }
            if (!auth.envName) {
                return false;
            }
            return auth.type !== 'header-env' || Boolean(auth.headerName);
        }
        default:
            return true;
    }
}
function normalizeProviderDefinitions(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return DEFAULT_PROVIDER_DEFINITIONS.map(cloneProviderDefinition);
    }
    const providers = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const raw = entry;
        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        const label = typeof raw.label === 'string' ? raw.label.trim() : id;
        const kind = raw.usageSource?.kind;
        if (!id || !label || !validateProviderKind(kind)) {
            continue;
        }
        const modelMatchers = Array.isArray(raw.modelMatchers)
            ? raw.modelMatchers.filter((matcher) => typeof matcher === 'string' && matcher.trim().length > 0)
                .map((matcher) => matcher.trim())
            : [];
        if (raw.usageSource?.auth && !validateProviderAuthType(raw.usageSource.auth.type)) {
            continue;
        }
        const auth = raw.usageSource?.auth && validateProviderAuthType(raw.usageSource.auth.type)
            ? {
                type: raw.usageSource.auth.type,
                ...(typeof raw.usageSource.auth.envName === 'string' && raw.usageSource.auth.envName.trim().length > 0
                    ? { envName: raw.usageSource.auth.envName.trim() }
                    : {}),
                ...(typeof raw.usageSource.auth.headerName === 'string' && raw.usageSource.auth.headerName.trim().length > 0
                    ? { headerName: raw.usageSource.auth.headerName.trim() }
                    : {}),
            }
            : undefined;
        const provider = {
            id,
            label,
            enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
            modelMatchers,
            usageSource: {
                kind,
                ...(typeof raw.usageSource?.endpoint === 'string' && raw.usageSource.endpoint.trim().length > 0
                    ? { endpoint: raw.usageSource.endpoint.trim() }
                    : {}),
                ...(typeof raw.usageSource?.path === 'string' && raw.usageSource.path.trim().length > 0
                    ? { path: raw.usageSource.path.trim() }
                    : {}),
                ...(auth ? { auth } : {}),
                ...(raw.usageSource?.responseMapping
                    ? {
                        responseMapping: {
                            ...(typeof raw.usageSource.responseMapping.planNamePath === 'string'
                                && raw.usageSource.responseMapping.planNamePath.trim().length > 0
                                ? { planNamePath: raw.usageSource.responseMapping.planNamePath.trim() }
                                : {}),
                            ...(normalizeProviderWindows(raw.usageSource.responseMapping.windows)
                                ? { windows: normalizeProviderWindows(raw.usageSource.responseMapping.windows) }
                                : {}),
                        },
                    }
                    : {}),
            },
        };
        if (isSemanticallyValidProviderDefinition(provider)) {
            providers.push(provider);
        }
    }
    return providers.length > 0
        ? providers
        : DEFAULT_PROVIDER_DEFINITIONS.map(cloneProviderDefinition);
}
export function mergeConfig(userConfig) {
    const migrated = migrateConfig(userConfig);
    const language = validateLanguage(migrated.language)
        ? migrated.language
        : DEFAULT_CONFIG.language;
    const lineLayout = validateLineLayout(migrated.lineLayout)
        ? migrated.lineLayout
        : DEFAULT_CONFIG.lineLayout;
    const showSeparators = typeof migrated.showSeparators === 'boolean'
        ? migrated.showSeparators
        : DEFAULT_CONFIG.showSeparators;
    const pathLevels = validatePathLevels(migrated.pathLevels)
        ? migrated.pathLevels
        : DEFAULT_CONFIG.pathLevels;
    const rawMaxWidth = migrated.maxWidth;
    const maxWidth = (typeof rawMaxWidth === 'number' && Number.isFinite(rawMaxWidth) && rawMaxWidth > 0)
        ? Math.floor(rawMaxWidth)
        : null;
    const elementOrder = validateElementOrder(migrated.elementOrder);
    const gitStatus = {
        enabled: typeof migrated.gitStatus?.enabled === 'boolean'
            ? migrated.gitStatus.enabled
            : DEFAULT_CONFIG.gitStatus.enabled,
        showDirty: typeof migrated.gitStatus?.showDirty === 'boolean'
            ? migrated.gitStatus.showDirty
            : DEFAULT_CONFIG.gitStatus.showDirty,
        showAheadBehind: typeof migrated.gitStatus?.showAheadBehind === 'boolean'
            ? migrated.gitStatus.showAheadBehind
            : DEFAULT_CONFIG.gitStatus.showAheadBehind,
        showFileStats: typeof migrated.gitStatus?.showFileStats === 'boolean'
            ? migrated.gitStatus.showFileStats
            : DEFAULT_CONFIG.gitStatus.showFileStats,
        branchOverflow: validateGitBranchOverflow(migrated.gitStatus?.branchOverflow)
            ? migrated.gitStatus.branchOverflow
            : DEFAULT_CONFIG.gitStatus.branchOverflow,
        pushWarningThreshold: validateCountThreshold(migrated.gitStatus?.pushWarningThreshold),
        pushCriticalThreshold: validateCountThreshold(migrated.gitStatus?.pushCriticalThreshold),
    };
    const display = {
        showModel: typeof migrated.display?.showModel === 'boolean'
            ? migrated.display.showModel
            : DEFAULT_CONFIG.display.showModel,
        showProject: typeof migrated.display?.showProject === 'boolean'
            ? migrated.display.showProject
            : DEFAULT_CONFIG.display.showProject,
        showContextBar: typeof migrated.display?.showContextBar === 'boolean'
            ? migrated.display.showContextBar
            : DEFAULT_CONFIG.display.showContextBar,
        contextValue: validateContextValue(migrated.display?.contextValue)
            ? migrated.display.contextValue
            : DEFAULT_CONFIG.display.contextValue,
        showConfigCounts: typeof migrated.display?.showConfigCounts === 'boolean'
            ? migrated.display.showConfigCounts
            : DEFAULT_CONFIG.display.showConfigCounts,
        showCost: typeof migrated.display?.showCost === 'boolean'
            ? migrated.display.showCost
            : DEFAULT_CONFIG.display.showCost,
        showDuration: typeof migrated.display?.showDuration === 'boolean'
            ? migrated.display.showDuration
            : DEFAULT_CONFIG.display.showDuration,
        showSpeed: typeof migrated.display?.showSpeed === 'boolean'
            ? migrated.display.showSpeed
            : DEFAULT_CONFIG.display.showSpeed,
        showTokenBreakdown: typeof migrated.display?.showTokenBreakdown === 'boolean'
            ? migrated.display.showTokenBreakdown
            : DEFAULT_CONFIG.display.showTokenBreakdown,
        showUsage: typeof migrated.display?.showUsage === 'boolean'
            ? migrated.display.showUsage
            : DEFAULT_CONFIG.display.showUsage,
        usageBarEnabled: typeof migrated.display?.usageBarEnabled === 'boolean'
            ? migrated.display.usageBarEnabled
            : DEFAULT_CONFIG.display.usageBarEnabled,
        showResetLabel: typeof migrated.display?.showResetLabel === 'boolean'
            ? migrated.display.showResetLabel
            : DEFAULT_CONFIG.display.showResetLabel,
        usageCompact: typeof migrated.display?.usageCompact === 'boolean'
            ? migrated.display.usageCompact
            : DEFAULT_CONFIG.display.usageCompact,
        showTools: typeof migrated.display?.showTools === 'boolean'
            ? migrated.display.showTools
            : DEFAULT_CONFIG.display.showTools,
        showAgents: typeof migrated.display?.showAgents === 'boolean'
            ? migrated.display.showAgents
            : DEFAULT_CONFIG.display.showAgents,
        showTodos: typeof migrated.display?.showTodos === 'boolean'
            ? migrated.display.showTodos
            : DEFAULT_CONFIG.display.showTodos,
        showSessionName: typeof migrated.display?.showSessionName === 'boolean'
            ? migrated.display.showSessionName
            : DEFAULT_CONFIG.display.showSessionName,
        showClaudeCodeVersion: typeof migrated.display?.showClaudeCodeVersion === 'boolean'
            ? migrated.display.showClaudeCodeVersion
            : DEFAULT_CONFIG.display.showClaudeCodeVersion,
        showEffortLevel: typeof migrated.display?.showEffortLevel === 'boolean'
            ? migrated.display.showEffortLevel
            : DEFAULT_CONFIG.display.showEffortLevel,
        showMemoryUsage: typeof migrated.display?.showMemoryUsage === 'boolean'
            ? migrated.display.showMemoryUsage
            : DEFAULT_CONFIG.display.showMemoryUsage,
        showPromptCache: typeof migrated.display?.showPromptCache === 'boolean'
            ? migrated.display.showPromptCache
            : DEFAULT_CONFIG.display.showPromptCache,
        promptCacheTtlSeconds: validateDurationSeconds(migrated.display?.promptCacheTtlSeconds, DEFAULT_CONFIG.display.promptCacheTtlSeconds),
        showSessionTokens: typeof migrated.display?.showSessionTokens === 'boolean'
            ? migrated.display.showSessionTokens
            : DEFAULT_CONFIG.display.showSessionTokens,
        showOutputStyle: typeof migrated.display?.showOutputStyle === 'boolean'
            ? migrated.display.showOutputStyle
            : DEFAULT_CONFIG.display.showOutputStyle,
        mergeGroups: validateMergeGroups(migrated.display?.mergeGroups),
        autocompactBuffer: validateAutocompactBuffer(migrated.display?.autocompactBuffer)
            ? migrated.display.autocompactBuffer
            : DEFAULT_CONFIG.display.autocompactBuffer,
        usageThreshold: validateThreshold(migrated.display?.usageThreshold, 100),
        sevenDayThreshold: validateThreshold(migrated.display?.sevenDayThreshold, 100),
        environmentThreshold: validateThreshold(migrated.display?.environmentThreshold, 100),
        externalUsagePath: validateOptionalPath(migrated.display?.externalUsagePath),
        externalUsageFreshnessMs: validateFreshnessMs(migrated.display?.externalUsageFreshnessMs),
        modelFormat: validateModelFormat(migrated.display?.modelFormat)
            ? migrated.display.modelFormat
            : DEFAULT_CONFIG.display.modelFormat,
        modelOverride: typeof migrated.display?.modelOverride === 'string'
            ? migrated.display.modelOverride.slice(0, 80)
            : DEFAULT_CONFIG.display.modelOverride,
        customLine: typeof migrated.display?.customLine === 'string'
            ? migrated.display.customLine.slice(0, 80)
            : DEFAULT_CONFIG.display.customLine,
        timeFormat: validateTimeFormat(migrated.display?.timeFormat)
            ? migrated.display.timeFormat
            : DEFAULT_CONFIG.display.timeFormat,
    };
    const colors = {
        context: validateColorValue(migrated.colors?.context)
            ? migrated.colors.context
            : DEFAULT_CONFIG.colors.context,
        usage: validateColorValue(migrated.colors?.usage)
            ? migrated.colors.usage
            : DEFAULT_CONFIG.colors.usage,
        warning: validateColorValue(migrated.colors?.warning)
            ? migrated.colors.warning
            : DEFAULT_CONFIG.colors.warning,
        usageWarning: validateColorValue(migrated.colors?.usageWarning)
            ? migrated.colors.usageWarning
            : DEFAULT_CONFIG.colors.usageWarning,
        critical: validateColorValue(migrated.colors?.critical)
            ? migrated.colors.critical
            : DEFAULT_CONFIG.colors.critical,
        model: validateColorValue(migrated.colors?.model)
            ? migrated.colors.model
            : DEFAULT_CONFIG.colors.model,
        project: validateColorValue(migrated.colors?.project)
            ? migrated.colors.project
            : DEFAULT_CONFIG.colors.project,
        git: validateColorValue(migrated.colors?.git)
            ? migrated.colors.git
            : DEFAULT_CONFIG.colors.git,
        gitBranch: validateColorValue(migrated.colors?.gitBranch)
            ? migrated.colors.gitBranch
            : DEFAULT_CONFIG.colors.gitBranch,
        label: validateColorValue(migrated.colors?.label)
            ? migrated.colors.label
            : DEFAULT_CONFIG.colors.label,
        custom: validateColorValue(migrated.colors?.custom)
            ? migrated.colors.custom
            : DEFAULT_CONFIG.colors.custom,
    };
    const usage = {
        cacheTtlSeconds: validateDurationSeconds(migrated.usage?.cacheTtlSeconds, DEFAULT_CONFIG.usage.cacheTtlSeconds),
        failureCacheTtlSeconds: validateDurationSeconds(migrated.usage?.failureCacheTtlSeconds, DEFAULT_CONFIG.usage.failureCacheTtlSeconds),
        providerDefinitions: normalizeProviderDefinitions(migrated.usage?.providerDefinitions),
    };
    return { language, lineLayout, showSeparators, pathLevels, maxWidth, elementOrder, gitStatus, display, usage, colors };
}
export async function loadConfig() {
    const configPath = getConfigPath();
    try {
        if (!fs.existsSync(configPath)) {
            return mergeConfig({});
        }
        const content = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(content);
        return mergeConfig(userConfig);
    }
    catch {
        return mergeConfig({});
    }
}
//# sourceMappingURL=config.js.map