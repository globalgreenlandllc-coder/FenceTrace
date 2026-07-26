# Abuse Protection System

Complete guide to the layered rate-limiting, cost-aware throttling, and circuit-breaker system protecting GutterScan from DDoS, bot abuse, and runaway infrastructure costs.

## Executive Summary

You've built a **production-grade three-layer abuse protection system** that protects against both availability threats (DDoS) and cost threats (bot-driven LLM spend). This doc explains:

- **Threat model:** what attacks we're defending against and why
- **Architecture:** three layers (edge rate limit → durable request quotas → spend caps + circuit)
- **Implementation:** where every piece lives in the codebase
- **Thresholds:** sensible defaults with tuning guidance
- **Operations:** runbook for alerts and incident response

The system is **already implemented** (commit 59ddcc3). This doc is the reference for operating and tuning it.

---

## Threat Model

GutterScan's exposure, ranked by expected impact without guards:

| # | Threat | What Gets Hit | Worst Case |
|---|--------|--|--|
| **1** | **Bot-driven LLM cost explosion** | `/api/blueprints`, `/api/blueprints/[id]/reanalyze` (3× Opus + Haiku + Gemini), `runEstimate` (Solar + SAM-2 + GPT-4o) | Scripted account loops uploads → **$500+/hour** of Anthropic/OpenAI/Google spend |
| **2** | **Free-pipeline abuse** | `runEstimate` is free on every plan (credits only meter `/api/blueprints`); failed pipelines never debited | Bot fishes junk addresses → unlimited free Solar/SAM-2 calls (bounded only by the rails below) |
| **3** | **Unauthenticated portal writes** | `/p/[token]` accept + change-order-respond (mutate contract, **email contractor**) | Token holder loops writes → email spam + contract churn |
| **4** | **Email reputation burn** | All Resend sends (proposals, receipts, reminders, worker invites, notifications) | Compromised account or bot loop → domain blacklist + Resend bill |
| **5** | **Request floods / scraping** | `/api/leads` (bbox queries), public pages, cron/webhook endpoints (brute-force secrets) | DB saturation, function-hours bill, dataset scraping |
| **6** | **Storage stockpiling** | `/api/blueprints/presign`, `/api/blueprints/upload-url` → 50 MB capabilities | Blob storage bill growth |

**Your defense strategy:**
- Layer 1 (edge): In-memory per-IP throttle (burst + per-minute limits)
- Layer 2 (durable): Postgres-backed per-user/per-token/per-recipient quotas
- Layer 3 (circuit): Cost-aware spend caps + auto-opening circuit breaker

---

## Architecture: Three Layers

```
Internet
   │
   ▼
[Layer 0] Vercel — WAF managed rules, Attack Challenge Mode, Spend Mgmt
   │           (platform config only; no code)
   ▼
[Layer 1] middleware.ts — in-memory per-IP limits at the edge
   │           burst + per-minute by route, 3 strikes → 15-min ban
   ▼
[Layer 2] lib/abuse/* — durable Postgres counters
   │           per-user / per-token / per-recipient quotas
   ▼
[Layer 3] lib/abuse/spend-guard.ts — cost caps + circuit breaker
              per-user daily $ | global hourly/daily $ → circuit opens
```

### Layer 0: Vercel Platform
**What:** WAF managed rules, Attack Challenge, Spend Management  
**Who:** Ops; configured in Vercel dashboard (no code)  
**Why:** First-line flood dampening; regional DDoS mitigation  
**Limits:** Handles volumetric attacks that would exhaust function concurrency

### Layer 1: Edge Middleware (In-Memory)
**File:** `middleware.ts`  
**What:** Per-IP throttle running before Clerk auth  
**Semantics:** Burst limit (80 req/10s), per-minute by route class, 3 strikes = 15-min ban  
**Routes:**
- `portal` (`/p/*`): 40/min — anonymous, bot-probed
- `webhook` (`/api/webhooks/*`): 120/min — Stripe retries
- `cron` (`/api/cron/*`): 30/min — one per day expected
- `anon pages`: 60/min — `/`, `/sign-in`, `/sign-up`, `/demo`
- `api` (signed-in): 240/min — catches floods only
- `app`: 300/min — catch-all

