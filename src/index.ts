#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ReamazeClient } from "./reamaze-client.js";
import { STATUS_LABELS, STATUS_NAMES_TO_VALUES } from "./types.js";

const server = new McpServer({
  name: "reamaze",
  version: "1.0.0",
});

const client = new ReamazeClient();

// --- Tool: list_conversations ---
server.tool(
  "list_conversations",
  "List Reamaze support conversations/tickets. Returns subject, status, author, assignee, and last message preview for each ticket.",
  {
    filter: z
      .enum(["open", "unassigned", "archived", "all"])
      .default("all")
      .describe("Filter conversations by status"),
    page: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe("Page number for pagination"),
  },
  async ({ filter, page }) => {
    try {
      const data = await client.listConversations(filter, page);

      const lines = data.conversations.map((c) => {
        const status = STATUS_LABELS[c.status] ?? `Unknown(${c.status})`;
        const assignee = c.assignee?.name ?? "Unassigned";
        const updated = new Date(c.updated_at).toLocaleString();
        return [
          `**[${c.slug}]** ${c.subject}`,
          `  Status: ${status} | Assignee: ${assignee} | Updated: ${updated}`,
          `  From: ${c.author.name} <${c.author.email}>`,
          c.tag_list.length > 0 ? `  Tags: ${c.tag_list.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      });

      const header = `Showing ${data.conversations.length} of ${data.total_count} conversations (page ${page} of ${data.page_count}) — filter: ${filter}`;

      return {
        content: [
          {
            type: "text" as const,
            text: header + "\n\n" + lines.join("\n\n"),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing conversations: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: get_conversation_count ---
server.tool(
  "get_conversation_count",
  "Get a quick count of conversations by filter (open, unassigned, archived, or all) without fetching full ticket data.",
  {
    filter: z
      .enum(["open", "unassigned", "archived", "all"])
      .default("all")
      .describe("Filter conversations by status"),
  },
  async ({ filter }) => {
    try {
      const data = await client.listConversations(filter, 1);
      return {
        content: [
          {
            type: "text" as const,
            text: `${data.total_count} conversation(s) — filter: ${filter}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting conversation count: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: get_conversation ---
server.tool(
  "get_conversation",
  "Get a full Reamaze conversation thread including all messages. Use this to read the complete ticket history before drafting a reply.",
  {
    slug: z.string().describe("The conversation slug (identifier)"),
  },
  async ({ slug }) => {
    try {
      const [conversation, messages] = await Promise.all([
        client.getConversation(slug),
        client.getConversationMessages(slug),
      ]);

      const status = STATUS_LABELS[conversation.status] ?? `Unknown(${conversation.status})`;
      const assignee = conversation.assignee?.name ?? "Unassigned";

      const header = [
        `**Subject:** ${conversation.subject}`,
        `**Status:** ${status} | **Assignee:** ${assignee}`,
        `**From:** ${conversation.author.name} <${conversation.author.email}>`,
        `**Created:** ${new Date(conversation.created_at).toLocaleString()}`,
        conversation.tag_list.length > 0
          ? `**Tags:** ${conversation.tag_list.join(", ")}`
          : null,
        `---`,
      ]
        .filter(Boolean)
        .join("\n");

      const messageLines = messages.map((m) => {
        const visibility = m.visibility === 1 ? " [INTERNAL NOTE]" : "";
        const time = new Date(m.created_at).toLocaleString();
        const attachments =
          m.attachments.length > 0
            ? `\n  Attachments: ${m.attachments.map((a) => a.name).join(", ")}`
            : "";
        return `**${m.user.name}** (${time})${visibility}\n${m.body}${attachments}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: header + "\n\n" + messageLines.join("\n\n---\n\n"),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error reading conversation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: reply_to_conversation ---
server.tool(
  "reply_to_conversation",
  `Send a reply to a Reamaze conversation.

IMPORTANT — SEND SAFETY: Before calling this tool, you MUST present the full draft reply to the user and get explicit approval (e.g. "Approved, send it" or "Yes, send"). Do NOT call this tool without user confirmation. This sends a real message to the customer (or internal note if internal=true).`,
  {
    slug: z.string().describe("The conversation slug"),
    body: z
      .string()
      .describe("The HTML message body to send"),
    internal: z
      .boolean()
      .default(false)
      .describe("If true, sends as an internal note (not visible to customer)"),
  },
  async ({ slug, body, internal }) => {
    try {
      const message = await client.createMessage(slug, body, internal);
      const visibility = internal ? "internal note" : "reply";
      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully sent ${visibility} to conversation [${slug}] at ${new Date(message.created_at).toLocaleString()}.`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error sending reply: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: update_conversation ---
server.tool(
  "update_conversation",
  "Update a Reamaze conversation's status, assignee, or tags. Use this to archive tickets, reassign them, or change their status.",
  {
    slug: z.string().describe("The conversation slug (identifier)"),
    status: z
      .enum(["open", "responded", "done", "spam", "archived", "on hold"])
      .optional()
      .describe("New status for the conversation"),
    assignee: z
      .string()
      .optional()
      .describe("Email address of the staff member to assign the conversation to"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Replace the conversation's tags with this list"),
  },
  async ({ slug, status, assignee, tags }) => {
    try {
      const updates: { status?: number; assignee?: string; tag_list?: string[] } = {};

      if (status !== undefined) {
        updates.status = STATUS_NAMES_TO_VALUES[status];
      }
      if (assignee !== undefined) {
        updates.assignee = assignee;
      }
      if (tags !== undefined) {
        updates.tag_list = tags;
      }

      const conversation = await client.updateConversation(slug, updates);

      const newStatus = STATUS_LABELS[conversation.status] ?? `Unknown(${conversation.status})`;
      const newAssignee = conversation.assignee?.name ?? "Unassigned";

      const summary = [
        `Conversation [${slug}] updated:`,
        `  Status: ${newStatus}`,
        `  Assignee: ${newAssignee}`,
        conversation.tag_list.length > 0
          ? `  Tags: ${conversation.tag_list.join(", ")}`
          : `  Tags: (none)`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating conversation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: search_contacts ---
server.tool(
  "search_contacts",
  "Search Reamaze contacts by name or email. Useful for finding customer records before looking up their orders in Shopify.",
  {
    query: z.string().describe("Search query (name or email)"),
    page: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe("Page number for pagination"),
  },
  async ({ query, page }) => {
    try {
      const data = await client.searchContacts(query, page);

      if (data.contacts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No contacts found for "${query}".`,
            },
          ],
        };
      }

      const lines = data.contacts.map((c) => {
        const phone = c.phone || c.mobile || "N/A";
        return [
          `**${c.name}** <${c.email}>`,
          `  Phone: ${phone} | Created: ${new Date(c.created_at).toLocaleString()}`,
          c.notes.length > 0
            ? `  Notes: ${c.notes.length} note(s)`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
      });

      const header = `Found ${data.total_count} contact(s) for "${query}" (page ${page} of ${data.page_count})`;

      return {
        content: [
          {
            type: "text" as const,
            text: header + "\n\n" + lines.join("\n\n"),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error searching contacts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: get_contact ---
server.tool(
  "get_contact",
  "Get detailed information about a Reamaze contact including their notes. Use the email address to look up the contact.",
  {
    email: z.string().describe("The contact's email address"),
  },
  async ({ email }) => {
    try {
      const contact = await client.getContact(email);

      const phone = contact.phone || contact.mobile || "N/A";
      const notes =
        contact.notes.length > 0
          ? contact.notes
              .map(
                (n) =>
                  `  - (${new Date(n.created_at).toLocaleString()}) ${n.body}`
              )
              .join("\n")
          : "  None";

      const customData =
        Object.keys(contact.data).length > 0
          ? JSON.stringify(contact.data, null, 2)
          : "None";

      const text = [
        `**${contact.name}** <${contact.email}>`,
        `Phone: ${phone}`,
        `Created: ${new Date(contact.created_at).toLocaleString()}`,
        `Updated: ${new Date(contact.updated_at).toLocaleString()}`,
        ``,
        `**Notes:**`,
        notes,
        ``,
        `**Custom Data:**`,
        customData,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting contact: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: list_response_templates ---
server.tool(
  "list_response_templates",
  "List canned response templates from Reamaze. Optionally filter by keyword. Use these templates as a starting point for replies to ensure consistent messaging.",
  {
    query: z
      .string()
      .optional()
      .describe("Optional keyword to filter templates"),
    page: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe("Page number for pagination"),
  },
  async ({ query, page }) => {
    try {
      const data = await client.listResponseTemplates(query, page);

      if (data.response_templates.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: query
                ? `No response templates found for "${query}".`
                : "No response templates found.",
            },
          ],
        };
      }

      const lines = data.response_templates.map((t) => {
        // Truncate body for preview
        const preview =
          t.body.length > 200 ? t.body.substring(0, 200) + "..." : t.body;
        return `**[${t.id}] ${t.title}**\n${preview}`;
      });

      const header = `Found ${data.total_count} template(s) (page ${page} of ${data.page_count})`;

      return {
        content: [
          {
            type: "text" as const,
            text: header + "\n\n" + lines.join("\n\n---\n\n"),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing templates: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: add_note ---
server.tool(
  "add_note",
  "Add an internal note to a Reamaze contact. Notes are only visible to support staff, not the customer.",
  {
    email: z.string().describe("The contact's email address"),
    body: z.string().describe("The note content"),
  },
  async ({ email, body }) => {
    try {
      const note = await client.addNote(email, body);
      return {
        content: [
          {
            type: "text" as const,
            text: `Note added to contact <${email}> at ${new Date(note.created_at).toLocaleString()}.`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error adding note: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Start the server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Reamaze MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
