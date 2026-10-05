const WEEX_BASE = "https://api-contract.weex.com";

const ALLOWED_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "12h",
  "1d",
  "1w",
]);

function normalizeSymbol(symbol = "ONDO") {
  let clean = String(symbol)
    .trim()
    .toUpperCase()
    .replaceAll("-", "")
    .replaceAll("_", "")
    .replaceAll("/", "");

  // Accept old formats such as:
  // ONDO
  // ONDOUSDT
  // cmt_ondousdt
  // cmt-ondousdt
  if (clean.startsWith("CMT")) {
    clean = clean.substring(3);
  }

  if (!clean.endsWith("USDT")) {
    clean += "USDT";
  }

  if (!/^[A-Z0-9]+USDT$/.test(clean)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }

  return clean;
}

async function fetchWeex(url) {
  const response = await fetch(url);

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `WEEX returned non-JSON response (${response.status}): ${text}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `WEEX API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}


/* ============================================================
   WEEX TICKER
   ============================================================ */

async function getWeexTicker(symbolInput) {
  const requestedSymbol = symbolInput || "ONDO";
  const weexSymbol = normalizeSymbol(requestedSymbol);

  const tickerUrl =
    `${WEEX_BASE}/capi/v3/market/ticker/24hr` +
    `?symbol=${encodeURIComponent(weexSymbol)}`;

  const bookTickerUrl =
    `${WEEX_BASE}/capi/v3/market/ticker/bookTicker` +
    `?symbol=${encodeURIComponent(weexSymbol)}`;

  // Fetch ticker + bid/ask simultaneously.
  const [tickerResponse, bookTickerResponse] = await Promise.all([
    fetchWeex(tickerUrl),
    fetchWeex(bookTickerUrl),
  ]);

  // WEEX may return either an object or an array.
  const ticker = Array.isArray(tickerResponse)
    ? tickerResponse[0]
    : tickerResponse;

  const bookTicker = Array.isArray(bookTickerResponse)
    ? bookTickerResponse[0]
    : bookTickerResponse;

  if (!ticker || ticker.lastPrice === undefined) {
    throw new Error(
      `Unexpected WEEX ticker response: ${JSON.stringify(tickerResponse)}`
    );
  }

  return {
    source: "WEEX",
    market: "USDT perpetual",

    requestedSymbol: String(requestedSymbol).toUpperCase(),

    weexSymbol,

    retrievedAt: new Date().toISOString(),

    // Current traded price
    last: ticker.lastPrice,

    // WEEX mark/index prices
    markPrice: ticker.markPrice,
    indexPrice: ticker.indexPrice,

    // Order book
    bid: bookTicker?.bidPrice,
    ask: bookTicker?.askPrice,

    // 24h statistics
    high24h: ticker.highPrice,
    low24h: ticker.lowPrice,
    change24h: ticker.priceChangePercent,
    volume24h: ticker.volume,

    exchangeTimestamp: ticker.closeTime,
  };
}


/* ============================================================
   WEEX CANDLES
   ============================================================ */

