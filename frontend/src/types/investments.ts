export type Investor = {
  id: number;
  name: string;
  is_manager: boolean;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
  active_principal: number;
  monthly_payout: number;
  monthly_cash?: number;
  monthly_savings?: number;
  monthly_total?: number;
  cash_rate_percent?: number;
  savings_rate_percent?: number;
  current_savings_balance?: number;
  projected_savings_balance?: number;
  active_plans_count?: number;
  plan_types?: string[];
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
  manager_fee_percent?: number;
  start_date: string;
  track_end_date?: string | null;
  duration_months: number;
  status: string;
  notes?: string | null;
  created_at: string;
  monthly_investor_payout: number;
  monthly_manager_fee?: number;
  monthly_savings_accrual: number;
  projected_savings_balance: number;
  current_savings_balance?: number;
  accrued_savings_balance?: number;
  savings_redeemed_total?: number;
  successor_plan_id?: number | null;
  source_request_id?: number | null;
  cooling_off_until?: string | null;
  cooling_off_days_left?: number;
  can_cancel_investment?: boolean;
  total_cash_payout: number;
  total_investor_payout: number;
  total_manager_fee?: number;
  annual_investor_payout: number;
  months_elapsed: number;
  months_remaining: number;
  paid_count: number;
  paid_investor_total: number;
  paid_manager_total?: number;
};

export type PlanStatusMonth = {
  month_number: number;
  due_date: string;
  cash_amount: number;
  manager_amount?: number;
  savings_accrual: number;
  cumulative_cash: number;
  cumulative_savings: number;
  compounded: boolean;
  status: string;
  payment_id?: number | null;
};

export type PlanStatusReport = {
  plan_id: number;
  investor_id: number;
  investor_name: string;
  plan_type: string;
  principal: number;
  start_date: string;
  duration_months: number;
  monthly_cash: number;
  monthly_savings_accrual: number;
  projected_savings_balance: number;
  paid_cash_total: number;
  current_savings_balance: number;
  months: PlanStatusMonth[];
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
  phone?: string | null;
  access_username?: string | null;
  access_password?: string | null;
  start_date?: string | null;
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
  slack_webhook_url?: string | null;
  assistant_provider?: string;
  assistant_api_key_set?: boolean;
  assistant_api_key_hint?: string | null;
};

export type SiteStatus = {
  site_updating: boolean;
  site_updating_message: string;
  public_url?: string | null;
};

export type Dashboard = {
  scope_investor_id?: number | null;
  total_principal: number;
  monthly_investor_payouts: number;
  monthly_cash_payouts?: number;
  monthly_savings_accruals?: number;
  monthly_investor_total?: number;
  current_savings_total?: number;
  projected_savings_total?: number;
  monthly_manager_fees: number;
  monthly_manager_own_payout: number;
  monthly_manager_own_savings?: number;
  monthly_manager_own_total?: number;
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
  savings_to_date?: number;
  savings_to_track_end?: number;
};

export type PaymentReport = {
  year: number;
  available_years: number[];
  yearly: PaymentTotals;
  lifetime: PaymentTotals;
};

export type ManagerIncomePlanFee = {
  plan_id: number;
  plan_type: string;
  principal: number;
  manager_fee_percent: number;
  monthly_fee: number;
};

export type ManagerIncomeInvestor = {
  investor_id: number;
  investor_name: string;
  principal: number;
  monthly_fee: number;
  plans: ManagerIncomePlanFee[];
};

export type ManagerOwnPlan = {
  plan_id: number;
  plan_type: string;
  principal: number;
  monthly_cash: number;
  monthly_savings: number;
  monthly_total: number;
  savings_rate_percent: number;
  monthly_rate_percent: number;
  start_date: string;
  track_end_date: string;
  duration_months: number;
  months_elapsed: number;
};

export type ManagerIncomeBoard = {
  manager_name: string;
  manager_investor_id?: number | null;
  investors: ManagerIncomeInvestor[];
  monthly_fees_total: number;
  manager_own: {
    investor_id?: number | null;
    investor_name: string;
    principal: number;
    monthly_cash: number;
    monthly_savings: number;
    monthly_total: number;
    plans: ManagerOwnPlan[];
  };
  monthly_grand_total: number;
};

export type TopupRequestStatus =
  | "pending"
  | "cancelled"
  | "rejected"
  | "contract"
  | "executed"
  | "approved"
  | "reversed";

export type TopupRequest = {
  id: number;
  investor_id: number;
  investor_name: string;
  amount: number;
  notes?: string | null;
  status: TopupRequestStatus | string;
  created_at: string;
  reviewed_at?: string | null;
  review_notes?: string | null;
  created_plan_id?: number | null;
  approved_at?: string | null;
  executed_at?: string | null;
  cancel_until?: string | null;
  reversed_at?: string | null;
  can_cancel_request: boolean;
  can_reverse_investment: boolean;
  cooling_off_days_left: number;
  cooling_off_business_days: number;
  plan?: Plan | null;
  manager_fee_percent?: number;
  monthly_rate_percent?: number;
  savings_rate_percent?: number;
  plan_type?: string;
  contract_number?: string;
  manager_party_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_months?: number | null;
  offered_notes?: string | null;
  monthly_investor_payout?: number | null;
  monthly_savings_accrual?: number | null;
  total_investor_payout?: number | null;
  manager_signed?: boolean;
  investor_signed?: boolean;
  both_signed?: boolean;
  contract_fully_signed?: boolean;
  manager_signed_at?: string | null;
  manager_signed_name?: string | null;
  investor_signed_at?: string | null;
  investor_signed_name?: string | null;
  manager_signature_png?: string | null;
  investor_signature_png?: string | null;
};
