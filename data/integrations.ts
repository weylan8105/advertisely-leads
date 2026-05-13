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
    description:
      "Trigger any of 6,000+ apps with new lead, status change, or replacement events.",
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
    description:
      "POST every new lead event to any endpoint with HMAC-signed payloads.",
  },
  {
    id: "dialer-readymode",
    type: "dialer",
    name: "ReadyMode Dialer",
    status: "available",
    description:
      "Stream new leads directly into your ReadyMode predictive dialer with state and disposition mapping.",
  },
  {
    id: "dialer-callblitz",
    type: "dialer",
    name: "CallTools / Phoneburner",
    status: "coming_soon",
    description:
      "Power-dialer push with one-tap callback scheduling and disposition writeback.",
  },
  {
    id: "twilio",
    type: "twilio",
    name: "Twilio SMS + Voice",
    status: "available",
    description:
      "Send compliant SMS and place click-to-call traffic from inside the Advertisely CRM.",
  },
  {
    id: "calendar",
    type: "calendar",
    name: "Google / Outlook Calendar",
    status: "available",
    description:
      "Two-way sync of appointment-set tasks to your calendar of choice.",
  },
];
