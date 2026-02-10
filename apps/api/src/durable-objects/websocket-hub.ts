import { DurableObject } from 'cloudflare:workers';

interface SessionMetadata {
  id: string;
  subscribedAgentId?: string;
}

export class WebSocketHub extends DurableObject {
  private sessions: Map<WebSocket, SessionMetadata>;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.sessions = new Map();

    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, attachment as SessionMetadata);
      }
    });

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const message = await request.text();
      this.broadcast(message);
      return new Response('ok');
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    const agentId = url.searchParams.get('agentId') ?? undefined;

    const metadata: SessionMetadata = {
      id: crypto.randomUUID(),
      subscribedAgentId: agentId,
    };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(metadata);
    this.sessions.set(server, metadata);

    server.send(
      JSON.stringify({
        type: 'connected',
        data: { sessionId: metadata.id, subscribedAgentId: agentId },
        timestamp: new Date().toISOString(),
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: ArrayBuffer | string,
  ): Promise<void> {
    if (typeof message === 'string') {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'subscribe' && parsed.agentId) {
          const meta = this.sessions.get(ws);
          if (meta) {
            meta.subscribedAgentId = parsed.agentId;
            ws.serializeAttachment(meta);
            ws.send(
              JSON.stringify({
                type: 'subscribed',
                data: { agentId: parsed.agentId },
                timestamp: new Date().toISOString(),
              }),
            );
          }
        } else if (parsed.type === 'unsubscribe') {
          const meta = this.sessions.get(ws);
          if (meta) {
            meta.subscribedAgentId = undefined;
            ws.serializeAttachment(meta);
            ws.send(
              JSON.stringify({
                type: 'unsubscribed',
                timestamp: new Date().toISOString(),
              }),
            );
          }
        }
      } catch {
        // Ignore invalid messages
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    ws.close(code, reason);
    this.sessions.delete(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(1011, 'WebSocket error');
    this.sessions.delete(ws);
  }

  private broadcast(messageStr: string): void {
    let parsed: any;
    try {
      parsed = JSON.parse(messageStr);
    } catch {
      return;
    }

    const messageAgentId = parsed.agentId;

    for (const [ws, meta] of this.sessions) {
      try {
        if (meta.subscribedAgentId && messageAgentId) {
          if (meta.subscribedAgentId !== messageAgentId) continue;
        }
        ws.send(messageStr);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }
}
