import type { Integration } from "@/types";

export const integrations: Integration[] = [
  {
    id: "ghl",
    type: "gohighlevel",
    name: "GoHighLevel",
    status: "available",
    description:
      "Push purchased leads directly into your GHL pipeline with custom tags and pipeline stages.",
  },
  {
    id: "sf",
    type: "salesforce",
    name: "Salesforce",
    status: "available",
    description: "Native Salesforce Lead object mapping with custom field support.",
  },
  {
    id: "hs",
    type: "hubspot",
    name: "HubSpot",
    status: "available",
    description: "Two-way sync to HubSpot contacts and deals.",
  },
  {
    id: "zap",
    type: "zapier",
    name: "Zapier",
    status: "available",
    description: "Trigger any of 6,000+ apps with new lead, status change, or replacement events.",
  },
  {
    id: "sheets",
    type: "sheets",
    name: "Google Sheets",
    status: "connected",
    description: "Auto-append new leads to a connected Google Sheet for shared visibility.",
  },
  {
    id: "webhook",
    type: "webhook",
    name: "Custom Webhook",
    status: "available",
    description: "POST every new lead event to any endpoint with HMAC-signed payloads.",
  },
];
