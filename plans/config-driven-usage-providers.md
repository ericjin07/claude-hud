# Config-Driven Usage Providers Plan

## Objective

将当前硬编码的 MiniMax 和 Claude usage 分支，重构为“provider 探测 + usage source adapter + 归一化渲染”的配置驱动体系。

目标是让后续新增 provider 时，优先通过配置完成接入，而不是每次都新增一套像 MiniMax 一样的特化代码。

## Desired Outcome

1. `.claude/settings.json` 只负责暴露当前激活模型和环境变量，不承担完整 provider 注册表职责。
2. HUD 自己的 `config.json` 承载 `providerDefinitions`，定义 provider 匹配规则、usage source、认证来源、响应映射和窗口计算。
3. 运行时先统一解析当前 provider，再把不同来源的 usage 数据归一化成单一 render contract。
4. render 层不再感知 `MiniMaxUsageData` 或其他 provider-specific 类型。
5. 后续新增常见 HTTP/JSON provider 时，优先走“加配置 + 少量 adapter”模式。

## Non-Goals For Phase 1

1. 不在第一阶段处理 provider-specific cost 估算。
2. 不在第一阶段统一 provider-specific context window 语义。
3. 不支持在配置中执行任意 JavaScript 公式。
4. 不在第一阶段重做所有 provider label/cost 逻辑，只聚焦 model/usage provider 化。

## Current Problems

1. [src/index.ts](/home/ericjin/Projects/claude-hud/src/index.ts) 里把 MiniMax、stdin usage、external snapshot 的优先级写死了，新增 provider 需要继续改入口分支。
2. [src/minimax-usage.ts](/home/ericjin/Projects/claude-hud/src/minimax-usage.ts) 自己读取 `.claude/settings.json` 中的 `ANTHROPIC_MODEL`，导致 provider 发现逻辑分散。
3. [src/types.ts](/home/ericjin/Projects/claude-hud/src/types.ts) 当前把 `UsageData | MiniMaxUsageData` 暴露给 render，provider-specific 类型泄漏到了 UI 层。
4. [src/render/lines/usage.ts](/home/ericjin/Projects/claude-hud/src/render/lines/usage.ts) 和 [src/render/session-line.ts](/home/ericjin/Projects/claude-hud/src/render/session-line.ts) 都有 MiniMax 分支，后续每加一个 provider 都会继续扩散。
5. [src/usage-api.ts](/home/ericjin/Projects/claude-hud/src/usage-api.ts)、[src/external-usage.ts](/home/ericjin/Projects/claude-hud/src/external-usage.ts)、[src/minimax-usage.ts](/home/ericjin/Projects/claude-hud/src/minimax-usage.ts) 本质上都是 usage source，但目前不是统一 adapter 模型。

## Proposed Architecture

### 1. Provider Resolver

新增统一 resolver，负责：

1. 收集 provider 识别信号：stdin model、`.claude/settings.json`、必要环境变量。
2. 对照 `providerDefinitions` 选择当前激活 provider。
3. 决定使用哪种 usage source adapter。

建议新增目录：`src/providers/`

建议首批模块：

1. `src/providers/types.ts`
2. `src/providers/resolve-provider.ts`
3. `src/providers/settings-reader.ts`
4. `src/providers/normalize-usage.ts`

### 2. Normalized Usage Contract

在 [src/types.ts](/home/ericjin/Projects/claude-hud/src/types.ts) 定义统一 usage 结构，替换当前 render 面向 union 类型的方式。

建议结构：

```ts
export interface UsageWindow {
  key: string;
  label: string;
  usedPercent: number | null;
  resetAt: Date | null;
  apiUnavailable?: boolean;
  apiError?: string;
}

export interface NormalizedUsageData {
  providerId: string;
  providerLabel: string;
  planName: string | null;
  windows: UsageWindow[];
}
```

这样 render 只关心 windows，不再关心“这是 MiniMax 还是 Claude 原生”。

### 3. Config-Driven Provider Registry

在 [src/config.ts](/home/ericjin/Projects/claude-hud/src/config.ts) 中扩展 `HudConfig`，新增 `providerDefinitions`。

建议字段：

