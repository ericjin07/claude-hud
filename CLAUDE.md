# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time multi-line statusline. It shows context health, tool activity, agent status, and todo progress.

## Build Commands

```bash
npm ci               # Install dependencies
npm run build        # Build TypeScript to dist/

# Test with sample stdin data
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js
```

## Architecture

### Data Flow

```
Claude Code → stdin JSON → parse → render lines → stdout → Claude Code displays
           ↘ transcript_path → parse JSONL → tools/agents/todos
```

**Key insight**: The statusline is invoked every ~300ms by Claude Code. Each invocation:
1. Receives JSON via stdin (model, context, tokens - native accurate data)
2. Parses the transcript JSONL file for tools, agents, and todos
3. Renders multi-line output to stdout
4. Claude Code displays all lines

### Data Sources

**Native from stdin JSON** (accurate, no estimation):
- `model.display_name` - Current model
- `context_window.current_usage` - Token counts
- `context_window.context_window_size` - Max context
- `transcript_path` - Path to session transcript

**From transcript JSONL parsing**:
- `tool_use` blocks → tool name, input, start time
- `tool_result` blocks → completion, duration
- Running tools = `tool_use` without matching `tool_result`
- `TodoWrite` calls → todo list
- `Task` calls → agent info

**From config files**:
- MCP count from `~/.claude/settings.json` (mcpServers)
- Hooks count from `~/.claude/settings.json` (hooks)
- Rules count from CLAUDE.md files

**From Claude Code stdin rate limits**:
- `rate_limits.five_hour.used_percentage` - 5-hour subscriber usage percentage
- `rate_limits.five_hour.resets_at` - 5-hour reset timestamp
- `rate_limits.seven_day.used_percentage` - 7-day subscriber usage percentage
- `rate_limits.seven_day.resets_at` - 7-day reset timestamp

### File Structure

```
src/
├── index.ts           # Entry point
├── stdin.ts           # Parse Claude's JSON input
├── transcript.ts      # Parse transcript JSONL
├── config-reader.ts   # Read MCP/rules configs
├── config.ts          # Load/validate user config
├── git.ts             # Git status (branch, dirty, ahead/behind)
├── types.ts           # TypeScript interfaces
└── render/
    ├── index.ts       # Main render coordinator
    ├── session-line.ts   # Compact mode: single line with all info
    ├── tools-line.ts     # Tool activity (opt-in)
    ├── agents-line.ts    # Agent status (opt-in)
    ├── todos-line.ts     # Todo progress (opt-in)
    ├── colors.ts         # ANSI color helpers
    └── lines/
        ├── index.ts      # Barrel export
        ├── project.ts    # Line 1: model bracket + project + git
        ├── identity.ts   # Line 2a: context bar
        ├── usage.ts      # Line 2b: usage bar (combined with identity)
        └── environment.ts # Config counts (opt-in)
```

### Output Format (default expanded layout)

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```

Lines 1-2 always shown. Additional lines are opt-in via config:
- Tools line (`showTools`): ◐ Edit: auth.ts | ✓ Read ×3
- Agents line (`showAgents`): ◐ explore [haiku]: Finding auth code
- Todos line (`showTodos`): ▸ Fix authentication bug (2/5)
- Environment line (`showConfigCounts`): 2 CLAUDE.md | 4 rules

### Context Thresholds

| Threshold | Color | Action |
|-----------|-------|--------|
| <70% | Green | Normal |
| 70-85% | Yellow | Warning |
| >85% | Red | Show token breakdown |

## Plugin Configuration

The plugin manifest is in `.claude-plugin/plugin.json` (metadata only - name, description, version, author).

**StatusLine configuration** must be added to the user's `~/.claude/settings.json` via `/claude-hud:setup`.

The setup command adds an auto-updating command that finds the latest installed version at runtime.

Note: `statusLine` is NOT a valid plugin.json field. It must be configured in settings.json after plugin installation. Updates are automatic - no need to re-run setup.

## Development Workflow

### Branches

- `main` - upstream jarrodwatts/claude-hud (original plugin)
- `minimax-usage` - this fork with MiniMax usage display support

### Testing Local Changes

```bash
# Build the local branch
cd /home/ericjin/Projects/claude-hud
git worktree list  # see active worktrees
cd .worktrees/minimax-usage  # or main directory for main branch
npm ci
npm run build

# Run with --plugindir to use local version
claude --plugindir /home/ericjin/Projects/claude-hud/.worktrees/minimax-usage
```

### Pushing Changes

**IMPORTANT: After ANY update to minimax-usage branch, ALWAYS merge to main:**

```bash
# 1. In minimax-usage worktree: push changes
cd .worktrees/minimax-usage
git add -A && git commit -m "your message"
git push origin minimax-usage

# 2. In main directory: merge minimax-usage and push
cd /home/ericjin/Projects/claude-hud
git fetch origin minimax-usage
git merge origin/minimax-usage --no-edit
git push origin main
```

**This ensures users get the latest changes via `/plugin update claude-hud`.**

### Installation

The plugin is installed from `ericjin07/claude-hud` fork via `/plugin install claude-hud`. It uses the `minimax-usage` branch.

### Version Update Workflow

When version number is bumped in `package.json`, update the plugin cache:

```bash
# 1. Build in marketplace (or worktree)
cd ~/.claude/plugins/marketplaces/claude-hud
git pull origin main
npm ci && npm run build

# 2. Create new version directory and copy files
VERSION=$(node -p "require('./package.json').version")
mkdir -p ~/.claude/plugins/cache/claude-hud/claude-hud/$VERSION
cp -r ~/.claude/plugins/marketplaces/claude-hud/* ~/.claude/plugins/cache/claude-hud/claude-hud/$VERSION/

# 3. Update version in cache plugin files
sed -i "s/\"version\": \"[0-9.]*\"/\"version\": \"$VERSION\"/" ~/.claude/plugins/cache/claude-hud/claude-hud/$VERSION/.claude-plugin/plugin.json
sed -i "s/\"version\": \"[0-9.]*\"/\"version\": \"$VERSION\"/" ~/.claude/plugins/cache/claude-hud/claude-hud/$VERSION/.claude-plugin/marketplace.json

# 4. Update settings.json path (if using manual path)
# Change .../0.0.X/dist/index.js to new version

# 5. Reload plugins
/reload-plugins
```

## Dependencies

- **Runtime**: Node.js 18+ or Bun
- **Build**: TypeScript 5, ES2022 target, NodeNext modules
