/** Aggregate monetary values use nonnegative JavaScript-safe integer cents. */
export function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(field + " must be a nonnegative safe integer number of cents");
  }
}

/** A single reservation/charge must fit every supported store's integer column.
 * Monthly ceilings and sums remain safe integers and may exceed this row limit. */
export function assertReservationCents(value: number, field: string): void {
  assertCents(value, field);
  if (value > 2_147_483_647) {
    throw new RangeError(field + " must not exceed 2147483647 cents per reservation");
  }
}
