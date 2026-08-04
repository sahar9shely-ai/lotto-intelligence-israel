export type AuthUser = {
  id: number;
  email: string;
  role: string;
  investor_id: number;
  investor_name: string;
  is_manager: boolean;
  is_active?: boolean;
  must_reset_password: boolean;
  has_password: boolean;
  email_needs_update?: boolean;
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

export type EmailOutboxItem = {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  kind: string;
  created_at: string;
  meta_json?: string | null;
};
