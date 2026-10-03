/** Joins class names, leaving out the ones that are not turned on. */
export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");
