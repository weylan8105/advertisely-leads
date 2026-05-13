export type LeadStatus =
  | "New"
  | "Contacted"
  | "Appointment Set"
  | "No Answer"
  | "Bad Number"
  | "Closed"
  | "Replaced";

export type LeadPackageId =
  | "fresh-iul"
  | "blue-collar-iul"
  | "retirement-iul"
  | "mortgage-iul"
  | "aged-iul";

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
}

export interface LeadFilters {
  states?: string[];
  ageRange?: [number, number];
  incomeRange?: [number, number];
  occupations?: string[];
}

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
  source: string;
  consent: {
    captured: boolean;
    method: "TCPA Web Form" | "TrustedForm" | "Jornaya";
    timestamp: string;
    ip?: string;
  };
  receivedAt: string;
  assignedAgent?: string;
  intentReason: string;
  notes: LeadNote[];
}

export interface LeadNote {
  id: string;
  author: string;
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
  | "webhook";

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: "connected" | "available" | "coming_soon";
  description: string;
}
