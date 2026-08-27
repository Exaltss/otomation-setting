/**
 * Context Manager — Fase 23E Enhancement.
 * Manajemen context window untuk AUTO REMOTE mode.
 * 
 * Fitur:
 * - Context tracking (current tokens)
 * - Auto-compact saat context penuh (pakai specialist compress)
 * - Context persistence untuk multi-turn
 * - History storage untuk audit
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from '../engine.mjs';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const CONTEXT_FILE = path.join(DATA_DIR, 'context-history.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readContextHistory() {
  ensureDir();
  if (!existsSync(CONTEXT_FILE)) return {};
  try { return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')); }
  catch { return {}; }
}

function writeContextHistory(history) {
  ensureDir();
  writeFileSync(CONTEXT_FILE, JSON.stringify(history, null, 2));
}

// Config per mode
const MODE_CONTEXT_CONFIG = {
  auto: {
    maxTokens: 8192,
    compactThreshold: 0.8, // compact saat 80% penuh
    historySize: 10, // simpan 10 conversation terakhir
  },
  manual: {
    maxTokens: 8192,
    compactThreshold: 0.8,
    historySize: 10,
  },
  planning: {
    maxTokens: 16384, // planning butuh context besar
    compactThreshold: 0.85,
    historySize: 20,
  },
  auto_remote: {
    maxTokens: 32768, // YOLO butuh context sangat besar
    compactThreshold: 0.9,
    historySize: 50, // simpan banyak history untuk audit
  },
};

/**
 * Buat context manager baru.
 * @param {string} sessionId - Session identifier
 * @param {string} mode - Mode (auto/manual/planning/auto_remote)
 * @returns {Object} context manager instance
 */
export function createContextManager(sessionId, mode = 'auto_remote') {
  const config = MODE_CONTEXT_CONFIG[mode] || MODE_CONTEXT_CONFIG.auto;
  const history = readContextHistory();
  
  if (!history[sessionId]) {
    history[sessionId] = {
      mode,
      messages: [],
      totalTokens: 0,
      createdAt: new Date().toISOString(),
      compactCount: 0,
    };
    writeContextHistory(history);
  }

  const session = history[sessionId];

  return {
    config,
    
    /**
     * Tambah message ke context.
     * @param {Object} message - { role, content }
     */
    addMessage(message) {
      const tokens = estimateTokens(message.content || '');
      session.messages.push({ ...message, tokens, timestamp: new Date().toISOString() });
      session.totalTokens += tokens;
      
      // Trim history jika terlalu banyak
      while (session.messages.length > config.historySize * 2) {
        const removed = session.messages.shift();
        session.totalTokens -= removed.tokens || 0;
      }
      
      writeContextHistory(history);
    },

    /**
     * Cek apakah context sudah penuh.
     */
    needsCompaction() {
      return session.totalTokens >= config.maxTokens * config.compactThreshold;
    },

    /**
     * Compact context (summarize old messages).
     * Dipanggil otomatis saat context penuh.
     * @param {Function} callModel - Gateway callModel function
     * @returns {Promise<Object>} compaction result
     */
    async compact(callModel) {
      if (session.messages.length < 4) {
        return { compacted: false, reason: 'not enough messages' };
      }

      // Ambil 60% messages lama untuk summarize
      const splitIndex = Math.floor(session.messages.length * 0.6);
      const oldMessages = session.messages.slice(0, splitIndex);
      const recentMessages = session.messages.slice(splitIndex);

      const prompt = `Summarize this conversation concisely (max 500 words). Keep important facts, decisions, and context:

${oldMessages.map(m => `${m.role}: ${m.content}`).join('\n\n')}

Summary:`;

      try {
        const result = await callModel('auto', [{ role: 'user', content: prompt }], {
          maxTokens: 1024,
          sampling: { temperature: 0.1 },
        });

        const summary = result.content || result.reasoning || '';
        
        // Replace old messages dengan summary
        const summaryMessage = {
          role: 'system',
          content: `[Context Summary]\n${summary}`,
          tokens: estimateTokens(summary),
          timestamp: new Date().toISOString(),
          isSummary: true,
        };

        session.messages = [summaryMessage, ...recentMessages];
        session.totalTokens = session.messages.reduce((sum, m) => sum + (m.tokens || 0), 0);
        session.compactCount += 1;
        
        writeContextHistory(history);

        return {
          compacted: true,
          oldCount: oldMessages.length,
          newCount: session.messages.length,
          tokensBefore: oldMessages.reduce((sum, m) => sum + (m.tokens || 0), 0),
          tokensAfter: summaryMessage.tokens,
        };
      } catch (error) {
        return {
          compacted: false,
          error: String(error?.message ?? error),
        };
      }
    },

    /**
     * Ambil context untuk dikirim ke model.
     */
    getContext() {
      return session.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
    },

    /**
     * Get context stats.
     */
    getStats() {
      return {
        messageCount: session.messages.length,
        totalTokens: session.totalTokens,
        maxTokens: config.maxTokens,
        usage: (session.totalTokens / config.maxTokens * 100).toFixed(1) + '%',
        compactCount: session.compactCount,
        needsCompaction: this.needsCompaction(),
      };
    },

    /**
     * Clear context (reset session).
     */
    clear() {
      session.messages = [];
      session.totalTokens = 0;
      session.compactCount = 0;
      writeContextHistory(history);
    },
  };
}

/**
 * List semua active sessions.
 */
export function listSessions() {
  const history = readContextHistory();
  return Object.keys(history).map(id => ({
    id,
    mode: history[id].mode,
    messageCount: history[id].messages.length,
    totalTokens: history[id].totalTokens,
    createdAt: history[id].createdAt,
  }));
}
