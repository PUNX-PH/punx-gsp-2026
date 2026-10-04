/** A daily limit from an environment value: a whole number of 0 or more and nothing else (no spaces, signs, decimals or exponents); anything else is the fallback. 0 means nobody. */
export const dailyLimit = (value: string | undefined, fallback: number): number => (value !== undefined && /^\d+$/.test(value) ? Number(value) : fallback);
