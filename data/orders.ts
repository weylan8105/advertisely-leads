/**
 * Mock orders data — DEPRECATED.
 * Orders are now fetched from the real database via /api/orders.
 * This file is kept only for type compatibility during the transition.
 * The mockOrders array is intentionally empty.
 */

import type { Order } from "@/types";

// Empty — all real orders come from the database via /api/orders
export const mockOrders: Order[] = [];
