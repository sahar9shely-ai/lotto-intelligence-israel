export type AuthUser = {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  access_password?: string | null;
  role: string;
  investor_id: number;
  investor_name: string;
  is_manager: boolean;
  is_active?: boolean;
  must_reset_password: boolean;
  has_password: boolean;
  last_login_at?: string | null;
  password_set_at?: string | null;
};

export type LoginAlert = {
  id: number;
  user_id: number;
  investor_id: number;
  email: string;
  display_name: string;
  logged_in_at: string;
  read_at?: string | null;
};

export type ActivityEvent = {
  id: number;
  kind: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "urgent" | string;
  actor_user_id?: number | null;
  actor_name?: string | null;
  investor_id?: number | null;
  investor_name?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  href?: string | null;
  meta_json?: string | null;
  created_at: string;
  read_at?: string | null;
  is_unread: boolean;
};

export type ActivitySummary = {
  unread_count: number;
  unread_login_count: number;
  latest_id: number;
  latest_login_id: number;
  latest?: ActivityEvent | null;
  latest_login?: ActivityEvent | null;
};

export type PasswordResetRequestItem = {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  status: string;
  note?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_by_user_id?: number | null;
};

export type EmailOutboxItem = {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  kind: string;
  created_at: string;
  meta_json?: string | null;
};
