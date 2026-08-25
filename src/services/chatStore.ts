/**
 * Persistensi chat sisi klien (localStorage) — sidebar Recents gaya Gemini.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TournamentTrace } from './gatewayClient';

export interface ChatTrace {
  tier?: string;
  modelUsed?: string;
  providerUsed?: string;
  durationMs?: number;
  tournament?: TournamentTrace;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  trace?: ChatTrace;
  failed?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMsg[];
}

const KEY = 'otom-chats-v1';

export function useChats() {
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Chat[];
    } catch {
      return [];
    }
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(chats));
  }, [chats]);

  const newChat = useCallback(() => setActiveId(null), []);

  const ensureChat = useCallback(
    (firstText: string): string => {
      if (activeId) return activeId;
      const id = crypto.randomUUID();
      const chat: Chat = {
        id,
        title: firstText.slice(0, 48) || 'Percakapan baru',
        createdAt: Date.now(),
        messages: [],
      };
      setChats((p) => [chat, ...p]);
      setActiveId(id);
      return id;
    },
    [activeId],
  );

  const updateChat = useCallback((id: string, fn: (c: Chat) => Chat) => {
    setChats((p) => p.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const deleteChat = useCallback((id: string) => {
    setChats((p) => p.filter((c) => c.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const active = chats.find((c) => c.id === activeId) ?? null;

  return { chats, active, activeId, setActiveId, newChat, ensureChat, updateChat, deleteChat };
}

export type ChatsApi = ReturnType<typeof useChats>;