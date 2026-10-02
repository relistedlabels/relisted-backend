/** Platform service fee rounded down to a whole naira. */
export function calculatePlatformFee(amount: number): number {
  return Math.floor(amount * 0.1);
}
