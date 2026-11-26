export function variance(actual: number, expected: number): number {
  if (!Number.isInteger(actual) || !Number.isInteger(expected)) {
    throw new Error("Quantity must be a whole number")
  }
  return actual - expected
}

export function varianceLabel(value: number): string {
  if (value < 0) return `${value} SHORT`
  if (value > 0) return `+${value} OVER`
  return "0 EVEN"
}
