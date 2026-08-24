/**
 * Compressed Context engine.
 *
 * Tujuan: memadatkan konteks percakapan SEBELUM dikirim ke LLM
 * untuk meminimalkan token usage (credit limit).
 *
 * Strategi (O(n), single pass):
 * 1. Sanitasi pesan (trim, buang yang kosong).
 * 2. Jika total token <= budget -> loloskan apa adanya.
 * 3. Jika overflow -> pertahankan pesan terbaru (70% budget),
 *    rangkum pesan lama ke sisa 30% budget.
 */
import { err, ok, type Result } from '../../core/result';
import type { CompressedContext, ContextMessage } from '../../domain/automation';
import { estimateTokens } from '../router/nineRouter';

/** Pangkas teks agar muat dalam estimasi token (~4 karakter per token). */
function truncateToTokenEstimate(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return '';
  }

  const approximateChars = Math.floor(maxTokens * 4);

  if (text.length <= approximateChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, approximateChars - 3))}...`;
}

/**
 * Memadatkan daftar pesan agar muat dalam budget token.
 * Mengembalikan Result — caller WAJIB menangani kasus input tidak valid.
 */
export function compressContext(
  messages: ContextMessage[],
  maxTokens: number,
): Result<CompressedContext, Error> {
  if (!Array.isArray(messages)) {
    return err(new Error('messages must be an array.'));
  }

  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return err(new Error('maxTokens must be a positive number.'));
  }

  const sanitized = messages
    .filter(
      (message) =>
        message !== null &&
        typeof message === 'object' &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0,
    )
    .map((message) => ({ ...message, content: message.content.trim() }));

  if (sanitized.length === 0) {
    return ok({ messages: [], summary: '', estimatedTokens: 0, droppedMessages: 0 });
  }

  const totalTokens = sanitized.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );

  // Fast path: konteks sudah muat, tidak perlu kompresi.
  if (totalTokens <= maxTokens) {
    return ok({
      messages: sanitized,
      summary: '',
      estimatedTokens: totalTokens,
      droppedMessages: 0,
    });
  }

  // Pertahankan pesan terbaru dalam 70% budget (recency bias).
  const recentMessages: ContextMessage[] = [];
  let recentTokens = 0;
  const recentBudget = Math.floor(maxTokens * 0.7);

  for (let index = sanitized.length - 1; index >= 0; index -= 1) {
    const message = sanitized[index];
    const tokens = estimateTokens(message.content);

    if (recentTokens + tokens > recentBudget) {
      break;
    }

    recentMessages.unshift(message);
    recentTokens += tokens;
  }

  const droppedMessages = sanitized.length - recentMessages.length;
  const oldMessages = sanitized.slice(0, droppedMessages);

  // Sisa 30% budget dipakai untuk ringkasan pesan lama.
  const summaryBudget = Math.max(0, maxTokens - recentTokens);
  const summarySource = oldMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join(' | ');

  const summary =
    summaryBudget > 0
      ? truncateToTokenEstimate(
          `Summary of ${oldMessages.length} older messages: ${summarySource}`,
          summaryBudget,
        )
      : '';

  const estimatedTokens = recentTokens + estimateTokens(summary);

  return ok({
    messages: recentMessages,
    summary,
    estimatedTokens,
    droppedMessages,
  });
}