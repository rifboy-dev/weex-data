// server.js
// WEEX Market Data — REST + MCP
// Deno Deploy / Deno.serve
// Public, read-only market data only.

const WEEX_BASE = "https://api-contract.weex.com";

const ALLOWED_INTERVALS = new Set([
  "1m", "5m", "15m", "30m",
  "1h", "4h", "12h", "1d", "1w"
]);

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Accept, MCP-Protocol-Version",
  "access-control-expose-headers": "MCP-Protocol-Version"
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

function normalizeSymbol(symbol = "ONDO") {
  let clean = symbol
    .toLowerCase()
    .replaceAll("-", "")
    .replaceAll("_", "")
    .replaceAll("/", "");

  if (clean.startsWith("cmt")) {
    clean = clean.substring(3);
  }

  if (!clean.endsWith("usdt")) {
    clean += "usdt";
  }

  if (!/^[a-z0-9]+usdt$/.test(clean)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }

  return `cmt_${clean}`;
}

async function fetchWeex(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `WEEX API error ${response.status}: ${text.slice(0, 500)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `WEEX returned invalid JSON: ${text.slice(0, 500)}`
    );
  }
}


// ---------------------------------------------------------
// WEEX TICKER — proven V2 endpoint
// ---------------------------------------------------------

async function getWeexTicker(symbolInput) {
  const requestedSymbol = symbolInput || "ONDO";
  const weexSymbol = normalizeSymbol(requestedSymbol);

  const url =
    `${WEEX_BASE}/capi/v2/market/ticker` +
    `?symbol=${encodeURIComponent(weexSymbol)}`;

  const data = await fetchWeex(url);

  return {
    source: "WEEX",
    market: "USDT perpetual",

    requestedSymbol: requestedSymbol.toUpperCase(),
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
  };
}


// ---------------------------------------------------------
// WEEX CANDLES — proven V2 endpoint
// ---------------------------------------------------------

async function getWeexCandles(
  symbolInput,
  intervalInput = "4h",
  limitInput = 100
) {
  const requestedSymbol = symbolInput || "ONDO";
  const weexSymbol = normalizeSymbol(requestedSymbol);

  const interval = intervalInput || "4h";

  if (!ALLOWED_INTERVALS.has(interval)) {
    throw new Error(
      `Invalid interval. Supported intervals: ${
        [...ALLOWED_INTERVALS].join(", ")
      }`
    );
  }

  const parsedLimit = Number(limitInput);

  if (!Number.isInteger(parsedLimit)) {
    throw new Error("limit must be an integer");
  }

  // Keep the same limit used by our proven REST bridge.
  const limit = Math.min(
    Math.max(parsedLimit || 100, 1),
    500
  );

  const url =
    `${WEEX_BASE}/capi/v2/market/candles` +
    `?symbol=${encodeURIComponent(weexSymbol)}` +
    `&granularity=${encodeURIComponent(interval)}` +
    `&limit=${limit}` +
    `&priceType=LAST`;

  const raw = await fetchWeex(url);

  if (!Array.isArray(raw)) {
    throw new Error("Unexpected WEEX candle response");
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

  return {
    source: "WEEX",
    market: "USDT perpetual",

    requestedSymbol: requestedSymbol.toUpperCase(),
    weexSymbol,

    interval,
    count: candles.length,

    retrievedAt: new Date().toISOString(),

    candles
  };
}


// ---------------------------------------------------------
// MCP TOOL DEFINITIONS
// ---------------------------------------------------------

const MCP_TOOLS = [
  {
    name: "get_weex_ticker",
    title: "Get WEEX Futures Ticker",

    description:
      "Get live public WEEX USDT perpetual futures ticker data. " +
      "Returns last price, mark price, index price, bid, ask, " +
      "24h high/low, 24h percentage change and volume. Read-only.",

    inputSchema: {
      type: "object",

      properties: {
        symbol: {
          type: "string",
          description:
            "Cryptocurrency symbol, for example ONDO, HBAR, SUI or BTC."
        }
      },

      required: ["symbol"],
      additionalProperties: false
    },

    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },

  {
    name: "get_weex_candles",
    title: "Get WEEX Futures Candles",

    description:
      "Get public OHLCV candlestick data from the WEEX " +
      "USDT perpetual futures market. Read-only.",

    inputSchema: {
      type: "object",

      properties: {
        symbol: {
          type: "string",
          description:
            "Cryptocurrency symbol, for example ONDO, HBAR, SUI or BTC."
        },

        interval: {
          type: "string",

          enum: [
            "1m", "5m", "15m", "30m",
            "1h", "4h", "12h", "1d", "1w"
          ],

          description: "Candlestick interval."
        },

        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          default: 100,

          description:
            "Number of candles to return. Maximum 500."
        }
      },

      required: ["symbol", "interval"],
      additionalProperties: false
    },

    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }
];


// ---------------------------------------------------------
// MCP JSON-RPC HELPERS
// ---------------------------------------------------------

function mcpResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function mcpError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,

    error: {
      code,
      message
    }
  };
}


// ---------------------------------------------------------
// EXECUTE MCP TOOLS
// ---------------------------------------------------------

async function executeMcpTool(name, args = {}) {

  if (name === "get_weex_ticker") {

    const data =
      await getWeexTicker(args.symbol);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2)
        }
      ],

      structuredContent: data,
      isError: false
    };
  }


  if (name === "get_weex_candles") {

    const data =
      await getWeexCandles(
        args.symbol,
        args.interval,
        args.limit ?? 100
      );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2)
        }
      ],

      structuredContent: data,
      isError: false
    };
  }


  throw new Error(`Unknown tool: ${name}`);
}


// ---------------------------------------------------------
// MCP ENDPOINT
// ---------------------------------------------------------

async function handleMcpRequest(request) {

  if (request.method !== "POST") {

    return jsonResponse(
      mcpError(
        null,
        -32600,
        "MCP endpoint accepts POST requests"
      ),
      405,
      {
        Allow: "POST, OPTIONS"
      }
    );
  }


  let body;

  try {

    body = await request.json();

  } catch {

    return jsonResponse(
      mcpError(null, -32700, "Parse error"),
      400
    );
  }


  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.jsonrpc !== "2.0"
  ) {

    return jsonResponse(
      mcpError(
        body?.id ?? null,
        -32600,
        "Invalid Request"
      ),
      400
    );
  }


  // MCP notifications do not require a response body.
  if (body.id === undefined) {

    return new Response(null, {
      status: 202,
      headers: CORS_HEADERS
    });
  }


  const id = body.id;
  const method = body.method;


  try {

    switch (method) {

      case "initialize":

        return jsonResponse(
          mcpResult(id, {

            protocolVersion: "2025-06-18",

            capabilities: {
              tools: {
                listChanged: false
              }
            },

            serverInfo: {
              name: "weex-market-data",
              title: "WEEX Market Data",
              version: "1.0.0"
            },

            instructions:
              "Read-only WEEX USDT perpetual futures market data. " +
              "This server exposes ticker and OHLCV candle retrieval only. " +
              "It cannot place orders, access accounts or execute trades."
          }),
          200,
          {
            "MCP-Protocol-Version": "2025-06-18"
          }
        );


      case "ping":

        return jsonResponse(
          mcpResult(id, {}),
          200,
          {
            "MCP-Protocol-Version": "2025-06-18"
          }
        );


      case "tools/list":

        return jsonResponse(
          mcpResult(id, {
            tools: MCP_TOOLS
          }),
          200,
          {
            "MCP-Protocol-Version": "2025-06-18"
          }
        );


      case "tools/call": {

        const name = body.params?.name;
        const args =
          body.params?.arguments ?? {};


        if (
          name !== "get_weex_ticker" &&
          name !== "get_weex_candles"
        ) {

          return jsonResponse(
            mcpError(
              id,
              -32602,
              `Unknown tool: ${name}`
            ),
            200
          );
        }


        try {

          const result =
            await executeMcpTool(
              name,
              args
            );


          return jsonResponse(
            mcpResult(
              id,
              result
            ),
            200,
            {
              "MCP-Protocol-Version":
                "2025-06-18"
            }
          );


        } catch (error) {

          return jsonResponse(
            mcpResult(id, {

              content: [
                {
                  type: "text",
                  text:
                    `WEEX tool error: ${
                      error instanceof Error
                        ? error.message
                        : String(error)
                    }`
                }
              ],

              isError: true
            }),
            200,
            {
              "MCP-Protocol-Version":
                "2025-06-18"
            }
          );
        }
      }


      default:

        return jsonResponse(
          mcpError(
            id,
            -32601,
            `Method not found: ${method}`
          ),
          200
        );
    }

  } catch (error) {

    return jsonResponse(
      mcpError(
        id,
        -32603,
        error instanceof Error
          ? error.message
          : String(error)
      ),
      500
    );
  }
}


// ---------------------------------------------------------
// DENO HTTP SERVER
// ---------------------------------------------------------

Deno.serve(async (request) => {

  const url = new URL(request.url);


  // CORS
  if (request.method === "OPTIONS") {

    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }


  // MCP
  if (url.pathname === "/mcp") {

    return await handleMcpRequest(
      request
    );
  }


  // Existing REST ticker
  if (
    request.method === "GET" &&
    url.pathname === "/ticker"
  ) {

    try {

      const symbol =
        url.searchParams.get("symbol") ||
        "ONDO";

      const data =
        await getWeexTicker(symbol);

      return jsonResponse(data);

    } catch (error) {

      return jsonResponse(
        {
          error: "Server error",
          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        500
      );
    }
  }


  // Existing REST candles
  if (
    request.method === "GET" &&
    url.pathname === "/candles"
  ) {

    try {

      const symbol =
        url.searchParams.get("symbol") ||
        "ONDO";

      const interval =
        url.searchParams.get("interval") ||
        "4h";

      const limit =
        Number(
          url.searchParams.get("limit") ||
          "100"
        );

      const data =
        await getWeexCandles(
          symbol,
          interval,
          limit
        );

      return jsonResponse(data);

    } catch (error) {

      return jsonResponse(
        {
          error: "Server error",
          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        500
      );
    }
  }


  // Homepage / health check
  if (
    request.method === "GET" &&
    url.pathname === "/"
  ) {

    return jsonResponse({

      status: "ok",

      service:
        "WEEX Market Data",

      readOnly: true,

      endpoints: {
        ticker:
          "/ticker?symbol=ONDO",

        candles:
          "/candles?symbol=ONDO&interval=4h&limit=20",

        mcp:
          "/mcp"
      },

      mcpTools: [
        "get_weex_ticker",
        "get_weex_candles"
      ]
    });
  }


  return jsonResponse(
    {
      error: "Not found"
    },
    404
  );
});
