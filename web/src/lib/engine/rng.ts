/** The engine's only random source: xorshift32 on uint32, as docs/superpowers/notes/engine-semantics.md says. Returns the new state each call. */
export function xorshift32(seed: number): () => number {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}
