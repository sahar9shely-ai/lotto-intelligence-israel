export type AssistantPaymentAction = {
  token: string;
  kind: "payment_confirmation_request";
  investor_name: string;
  payment_id: number;
  amount: number;
  due_date: string;
  month_label: string;
};

export type AssistantChatResponse = {
  reply: string;
  pdf_suggested: boolean;
  what_if?: Record<string, unknown> | null;
  configured: boolean;
  cta?: { href: string; label: string } | null;
  suggestions?: Array<{ label: string; message: string }>;
  action?: AssistantPaymentAction | null;
};

export type AssistantActionConfirmation = {
  reply: string;
  action?: null;
  payment_id?: number;
};
