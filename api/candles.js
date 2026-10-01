export default async function handler(req, res) {
  try {
    const { symbol = "ONDO", interval = "4h", limit = "100" } = req.query;

    let cleanSymbol = symbol
      .toLowerCase()
      .replaceAll("-", "")
      .replaceAll("_", "");

    if (cleanSymbol.startsWith("cmt")) {
      cleanSymbol = cleanSymbol.substring(3);
    }

    if (!cleanSymbol.endsWith("usdt")) {
      cleanSymbol += "usdt";
    }

    const weexSymbol = `cmt_${cleanSymbol}`;

    const allowedIntervals = [
      "1m", "5m", "15m", "30m",
      "1h", "4h", "12h", "1d", "1w"
    ];

    if (!allowedIntervals.includes(interval)) {
      return res.status(400).json({
        error: "Invalid interval",
        allowedIntervals
      });
    }

    const candleLimit = Math.min(
      Math.max(parseInt(limit) || 100, 1),
      500
    );

    const url =
      `https://api-contract.weex.com/capi/v2/market/candles` +
      `?symbol=${encodeURIComponent(weexSymbol)}` +
      `&granularity=${encodeURIComponent(interval)}` +
      `&limit=${candleLimit}` +
      `&priceType=LAST`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "WEEX returned an error",
        status: response.status,
        response: text
      });
    }

    const raw = JSON.parse(text);

    if (!Array.isArray(raw)) {
      return res.status(502).json({
        error: "Unexpected WEEX response",
        raw
      });
    }

    const candles = raw.map(c => ({
      timestamp: Number(c[0]),
      time: new Date(Number(c[0])).toISOString(),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volumeBase: Number(c[5]),
      volumeQuote: Number(c[6])
    }));

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      source: "WEEX",
      market: "USDT perpetual",
      requestedSymbol: symbol.toUpperCase(),
      weexSymbol,
      interval,
      count: candles.length,
      retrievedAt: new Date().toISOString(),
      candles
    });

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      message: error.message
    });
  }
}
