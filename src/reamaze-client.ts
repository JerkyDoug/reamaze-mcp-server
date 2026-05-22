import type {
  ReamazeConversationListResponse,
  ReamazeConversation,
  ReamazeMessageListResponse,
  ReamazeMessage,
  ReamazeContactListResponse,
  ReamazeContact,
  ReamazeResponseTemplateListResponse,
  ReamazeVolumeReport,
  ReamazeResponseTimeReport,
  ReamazeStaffReport,
  ReamazeTagReport,
  ReamazeChannelSummaryReport,
  ReamazeChannel,
  ReamazeStaffListResponse,
} from "./types.js";

export class ReamazeClient {
  private baseUrl: string;
  private authHeader: string;

  constructor() {
    const brand = process.env.REAMAZE_BRAND;
    const email = process.env.REAMAZE_EMAIL;
    const token = process.env.REAMAZE_API_TOKEN;

    if (!brand || !email || !token) {
      throw new Error(
        "Missing required env vars: REAMAZE_BRAND, REAMAZE_EMAIL, REAMAZE_API_TOKEN"
      );
    }

    this.baseUrl = `https://${brand}.reamaze.io/api/v1`;
    this.authHeader =
      "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const { method = "GET", body, params } = options;

    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new Error(
        `Rate limited by Reamaze API. Retry after ${retryAfter || "unknown"} seconds.`
      );
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Reamaze API error ${response.status}: ${text}`
      );
    }

    return response.json() as Promise<T>;
  }

  async listConversations(
    filter: string = "all",
    page: number = 1
  ): Promise<ReamazeConversationListResponse> {
    const params: Record<string, string> = { page: String(page) };

    // Reamaze uses different endpoints for different filters
    let path = "/conversations";
    if (filter === "open") {
      params.filter = "open";
    } else if (filter === "unassigned") {
      params.filter = "unassigned";
    } else if (filter === "archived") {
      params.filter = "archived";
    }
    // "all" = no filter param

    return this.request<ReamazeConversationListResponse>(path, { params });
  }

  async getConversation(slug: string): Promise<ReamazeConversation> {
    return this.request<ReamazeConversation>(
      `/conversations/${encodeURIComponent(slug)}`
    );
  }

  async getConversationMessages(
    slug: string
  ): Promise<ReamazeMessage[]> {
    const data = await this.request<ReamazeMessageListResponse>(
      `/conversations/${encodeURIComponent(slug)}/messages`
    );
    return data.messages;
  }

  async createMessage(
    slug: string,
    body: string,
    internal: boolean = false
  ): Promise<ReamazeMessage> {
    const payload: Record<string, unknown> = {
      message: {
        body,
        visibility: internal ? 1 : 0,
      },
    };

    const data = await this.request<Record<string, unknown>>(
      `/conversations/${encodeURIComponent(slug)}/messages`,
      { method: "POST", body: payload }
    );

    // Reamaze API may return the message at data.message or at the top level
    const message = (data.message ?? data) as ReamazeMessage;
    if (!message || !message.created_at) {
      throw new Error(
        `Unexpected API response shape: ${JSON.stringify(data).substring(0, 500)}`
      );
    }
    return message;
  }

  async searchContacts(
    query: string,
    page: number = 1
  ): Promise<ReamazeContactListResponse> {
    return this.request<ReamazeContactListResponse>("/contacts", {
      params: { q: query, page: String(page) },
    });
  }

  async getContact(email: string): Promise<ReamazeContact> {
    return this.request<ReamazeContact>(
      `/contacts/${encodeURIComponent(email)}`
    );
  }

  async listResponseTemplates(
    query?: string,
    page: number = 1
  ): Promise<ReamazeResponseTemplateListResponse> {
    const params: Record<string, string> = { page: String(page) };
    if (query) {
      params.q = query;
    }
    return this.request<ReamazeResponseTemplateListResponse>(
      "/response_templates",
      { params }
    );
  }

  async updateConversation(
    slug: string,
    updates: {
      status?: number;
      assignee?: string;
      tag_list?: string[];
    }
  ): Promise<ReamazeConversation> {
    const body: Record<string, unknown> = { conversation: {} };
    const conv = body.conversation as Record<string, unknown>;

    if (updates.status !== undefined) {
      conv.status = updates.status;
    }
    if (updates.assignee !== undefined) {
      conv.assignee = updates.assignee;
    }
    if (updates.tag_list !== undefined) {
      conv.tag_list = updates.tag_list;
    }

    return this.request<ReamazeConversation>(
      `/conversations/${encodeURIComponent(slug)}`,
      { method: "PUT", body }
    );
  }

  // --- Reports ---

  async getVolumeReport(
    startDate?: string,
    endDate?: string
  ): Promise<ReamazeVolumeReport> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.request<ReamazeVolumeReport>("/reports/volume", { params });
  }

  async getResponseTimeReport(
    startDate?: string,
    endDate?: string
  ): Promise<ReamazeResponseTimeReport> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.request<ReamazeResponseTimeReport>("/reports/response_time", { params });
  }

  async getStaffReport(
    startDate?: string,
    endDate?: string
  ): Promise<ReamazeStaffReport> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.request<ReamazeStaffReport>("/reports/staff", { params });
  }

  async getTagReport(
    startDate?: string,
    endDate?: string
  ): Promise<ReamazeTagReport> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.request<ReamazeTagReport>("/reports/tags", { params });
  }

  async getChannelSummaryReport(
    startDate?: string,
    endDate?: string
  ): Promise<ReamazeChannelSummaryReport> {
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.request<ReamazeChannelSummaryReport>("/reports/channel_summary", { params });
  }

  // --- Channels & Staff ---

  async listChannels(): Promise<ReamazeChannel[]> {
    const data = await this.request<{ channels: ReamazeChannel[] }>("/channels");
    return data.channels ?? [];
  }

  async listStaff(): Promise<ReamazeStaffListResponse> {
    return this.request<ReamazeStaffListResponse>("/staff");
  }

  async createConversation(params: {
    subject: string;
    body: string;
    contact_name: string;
    contact_email: string;
    category_slug: string;
    assignee?: string;
    tag_list?: string[];
    internal?: boolean;
  }): Promise<ReamazeConversation> {
    const payload: Record<string, unknown> = {
      conversation: {
        subject: params.subject,
        message: {
          body: params.body,
          visibility: params.internal ? 1 : 0,
        },
        // Reamaze API requires "user" (not "contact") and "category" as a plain slug string
        user: {
          name: params.contact_name,
          email: params.contact_email,
        },
        category: params.category_slug,
        ...(params.assignee && { assignee: params.assignee }),
        ...(params.tag_list && { tag_list: params.tag_list }),
      },
    };

    return this.request<ReamazeConversation>("/conversations", {
      method: "POST",
      body: payload,
    });
  }

  async addNote(
    email: string,
    body: string
  ): Promise<{ body: string; created_at: string }> {
    const data = await this.request<{
      note: { body: string; created_at: string };
    }>(`/contacts/${encodeURIComponent(email)}/notes`, {
      method: "POST",
      body: { note: { body } },
    });
    return data.note;
  }
}
