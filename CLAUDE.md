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

**From OAuth credentials** (`~/.claude/.credentials.json`, when `display.showUsage` enabled):
- `claudeAiOauth.accessToken` - OAuth token for API calls
- `claudeAiOauth.subscriptionType` - User's plan (Pro, Max, Team)

**From Anthropic Usage API** (`api.anthropic.com/api/oauth/usage`):
- 5-hour and 7-day usage percentages
- Reset timestamps (cached 60s success, 15s failure)

**From MiniMax Usage API** (`www.minimaxi.com/v1/api/openplatform/coding_plan/remains`):
- Detected when `ANTHROPIC_MODEL` in `settings.json` contains "minimax"
- API key from `ANTHROPIC_AUTH_TOKEN` env var
- Remaining quota percentage and reset time (cached 60s success, 15s failure)
- Falls back to Anthropic OAuth usage when not using MiniMax

### File Structure

```
src/
├── index.ts           # Entry point
├── stdin.ts           # Parse Claude's JSON input
├── transcript.ts      # Parse transcript JSONL
├── config-reader.ts   # Read MCP/rules configs
├── config.ts          # Load/validate user config
├── git.ts             # Git status (branch, dirty, ahead/behind)
├── usage-api.ts       # Fetch usage from Anthropic OAuth API
├── minimax-types.ts   # MiniMax API response types
├── minimax-usage.ts   # Fetch usage from MiniMax API
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
[Opus | Max] │ my-project git:(main*)
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

Note: `statusLine` is NOT a valid plugin.json field. It must be configured in settings.json after plugin installation.

**Updating**: Run `/plugin update claude-hud` to get the latest version. The statusLine command auto-updates at runtime, but plugin code changes require a plugin update.

## Development Workflow

### Branches

- `main` - upstream jarrodwatts/claude-hud (original plugin)
- `minimax-usage` - this fork with MiniMax usage display support

### Local Testing

```bash
# Build the local worktree
cd .worktrees/minimax-usage
npm ci
npm run build

# Temporarily point settings.json to local worktree
# Edit ~/.claude/settings.json, change statusLine.command to:
# "command": "bash -c 'exec \"/usr/bin/node\" \"/home/ericjin/Projects/claude-hud/.worktrees/minimax-usage/dist/index.js\"'"

# Restart Claude Code to test

# After testing, restore settings.json to cache path:
# "command": "bash -c 'exec \"/usr/bin/node\" \"$HOME/.claude/plugins/cache/claude-hud/claude-hud/0.0.10/dist/index.js\"'"
```

### Remote Testing (from fork)

```bash
# Push changes to minimax-usage branch
cd .worktrees/minimax-usage
git add -A && git commit -m "your message" && git push origin minimax-usage

# Uninstall old version and reinstall (ensures fresh clone)
rm -rf ~/.claude/plugins/cache/claude-hud
/plugin install claude-hud

# Or update if already installed (will pull latest from minimax-usage branch)
/plugin update claude-hud
```

### Merging minimax-usage to fork main

If you want `minimax-usage` to be the default branch in your fork:

```bash
# In your fork's main branch, merge minimax-usage
# Then push to origin:
git push origin main

# Users can now update to get your changes:
/plugin update claude-hud
```

**Important**: Version number must be bumped in `package.json` for updates to propagate. Claude Code uses the `version` field to determine if an update is available.

### Plugin Update Mechanism

- `/plugin update <name>` - Pulls latest version from marketplace
- `/plugin install <name>` - Fresh install (uses cache if exists)
- `/plugin uninstall <name>` - Remove plugin

### Troubleshooting

**Cache vs Marketplace structure**:
- `~/.claude/plugins/cache/claude-hud/claude-hud/0.0.10/` - runtime files (double-nested!)
- `~/.claude/plugins/marketplaces/claude-hud/` - git clone of the repo
- `~/.claude/plugins/claude-hud/config.json` - user config

**After `/plugin install` the dist/ files may be outdated**:
```bash
# Rebuild and copy to cache
cd ~/.claude/plugins/marketplaces/claude-hud
npm ci && npm run build
cp -r dist/* ~/.claude/plugins/cache/claude-hud/claude-hud/0.0.10/dist/
```

**Plugin not found after install**:
- Check `~/.claude/plugins/known_marketplaces.json` has the plugin entry
- If missing, manually clone: `git clone https://github.com/ericjin07/claude-hud ~/.claude/plugins/marketplaces/claude-hud`

**StatusLine command path**: Claude Code invokes the command every ~300ms. The path must be absolute (no `~`), use `$HOME` or `/home/<user>`.

### Installation

The plugin is installed from `ericjin07/claude-hud` fork via `/plugin install claude-hud`. It uses the `minimax-usage` branch.

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

```bash
# Push minimax-usage branch to origin (ericjin07/claude-hud)
git push origin minimax-usage

# Or create a PR to upstream
gh pr create --base main --head ericjin07:minimax-usage
```

### Installation

The plugin is installed from `ericjin07/claude-hud` fork via `/plugin install claude-hud`. It uses the `minimax-usage` branch.

## Dependencies

- **Runtime**: Node.js 18+ or Bun
- **Build**: TypeScript 5, ES2022 target, NodeNext modules
