/**
 * Chat persistence backend — sinkronisasi UI dilakukan di fase berikutnya.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = 'chats.json';

function read() {
  const p = path.join(DATA_DIR, FILE);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function write(list) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, FILE), JSON.stringify(list, null, 2));
}

export function listChats() {
  return read();
}

export function upsertChat(chat) {
  const list = read();
  const i = list.findIndex((c) => c.id === chat.id);
  if (i >= 0) list[i] = chat;
  else list.unshift(chat);
  write(list);
  return chat;
}

export function removeChat(id) {
  write(read().filter((c) => c.id !== id));
}