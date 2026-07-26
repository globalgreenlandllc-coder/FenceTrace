/**
 * Pure node tests for the Gutter Score engine.
 * Run with: npx tsx --test lib/leads/gutter-score.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeGutterScore,
  gutterWindow,
  scoreBand,
  haversineMiles,
  orderByNearestNeighbor,
  doorKnockRouteUrl,
  type ScoreInput,
} from "./gutter-score.ts";

const NOW = new Date("2026-07-09T00:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600 * 1000).toISOString();

test("fresh reroof on a single-family home scores prime with window now", () => {
  const lead: ScoreInput = {
    categorizedTrade: "Roofing",
    projectKind: "Remodel/Addition",
    buildingType: "Single Family/Duplex",
    originalDescription: "TEAR OFF COMP SHINGLES, RE-ROOF SFR, R&R GUTTERS",
    projectValue: 28_000,
    aiRelevance: "high",
    contractorName: null,
    issuedDate: daysAgo(14),
  };
  const s = computeGutterScore(lead, NOW);
  assert.equal(s.window.state, "now");
  assert.equal(s.band, "prime");
  assert.ok(s.score >= 70, `expected prime score, got ${s.score}`);
  // Explainability: reasons must carry the trade + timing drivers.
  assert.ok(s.reasons.some((r) => /roofing/i.test(r.text)));
  assert.ok(s.reasons.some((r) => /window/i.test(r.text)));
});

test("new construction: window is soon early, now mid-build, passed after 2 years", () => {
  const base: ScoreInput = {
    categorizedTrade: "Framing",
    projectKind: "New Construction",
    buildingType: "Single Family/Duplex",
  };
  assert.equal(gutterWindow({ ...base, issuedDate: daysAgo(30) }, NOW).state, "soon");
  assert.equal(gutterWindow({ ...base, issuedDate: daysAgo(240) }, NOW).state, "now");
  assert.equal(gutterWindow({ ...base, issuedDate: daysAgo(500) }, NOW).state, "closing");
  assert.equal(gutterWindow({ ...base, issuedDate: daysAgo(800) }, NOW).state, "passed");
});

test("old reroof scores lower than fresh identical reroof", () => {
  const mk = (issued: string): ScoreInput => ({
    categorizedTrade: "Roofing",
    projectKind: "Remodel/Addition",
    buildingType: "Single Family/Duplex",
    originalDescription: "reroof",
    issuedDate: issued,
  });
  const fresh = computeGutterScore(mk(daysAgo(10)), NOW);
  const stale = computeGutterScore(mk(daysAgo(400)), NOW);
  assert.ok(fresh.score > stale.score);
  assert.equal(stale.window.state, "passed");
});

test("demolition is capped at 5 regardless of other signals", () => {
  const s = computeGutterScore(
    {
      categorizedTrade: "Roofing",
      projectKind: "Demolition",
      buildingType: "Single Family/Duplex",
      originalDescription: "demolish house with gutters and downspouts and shingles",
      projectValue: 2_000_000,
      aiRelevance: "high",
      issuedDate: daysAgo(5),
    },
    NOW,
  );
  assert.ok(s.score <= 5, `demolition scored ${s.score}`);
  assert.equal(s.window.state, "passed");
});

test("keyword points are capped so a wordy description can't dominate", () => {
  const s = computeGutterScore(
    {
      categorizedTrade: "Other",
      projectKind: "Other",
      originalDescription:
        "gutter downspout reroof tear off shingle fascia soffit eave addition adu detached garage carport",
      issuedDate: null,
    },
    NOW,
  );
  const kwTotal = s.reasons
    .filter((r) =>
      /gutters\/downspouts|roof replacement|fascia|addition\/adu|outbuilding/i.test(r.text),
    )
    .reduce((sum, r) => sum + r.points, 0);
  assert.ok(kwTotal <= 18, `keyword total ${kwTotal} exceeds cap`);
});

test("no issue date yields unknown window with zero timing points", () => {
  const w = gutterWindow({ projectKind: "New Construction", issuedDate: null }, NOW);
  assert.equal(w.state, "unknown");
});

test("owner-managed (no contractor) adds a direct-sale reason", () => {
  const withGc = computeGutterScore(
    { categorizedTrade: "Roofing", contractorName: "ACME ROOFING", issuedDate: daysAgo(10) },
    NOW,
  );
  const ownerRun = computeGutterScore(
    { categorizedTrade: "Roofing", contractorName: null, issuedDate: daysAgo(10) },
    NOW,
  );
  assert.ok(ownerRun.score > withGc.score);
  assert.ok(ownerRun.reasons.some((r) => /owner is picking subs/i.test(r.text)));
});

test("score bands partition 0-100", () => {
  assert.equal(scoreBand(85), "prime");
  assert.equal(scoreBand(70), "prime");
  assert.equal(scoreBand(69), "strong");
  assert.equal(scoreBand(50), "strong");
  assert.equal(scoreBand(49), "fair");
  assert.equal(scoreBand(30), "fair");
  assert.equal(scoreBand(29), "low");
});

test("keyword regexes don't fire on substrings (leave/additional)", () => {
  const s = computeGutterScore(
    {
      categorizedTrade: "Other",
      projectKind: "Other",
      originalDescription:
        "leave existing structure in place, additional conditions apply, heaven forbid",
      issuedDate: null,
    },
    NOW,
  );
  assert.ok(
    !s.reasons.some((r) => /fascia|eave|addition/i.test(r.text)),
    `false-positive keyword reasons: ${JSON.stringify(s.reasons)}`,
  );
});

test("passed window caps the score below strong — no coral pin on a done job", () => {
  const s = computeGutterScore(
    {
      categorizedTrade: "Roofing",
      projectKind: "Remodel/Addition",
      buildingType: "Single Family/Duplex",
      originalDescription: "TEAR OFF SHINGLES REROOF WITH GUTTERS AND DOWNSPOUTS",
      projectValue: 900_000,
      aiRelevance: "high",
      contractorName: null,
      issuedDate: daysAgo(400),
    },
    NOW,
  );
  assert.equal(s.window.state, "passed");
  assert.ok(s.score <= 49, `passed-window lead scored ${s.score}`);
  assert.notEqual(s.band, "prime");
  assert.notEqual(s.band, "strong");
});

test("owner-managed bonus requires a KNOWN trade — empty trade gets nothing", () => {
  const s = computeGutterScore(
    { categorizedTrade: null, contractorName: null, issuedDate: daysAgo(10) },
    NOW,
  );
  assert.ok(!s.reasons.some((r) => /owner is picking subs/i.test(r.text)));
});

test("no +0 reason rows from fractional points", () => {
  const s = computeGutterScore(
    { categorizedTrade: "Roofing", housingUnits: 0, issuedDate: daysAgo(10) },
    NOW,
  );
  assert.ok(s.reasons.every((r) => r.points !== 0));
});

test("route cap drops lowest-PRIORITY stops, not chain-end stops", () => {
  // 11 stops: first 10 clustered, the 11th (lowest priority) far away but
  // geographically nearest to the start — slicing after ordering would
  // keep it and drop a higher-priority stop.
  const priority = Array.from({ length: 10 }, (_, i) => ({
    lat: 47.6 + i * 0.001,
    lng: -122.3,
  }));
  const lowPriorityButNear = { lat: 47.6001, lng: -122.3001 };
  const url = doorKnockRouteUrl([...priority, lowPriorityButNear])!;
  assert.ok(!url.includes("-122.3001"), "low-priority stop should be cut by the cap");
});

test("haversine: Seattle to Bellevue is ~6 miles", () => {
  const d = haversineMiles(
    { lat: 47.6062, lng: -122.3321 },
    { lat: 47.6101, lng: -122.2015 },
  );
  assert.ok(d > 5 && d < 8, `got ${d}`);
});

test("nearest-neighbor ordering visits the close stop before the far one", () => {
  const a = { lat: 47.6, lng: -122.3, id: "start" };
  const far = { lat: 47.7, lng: -122.3, id: "far" };
  const near = { lat: 47.61, lng: -122.3, id: "near" };
  const route = orderByNearestNeighbor([a, far, near]);
  assert.deepEqual(route.map((p) => p.id), ["start", "near", "far"]);
});

test("door-knock route URL caps at 10 stops and includes waypoints", () => {
  const stops = Array.from({ length: 14 }, (_, i) => ({
    lat: 47.6 + i * 0.01,
    lng: -122.3,
  }));
  const url = doorKnockRouteUrl(stops)!;
  assert.ok(url.startsWith("https://www.google.com/maps/dir/?"));
  const u = new URL(url);
  assert.ok(u.searchParams.get("destination"));
  const wps = (u.searchParams.get("waypoints") ?? "").split("|").filter(Boolean);
  assert.equal(wps.length, 9); // 9 waypoints + 1 destination = 10 stops
  assert.equal(doorKnockRouteUrl([]), null);
});
