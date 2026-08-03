export type LeadStatus =
  | "New"
  | "Contacted"
  | "Appointment Set"
  | "No Answer"
  | "Bad Number"
  | "Closed"
  | "Replaced";

export type LeadPackageId =
  | "blue-collar-iul"
  | "aged-iul"
  | "aged-iul-0-14"
  | "aged-iul-15-30"
  | "aged-iul-31plus"
  | "term-leads";

export interface LeadPackage {
  id: LeadPackageId;
  name: string;
  tagline: string;
  description: string;
  pricePerLead: number;
  minimumOrder: number;
  estimatedDelivery: string;
  freshnessHours?: number;
  badge?: string;
  features: string[];
  ideal: string[];
  niches: string[];
  available: boolean;
  comingSoonNote?: string;
  // Aged-bucket support: a bucket sells from an underlying lead pool
  // (`leadPackageId`) filtered to an age window. `hidden` keeps the raw pool
  // entry out of the marketplace grid (used only for label resolution).
  leadPackageId?: LeadPackageId;
  ageMinDays?: number;
  ageMaxDays?: number;
  hidden?: boolean;
}

export interface LeadFilters {
  states?: string[];
  ageRange?: [number, number];
  incomeRange?: [number, number];
  occupations?: string[];
}

export type LeadDisposition =
  | "interested"
  | "callback"
  | "not_interested"
  | "voicemail"
  | "wrong_number"
  | "do_not_call"
  | "left_message"
  | "qualified"
  | "sold";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  state: string;
  age: number;
  income: number;
  occupation: string;
  leadType: LeadPackageId;
  leadTypeLabel: string;
  status: LeadStatus;
  disposition?: LeadDisposition;
  source: string;
  tags: string[];
  consent: {
    captured: boolean;
    method: "TCPA Web Form" | "TrustedForm" | "Jornaya";
    timestamp: string;
    ip?: string;
  };
  receivedAt: string;
  lastContactedAt?: string;
  assignedAgent?: string;
  intentReason: string;
  notes: LeadNote[];
  tasks: LeadTask[];
  activity: LeadActivity[];
  callAttempts: number;
}

export interface LeadNote {
  id: string;
  author: string;
  body: string;
  at: string;
}

export type LeadTaskType =
  | "call"
  | "email"
  | "sms"
  | "appointment"
  | "follow_up";

export interface LeadTask {
  id: string;
  leadId: string;
  leadName: string;
  type: LeadTaskType;
  title: string;
  dueAt: string;
  done: boolean;
  assignedTo: string;
}

export type LeadActivityType =
  | "lead_received"
  | "call_made"
  | "email_sent"
  | "sms_sent"
  | "note_added"
  | "status_changed"
  | "appointment_set"
  | "exported_crm"
  | "tag_added"
  | "replacement_requested";

export interface LeadActivity {
  id: string;
  type: LeadActivityType;
  author?: string;
  body: string;
  at: string;
}

export interface OrderItem {
  packageId: LeadPackageId;
  packageName: string;
  quantity: number;
  pricePerLead: number;
}

export type OrderStatus =
  | "Pending"
  | "Processing"
  | "Delivering"
  | "Delivered"
  | "Refunded";

export interface Order {
  id: string;
  date: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  delivered: number;
  total_leads: number;
  filters?: LeadFilters;
}

export interface User {
  id: string;
  name: string;
  email: string;
  agency?: string;
  role: "agent" | "agency_owner" | "admin";
  avatarUrl?: string;
  state?: string;
  joinedAt: string;
}

export type IntegrationType =
  | "gohighlevel"
  | "salesforce"
  | "hubspot"
  | "zapier"
  | "sheets"
  | "webhook"
  | "dialer"
  | "twilio"
  | "calendar";

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: "connected" | "available" | "coming_soon";
  description: string;
}
