/**
 * Result<T, E> — type-safe alternative to thrown exceptions.
 * Memaksa caller menangani kasus kegagalan secara eksplisit
 * (pola Rust/Elixir), mencegah crash tak terduga di execution engine.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Membungkus nilai sukses. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Membungkus kegagalan. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });