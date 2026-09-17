export type UserRole = "CUSTOMER" | "SUPPORT";
export type TicketStatus =
  | "OPEN"
  | "PROCESSING"
  | "NEEDS_INFORMATION"
  | "AWAITING_APPROVAL"
  | "RESOLVED"
  | "ESCALATED"
  | "FAILED";

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
};

export type Product = { id: string; name: string; price: number };
export type InventoryItem = { productId: string; stock: number };
export type Order = {
  id: string;
  customerId: string;
  productId: string;
  status: "DELIVERED" | "SHIPPED";
  deliveredAt: string | null;
};
export type Policy = { id: string; title: string; content: string };

export type Ticket = {
  id: string;
  customerId: string;
  orderId: string | null;
  subject: string;
  status: TicketStatus;
  finalResponse: string | null;
  escalationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  ticketId: string;
  role: "CUSTOMER" | "AGENT";
  content: string;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  ticketId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  toolCallCount: number;
  startedAt: string;
  completedAt: string | null;
};

export type ToolCall = {
  id: string;
  runId: string;
  ticketId: string;
  sequence: number;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "SUCCEEDED" | "FAILED";
  result: unknown | null;
  error: unknown | null;
  createdAt: string;
};

export type Action = {
  id: string;
  ticketId: string;
  orderId: string;
  type: "REFUND" | "REPLACEMENT";
  status: "PENDING" | "COMPLETED" | "REJECTED";
  amount: number | null;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

export type Approval = {
  id: string;
  ticketId: string;
  actionId: string;
  supportUserId: string;
  decision: "APPROVED" | "REJECTED";
  note: string | null;
  createdAt: string;
};

export type AppState = {
  users: User[];
  products: Product[];
  inventory: InventoryItem[];
  orders: Order[];
  policies: Policy[];
  tickets: Ticket[];
  messages: Message[];
  agentRuns: AgentRun[];
  toolCalls: ToolCall[];
  actions: Action[];
  approvals: Approval[];
  activeRuns: Set<string>;
};

const passwordHash =
  "$argon2id$v=19$m=65536,t=2,p=1$razZBR8PFZthEq6Ht0wtaW27hp5rSd55My53nIkWS0w$wA+/ydmI6D86x6eUpBAxEULggS9N558+LCZCHBhUjXA";

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
}

export function createSeedState(): AppState {
  return {
    users: [
      {
        id: "USR-CUSTOMER-1",
        name: "Aarav Customer",
        email: "customer1@s30.test",
        passwordHash,
        role: "CUSTOMER",
      },
      {
        id: "USR-CUSTOMER-2",
        name: "Mira Customer",
        email: "customer2@s30.test",
        passwordHash,
        role: "CUSTOMER",
      },
      {
        id: "USR-SUPPORT-1",
        name: "S30 Support",
        email: "support@s30.test",
        passwordHash,
        role: "SUPPORT",
      },
    ],
    products: [
      { id: "PROD-KEYBOARD", name: "Mechanical Keyboard", price: 1500 },
      { id: "PROD-HEADPHONES", name: "Wireless Headphones", price: 4999 },
      { id: "PROD-MOUSE", name: "Wireless Mouse", price: 999 },
    ],
    inventory: [
      { productId: "PROD-KEYBOARD", stock: 10 },
      { productId: "PROD-HEADPHONES", stock: 5 },
      { productId: "PROD-MOUSE", stock: 0 },
    ],
    orders: [
      {
        id: "ORD-1001",
        customerId: "USR-CUSTOMER-1",
        productId: "PROD-KEYBOARD",
        status: "DELIVERED",
        deliveredAt: daysAgo(3),
      },
      {
        id: "ORD-1002",
        customerId: "USR-CUSTOMER-1",
        productId: "PROD-HEADPHONES",
        status: "DELIVERED",
        deliveredAt: daysAgo(5),
      },
      {
        id: "ORD-1003",
        customerId: "USR-CUSTOMER-2",
        productId: "PROD-MOUSE",
        status: "DELIVERED",
        deliveredAt: daysAgo(2),
      },
      {
        id: "ORD-OLD-1",
        customerId: "USR-CUSTOMER-1",
        productId: "PROD-KEYBOARD",
        status: "DELIVERED",
        deliveredAt: daysAgo(45),
      },
      {
        id: "ORD-SHIPPED-1",
        customerId: "USR-CUSTOMER-1",
        productId: "PROD-KEYBOARD",
        status: "SHIPPED",
        deliveredAt: null,
      },
    ],
    policies: [
      {
        id: "POL-REPLACEMENT",
        title: "Damaged item replacement",
        content: "Damaged delivered items can be replaced within 7 days when stock exists.",
      },
      {
        id: "POL-REFUND",
        title: "Refunds",
        content:
          "Delivered orders can be refunded within 30 days. Refunds above ₹2,000 require support approval.",
      },
      {
        id: "POL-DUPLICATE",
        title: "Duplicate actions",
        content: "An order may receive only one refund or replacement.",
      },
    ],
    tickets: [],
    messages: [],
    agentRuns: [],
    toolCalls: [],
    actions: [],
    approvals: [],
    activeRuns: new Set(),
  };
}

// Keep this object reference stable. Access collections as state.tickets/state.orders.
export const state: AppState = createSeedState();

export function resetState() {
  if (state.activeRuns.size > 0) return false;
  Object.assign(state, createSeedState());
  return true;
}
