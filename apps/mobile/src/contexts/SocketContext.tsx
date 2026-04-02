import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../services/api';

// ── Types ────────────────────────────────────────────────────────────────────
interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
}

// ── Context ──────────────────────────────────────────────────────────────────
const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

// ── Provider ─────────────────────────────────────────────────────────────────
interface SocketProviderProps {
  children: React.ReactNode;
  /** Pass userToken so the socket reconnects automatically on login/logout. */
  userToken: string | null;
}

export function SocketProvider({ children, userToken }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userToken) {
      setSocket((prev) => { prev?.disconnect(); return null; });
      setIsConnected(false);
      return;
    }

    const instance = io(API_BASE_URL, {
      auth: { token: 'Bearer ' + userToken },
      transports: ['websocket', 'polling'],
      upgrade: true,
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    instance.on('connect', () => setIsConnected(true));
    instance.on('disconnect', () => setIsConnected(false));
    instance.on('connect_error', (err) => {
      console.warn('[SocketContext] connect_error:', err.message);
    });

    setSocket(instance);

    return () => {
      instance.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [userToken]); // re-runs every time the token changes (login / logout)

  const value = useMemo<SocketContextValue>(
    () => ({ socket, isConnected }),
    [socket, isConnected],
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used inside <SocketProvider>');
  }
  return context;
}
