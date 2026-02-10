import type { Env } from '../types/env';

interface TradeProcessedMessage {
  type: 'trade_processed';
  agentId: string;
  txSignature: string;
  isBuyback: boolean;
}

export async function tradeQueueConsumer(
  batch: MessageBatch<unknown>,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body as TradeProcessedMessage;

    try {
      switch (body.type) {
        case 'trade_processed':
          console.log(
            `Trade processed: agent=${body.agentId}, tx=${body.txSignature}, buyback=${body.isBuyback}`,
          );
          message.ack();
          break;

        default:
          console.warn('Unknown queue message type:', (body as any).type);
          message.ack();
      }
    } catch (err) {
      console.error('Queue consumer error:', err);
      message.retry();
    }
  }
}