**Response:** HTTP 429 + `Retry-After: 900` (15-min ban for strikers)  
**Limitation:** Per-isolate (resets on deploy, not shared across regions) — Layer 0 (WAF) catches cross-region floods

### Layer 2: Durable Request Quotas (Postgres)
**Files:** `lib/abuse/rate-limit.ts`, `lib/abuse/policies.ts`  
**What:** Fixed-window counters; one row per (policy, identity, window)  
**Semantics:**
- Increment-then-check: denied request still counts (repeated hammering doesn't reset timer)
- One atomic upsert per action: `INSERT INTO rate_limit_bucket ... ON CONFLICT UPDATE`
- ~5–15ms per check on Neon (noise compared to 100ms–2min action cost)
- Rows swept daily by cron

**Policies (env-overridable via `ABUSE_LIMIT_<NAME>`)**:

| Policy | Scope | Burst | Sustained | Fail Mode | Why |
|--------|-------|-------|-----------|-----------|-----|
| `estimate.run` | per-user | 10/hr | 30/day | **closed** | Most contractors: 10–20/day; 10/hr catches bots |
| `blueprint.analyze` | per-user | 4/hr | 12/day | **closed** | Most expensive (3× Opus); 4/hr is high for legitimate users |
| `blueprint.upload` | per-user | 20/hr | 60/day | open | Presign/upload-url minting; read + user can chunk |
| `leads.query` | per-user | 120/min | — | open | Heavy DB reads; 2/min is high for map pans |
| `email.user` | per-user | 20/hr | 100/day | **closed** | Contractor-initiated (proposals, reminders, receipts); 100/day is ~3/min |
| `email.recipient` | per-recipient | 20/day | — | open | Rate-limit *their* inbox (chokepoint in resend.ts) |
| `email.global` | global | 500/day | — | open | Platform-wide cap; ~21/hour average |
| `portal.accept` | per-token | 5/day | — | open | Homeowner accepting proposal; 5 attempts reasonable (retries) |
| `portal.changeorder` | per-token | 10/day | — | open | Change order respond; 10 attempts reasonable |
| `portal.ip` | per-IP | 30/hr | — | open | Cross-token portal writes; stops IP-based token hammering |

**Decision flow:**
```
consumeLimit({ policy, key, cost, context })
  for each rule in policy.rules:
    windowStart = floor(now / rule.windowSec) * rule.windowSec
    bucketKey = "{policy}|{key}|{windowSec}|{windowStart}"
    upsert: { count += cost, expiresAt = now + 2*windowSec }
    if count > rule.limit:
      log AbuseEvent (1st denial, then every 50th)
      denial = { retryAfterSec, rule, count }
  return denial ? { ok: false, reason, retryAfterSec } : { ok: true }
```

**Client response:**
- HTTP 429 + `Retry-After: {retryAfterSec}`
- Server action: thrown error with policy.message
- JSON: `{ error: "Too many requests — wait X seconds" }`

### Layer 3: Cost-Aware Spend Caps + Circuit Breaker
**Files:** `lib/abuse/spend-guard.ts`, `lib/abuse/policies.ts`  
**What:** Pre-flight cost check + ledger + circuit breaker  
**Why:** Request count alone can't stop high-cost abuse (attacker under rate limit but spending $500/hr)

**Pre-flight check: `checkAiSpendAllowed()`**
Runs before every AI action. Sequence:
1. Check env kill switch: `ABUSE_AI_DISABLED=1` → block (emergency)
2. Check circuit: `PlatformSetting("abuse.ai_circuit").open` → block if open
3. Query spend ledger:
   - User's spend (24h, unless caller is `SUPER_ADMIN`)
   - Global spend (last hour, last day)
4. Compare against caps:
   ```
   if userDay + estCost > userDailyCap:
       reject, log AbuseEvent(SPEND_CAP_USER), alert admin
   if globalHour + estCost > globalHourlyCap:
       open circuit, alert admin "🚨 Circuit OPENED"
   if globalDay + estCost > globalDailyCap:
       open circuit, alert admin "🚨 Circuit OPENED"
   if globalDay > 80% of cap:
       alert admin (warning, not a block)
   ```

**Estimated costs (pre-flight, before token counts known):**
- `SATELLITE_ESTIMATE` → $0.25 (tuned via `ABUSE_EST_COST_SATELLITE`)
- `BLUEPRINT_ANALYSIS` → $1.50 (tuned via `ABUSE_EST_COST_BLUEPRINT`)
- `LEAD_SYNC` → $0.50 (tuned via `ABUSE_EST_COST_LEAD_SYNC`)

**Actual cost: `recordSpend()` after action completes**
```typescript
await recordSpend({
  userId,
  kind: "BLUEPRINT_ANALYSIS",
  provider: "anthropic",
  costCents: estimateModelCostCents("claude-opus-4-8", inputTokens, outputTokens),
  inputTokens, outputTokens
});
```

**Spend caps (env-overridable):**
```
ABUSE_USER_DAILY_AI_CENTS=2000         # $20/user/day
ABUSE_GLOBAL_HOURLY_AI_CENTS=3000      # $30/hour platform
ABUSE_GLOBAL_DAILY_AI_CENTS=10000      # $100/day platform
```

**Circuit breaker: `PlatformSetting` row**
- Key: `"abuse.ai_circuit"`
- Value: `{ open: bool, reason: string, openedAt: ISO8601, openedBy: string }`
- When crossed: auto-open + alert admins + log AbuseEvent
- Stays open until: manual close at `/admin/abuse` or env override

**Fail-safe:** If spend ledger unreadable, AI actions blocked (don't guess).

---

## Protect Against Bot-Driven Cost Explosion

The core defense strategy: **five stacked controls, each capping the blast radius of the last.**

### Stop 1: Request-Rate Limits on Expensive Endpoints

**What:** `POLICIES.estimateRun` (10/hr) + `POLICIES.blueprintAnalyze` (4/hr)  
**Blocks:** High-frequency hammering. Max 240 estimates/day per account (even with unlimited credits)  
**Fail mode:** closed (if DB down, don't spend)

**How it fails:**
- Attacker creates 1000 accounts → 240 × 1000 = 240k estimates/day = $60k (without spend caps)
- **But:** Layer 2 + 3 catch this

### Stop 2: Spend Ledger (Cost Tracking)

**What:** Every AI action (success or failure) logged to `spend_events` table  
**Why:** Failed runs still cost money (bot fishing junk addresses burns Solar/SAM-2 budget)  
**Records:** costCents + token counts + kind + meta (estimateId, model, etc.)  
**Ledger use:**
- Pre-flight checks sum this for layers 3 + 4
- Post-mortem analysis (which users, which endpoints, which models?)
- Cost reconciliation (estimated vs. actual tokens)

### Stop 3: Per-User Daily Dollar Cap ($20 Default)

**What:** Every AI action checks: `userSpend24h + estCost > $20`?  
**Blocks:** Unknown single account going rogue. One stolen/trial account hits $20/day ceiling.  
**Tuning:** Contractors doing 80 estimates/day × $0.25 = $20; adjust for power users  
**Recovery:** Whitelist user at `/admin/abuse` → skips per-user cap, keeps global caps

**How it fails:**
- Attacker with 1000 accounts: each hits $20 cap = $20k/day (still 1000× max)
- **But:** Layer 4 catches this

### Stop 4: Global Hourly + Daily Caps ($30/hr, $100/day Default)

**What:**
- Hourly: `globalSpend1h + estCost > $30` → open circuit
- Daily: `globalSpend24h + estCost > $100` → open circuit

**Opens circuit:** All AI endpoints return "paused, contact support" until admin closes it  
**Auto-alert:** 80% of cap → warning email; 100% → circuit-open email  
**Recovery:** Manual close at `/admin/abuse` or env `ABUSE_AI_DISABLED=0`

**Why two windows?**
- Hourly: fast response to sudden spike (bot attack in real-time)
- Daily: catches slow-rolling abuse (10 accounts × $10/day compound)

**How it fails:**
- Attacker with fleet of accounts trying to parallel spend:
  - 100 accounts × 10 estimates/hour = 1000/hour = $250/hour
  - Hits global hourly cap within 7 minutes
  - Circuit opens → all AI blocked
  - Admin alerted → investigation starts

### Stop 5: Alerts + Manual Oversight

**Alerts sent to `ADMIN_EMAILS` (throttled 1/kind/hour):**
- **80% of daily cap:** "Watch—if this pace continues, circuit will open"
- **Circuit open:** "🚨 AI circuit OPENED — global hourly/daily spend cap crossed"
- **Per-user cap hit:** "User `{id}` hit daily AI spend cap"
- **Rate limit spike:** "Policy `{policy}` hit 50+ denials in 1 hour"

**Admin response:**
1. Investigate `/admin/abuse` dashboard
2. If legitimate spike: raise cap, close circuit, document
3. If attack: block accounts, keep circuit open, investigate

---

## Implementation Details

### Database Schema

**RateLimitBucket** — one row per (policy, identity, window)
```sql
CREATE TABLE rate_limit_bucket (
  key TEXT PRIMARY KEY,  -- "policy|identity|windowSec|bucketStart"
  count INT NOT NULL,
  expiresAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT now(),
  updatedAt TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_expires ON rate_limit_bucket(expiresAt);
```

**SpendEvent** — ledger of AI spend
```sql
CREATE TABLE spend_event (
  id TEXT PRIMARY KEY,
  userId TEXT,
  kind TEXT,  -- SATELLITE_ESTIMATE | BLUEPRINT_ANALYSIS | LEAD_SYNC
  provider TEXT,
  costCents INT,
  inputTokens INT,
  outputTokens INT,
  meta JSONB,  -- { estimateId, model, ... }
  createdAt TIMESTAMP DEFAULT now(),
  FOREIGN KEY (userId) REFERENCES users(id)
);
CREATE INDEX idx_user_created ON spend_event(userId, createdAt);
CREATE INDEX idx_created ON spend_event(createdAt);
```

**AbuseEvent** — audit log of all rate-limits, circuit opens, alerts
```sql
CREATE TABLE abuse_event (
  id TEXT PRIMARY KEY,
  kind TEXT,  -- RATE_LIMITED | QUOTA_EXCEEDED | SPEND_CAP_USER | CIRCUIT_OPENED | CIRCUIT_CLOSED | ALERT_SENT
  policy TEXT,
  scopeKey TEXT,  -- "user:123" | "ip:1.2.3.4" | "token:..." | "global"
  userId TEXT,
  ip TEXT,
  route TEXT,
  detail JSONB,  -- { rule, count, reason, ... }
  createdAt TIMESTAMP DEFAULT now(),
  FOREIGN KEY (userId) REFERENCES users(id)
);
CREATE INDEX idx_policy_created ON abuse_event(policy, createdAt);
CREATE INDEX idx_user_created ON abuse_event(userId, createdAt);
```

**PlatformSetting** — circuit state
```sql
CREATE TABLE platform_setting (
  key TEXT PRIMARY KEY,  -- "abuse.ai_circuit"
  value JSONB,  -- { open: bool, reason, openedAt, openedBy }
  updatedAt TIMESTAMP DEFAULT now()
);
```

### Code Integration Points

**Layer 1: Edge Middleware**
- File: `middleware.ts`
- When: Every request, before Clerk auth
- Logic: Check in-memory per-IP burst + per-minute counters

**Layer 2: Request Quotas**
- Estimate run: `app/actions/estimate.ts`
  ```typescript
  const decision = await consumeLimit({
    policy: POLICIES.estimateRun,
    key: `user:${user.id}`,
    context: { userId: user.id, route: "estimate" }
  });
  if (!decision.ok) throw new Error(decision.reason);
  ```
- Blueprint analyze: `app/api/blueprints/[id]/reanalyze/route.ts`
- Email sends: `app/actions/proposals.ts` + `lib/email/resend.ts`
- Portal writes: `app/actions/proposals.ts` (acceptProposalByToken)
- Leads queries: `app/api/leads/route.ts`

**Layer 3: Spend Guards**
- Pre-flight: `app/actions/estimate.ts`, `app/api/blueprints/[id]/reanalyze/route.ts`
  ```typescript
  const canSpend = await checkAiSpendAllowed({
    userId: user.id,
    kind: "BLUEPRINT_ANALYSIS",
    estCostCents: 150
  });
  if (!canSpend.ok) throw new Error(canSpend.reason);
  ```
- Record actual: After AI action completes
  ```typescript
  await recordSpend({
    userId,
    kind: "BLUEPRINT_ANALYSIS",
    provider: "anthropic",
    costCents: calculateTokenCost(inputTokens, outputTokens),
    inputTokens, outputTokens
  });
  ```

**Admin Dashboard:** `/admin/abuse`
- Read: Circuit state, spend trends, rate-limit summary, top spenders
- Write: Open/close circuit, set env overrides, whitelist users

---

## Tuning Guide

### When to Tighten

**Per-user daily cap $20 → $10:**
- Suspicious user creating many duplicate estimates
- Bot pattern: cluster of similar requests

**Portal IP limit 30/hr → 10/hr:**
- Scraper hammering proposal tokens
- Attack: Token-guessing loop

**Blueprint analyze 4/hr → 2/hr:**
- User spamming re-analyze on same blueprint
- Attack: Webhook → re-trigger loop

**Global daily cap $100 → $50:**
- Infrastructure cost constraint
- Set *before* attack, not in reaction

### When to Loosen

**Per-user daily cap $20 → $50:**
- Legitimate power user (enterprise contractor, 200+ estimates/day)
- Whitelist at `/admin/abuse` instead (better: skip per-user cap only)

**Email limit 100/day → 300/day:**
- Marketing campaign; bulk proposal sends
- Raise temporarily via `ABUSE_LIMIT_EMAIL_USER` env

**Leads query 120/min → 500/min:**
- Performance improved; users doing bigger pans
- Monitor CPU + DB load to verify it scales

### Testing Locally

```bash
# Simulate attack: tight caps, make requests
ABUSE_USER_DAILY_AI_CENTS=500  ABUSE_LIMIT_ESTIMATE_RUN=3/3600 npm run dev

# First 3 requests succeed; 4th blocked with policy.message
```

---

## Monitoring & Operations

### Dashboard: `/admin/abuse`

**Read:**
- Circuit state (open/closed, who, when, why)
- Spend meters (total vs. caps; hour + day)
- Top spenders (24h by kind)
- Rate-limited summary (policies with most denials)
- Recent abuse events (log, filters by policy/user/IP/kind)

**Write:**
- Toggle circuit open/close (requires `SUPER_ADMIN`)
- Manual override caps (testing)
- Whitelist users (skip per-user cap)

### Alerts (to `ADMIN_EMAILS`)

| Alert | Trigger | Throttle | Action |
|-------|---------|----------|--------|
| Circuit opened | Global hourly OR daily cap crossed | once | Close circuit after investigation |
| 80% of daily cap | `globalDay > 0.8 * cap` | 1/day | Watch—if pace continues, circuit opens |
| Per-user cap hit | `userDay > cap` | 1/user/day | Investigate user; whitelist if legit |
| Rate limit spike | Policy hit 50+ denials in 1h | 1/policy/day | Inspect top IPs/users; block if bot |

### Logs

**Abuse events** (Postgres):
- Every rate-limit entry (sampled: 1st denial + every 50th)
- Every spend cap hit
- Every circuit open/close
- Every alert sent

**Structured output** (stdout/stderr):
```
[abuse-event] kind=RATE_LIMITED policy=estimate.run scopeKey=user:123 ip=1.2.3.4 count=31 rule=10/3600
[spend-guard] user=456 kind=BLUEPRINT_ANALYSIS passed cost=$1.50 remaining=$18.50
[spend-guard] user=789 kind=SATELLITE_ESTIMATE denied CIRCUIT_OPEN
[abuse-alert] circuit-open subject="🚨 Circuit OPENED ..." recipients=1
```

---

## Failure Modes & Recovery

| Failure | Behavior | Why |
|---------|----------|-----|
| **DB unavailable** | Expensive policies (estimate, blueprint, email) block; cheap (leads, portal) allow | Outage must never mean unmetered spend; also never lock homeowner out of accepting |
| **Spend query fails** | AI action blocked | Can't read ledger → can't bound bill |
| **Circuit read fails** | Same (part of same check) | — |
| **Alert email fails** | Logged, request proceeds | Alerting must never take down triggering request |
| **Ledger write fails** | Logged, request proceeds | Pre-flight is the gate; ledger is telemetry |
| **Edge memory resets** | Per-IP limits restart (per-isolate) | Layer 1 is best-effort; Layer 2 is durable |
| **`ADMIN_EMAILS` unset** | Alerts become rows only; warning logged | — |
| **Clock boundary** | Worst-case 2× burst at window edge | Burst + sustained rules keep sustained honest |

---

## Rollout Checklist

### Phase 0: Deploy
- [x] `lib/abuse/*` files committed
- [x] DB migration applied
- [x] `/admin/abuse` wired in
- [x] Policies integrated into endpoints
- [ ] Verify `ADMIN_EMAILS` set in prod

### Phase 1: Platform Config (15 min)
- [ ] Enable Vercel WAF managed rules
- [ ] Enable Attack Challenge Mode (keep clickable)
- [ ] Set Vercel Spend Management alerts
- [ ] Check Clerk bot protection on sign-up
- [ ] Set usage alerts in Anthropic/OpenAI/Google consoles

### Phase 2: Monitor Baseline (Week 1)
- [ ] Loose caps: `ABUSE_USER_DAILY_AI_CENTS=20000, ABUSE_GLOBAL_DAILY_AI_CENTS=50000`
- [ ] Review `/admin/abuse` daily
- [ ] Collect: request patterns, spend trends, rate-limit hits
- [ ] Goal: Understand normal load before tightening

### Phase 3: Tighten to Production (Week 2)
- [ ] Set defaults: `$20/user/day, $30/hour global, $100/day global`
- [ ] Monitor for false positives (legitimate users blocked)
- [ ] Adjust ±20% based on usage
- [ ] Document tuning decisions

### Phase 4: Hardening (Week 3+)
- [ ] Whitelist known power users
- [ ] Add Turnstile to portal `/p/[token]` if probing shows
- [ ] Set up cron to sweep old buckets (daily)
- [ ] Document on-call runbook

---

## FAQ

**Q: Why Postgres instead of Redis?**  
A: Simpler ops, no cache invalidation, single source of truth. At 1–10 req/sec, one Postgres upsert (~5–15ms) is faster than Redis setup + cold starts.

**Q: Why "increment-then-check" not "check-then-increment"?**  
A: Race condition in the latter: thread A checks (count=9, passes), thread B checks (count=9, passes), both increment to 10+ (limit breached twice). Atomic upsert avoids this.

**Q: How do I whitelist a power user?**  
A: `/admin/abuse` → find user → Whitelist → skips per-user cap (global caps still apply).

**Q: Can I run a bulk operation?**  
A: Temporarily raise caps, run migration, restore. Or write a private script calling `recordSpend` directly.

**Q: How often are buckets swept?**  
A: Daily cron (piggybacked on payment reminders). Buckets kept one extra window for Retry-After math.

---

## Summary

✅ Three-layer defense: edge throttle → request quotas → spend caps + circuit  
✅ Fail-safe: expensive policies block on DB errors; spend guard always closed  
✅ Observable: AbuseEvent audit log; `/admin/abuse` dashboard; alerts  
✅ Tunable: env-overridable thresholds; no redeploy for policy changes  
✅ Cost-conscious: pre-flight estimates, token-derived actuals, hard spend ceiling

**Operating this well = infrastructure is protected, customers' proposals aren't spammed, bill never surprises you.**
