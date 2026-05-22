#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ReamazeClient } from "./reamaze-client.js";
import { STATUS_LABELS, STATUS_NAMES_TO_VALUES, CHANNEL_TYPE_LABELS } from "./types.js";

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
      .describe("The PLAIN TEXT message body to send. Use \\n for line breaks. Do NOT use HTML tags like <br>, <p>, <b> — they render as literal text in customer emails."),
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

// --- Tool: create_conversation ---
server.tool(
  "create_conversation",
  `Create a new Reamaze conversation (ticket) from scratch. Use this for internal operational requests such as seeding payout requests — situations where you need to create a task for a staff member rather than reply to an inbound customer message.

IMPORTANT — SEND SAFETY: Before calling this tool, present a summary of what ticket will be created and get explicit approval. This creates a real ticket in Reamaze.

Tips:
- Set internal=true to make the opening message an internal note (staff-only, not visible to any customer).
- Set assignee to the staff member's email to route it directly to them.
- Use tag_list to categorize (e.g. ["payout", "seeding"]).
- contact_email is required by the API — for internal staff tickets use the requester's email (e.g. doug@jerky.com).`,
  {
    subject: z.string().describe("Ticket subject line"),
    body: z.string().describe("Opening message body (plain text, use \\n for line breaks)"),
    contact_name: z.string().describe("Name of the contact to associate with the ticket (for internal tickets, use the requester's name)"),
    contact_email: z.string().describe("Email of the contact. For internal staff tickets, use the requester's email (e.g. doug@jerky.com)"),
    category_slug: z.string().default("jerky-taste-tester-support").describe("Reamaze channel slug to file the ticket under. Use 'jerky-taste-tester-support' for seeding payouts. Call list_channels to discover others."),
    assignee: z.string().optional().describe("Email of the staff member to assign the ticket to"),
    tag_list: z.array(z.string()).optional().describe("Tags to apply to the ticket, e.g. [\"payout\", \"seeding\"]"),
    internal: z.boolean().default(true).describe("If true (default), the opening message is an internal note not visible to the contact"),
  },
  async ({ subject, body, contact_name, contact_email, category_slug, assignee, tag_list, internal }) => {
    try {
      const conversation = await client.createConversation({
        subject,
        body,
        contact_name,
        contact_email,
        category_slug,
        assignee,
        tag_list,
        internal,
      });

      const assigneeName = conversation.assignee?.name ?? assignee ?? "Unassigned";
      const tags = conversation.tag_list?.length > 0 ? conversation.tag_list.join(", ") : "none";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Conversation created: [${conversation.slug}]`,
              `Subject: ${conversation.subject}`,
              `Assignee: ${assigneeName}`,
              `Tags: ${tags}`,
              `Created: ${new Date(conversation.created_at).toLocaleString()}`,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating conversation: ${error instanceof Error ? error.message : String(error)}`,
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

// --- Tool: report_volume ---
server.tool(
  "report_volume",
  "Get daily conversation volume over a date range. Shows how many new tickets came in each day. Defaults to last 30 days.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date (ISO 8601, e.g. 2026-03-01)"),
    end_date: z
      .string()
      .optional()
      .describe("End date (ISO 8601, e.g. 2026-03-31)"),
  },
  async ({ start_date, end_date }) => {
    try {
      const data = await client.getVolumeReport(start_date, end_date);

      const dates = Object.entries(data.conversation_counts).sort(
        ([a], [b]) => a.localeCompare(b)
      );
      const total = dates.reduce((sum, [, count]) => sum + count, 0);
      const avg = dates.length > 0 ? (total / dates.length).toFixed(1) : "0";

      const lines = dates.map(([date, count]) => `  ${date}: ${count}`);

      const text = [
        `**Conversation Volume** (${data.start_date} to ${data.end_date})`,
        `Total: ${total} | Daily avg: ${avg} | Days: ${dates.length}`,
        ``,
        ...lines,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting volume report: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: report_response_time ---
server.tool(
  "report_response_time",
  "Get response time metrics: daily averages, trends, and percentage of tickets responded to within 1 hour, 1 day, and 1 week. Defaults to last 30 days.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date (ISO 8601, e.g. 2026-03-01)"),
    end_date: z
      .string()
      .optional()
      .describe("End date (ISO 8601, e.g. 2026-03-31)"),
  },
  async ({ start_date, end_date }) => {
    try {
      const data = await client.getResponseTimeReport(start_date, end_date);

      const formatTime = (seconds: number) => {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
        return `${(seconds / 86400).toFixed(1)}d`;
      };

      const s = data.summary;
      const text = [
        `**Response Time Report** (${data.start_date} to ${data.end_date})`,
        ``,
        `**Averages:**`,
        `  In range: ${formatTime(s.averages.in_range)} | This month: ${formatTime(s.averages.this_month)} | This week: ${formatTime(s.averages.this_week)}`,
        ``,
        `**Trends:**`,
        `  Last 30 days: ${formatTime(s.trends.last_30_days.average)} (${s.trends.last_30_days.change_rate > 0 ? "+" : ""}${(s.trends.last_30_days.change_rate * 100).toFixed(1)}%)`,
        `  Last 7 days: ${formatTime(s.trends.last_7_days.average)} (${s.trends.last_7_days.change_rate > 0 ? "+" : ""}${(s.trends.last_7_days.change_rate * 100).toFixed(1)}%)`,
        ``,
        `**Response Ratio:**`,
        `  Under 1 hour: ${(s.ratio.under_1_hour * 100).toFixed(1)}%`,
        `  Under 1 day: ${(s.ratio.under_1_day * 100).toFixed(1)}%`,
        `  Under 1 week: ${(s.ratio.under_1_week * 100).toFixed(1)}%`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting response time report: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: report_staff ---
server.tool(
  "report_staff",
  "Get per-staff performance metrics: response count, average response time, and appreciations. Defaults to last 30 days.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date (ISO 8601, e.g. 2026-03-01)"),
    end_date: z
      .string()
      .optional()
      .describe("End date (ISO 8601, e.g. 2026-03-31)"),
  },
  async ({ start_date, end_date }) => {
    try {
      const data = await client.getStaffReport(start_date, end_date);

      const formatTime = (seconds: number) => {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
        return `${(seconds / 86400).toFixed(1)}d`;
      };

      const entries = Object.entries(data.report).sort(
        ([, a], [, b]) => b.response_count - a.response_count
      );

      const lines = entries.map(([name, stats]) => {
        return `  **${name}**: ${stats.response_count} responses | Avg: ${formatTime(stats.response_time_seconds)} | Appreciations: ${stats.appreciations_count}`;
      });

      const text = [
        `**Staff Performance** (${data.start_date} to ${data.end_date})`,
        ``,
        ...lines,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting staff report: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: report_tags ---
server.tool(
  "report_tags",
  "Get tag usage counts over a date range. Shows which issue categories are most common. Defaults to last 30 days.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date (ISO 8601, e.g. 2026-03-01)"),
    end_date: z
      .string()
      .optional()
      .describe("End date (ISO 8601, e.g. 2026-03-31)"),
  },
  async ({ start_date, end_date }) => {
    try {
      const data = await client.getTagReport(start_date, end_date);

      const tags = Object.entries(data.tags).sort(([, a], [, b]) => b - a);
      const total = tags.reduce((sum, [, count]) => sum + count, 0);

      const lines = tags.map(([tag, count]) => {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
        return `  ${tag}: ${count} (${pct}%)`;
      });

      const text = [
        `**Tag Distribution** (${data.start_date} to ${data.end_date})`,
        `Total tagged: ${total} | Unique tags: ${tags.length}`,
        ``,
        ...lines,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting tag report: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: report_channel_summary ---
server.tool(
  "report_channel_summary",
  "Get per-channel metrics: response counts, average response time, CSAT rating, and conversation status breakdown. Defaults to last 30 days.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date (ISO 8601, e.g. 2026-03-01)"),
    end_date: z
      .string()
      .optional()
      .describe("End date (ISO 8601, e.g. 2026-03-31)"),
  },
  async ({ start_date, end_date }) => {
    try {
      const data = await client.getChannelSummaryReport(start_date, end_date);

      const formatTime = (seconds: number) => {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
        return `${(seconds / 86400).toFixed(1)}d`;
      };

      const lines = Object.values(data.channels).map((ch) => {
        const type = ch.category.channel_type_name ?? `Type(${ch.category.channel_type})`;
        const rating = Number(ch.average_satisfaction_rating);
        const csat = rating > 0 ? rating.toFixed(1) : "N/A";
        const responseTime = Number(ch.average_response_time_seconds);
        return [
          `**${ch.category.name}** (${type})`,
          `  Staff responses: ${ch.staff_responses} | Customer responses: ${ch.customer_responses}`,
          `  Avg response time: ${formatTime(responseTime)}`,
          `  Active: ${ch.active_conversations} | Resolved: ${ch.resolved_conversations} | Archived: ${ch.archived_conversations}`,
          `  CSAT: ${csat} | Avg thread size: ${ch.average_thread_size} | Appreciations: ${ch.appreciations}`,
        ].join("\n");
      });

      const text = [
        `**Channel Summary** (${data.start_date} to ${data.end_date})`,
        ``,
        ...lines,
      ].join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting channel summary: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: list_channels ---
server.tool(
  "list_channels",
  "List all configured Reamaze channels with their type, visibility, and settings.",
  {},
  async () => {
    try {
      const channels = await client.listChannels();

      const lines = channels.map((ch) => {
        const type = CHANNEL_TYPE_LABELS[ch.channel] ?? `Type(${ch.channel})`;
        const visibility = ch.visibility === 1 ? "Public" : "Private";
        return [
          `**${ch.name}** (${type})`,
          `  Slug: ${ch.slug} | Visibility: ${visibility} | Spam filter: ${ch.spam_filter_enabled ? "On" : "Off"}`,
          ch.email ? `  Email: ${ch.email}` : null,
          ch.settings_reply_from_name ? `  Reply-from: ${ch.settings_reply_from_name}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      });

      const text = [
        `**Reamaze Channels** (${channels.length} total)`,
        ``,
        ...lines,
      ].join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing channels: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// --- Tool: list_staff ---
server.tool(
  "list_staff",
  "List all Reamaze staff/agents with their email and when they were added.",
  {},
  async () => {
    try {
      const data = await client.listStaff();

      const lines = data.staff.map((s) => {
        return `  **${s.name}** <${s.email}> — joined ${new Date(s.created_at).toLocaleDateString()}`;
      });

      const text = [
        `**Reamaze Staff** (${data.total_count} members)`,
        ``,
        ...lines,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing staff: ${error instanceof Error ? error.message : String(error)}`,
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
