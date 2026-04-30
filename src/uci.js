const SQUARE = /^[a-h][1-8]$/;
const PROMO = /^[qrbn]$/;

export function parseUci(uci) {
  if (typeof uci !== 'string' || (uci.length !== 4 && uci.length !== 5)) {
    throw new Error(`Invalid UCI: ${JSON.stringify(uci)}`);
  }
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (!SQUARE.test(from) || !SQUARE.test(to)) {
    throw new Error(`Invalid UCI squares: ${uci}`);
  }
  const result = { from, to };
  if (uci.length === 5) {
    const promotion = uci[4];
    if (!PROMO.test(promotion)) {
      throw new Error(`Invalid UCI promotion: ${uci}`);
    }
    result.promotion = promotion;
  }
  return result;
}
