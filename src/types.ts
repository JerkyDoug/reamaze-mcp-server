// Reamaze API response types

export const STATUS_LABELS: Record<number, string> = {
  0: "Open",
  1: "Responded",
  2: "Done",
  3: "Spam",
  4: "Archived",
  5: "On Hold",
  6: "Auto-Done",
  7: "AI Agent Assigned",
  8: "AI Agent Done",
  9: "Spam (AI)",
};

export const STATUS_NAMES_TO_VALUES: Record<string, number> = {
  open: 0,
  responded: 1,
  done: 2,
  spam: 3,
  archived: 4,
  "on hold": 5,
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

// Report types
export interface ReamazeVolumeReport {
  conversation_counts: Record<string, number>;
  start_date: string;
  end_date: string;
}

export interface ReamazeResponseTimeReport {
  response_times: Record<string, number>;
  summary: {
    averages: {
      in_range: number;
      this_month: number;
      this_week: number;
    };
    trends: {
      last_30_days: { average: number; change_rate: number };
      last_7_days: { average: number; change_rate: number };
    };
    ratio: {
      under_1_hour: number;
      under_1_day: number;
      under_1_week: number;
    };
  };
  start_date: string;
  end_date: string;
}

export interface ReamazeStaffReportEntry {
  response_count: number;
  response_time_seconds: number;
  appreciations_count: number;
  responses_trend: Record<string, number>;
}

export interface ReamazeStaffReport {
  report: Record<string, ReamazeStaffReportEntry>;
  start_date: string;
  end_date: string;
}

export interface ReamazeTagReport {
  tags: Record<string, number>;
  start_date: string;
  end_date: string;
}

export interface ReamazeChannelSummaryEntry {
  staff_responses: number;
  customer_responses: number;
  average_response_time_seconds: number | string;
  appreciations: number;
  active_conversations: number;
  resolved_conversations: number;
  archived_conversations: number;
  average_satisfaction_rating: number | string | null;
  average_thread_size: number;
  category: { id: number; name: string; channel_type: number; channel_type_name: string };
  brand: { id: number; name: string; url: string };
}

export interface ReamazeChannelSummaryReport {
  channels: Record<string, ReamazeChannelSummaryEntry>;
  start_date: string;
  end_date: string;
}

export interface ReamazeChannel {
  name: string;
  slug: string;
  email: string;
  channel: number;
  visibility: number;
  spam_filter_enabled: boolean;
  settings_reply_from_name: string;
  settings_signature: string;
}

export interface ReamazeStaffMember {
  name: string;
  email: string;
  created_at: string;
  role: Record<string, unknown>;
}

export interface ReamazeStaffListResponse {
  staff: ReamazeStaffMember[];
  page_size: number;
  page_count: number;
  total_count: number;
}

export const CHANNEL_TYPE_LABELS: Record<number, string> = {
  1: "Email",
  2: "Twitter",
  3: "Facebook",
  6: "Chat",
  8: "Instagram",
  9: "SMS",
  10: "Voice",
  12: "Facebook Messenger",
  13: "Facebook Lead",
  14: "Instagram Ad",
  15: "WhatsApp",
  16: "Instagram DM",
};

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
