import type { Order } from "@/types";

export const mockOrders: Order[] = [
  {
    id: "ORD-2026-0521",
    date: "2026-05-11T09:00:00Z",
    items: [
      {
        packageId: "fresh-iul",
        packageName: "Fresh IUL Leads",
        quantity: 25,
        pricePerLead: 32,
      },
    ],
    total: 800,
    status: "Delivering",
    delivered: 18,
    total_leads: 25,
    filters: { states: ["TX", "FL", "OH"], ageRange: [35, 60] },
  },
  {
    id: "ORD-2026-0518",
    date: "2026-05-08T14:11:00Z",
    items: [
      {
        packageId: "blue-collar-iul",
        packageName: "Blue-Collar IUL Leads",
        quantity: 40,
        pricePerLead: 30,
      },
    ],
    total: 1200,
    status: "Delivered",
    delivered: 40,
    total_leads: 40,
    filters: { states: ["NY", "PA", "OH"], occupations: ["Lineman", "Electrician"] },
  },
  {
    id: "ORD-2026-0509",
    date: "2026-04-29T17:30:00Z",
    items: [
      {
        packageId: "retirement-iul",
        packageName: "Retirement-Focused IUL Leads",
        quantity: 15,
        pricePerLead: 38,
      },
    ],
    total: 570,
    status: "Delivered",
    delivered: 15,
    total_leads: 15,
    filters: { ageRange: [50, 65], incomeRange: [90000, 250000] },
  },
  {
    id: "ORD-2026-0497",
    date: "2026-04-22T10:02:00Z",
    items: [
      {
        packageId: "aged-iul",
        packageName: "Aged IUL Leads",
        quantity: 250,
        pricePerLead: 6,
      },
    ],
    total: 1500,
    status: "Delivered",
    delivered: 250,
    total_leads: 250,
  },
  {
    id: "ORD-2026-0488",
    date: "2026-04-15T12:45:00Z",
    items: [
      {
        packageId: "mortgage-iul",
        packageName: "Mortgage Protection to IUL",
        quantity: 30,
        pricePerLead: 26,
      },
    ],
    total: 780,
    status: "Delivered",
    delivered: 30,
    total_leads: 30,
  },
];
