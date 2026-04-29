export interface Building {
  id: string; name: string; addr: string; zone: string; units: number;
}

export interface Property {
  id: string; name: string; unit: string; building: string;
  full: string; addr: string; zone: string; code: string; wifi: string; notes: string;
}

export interface Staff {
  id: string; name: string; role: string; phone: string; online: boolean;
}

export interface ChecklistItem {
  t: string; photo?: boolean; done: boolean; captured?: boolean;
}

export interface ChecklistGroup {
  g: string; items: ChecklistItem[];
}

export interface Turnover {
  id: string; prop: string; out: string; in: string; guests: number; nights: number;
  cleaner: string | null; status: string; notes: string; tickets: number; photos: boolean;
}

export interface WaMessage {
  id: string; who: string; sub: string; avatar: string; time: string;
  text: string; photo?: boolean;
  parsed: { type: string; prop: string; prio: string; confidence: number; splits?: number };
  status: string; ticketId?: string;
}

export interface Ticket {
  id: string; title: string; prop: string; type: string; prio: string;
  status: string; tech: string | null; due: string; cost: string;
  source: string; created: string; blocksTurnover: boolean;
  stage?: string; photos?: Record<string, boolean>; parts?: number;
}

export interface Tweaks {
  density: string; aiConfidence: number; autoCreate: boolean;
  autoReply: boolean; sidebarCollapsed: boolean; showAnnotations: boolean;
}

export interface Route {
  page: string; tid?: string; id?: string; pid?: string;
}

export interface UrgencyResult {
  level: 'urgent' | 'tight' | 'normal'; gapMin: number | null; label: string;
}
