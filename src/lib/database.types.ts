// Hand-written types matching the SQL schema.
// Replace later with auto-generated via `supabase gen types typescript`.

export type MemberRole = 'manager' | 'cleaner' | 'maintenance' | 'owner';
export type TurnoverStatus = 'pending' | 'in-progress' | 'done' | 'blocked';
export type WaStatus = 'pending' | 'ticketed' | 'rejected' | 'replied';
export type TicketStatus = 'open' | 'in-progress' | 'waiting' | 'closed';
export type TicketStage = 'open' | 'accepted' | 'en-route' | 'on-site' | 'fixed' | 'closed';
export type TicketPriority = 'urgent' | 'high' | 'med' | 'low';

export interface Org { id: string; name: string; slug: string; plan: string; created_at: string; }

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Membership { org_id: string; user_id: string; role: MemberRole; created_at: string; }

export interface Building {
  id: string; org_id: string; name: string; address: string; zone: string | null; created_at: string;
}

export interface Property {
  id: string;
  org_id: string;
  building_id: string | null;
  owner_user_id: string | null;
  name: string;
  unit: string | null;
  full_name: string;
  address: string;
  zone: string | null;
  door_code: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  notes: string | null;
  hostaway_id: string | null;
  default_cleaner_id: string | null;
  checklist_template_id: string | null;
  created_at: string;
}

export interface ChecklistTemplate {
  id: string; org_id: string; name: string; is_default: boolean; created_at: string;
}

export interface ChecklistItem {
  id: string; template_id: string; group_name: string; position: number;
  text: string; requires_photo: boolean;
}

export interface Turnover {
  id: string;
  org_id: string;
  property_id: string;
  checkout_at: string | null;
  checkin_at: string | null;
  guests: number | null;
  nights: number | null;
  cleaner_id: string | null;
  status: TurnoverStatus;
  notes: string | null;
  hostaway_reservation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TurnoverChecklistItem {
  id: string; turnover_id: string; group_name: string; position: number;
  text: string; requires_photo: boolean; done: boolean;
  done_at: string | null; done_by: string | null; photo_url: string | null;
}

export interface WaMessage {
  id: string;
  org_id: string;
  external_id: string | null;
  who: string;
  who_phone: string | null;
  subtitle: string | null;
  body: string;
  photo_url: string | null;
  received_at: string;
  parsed_type: string | null;
  parsed_property_id: string | null;
  parsed_priority: string | null;
  parsed_confidence: number | null;
  parsed_splits: number | null;
  status: WaStatus;
  ticket_id: string | null;
  raw_payload: any;
}

export interface Ticket {
  id: string;
  org_id: string;
  property_id: string;
  number: number;
  title: string;
  type: string;
  priority: TicketPriority;
  status: TicketStatus;
  stage: TicketStage;
  tech_id: string | null;
  due_at: string | null;
  cost_cents: number | null;
  parts_cents: number | null;
  source_message_id: string | null;
  blocks_turnover: boolean;
  turnover_id: string | null;
  photos: { before?: string; during?: string; after?: string };
  bill_to: 'owner' | 'guest' | 'ops';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketEvent {
  id: string; ticket_id: string; actor_id: string | null;
  kind: string; details: any; created_at: string;
}

export interface DamageReport {
  id: string; org_id: string; turnover_id: string; property_id: string;
  reporter_id: string; preset: string | null; description: string | null;
  cost_cents: number | null; bill_to: string;
  photo_url: string | null; ticket_id: string | null; created_at: string;
}

export interface OwnerStatement {
  id: string; org_id: string; property_id: string; owner_user_id: string;
  period_month: number; period_year: number;
  revenue_cents: number; cleaning_cents: number; maintenance_cents: number;
  channel_fees_cents: number; mgmt_fee_cents: number; payout_cents: number;
  status: string; paid_at: string | null; pdf_url: string | null; created_at: string;
}

export interface OrgSettings {
  org_id: string;
  ai_confidence_threshold: number;
  auto_reply: boolean;
  auto_create: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  hostaway_account_id: string | null;
  hostaway_api_key_encrypted: string | null;
  green_api_instance_id: string | null;
  green_api_token_encrypted: string | null;
  whatsapp_phone: string | null;
  updated_at: string;
}

// Minimal Database type so the supabase client is typed.
type T<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      orgs:                       T<Org>;
      profiles:                   T<Profile>;
      memberships:                T<Membership>;
      buildings:                  T<Building>;
      properties:                 T<Property>;
      checklist_templates:        T<ChecklistTemplate>;
      checklist_items:            T<ChecklistItem>;
      turnovers:                  T<Turnover>;
      turnover_checklist_items:   T<TurnoverChecklistItem>;
      wa_messages:                T<WaMessage>;
      tickets:                    T<Ticket>;
      ticket_events:              T<TicketEvent>;
      damage_reports:             T<DamageReport>;
      owner_statements:           T<OwnerStatement>;
      org_settings:               T<OrgSettings>;
    };
    Views: { [k: string]: never };
    Functions: {
      join_org: { Args: { p_slug: string; p_role?: MemberRole }; Returns: string };
    };
    Enums: {
      member_role: MemberRole;
      turnover_status: TurnoverStatus;
      wa_status: WaStatus;
      ticket_status: TicketStatus;
      ticket_stage: TicketStage;
      ticket_priority: TicketPriority;
    };
    CompositeTypes: { [k: string]: never };
  };
}
