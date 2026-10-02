function normalizeSymbol(symbol = "ONDO") {
  let clean = symbol
    .toLowerCase()
    .replaceAll("-", "")
    .replaceAll("_", "");

  if (clean.startsWith("cmt")) {
    clean = clean.substring(3);
  }

  if (!clean.endsWith("usdt")) {
    clean += "usdt";
  }

  return `cmt_${clean}`;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname;

    // ---------- TICKER ----------
    if (path === "/ticker") {
      const symbol = url.searchParams.get("symbol") || "ONDO";
      const weexSymbol = normalizeSymbol(symbol);

      const weexUrl =
        `https://api-contract.weex.com/capi/v2/market/ticker?symbol=${encodeURIComponent(weexSymbol)}`;

      const response = await fetch(weexUrl, {
        headers: { Accept: "application/json" }
      });

      const text = await response.text();

      if (!response.ok) {
        return Response.json(
          {
            error: "WEEX returned an error",
            status: response.status,
            response: text
          },
          { status: response.status }
        );
      }

      const data = JSON.parse(text);

      return Response.json({
        source: "WEEX",
        market: "USDT perpetual",
        requestedSymbol: symbol.toUpperCase(),
        weexSymbol,
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
        exchangeTimestamp: data.timestamp
      });
    }

    // ---------- CANDLES ----------
    if (path === "/candles") {
      const symbol = url.searchParams.get("symbol") || "ONDO";
      const interval = url.searchParams.get("interval") || "4h";

      const requestedLimit =
        parseInt(url.searchParams.get("limit") || "100");

      const limit = Math.min(
        Math.max(requestedLimit || 100, 1),
        500
      );

      const allowedIntervals = [
        "1m", "5m", "15m", "30m",
        "1h", "4h", "12h", "1d", "1w"
      ];

      if (!allowedIntervals.includes(interval)) {
        return Response.json(
          {
            error: "Invalid interval",
            allowedIntervals
          },
          { status: 400 }
        );
      }

      const weexSymbol = normalizeSymbol(symbol);

      const weexUrl =
        `https://api-contract.weex.com/capi/v2/market/candles` +
        `?symbol=${encodeURIComponent(weexSymbol)}` +
        `&granularity=${encodeURIComponent(interval)}` +
        `&limit=${limit}` +
        `&priceType=LAST`;

      const response = await fetch(weexUrl, {
        headers: { Accept: "application/json" }
      });

      const text = await response.text();

      if (!response.ok) {
        return Response.json(
          {
            error: "WEEX returned an error",
            status: response.status,
            response: text
          },
          { status: response.status }
        );
      }

      const raw = JSON.parse(text);

      if (!Array.isArray(raw)) {
        return Response.json(
          {
            error: "Unexpected WEEX response",
            raw
          },
          { status: 502 }
        );
      }

      const candles = raw.map((c) => ({
        timestamp: Number(c[0]),
        time: new Date(Number(c[0])).toISOString(),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volumeBase: Number(c[5]),
        volumeQuote: Number(c[6])
      }));

      return Response.json({
        source: "WEEX",
        market: "USDT perpetual",
        requestedSymbol: symbol.toUpperCase(),
        weexSymbol,
        interval,
        count: candles.length,
        retrievedAt: new Date().toISOString(),
        candles
      });
    }

    // ---------- HOMEPAGE ----------
    return Response.json({
      status: "ok",
      service: "WEEX market data bridge",
      endpoints: [
        "/ticker?symbol=ONDO",
        "/candles?symbol=ONDO&interval=4h&limit=20",
        "/candles?symbol=ONDO&interval=1d&limit=20"
      ]
    });

  } catch (error) {
    return Response.json(
      {
        error: "Server error",
        message: error.message
      },
      { status: 500 }
    );
  }
});
