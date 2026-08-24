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

/**
 * Konsumsi Result dalam satu tempat (fold / catamorphism).
 * Memusatkan konsumsi Result dengan satu assertion eksplisit,
 * sehingga call site kebal terhadap quirk narrowing TS.
 */
export function foldResult<T, E, R>(
  result: Result<T, E>,
  onOk: (value: T) => R,
  onErr: (error: E) => R,
): R {
  const boxed = result as { ok: boolean; value?: T; error?: E };
  return boxed.ok ? onOk(boxed.value as T) : onErr(boxed.error as E);
}

/**
 * Ekstrak value atau throw error.
 * HANYA untuk pipeline internal yang sudah dibungkus try/catch
 * dan dikonversi kembali menjadi Result di boundary.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  const boxed = result as { ok: boolean; value?: T; error?: E };
  if (!boxed.ok) {
    throw boxed.error instanceof Error
      ? boxed.error
      : new Error(String(boxed.error));
  }
  return boxed.value as T;
}