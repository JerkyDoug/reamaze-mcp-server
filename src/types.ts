// Reamaze API response types

export const STATUS_LABELS: Record<number, string> = {
  0: "Open",
  1: "Responded",
  2: "Done",
  3: "Pending",
  4: "Spam",
  5: "Archived",
};

export interface ReamazeConversation {
  slug: string;
  subject: string;
  status: number;
  category: {
    name: string;
    slug: string;
    channel: number;
  } | null;
  created_at: string;
  updated_at: string;
  last_customer_message_at: string | null;
  message: {
    body: string;
    created_at: string;
  };
  author: {
    name: string;
    email: string;
  };
  assignee: {
    name: string;
    email: string;
  } | null;
  tag_list: string[];
  data: Record<string, unknown>;
}

export interface ReamazeMessage {
  body: string;
  created_at: string;
  visibility: number; // 0 = public, 1 = internal
  user: {
    name: string;
    email: string;
  };
  attachments: Array<{
    url: string;
    name: string;
  }>;
}

export interface ReamazeContact {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
  phone: string | null;
  mobile: string | null;
  data: Record<string, unknown>;
  external_avatar_url: string | null;
  notes: Array<{
    body: string;
    created_at: string;
  }>;
}

export interface ReamazeResponseTemplate {
  id: number;
  title: string;
  body: string;
  subject: string | null;
  created_at: string;
  updated_at: string;
}

// List response wrappers
export interface ReamazeConversationListResponse {
  conversations: ReamazeConversation[];
  page_size: number;
  page_count: number;
  total_count: number;
}

export interface ReamazeMessageListResponse {
  messages: ReamazeMessage[];
}

export interface ReamazeContactListResponse {
  contacts: ReamazeContact[];
  page_size: number;
  page_count: number;
  total_count: number;
}

export interface ReamazeResponseTemplateListResponse {
  response_templates: ReamazeResponseTemplate[];
  page_size: number;
  page_count: number;
  total_count: number;
}
