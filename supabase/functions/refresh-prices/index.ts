// Rush HQ — refresh-prices edge function
// =======================================
// Pulls VOO USD price + USDSGD rate from Yahoo Finance's unofficial
// chart endpoint and upserts price_cache. Triggered by pg_cron every
// 15 minutes during US market hours, hourly otherwise.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface YahooQuote {
  chart: {
    result?: Array<{
      meta: { regularMarketPrice?: number };
    }>;
  };
}

async function fetchPrice(symbol: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; RushHQ/1.0; +https://rushhq.co)",
      },
    });
    if (!res.ok) {
      console.warn(`[refresh-prices] ${symbol} returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as YahooQuote;
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && isFinite(price) ? price : null;
  } catch (e) {
    console.warn(`[refresh-prices] ${symbol} fetch failed:`, (e as Error).message);
    return null;
  }
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [voo, fx] = await Promise.all([
    fetchPrice("VOO"),
    fetchPrice("USDSGD=X"),
  ]);

  const upserts: Array<{ symbol: string; price: number; last_updated: string }> = [];
  const now = new Date().toISOString();
  if (voo != null) upserts.push({ symbol: "VOO", price: voo, last_updated: now });
  if (fx  != null) upserts.push({ symbol: "USDSGD", price: fx, last_updated: now });

  if (upserts.length === 0) {
    return new Response(JSON.stringify({ ok: false, reason: "all-fetches-failed" }), {
      headers: { "content-type": "application/json" },
      status: 503,
    });
  }

  const { error } = await supabase
    .from("price_cache")
    .upsert(upserts, { onConflict: "symbol" });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { "content-type": "application/json" },
      status: 500,
    });
  }

  return new Response(JSON.stringify({ ok: true, updated: upserts }), {
    headers: { "content-type": "application/json" },
  });
});