```ts
providerDefinitions: Array<{
  id: string;
  label: string;
  enabled?: boolean;
  precedence?: number;
  modelMatchers?: string[];
  usageSource: {
    kind: 'stdin' | 'anthropic-oauth' | 'http-json' | 'external-file';
    endpoint?: string;
    path?: string;
    auth?: {
      type: 'bearer-env' | 'header-env' | 'none';
      envName?: string;
      headerName?: string;
    };
    responseMapping?: {
      planNamePath?: string;
      windows?: Array<{
        key: string;
        label: string;
        usedPercentPath?: string;
        remainingPercentPath?: string;
        resetAtPath?: string;
        transform?: 'direct-used' | 'remaining-to-used';
      }>;
    };
  };
}>;
```

重点是支持声明式映射，不支持任意公式执行。

### 4. Adapter Model

将现有 usage 获取路径重构为 adapter：

1. `stdin` adapter：从 [src/stdin.ts](/home/ericjin/Projects/claude-hud/src/stdin.ts) 的 `rate_limits` 生成统一 windows。
2. `minimax` adapter：保留 [src/minimax-usage.ts](/home/ericjin/Projects/claude-hud/src/minimax-usage.ts) 中的鉴权、缓存和 API 请求逻辑，但输出统一结构。
3. `anthropic-oauth` adapter：复用 [src/usage-api.ts](/home/ericjin/Projects/claude-hud/src/usage-api.ts) 中的缓存/锁/退避逻辑。
4. `external-file` adapter：继续使用 [src/external-usage.ts](/home/ericjin/Projects/claude-hud/src/external-usage.ts) 作为外部快照兜底。
5. 后续 `http-json` adapter：支持大多数第三方 provider 通过配置直接接入。

## Implementation Phases

## Phase 1: Freeze The Contract

### Goal

先消除 render 层对 provider-specific usage type 的依赖。

### Tasks

1. 在 [src/types.ts](/home/ericjin/Projects/claude-hud/src/types.ts) 定义 `UsageWindow` 和 `NormalizedUsageData`。
2. 将 `RenderContext.usageData` 改为 `NormalizedUsageData | null`。
3. 让 `isLimitReached()` 改为只对统一 windows 做判断。

### Exit Criteria

1. render 层不再需要消费 `MiniMaxUsageData`。
2. 类型系统里不再要求 `UsageData | MiniMaxUsageData` union 暴露到 UI。

## Phase 2: Extract Usage Resolution

### Goal

把 [src/index.ts](/home/ericjin/Projects/claude-hud/src/index.ts) 中的 usage 决策抽成单独 orchestration。

### Tasks

1. 新增 `resolveUsageContext()` 或同类入口。
2. 保持当前优先级不变：MiniMax -> stdin -> external snapshot。
3. 在 resolver 中统一返回 `NormalizedUsageData | null`。

### Exit Criteria

1. `main()` 不再直接写 provider/source 分支。
2. 新 provider 后续只需要在 resolver/registry 扩展，不需要回改入口。

## Phase 3: Introduce Provider Registry

### Goal

让 provider 选择规则从硬编码转到配置。

### Tasks

1. 在 [src/config.ts](/home/ericjin/Projects/claude-hud/src/config.ts) 扩展 `providerDefinitions`。
2. 新增 settings reader，统一读取 `.claude/settings.json`。
3. 新增 provider resolver，根据 stdin 和 settings 匹配当前 provider。

### Exit Criteria

1. MiniMax 是否激活不再由 [src/minimax-usage.ts](/home/ericjin/Projects/claude-hud/src/minimax-usage.ts) 私自决定。
2. provider 识别路径只有一个统一入口。

## Phase 4: Convert Existing Sources To Adapters

### Goal

把现有 usage source 统一成 adapter 模型。

### Tasks

1. stdin rate limit 路径转成 adapter。
2. MiniMax API 路径转成 adapter。
3. Anthropic OAuth usage API 路径转成 adapter。
4. external snapshot 路径保留为 adapter。

### Exit Criteria

1. 四种来源都返回统一结构。
2. `MiniMaxUsageData` 不再直接进入 render 层。

## Phase 5: Make Render Provider-Agnostic

### Goal

移除 render 里的 MiniMax 分支。