async function getWeexCandles(
  symbolInput,
  interval = "4h",
  limit = 100
) {
  const requestedSymbol = symbolInput || "ONDO";
  const weexSymbol = normalizeSymbol(requestedSymbol);

  if (!ALLOWED_INTERVALS.has(interval)) {
    throw new Error(
      `Invalid interval: ${interval}. Allowed: ${[
        ...ALLOWED_INTERVALS,
      ].join(", ")}`
    );
  }

  limit = Number(limit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be an integer between 1 and 500");
  }

  const url =
    `${WEEX_BASE}/capi/v3/market/klines` +
    `?symbol=${encodeURIComponent(weexSymbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  const raw = await fetchWeex(url);

  if (!Array.isArray(raw)) {
    throw new Error(
      `Unexpected WEEX candle response: ${JSON.stringify(raw)}`
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

    closeTime: Number(c[6]),

    volumeQuote: Number(c[7]),
  }));

  return {
    source: "WEEX",
    market: "USDT perpetual",

    requestedSymbol: String(requestedSymbol).toUpperCase(),

    weexSymbol,

    interval,

    limit: candles.length,

    retrievedAt: new Date().toISOString(),

    candles,
  };
}


/* ============================================================
   MCP HELPERS
   ============================================================ */

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}


/* ============================================================
   MCP SERVER
   ============================================================ */

function mcpResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}


/* ============================================================
   DENO HTTP SERVER
   ============================================================ */

Deno.serve(async (req) => {
  const url = new URL(req.url);

  /* ------------------------------------------------------------
     HOME
     ------------------------------------------------------------ */

  if (req.method === "GET" && url.pathname === "/") {
    return new Response(
      JSON.stringify(
        {
          status: "ok",
          service: "WEEX Market Data",
          version: "3",
          endpoints: {
            ticker: "/ticker?symbol=ONDO",
            candles: "/candles?symbol=ONDO&interval=4h&limit=100",
            mcp: "/mcp",
          },
        },
        null,
        2
      ),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }


  /* ------------------------------------------------------------
     REST TICKER
     ------------------------------------------------------------ */

  if (req.method === "GET" && url.pathname === "/ticker") {
    try {
      const symbol = url.searchParams.get("symbol") || "ONDO";

      const result = await getWeexTicker(symbol);

      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify(
          {
            error: "Server error",
            message: error.message,
          },
          null,
          2
        ),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  }


  /* ------------------------------------------------------------
     REST CANDLES
     ------------------------------------------------------------ */

  if (req.method === "GET" && url.pathname === "/candles") {
    try {
      const symbol = url.searchParams.get("symbol") || "ONDO";
      const interval = url.searchParams.get("interval") || "4h";
      const limit = url.searchParams.get("limit") || "100";

      const result = await getWeexCandles(
        symbol,
        interval,
        Number(limit)
      );

      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify(
          {
            error: "Server error",
            message: error.message,
          },
          null,
          2
        ),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }
  }


  /* ------------------------------------------------------------
     MCP
     ------------------------------------------------------------ */

  if (url.pathname === "/mcp") {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "POST",
        },
      });
    }

    try {
      const body = await req.json();

      const id = body.id;

      /* --------------------------------------------------------
         initialize
         -------------------------------------------------------- */

      if (body.method === "initialize") {
        return mcpResponse(
          jsonRpcResult(id, {
            protocolVersion: "2025-06-18",

            capabilities: {
              tools: {},
            },

            serverInfo: {
              name: "WEEX Market Data",
              version: "1.0.0",
            },
          })
        );
      }


      /* --------------------------------------------------------
         notifications/initialized
         -------------------------------------------------------- */

      if (body.method === "notifications/initialized") {
        return new Response(null, {
          status: 202,
        });
      }


      /* --------------------------------------------------------
         tools/list
         -------------------------------------------------------- */

      if (body.method === "tools/list") {
        return mcpResponse(
          jsonRpcResult(id, {
            tools: [
              {
                name: "get_weex_ticker",

                description:
                  "Get the current live WEEX futures ticker for a symbol.",

                inputSchema: {
                  type: "object",

                  properties: {
                    symbol: {
                      type: "string",
                      description:
                        "Trading symbol, for example ONDO, HBAR, SUI or 1000PEPE.",
                    },
                  },

                  required: ["symbol"],
                },
              },

              {
                name: "get_weex_candles",

                description:
                  "Get live OHLCV candles from WEEX futures.",

                inputSchema: {
                  type: "object",

                  properties: {
                    symbol: {
                      type: "string",
                      description:
                        "Trading symbol, for example ONDO, HBAR, SUI or 1000PEPE.",
                    },

                    interval: {
                      type: "string",
                      enum: [
                        "1m",
                        "5m",
                        "15m",
                        "30m",
                        "1h",
                        "4h",
                        "12h",
                        "1d",
                        "1w",
                      ],

                      description: "Candle interval.",
                    },

                    limit: {
                      type: "integer",
                      minimum: 1,
                      maximum: 500,

                      description:
                        "Number of candles to return.",
                    },
                  },

                  required: ["symbol", "interval"],
                },
              },
            ],
          })
        );
      }


      /* --------------------------------------------------------
         tools/call
         -------------------------------------------------------- */

      if (body.method === "tools/call") {
        const toolName = body.params?.name;
        const args = body.params?.arguments || {};

        try {
          /* ----------------------------------------------------
             get_weex_ticker
             ---------------------------------------------------- */

          if (toolName === "get_weex_ticker") {
            const result = await getWeexTicker(args.symbol);

            return mcpResponse(
              jsonRpcResult(id, {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              })
            );
          }


          /* ----------------------------------------------------
             get_weex_candles
             ---------------------------------------------------- */

          if (toolName === "get_weex_candles") {
            const result = await getWeexCandles(
              args.symbol,
              args.interval || "4h",
              args.limit || 100
            );

            return mcpResponse(
              jsonRpcResult(id, {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              })
            );
          }


          return mcpResponse(
            jsonRpcError(
              id,
              -32601,
              `Unknown tool: ${toolName}`
            )
          );
        } catch (error) {
          return mcpResponse(
            jsonRpcError(
              id,
              -32000,
              error.message
            )
          );
        }
      }


      /* --------------------------------------------------------
         ping
         -------------------------------------------------------- */

      if (body.method === "ping") {
        return mcpResponse(
          jsonRpcResult(id, {})
        );
      }


      return mcpResponse(
        jsonRpcError(
          id,
          -32601,
          `Method not found: ${body.method}`
        )
      );
    } catch (error) {
      return mcpResponse(
        jsonRpcError(
          null,
          -32700,
          error.message
        )
      );
    }
  }


  /* ------------------------------------------------------------
     404
     ------------------------------------------------------------ */

  return new Response("Not Found", {
    status: 404,
  });
});
