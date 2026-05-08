// Rush HQ — snapshot-portfolio edge function
// ===========================================
// Inserts a portfolio_snapshots row per active child for the current
// month. Idempotent via the unique (member_id, snapshot_date) index.
// Also enqueues a stock_monthly_summary outbox row per child + per
// parent so the dispatcher can format and send the message.
//
// Triggered by pg_cron on the 1st of each month at 09:00 SGT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // First of *current* month, in UTC. The cron job is scheduled at
  // 09:00 SGT on day-1, so calling now() and pinning to the 1st is safe.
  const today = new Date();
  const snapshotDate = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const [holdingsRes, priceRes] = await Promise.all([
    supabase.from("child_holdings").select("*"),
    supabase.from("price_cache").select("*"),
  ]);

  if (holdingsRes.error) {
    return jsonError(`holdings fetch failed: ${holdingsRes.error.message}`);
  }
  if (priceRes.error) {
    return jsonError(`price_cache fetch failed: ${priceRes.error.message}`);
  }

  type PriceRow = { symbol: string; price: number };
  const prices = (priceRes.data ?? []) as PriceRow[];
  const voo = Number(prices.find((p) => p.symbol === "VOO")?.price ?? 0);
  const fx  = Number(prices.find((p) => p.symbol === "USDSGD")?.price ?? 0);
  if (voo <= 0 || fx <= 0) {
    return jsonError("price_cache values not yet populated; run refresh-prices first");
  }

  type Holding = {
    member_id: string;
    short_name: string;
    shares_held: number | string;
    cost_basis_usd: number | string;
    cost_basis_sgd: number | string;
  };
  const holdings = (holdingsRes.data ?? []) as Holding[];

  const rows = holdings.map((h) => ({
    member_id:             h.member_id,
    snapshot_date:         snapshotDate,
    shares_held:           Number(h.shares_held),
    cost_basis_usd:        Number(h.cost_basis_usd),
    cost_basis_sgd:        Number(h.cost_basis_sgd),
    price_usd_at_snapshot: voo,
    fx_at_snapshot:        fx,
  }));

  if (rows.length === 0) {
    return jsonOk({ snapshots: 0, reason: "no-children-with-holdings" });
  }

  const { error: upsertErr } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "member_id,snapshot_date", ignoreDuplicates: true });
  if (upsertErr) {
    return jsonError(`portfolio_snapshots upsert: ${upsertErr.message}`);
  }

  // Pull the freshly-inserted snapshots back out so we can include
  // change-vs-previous-month in the notification payload.
  const memberIds = rows.map((r) => r.member_id);
  const { data: recent } = await supabase
    .from("portfolio_snapshots")
    .select("member_id, snapshot_date, value_sgd, shares_held, cost_basis_sgd")
    .in("member_id", memberIds)
    .order("snapshot_date", { ascending: false })
    .limit(memberIds.length * 2);

  type Snap = { member_id: string; snapshot_date: string; value_sgd: number; shares_held: number; cost_basis_sgd: number };
  const recentSnaps = (recent ?? []) as Snap[];

  const outboxRows: Array<{ event_type: string; member_id: string; payload: Record<string, unknown> }> = [];

  for (const h of holdings) {
    const childSnaps = recentSnaps.filter((s) => s.member_id === h.member_id);
    const thisMonth = childSnaps.find((s) => s.snapshot_date === snapshotDate);
    const previous  = childSnaps.find((s) => s.snapshot_date !== snapshotDate);
    if (!thisMonth) continue;
    const valueSgd = Number(thisMonth.value_sgd);
    const change   = previous ? valueSgd - Number(previous.value_sgd) : 0;

    // Notify the child themselves.
    outboxRows.push({
      event_type: "stock_monthly_summary",
      member_id: h.member_id,
      payload: {
        child_id: h.member_id,
        child_short_name: h.short_name,
        snapshot_date: snapshotDate,
        value_sgd: valueSgd,
        change_sgd: change,
        is_self: true,
      },
    });
  }

  // Notify parents with the same data, one row per (parent × child).
  const { data: parents } = await supabase
    .from("family_members")
    .select("id")
    .eq("role", "parent")
    .eq("active", true);
  for (const p of (parents ?? []) as Array<{ id: string }>) {
    for (const h of holdings) {
      const childSnaps = recentSnaps.filter((s) => s.member_id === h.member_id);
      const thisMonth = childSnaps.find((s) => s.snapshot_date === snapshotDate);
      const previous  = childSnaps.find((s) => s.snapshot_date !== snapshotDate);
      if (!thisMonth) continue;
      const valueSgd = Number(thisMonth.value_sgd);
      const change   = previous ? valueSgd - Number(previous.value_sgd) : 0;
      outboxRows.push({
        event_type: "stock_monthly_summary",
        member_id: p.id,
        payload: {
          child_id: h.member_id,
          child_short_name: h.short_name,
          snapshot_date: snapshotDate,
          value_sgd: valueSgd,
          change_sgd: change,
          is_self: false,
        },
      });
    }
  }

  if (outboxRows.length > 0) {
    await supabase.from("notification_outbox").insert(outboxRows);
  }

  return jsonOk({ snapshots: rows.length, notifications: outboxRows.length });
});

function jsonOk(body: unknown) {
  return new Response(JSON.stringify({ ok: true, ...(body as object) }), {
    headers: { "content-type": "application/json" },
  });
}
function jsonError(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    headers: { "content-type": "application/json" },
    status: 500,
  });
}