### Tasks

1. 修改 [src/render/lines/usage.ts](/home/ericjin/Projects/claude-hud/src/render/lines/usage.ts)。
2. 修改 [src/render/session-line.ts](/home/ericjin/Projects/claude-hud/src/render/session-line.ts)。
3. 让 render 只循环 `windows` 并渲染 `usedPercent`、`resetAt`、`apiUnavailable`。

### Exit Criteria

1. render 中不存在 `isMiniMaxUsageData()` 分支。
2. 新 provider 不需要修改 render 逻辑。

## Phase 6: Enable Config-Only Providers

### Goal

让常见第三方 provider 通过配置即可接入。

### Tasks

1. 增加 `http-json` source kind。
2. 支持 response path mapping。
3. 支持少量 built-in transform：`direct-used`、`remaining-to-used`。
4. 支持通过 env header/bearer token 完成鉴权。

### Exit Criteria

1. 新 provider 在常见情况下只需增加 `providerDefinitions`。
2. 只有特殊鉴权或特殊响应结构时才需要加薄 adapter。

## Validation Plan

1. 扩展 [tests/config.test.js](/home/ericjin/Projects/claude-hud/tests/config.test.js)，验证 `providerDefinitions` schema 和 merge 行为。
2. 新增 provider resolver 测试，覆盖匹配、禁用、precedence、fallback。
3. 扩展 [tests/minimax-usage.test.js](/home/ericjin/Projects/claude-hud/tests/minimax-usage.test.js)，验证 MiniMax adapter 输出归一化结构。
4. 扩展 [tests/render.test.js](/home/ericjin/Projects/claude-hud/tests/render.test.js) 和 [tests/index.test.js](/home/ericjin/Projects/claude-hud/tests/index.test.js)，验证 render 不再依赖 provider-specific 分支。
5. 手动验证三个场景：原生 Claude、MiniMax、一个 synthetic config-only HTTP provider。

## Risks And Mitigations

1. 风险：一次性改太大，render 和 source 同时改容易回归。
   缓解：先冻结统一 contract，再逐个 source adapter 化。
2. 风险：配置 schema 设计过度灵活，后续难测且不安全。
   缓解：只支持声明式 path mapping 和少量内建 transform，不支持动态代码。
3. 风险：MiniMax 当前行为在重构后回退。
   缓解：先用 MiniMax 作为第一号 adapter 模板，并补定向测试。
4. 风险：provider label 和 usage source 仍然分散。
   缓解：第二阶段后再统一 provider identity 和 label 逻辑，但不阻塞第一阶段落地。

## Recommended PR Breakdown

1. PR 1: 定义统一 usage contract，抽出 `resolveUsageContext()`，保持现有行为。
2. PR 2: 引入 `providerDefinitions` 和 provider resolver。
3. PR 3: MiniMax/stdin/external/Anthropic usage 全部 adapter 化。
4. PR 4: render 去 provider-specific 分支并补测试。
5. PR 5: 支持 config-only `http-json` provider 并补文档。

## First Slice To Implement

如果立刻开始编码，建议先做这一刀：

1. 修改 [src/types.ts](/home/ericjin/Projects/claude-hud/src/types.ts)，引入统一 usage contract。
2. 修改 [src/index.ts](/home/ericjin/Projects/claude-hud/src/index.ts)，提取 `resolveUsageContext()`。
3. 修改 [src/minimax-usage.ts](/home/ericjin/Projects/claude-hud/src/minimax-usage.ts)，让它输出统一结构。
4. 最后再处理 [src/render/lines/usage.ts](/home/ericjin/Projects/claude-hud/src/render/lines/usage.ts) 和 [src/render/session-line.ts](/home/ericjin/Projects/claude-hud/src/render/session-line.ts)。

## Decision Summary

1. provider 注册表放 HUD `config.json`，不是 `.claude/settings.json`。
2. `.claude/settings.json` 仅作为发现当前激活模型和环境变量的输入。
3. 第一阶段只做 usage/provider 化，不扩展到完整 cost/context provider 化。
4. 配置层只支持声明式映射，不支持任意脚本公式。
5. 新 provider 的理想接入方式是“加配置优先，必要时加薄 adapter”。
