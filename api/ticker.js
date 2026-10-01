export default async function handler(req, res) {
  try {
    const { symbol = "ONDO" } = req.query;

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

    const url =
      `https://api-contract.weex.com/capi/v2/market/ticker?symbol=${encodeURIComponent(
        weexSymbol
      )}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "WEEX returned an error",
        status: response.status,
        response: text,
      });
    }

    const data = JSON.parse(text);

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      source: "WEEX",
      market: "USDT perpetual",
      requestedSymbol: symbol.toUpperCase(),
      weexSymbol: weexSymbol,
      retrievedAt: new Date().toISOString(),

      last: data.last,
      markPrice: data.markPrice,
      indexPrice: data.indexPrice,

      bid: data.best_bid,
      ask: data.best_ask,

      high24h: data.high_24h,
      low24h: data.low_24h,
      change24h: data.priceChangePercent,

      volume24h: data.volume_24h,
      exchangeTimestamp: data.timestamp,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      message: error.message,
    });
  }
}
