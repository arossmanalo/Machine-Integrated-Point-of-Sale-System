/** All money in the app is an integer number of centavos. */
export type Centavos = number;

export function pesosToCentavos(pesos: number): Centavos {
  return Math.round(pesos * 100);
}

/**
 * Parses what a person typed into a peso field ("150", "150.5", "1,250.75").
 * Returns null for anything that is not a non-negative amount with at most two decimals.
 */
export function parsePesoInput(text: string): Centavos | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1,234.50" with no currency sign. */
export function formatAmount(centavos: Centavos): string {
  const sign = centavos < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(centavos));
  const whole = Math.floor(absolute / 100).toString();
  const fraction = (absolute % 100).toString().padStart(2, '0');
  return `${sign}${groupThousands(whole)}.${fraction}`;
}

/** "₱1,234.50" for the screen. Receipts use "Php" because thermal printers lack the peso sign. */
export function formatPeso(centavos: Centavos): string {
  return centavos < 0 ? `-₱${formatAmount(-centavos)}` : `₱${formatAmount(centavos)}`;
}

/** Value for pre-filling an input: "150" or "150.50". */
export function centavosToInput(centavos: Centavos): string {
  return centavos % 100 === 0 ? String(centavos / 100) : formatAmount(centavos).replace(/,/g, '');
}
