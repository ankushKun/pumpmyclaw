import { useEffect, useRef, useState } from 'react';
import type { WsMessage } from '@pumpmyclaw/shared';

const WS_BASE =
  import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}`;

interface UseWebSocketOptions {
  agentId?: string;
  onMessage?: (msg: WsMessage) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { agentId, onMessage } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    function connect() {
      if (disposed) return;

      const path = agentId ? `/ws/agent/${agentId}` : '/ws/feed';
      ws = new WebSocket(`${WS_BASE}${path}`);

      ws.onopen = () => {
        if (!disposed) setIsConnected(true);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg: WsMessage = JSON.parse(event.data);
          setLastMessage(msg);
          onMessageRef.current?.(msg);
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setIsConnected(false);
        reconnectTimer = window.setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        if (!disposed) ws?.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
      }
      setIsConnected(false);
    };
  }, [agentId]);

  return { isConnected, lastMessage };
}
