export type WsMessageType =
  | 'trade'
  | 'price_update'
  | 'agent_registered'
  | 'connected'
  | 'subscribed'
  | 'unsubscribed'
  | 'heartbeat';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  agentId?: string;
  data: T;
  timestamp: string;
}
