export type Investor = {
  id: number;
  name: string;
  is_manager: boolean;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
  active_principal: number;
  monthly_payout: number;
  months_in_program: number;
  plans_count: number;
  access_username?: string | null;
  access_email?: string | null;
  access_role?: string | null;
  has_login?: boolean;
};

export type PlanType = "monthly" | "savings" | "hybrid";

export type Plan = {
  id: number;
  investor_id: number;
  investor_name: string;
  principal: number;
  plan_type: PlanType | string;
  monthly_rate_percent: number;
  savings_rate_percent: number;
  manager_fee_percent: number;
  start_date: string;
  duration_months: number;
  status: string;
  notes?: string | null;
  created_at: string;
  monthly_investor_payout: number;
  monthly_manager_fee: number;
  monthly_savings_accrual: number;
  projected_savings_balance: number;
  total_cash_payout: number;
  total_investor_payout: number;
  total_manager_fee: number;
  annual_investor_payout: number;
  months_elapsed: number;
  months_remaining: number;
  paid_count: number;
  paid_investor_total: number;
  paid_manager_total: number;
};

export type Payment = {
  id: number;
  plan_id: number;
  investor_id: number;
  investor_name: string;
  month_number: number;
  due_date: string;
  investor_amount: number;
  manager_amount: number;
  status: string;
  paid_at?: string | null;
  notes?: string | null;
};

export type Quote = {
  id: number;
  prospect_name: string;
  principal: number;
  plan_type: PlanType | string;
  monthly_rate_percent: number;
  savings_rate_percent: number;
  manager_fee_percent: number;
  duration_months: number;
  notes?: string | null;
  status: string;
  converted_investor_id?: number | null;
  created_at: string;
  monthly_investor_payout: number;
  monthly_manager_fee: number;
  monthly_savings_accrual: number;
  projected_savings_balance: number;
  total_cash_payout: number;
  total_investor_payout: number;
  total_manager_fee: number;
  annual_investor_payout: number;
};

export type Settings = {
  default_monthly_rate_percent: number;
  default_manager_fee_percent: number;
  default_duration_months: number;
  currency_symbol: string;
  manager_display_name: string;
  site_updating: boolean;
  site_updating_message: string;
};

export type SiteStatus = {
  site_updating: boolean;
  site_updating_message: string;
};

export type Dashboard = {
  total_principal: number;
  monthly_investor_payouts: number;
  monthly_manager_fees: number;
  monthly_manager_own_payout: number;
  monthly_manager_total: number;
  ytd_investor_paid: number;
  ytd_manager_earned: number;
  lifetime_investor_paid: number;
  lifetime_manager_earned: number;
  active_investors: number;
  active_plans: number;
  upcoming_payments: Payment[];
  recent_payments: Payment[];
  investors_summary: Investor[];
};

export type PaymentTotals = {
  planned_investor: number;
  paid_investor: number;
  planned_manager: number;
  paid_manager: number;
  paid_count: number;
  scheduled_count: number;
  awaiting_count: number;
  skipped_count: number;
  total_count: number;
};

export type PaymentReport = {
  year: number;
  available_years: number[];
  yearly: PaymentTotals;
  lifetime: PaymentTotals;
};
