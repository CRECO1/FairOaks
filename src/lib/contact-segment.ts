// Tenants vs brokers/agents (vs everyone else) — one definition for the Call Queue and the Rent Roll
// prospects table. crm_clients.type is Buyer | Seller | Tenant | Landlord/Investor | Agent | Broker.
export type Segment = 'tenant' | 'broker' | 'other';

export const segmentOf = (type: string | null | undefined): Segment =>
  type === 'Tenant' ? 'tenant' : type === 'Agent' || type === 'Broker' ? 'broker' : 'other';

export const SEGMENT_LABEL: Record<Segment, string> = { tenant: 'Tenants', broker: 'Brokers & Agents', other: 'Owners & other' };
export const SEGMENTS: Segment[] = ['tenant', 'broker', 'other'];
