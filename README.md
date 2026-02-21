# Reamaze MCP Server

An MCP (Model Context Protocol) server that connects Claude Code to the [Reamaze](https://www.reamaze.com/) customer support platform. Provides tools for listing/reading conversations, replying to tickets, searching contacts, managing notes, and browsing response templates.

## Prerequisites

- Node.js 18+
- A Reamaze account with API access
- Claude Code CLI

## Setup

### 1. Clone and build

```bash
git clone https://github.com/kennymkchan/reamaze-mcp-server.git
cd reamaze-mcp-server
npm install
npm run build
```

### 2. Get your Reamaze API credentials

- **Brand**: Your Reamaze subdomain (e.g. if your dashboard is `acme.reamaze.com`, the brand is `acme`)
- **Email**: The email address of a staff user with API access
- **API Token**: Found in Reamaze under Settings > API > API Token

### 3. Register the MCP server with Claude Code

Run the following command, replacing the placeholder values with your actual credentials:

```bash
claude mcp add reamaze \
  -e REAMAZE_BRAND=yourbrand \
  -e REAMAZE_EMAIL=you@example.com \
  -e REAMAZE_API_TOKEN=your_api_token_here \
  -- node /absolute/path/to/reamaze-mcp-server/build/index.js
```

This stores the server config (including env vars) in `~/.claude.json`. Credentials are never committed to the repo.

## Available Tools

| Tool | Description |
|---|---|
| `list_conversations` | List tickets with optional filter (open, unassigned, archived, all) and pagination |
| `get_conversation` | Get a full conversation thread with all messages |
| `reply_to_conversation` | Send a reply or internal note to a conversation |
| `search_contacts` | Search contacts by name or email |
| `get_contact` | Get detailed contact info including notes |
| `list_response_templates` | List canned response templates, optionally filtered by keyword |
| `add_note` | Add an internal staff note to a contact |

## Development

```bash
# Build
npm run build

# Rebuild after changes
npm run build

# Run directly (requires env vars to be set)
REAMAZE_BRAND=yourbrand REAMAZE_EMAIL=you@example.com REAMAZE_API_TOKEN=yourtoken npm start
```

## Project Structure

```
src/
  index.ts            # MCP server setup and tool definitions
  reamaze-client.ts   # Reamaze REST API client
  types.ts            # TypeScript interfaces and constants
```
