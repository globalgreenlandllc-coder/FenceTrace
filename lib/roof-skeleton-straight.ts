/**
 * Straight-skeleton roof engine for (near-)rectilinear footprints.
 *
 * Given a building FOOTPRINT polygon, produce the architecturally-correct
 * roof: HIPS rising from convex (outside) corners, VALLEYS rising from reflex
 * (inside) corners, RIDGES where opposing slopes meet, and the roof FACES
 * (planes) that tile the footprint. This is the textbook "straight skeleton"
 * of the polygon — every roof plane slopes up at an equal angle from its eave,
 * and the skeleton (the ridge/hip/valley network) is the medial set where
 * those planes meet.
 *
 * It is a strict DROP-IN for deriveRoofSkeleton: same RoofSkeleton output
 * contract, honours eaveSegments/rakeSegments (a side fed a RAKE / no gutter is
 * a GABLE end — its slope is replaced by a vertical wall held STATIONARY during
 * the offset, so the ridge runs flush to that wall and no hip is drawn there).
 *
 * It is computed by simulating an equal-speed INWARD OFFSET of the eave edges
 * (gable edges held at speed 0). As the boundary shrinks, vertices trace the
 * hips/valleys, edges collapse to ridge nodes, and reflex notches close. The
 * traced vertex paths ARE the skeleton; the swept region of each original eave
 * edge IS its roof face.
 *
 * Restricted to rectilinear input (every edge axis-aligned within tol). On a
 * rectilinear polygon all bisectors are exactly ±45°, so events are simple
 * well-conditioned min-distance computations and the geometry is stable. Any
 * non-axis edge, degeneracy, NaN, or iteration overflow → returns EMPTY so the
 * caller falls back to the grid-decomposition engine. NEVER throws on its own.
 *
 * Pure: no DOM, no server-only, no React. Runs in the browser bundle and under
 * `node --test`.
 */

import {
  type Pt,
  type Seg,
  type SkeletonLine,
  type RoofFace,
  type RoofSkeleton,
  isFinitePt,
  cleanRing,
  signedArea,
  sideEaveCoverage,
  sideHasEave,
  sideMiddleHasEave,
} from "./roof-skeleton";

const EMPTY: RoofSkeleton = {
  ridges: [],
  hips: [],
  valleys: [],
  gables: [],
  faces: [],
};

type VertexType = "convex" | "reflex" | "internal";

type Arc = {
  a: Pt;
  b: Pt;
  originType: VertexType;
  endType: VertexType;
  /** True when the origin corner is adjacent to a GABLE (speed-0) wall, so its
   *  trace runs ALONG the wall — it is the rake line, not a hip/valley. */
  onWall: boolean;
};

/**
 * Active vertex in the shrinking polygon. Each vertex sits between two edges
 * (its prev edge and next edge). It moves with velocity `vel` (per unit time)
 * = the point where the two offset edges intersect, advanced one unit of time.
 * `edgeIndexNext` is the ORIGINAL edge index of the edge LEAVING this vertex
 * (vertex i → vertex next), so a face can be assembled per original edge.
 */
type Vtx = {
  id: number;
  pos: Pt;
  vel: Pt; // movement per unit offset time
  type: VertexType; // type at its ORIGIN (snapshot when created from an original corner)
  prev: number; // id of previous active vertex
  next: number; // id of next active vertex
  alive: boolean;
  edgeIndexNext: number; // original edge index of edge (this → next)
  spawnedAt: number; // skeleton node id where this vertex was born (-1 = original corner)
};

const EPS = 1e-7;

function isFiniteNum(n: number): boolean {
  return Number.isFinite(n);
}

/** Inward unit normal of a directed edge a→b for a CCW ring (interior on the
 *  left). For CCW, the interior normal is the left normal: (-dy, dx) normalized. */
function inwardNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: -dy / l, y: dx / l };
}

/**
 * Compute the velocity of a vertex between edge e0 (incoming, dir d0) and edge
 * e1 (outgoing, dir d1), where each edge moves inward at its own speed. The
 * offset of edge e at time t is the line shifted by t*speed*inwardNormal. The
 * vertex is the intersection of the two offset lines; its velocity is that
 * intersection per unit t.
 *
 * For an edge with speed 0 (a gable wall held stationary), the vertex slides
 * ALONG that wall as the other edge advances.
 *
 * Solve: vertex p(t) satisfies n0·(p - p0) = s0*t and n1·(p - p1) = s1*t where
 * n0,n1 are inward unit normals and p0,p1 points on each (original) edge. With
 * p0=p1=pos (vertex on both edges at t=0): n0·(p-pos)=s0*t, n1·(p-pos)=s1*t.
 * Let v = dp/dt. Then n0·v = s0, n1·v = s1. Solve the 2x2 system.
 */
function vertexVelocity(
  pos: Pt,
  prevPos: Pt,
  nextPos: Pt,
  speedIn: number,
  speedOut: number,
): Pt | null {
  // inward normals of the two incident edges (edges directed along the ring)
  const nIn = inwardNormal(prevPos, pos); // incoming edge prev→pos
  const nOut = inwardNormal(pos, nextPos); // outgoing edge pos→next
  // n0·v = speedIn, n1·v = speedOut
  const det = nIn.x * nOut.y - nIn.y * nOut.x;
  if (Math.abs(det) < EPS) return null; // edges parallel (straight vertex) — caller handles
  const vx = (speedIn * nOut.y - speedOut * nIn.y) / det;
  const vy = (nIn.x * speedOut - nOut.x * speedIn) / det;
  if (!isFiniteNum(vx) || !isFiniteNum(vy)) return null;
  return { x: vx, y: vy };
}

/** Distance from point p to segment [a,b]. */
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The inward-offset simulation core. Returns the skeleton nodes, the arcs
 * (each a traced vertex path from its birth to the node that consumed it,
 * tagged with the vertex's origin/end type), and the per-original-edge swept
 * slab polygon. Returns null on any degeneracy.
 */
function runStraightSkeleton(
  ring: Pt[],
  speed: number[],
): {
  arcs: Arc[];
  slabs: Array<{ edgeIndex: number; polygon: Pt[] }>;
} | null {
  const n = ring.length;
  if (n < 3 || speed.length !== n) return null;

  // Build the active vertex linked list.
  const verts: Vtx[] = [];
  let nextId = 0;

  // For each original edge i (ring[i] → ring[(i+1)%n]), record the chain of
  // node points its offset boundary passes through, so its slab can be built.
  // The slab polygon = [ring[i], ring[i+1], ...chain on the i+1 side back to
  // the i side]. We track, per edge, an ordered list of the skeleton nodes
  // generated on its left endpoint trace and right endpoint trace.
  // Simpler robust approach: track for each edge the two vertices currently
  // bounding it (startVtx, endVtx) and accumulate node points as they retire.
  const edgeChain: Pt[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const sIn = speed[(i - 1 + n) % n];
    const sOut = speed[i];
    // classify convex/reflex (ring is CCW): cross < 0 => reflex
    const cr =
      (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    let type: VertexType;
    if (Math.abs(cr) < EPS) type = "internal";
    else type = cr > 0 ? "convex" : "reflex";
    const vel =
      vertexVelocity(cur, prev, next, sIn, sOut) ?? { x: 0, y: 0 };
    verts.push({
      id: nextId++,
      pos: { x: cur.x, y: cur.y },
      vel,
      type,
      prev: (i - 1 + n) % n,
      next: (i + 1) % n,
      alive: true,
      edgeIndexNext: i,
      spawnedAt: -1,
    });
  }

  // Seed each edge chain with its two original endpoints (ordered start→end).
  for (let i = 0; i < n; i++) {
    edgeChain[i].push({ x: ring[i].x, y: ring[i].y });
  }

  const arcs: Arc[] = [];
  // record the arc each living vertex would emit (from its start pos)
  const vtxStart = new Map<number, Pt>();
  const vtxStartType = new Map<number, VertexType>();
  // True when a vertex's trace runs ALONG a gable wall (an original corner
  // incident to a speed-0 edge): its arc is the rake line, not a hip/valley.
  const vtxOnWall = new Map<number, boolean>();
  for (const v of verts) {
    vtxStart.set(v.id, { x: v.pos.x, y: v.pos.y });
    vtxStartType.set(v.id, v.type);
    const sIn = speed[(v.id - 1 + n) % n];
    const sOut = speed[v.id];
    vtxOnWall.set(v.id, sIn < EPS || sOut < EPS);
  }

  const byId = (id: number) => verts[id];

  let t = 0;
  const maxIter = n * n * 4 + 16;
  let iter = 0;

  // Count of alive vertices.
  let aliveCount = n;

  while (aliveCount > 2 && iter < maxIter) {
    iter++;

    // ZERO-LENGTH collapse pass: simultaneous events (common on symmetric
    // footprints) leave adjacent vertices coincident. Merge any near-zero
    // edge BEFORE the timed search so the loop stays consistent and the
    // event order can't strand a degenerate zero-length edge.
    {
      let collapsed = false;
      for (const v of verts) {
        if (!v.alive || aliveCount <= 2) continue;
        const w = byId(v.next);
        if (!w.alive || w.id === v.id) continue;
        if (Math.hypot(w.pos.x - v.pos.x, w.pos.y - v.pos.y) > 1e-4) continue;
        // collapse v→w into one node at their shared position
        const node = { x: (v.pos.x + w.pos.x) / 2, y: (v.pos.y + w.pos.y) / 2 };
        const pv = byId(v.prev);
        const nw = byId(w.next);
        arcs.push({
          a: vtxStart.get(v.id)!,
          b: node,
          originType: vtxStartType.get(v.id)!,
          endType: "internal",
          onWall: !!vtxOnWall.get(v.id),
        });
        arcs.push({
          a: vtxStart.get(w.id)!,
          b: node,
          originType: vtxStartType.get(w.id)!,
          endType: "internal",
          onWall: !!vtxOnWall.get(w.id),
        });
        edgeChain[v.edgeIndexNext].push(node);
        edgeChain[pv.edgeIndexNext].push(node);
        edgeChain[w.edgeIndexNext].push(node);
        v.alive = false;
        w.alive = false;
        aliveCount -= 2;
        const merged: Vtx = {
          id: nextId++,
          pos: { x: node.x, y: node.y },
          vel: { x: 0, y: 0 },
          type: "internal",
          prev: pv.id,
          next: nw.id,
          alive: true,
          edgeIndexNext: w.edgeIndexNext,
          spawnedAt: -1,
        };
        verts.push(merged);
        vtxStart.set(merged.id, { x: node.x, y: node.y });
        vtxStartType.set(merged.id, "internal");
        vtxOnWall.set(merged.id, false);
        pv.next = merged.id;
        nw.prev = merged.id;
        aliveCount += 1;
        const mv = vertexVelocity(
          merged.pos,
          pv.pos,
          nw.pos,
          speed[pv.edgeIndexNext],
          speed[merged.edgeIndexNext],
        );
        merged.vel = mv ?? { x: 0, y: 0 };
        collapsed = true;
        break;
      }
      if (collapsed) continue;
    }

    // Find the next event: the minimum positive time at which an active edge
    // collapses (its two endpoints meet) OR a reflex vertex splits an edge.
    let bestDt = Infinity;
    let bestKind: "edge" | "split" = "edge";
    let bestA = -1; // primary vertex (edge: start vtx; split: reflex vtx)
    let bestB = -1; // edge: end vtx; split: the edge's start vtx
    let bestPoint: Pt | null = null;

    // EDGE events: for each active edge (v → v.next), the two endpoints move;
    // the edge collapses when they coincide. Solve along the edge.
    for (const v of verts) {
      if (!v.alive) continue;
      const w = byId(v.next);
      if (!w.alive) continue;
      // positions p(t)=v.pos+v.vel*dt, q(t)=w.pos+w.vel*dt
      const px = w.pos.x - v.pos.x;
      const py = w.pos.y - v.pos.y;
      const vx = w.vel.x - v.vel.x;
      const vy = w.vel.y - v.vel.y;
      // distance^2(dt) minimized / zero. We want first dt>0 where they meet.
      // Solve |p + v*dt|^2 = 0 → only if they actually converge to a point.
      const a = vx * vx + vy * vy;
      const b = 2 * (px * vx + py * vy);
      const c = px * px + py * py;
      if (a < EPS) continue; // not converging
      // minimum at dt = -b/(2a); meet exactly when discriminant ~0
      const dtMin = -b / (2 * a);
      if (dtMin <= EPS) continue;
      const distSq = c + b * dtMin + a * dtMin * dtMin;
      // Edge collapses if endpoints get within tol at dtMin.
      if (distSq > 1e-3) continue; // they don't actually meet (skew) — skip
      const dt = dtMin;
      if (dt < bestDt - EPS) {
        bestDt = dt;
        bestKind = "edge";
        bestA = v.id;
        bestB = w.id;
        bestPoint = {
          x: v.pos.x + v.vel.x * dt,
          y: v.pos.y + v.vel.y * dt,
        };
      }
    }

    // SPLIT events: a reflex vertex's trajectory hits a non-adjacent active
    // edge. We approximate: the reflex vertex p moving with vel hits the line
    // of edge (s→e) (moving inward at its speed). Compute the time the moving
    // point lands on the moving edge line, and verify it lands within the
    // current segment span at that time.
    for (const rv of verts) {
      if (!rv.alive || rv.type !== "reflex") continue;
      for (const sv of verts) {
        if (!sv.alive) continue;
        const ev = byId(sv.next);
        if (!ev.alive) continue;
        // skip edges adjacent to the reflex vertex
        if (sv.id === rv.id || ev.id === rv.id) continue;
        if (sv.id === rv.prev || ev.id === rv.next) continue;
        const eIdx = sv.edgeIndexNext;
        const sp = speed[eIdx];
        if (sp < EPS) continue; // stationary gable wall: reflex can't be split by it cleanly
        // inward normal of this edge at t=0
        const nrm = inwardNormal(sv.pos, ev.pos);
        // signed distance of reflex point from the (moving) edge line:
        // f(t) = nrm·(p(t) - s(t)) - sp*t*?  Since edge moves inward by sp*t
        // along nrm, a point ON the original line has nrm·(x - s)=0; the moving
        // line is nrm·(x - s0) = sp*t. The reflex point: nrm·(p(t)-s0)=?
        const p0rel = {
          x: rv.pos.x - sv.pos.x,
          y: rv.pos.y - sv.pos.y,
        };
        const f0 = nrm.x * p0rel.x + nrm.y * p0rel.y;
        // df/dt = nrm·(rv.vel - sv.vel) - sp
        const dfdt =
          nrm.x * (rv.vel.x - sv.vel.x) +
          nrm.y * (rv.vel.y - sv.vel.y) -
          sp;
        if (Math.abs(dfdt) < EPS) continue;
        const dt = -f0 / dfdt;
        if (dt <= EPS || dt >= bestDt - EPS) continue;
        // landing point of the reflex vertex
        const lp = {
          x: rv.pos.x + rv.vel.x * dt,
          y: rv.pos.y + rv.vel.y * dt,
        };
        // edge endpoints at that time
        const sa = { x: sv.pos.x + sv.vel.x * dt, y: sv.pos.y + sv.vel.y * dt };
        const sb = { x: ev.pos.x + ev.vel.x * dt, y: ev.pos.y + ev.vel.y * dt };
        // must land WITHIN the segment span (with small tol)
        const ex = sb.x - sa.x;
        const ey = sb.y - sa.y;
        const el2 = ex * ex + ey * ey;
        if (el2 < EPS) continue;
        const u = ((lp.x - sa.x) * ex + (lp.y - sa.y) * ey) / el2;
        if (u < 0.02 || u > 0.98) continue;
        const d = distToSeg(lp, sa, sb);
        if (d > 1) continue;
        if (dt < bestDt - EPS) {
          bestDt = dt;
          bestKind = "split";
          bestA = rv.id;
          bestB = sv.id;
          bestPoint = lp;
        }
      }
    }

    if (!isFiniteNum(bestDt) || bestDt === Infinity || !bestPoint) {
      // No more events but >2 vertices: the remaining loop is convex with no
      // collapse found (numerical). Try to close it: collapse all remaining to
      // their centroid as a final node.
      break;
    }
    if (!isFiniteNum(bestPoint.x) || !isFiniteNum(bestPoint.y)) return null;

    // Advance all alive vertices by bestDt.
    for (const v of verts) {
      if (!v.alive) continue;
      v.pos = { x: v.pos.x + v.vel.x * bestDt, y: v.pos.y + v.vel.y * bestDt };
    }
    t += bestDt;
    const node = bestPoint;

    if (bestKind === "edge") {
      const v = byId(bestA);
      const w = byId(bestB);
      // The edge v→w collapses to `node`. Emit arcs for v and w (their traces
      // from start → node).
      arcs.push({
        a: vtxStart.get(v.id)!,
        b: node,
        originType: vtxStartType.get(v.id)!,
        endType: "internal",
        onWall: !!vtxOnWall.get(v.id),
      });
      arcs.push({
        a: vtxStart.get(w.id)!,
        b: node,
        originType: vtxStartType.get(w.id)!,
        endType: "internal",
        onWall: !!vtxOnWall.get(w.id),
      });
      // The edge between v and w disappears; record node into its edge chain
      // on the END side (it terminates).
      // Append node to the chains of the edges incident at v and w so faces
      // close up: edge entering v (prev→v) and edge leaving w (w→next).
      const pv = byId(v.prev);
      const nw = byId(w.next);
      // The collapsing edge (v→w) closes at `node`. The two SURVIVING
      // neighbour edges — the edge entering v (pv→v) and the edge leaving w
      // (w→nw) — now share `node` as their new common boundary vertex. Each
      // edge accumulates the nodes its offset boundary passes through, so push
      // `node` to all three (the collapsing edge ends here; the neighbours
      // continue from here).
      edgeChain[v.edgeIndexNext].push(node);
      edgeChain[pv.edgeIndexNext].push(node);
      edgeChain[w.edgeIndexNext].push(node);
      // create a NEW merged vertex replacing v and w
      v.alive = false;
      w.alive = false;
      aliveCount -= 2;
      const merged: Vtx = {
        id: nextId++,
        pos: { x: node.x, y: node.y },
        vel: { x: 0, y: 0 },
        type: "internal",
        prev: pv.id,
        next: nw.id,
        alive: true,
        edgeIndexNext: nw.edgeIndexNext, // edge leaving = w's outgoing edge
        spawnedAt: -1,
      };
      // wait: edgeIndexNext should be the edge that leaves the merged vertex,
      // which is w→next's edge, i.e. w.edgeIndexNext.
      merged.edgeIndexNext = w.edgeIndexNext;
      verts.push(merged);
      vtxStart.set(merged.id, { x: node.x, y: node.y });
      vtxStartType.set(merged.id, "internal");
      vtxOnWall.set(merged.id, false);
      pv.next = merged.id;
      nw.prev = merged.id;
      aliveCount += 1;
      // recompute velocity of merged vertex from its two neighbours
      const mv = vertexVelocity(
        merged.pos,
        pv.pos,
        nw.pos,
        speed[pv.edgeIndexNext],
        speed[merged.edgeIndexNext],
      );
      merged.vel = mv ?? { x: 0, y: 0 };
      // also recompute neighbour velocities (their edge set unchanged but
      // positions advanced — velocity is constant for straight edges, so skip).
    } else {
      // SPLIT event: reflex vertex rv lands on edge (sv→ev), splitting the
      // loop into two. Emit the arc for rv. Then create two new vertices at
      // node, one for each resulting loop.
      const rv = byId(bestA);
      const sv = byId(bestB);
      const ev = byId(sv.next);
      arcs.push({
        a: vtxStart.get(rv.id)!,
        b: node,
        originType: "reflex",
        endType: "internal",
        onWall: !!vtxOnWall.get(rv.id),
      });
      edgeChain[sv.edgeIndexNext].push(node);
      edgeChain[byId(rv.prev).edgeIndexNext].push(node);

      // Loop A: rv.prev → [new vtx on sv's edge tail] ... ev
      // Loop B: sv ... [new vtx] → rv.next
      // The reflex vertex rv is consumed; its two incident edges (prev→rv,
      // rv→next) attach to the two halves of the split edge.
      const rp = byId(rv.prev);
      const rn = byId(rv.next);

      rv.alive = false;
      aliveCount -= 1;

      // New vertex P1: replaces rv on the side connecting rp ... node ... ev
      const p1: Vtx = {
        id: nextId++,
        pos: { x: node.x, y: node.y },
        vel: { x: 0, y: 0 },
        type: "internal",
        prev: rp.id,
        next: ev.id,
        alive: true,
        edgeIndexNext: sv.edgeIndexNext, // takes over the tail of sv's edge
        spawnedAt: -1,
      };
      // New vertex P2: side connecting sv ... node ... rn
      const p2: Vtx = {
        id: nextId++,
        pos: { x: node.x, y: node.y },
        vel: { x: 0, y: 0 },
        type: "internal",
        prev: sv.id,
        next: rn.id,
        alive: true,
        edgeIndexNext: rv.edgeIndexNext, // takes over rv's outgoing edge
        spawnedAt: -1,
      };
      verts.push(p1, p2);
      aliveCount += 2;
      vtxStart.set(p1.id, { x: node.x, y: node.y });
      vtxStart.set(p2.id, { x: node.x, y: node.y });
      vtxStartType.set(p1.id, "internal");
      vtxStartType.set(p2.id, "internal");
      vtxOnWall.set(p1.id, false);
      vtxOnWall.set(p2.id, false);
      rp.next = p1.id;
      ev.prev = p1.id;
      sv.next = p2.id;
      rn.prev = p2.id;
      const v1 = vertexVelocity(
        p1.pos,
        rp.pos,
        ev.pos,
        speed[rp.edgeIndexNext],
        speed[p1.edgeIndexNext],
      );
      p1.vel = v1 ?? { x: 0, y: 0 };
      const v2 = vertexVelocity(
        p2.pos,
        sv.pos,
        rn.pos,
        speed[sv.edgeIndexNext],
        speed[p2.edgeIndexNext],
      );
      p2.vel = v2 ?? { x: 0, y: 0 };
    }
  }

  if (iter >= maxIter) return null;

  // Close out the remaining alive loop.
  const remaining = verts.filter((v) => v.alive);
  if (remaining.length === 2) {
    // Two parallel survivors = a RIDGE segment. Connect them directly: each
    // keeps its current position as a ridge endpoint, and the connecting
    // segment is the ridge. Their arcs run from their birth to their final
    // position; the ridge between the two final positions is emitted as an
    // internal→internal arc, and each survivor's edge closes at its own end.
    const [a, b] = remaining;
    arcs.push({
      a: vtxStart.get(a.id)!,
      b: { x: a.pos.x, y: a.pos.y },
      originType: vtxStartType.get(a.id)!,
      endType: "internal",
      onWall: !!vtxOnWall.get(a.id),
    });
    arcs.push({
      a: vtxStart.get(b.id)!,
      b: { x: b.pos.x, y: b.pos.y },
      originType: vtxStartType.get(b.id)!,
      endType: "internal",
      onWall: !!vtxOnWall.get(b.id),
    });
    // the ridge connecting the two final node positions
    arcs.push({
      a: { x: a.pos.x, y: a.pos.y },
      b: { x: b.pos.x, y: b.pos.y },
      originType: "internal",
      endType: "internal",
      onWall: false,
    });
    // both surviving edges close at BOTH final node positions
    edgeChain[a.edgeIndexNext].push({ x: a.pos.x, y: a.pos.y });
    edgeChain[a.edgeIndexNext].push({ x: b.pos.x, y: b.pos.y });
    edgeChain[b.edgeIndexNext].push({ x: b.pos.x, y: b.pos.y });
    edgeChain[b.edgeIndexNext].push({ x: a.pos.x, y: a.pos.y });
  } else if (remaining.length >= 3) {
    // 3+ survivors collapse to their centroid (apex node).
    let cx = 0;
    let cy = 0;
    for (const v of remaining) {
      cx += v.pos.x;
      cy += v.pos.y;
    }
    const node = { x: cx / remaining.length, y: cy / remaining.length };
    if (!isFiniteNum(node.x) || !isFiniteNum(node.y)) return null;
    for (const v of remaining) {
      arcs.push({
        a: vtxStart.get(v.id)!,
        b: node,
        originType: vtxStartType.get(v.id)!,
        endType: "internal",
        onWall: !!vtxOnWall.get(v.id),
      });
      edgeChain[v.edgeIndexNext].push(node);
    }
  }

  // Build slab polygons per original edge. The face is bounded by the edge
  // (start→end) and the interior skeleton nodes its offset boundary passed
  // through. Because each eave-edge face is MONOTONE along the edge direction
  // for a rectilinear roof, we sort the interior nodes by their projection
  // onto the edge (descending — to walk back from `end` to `start`) so the
  // resulting polygon is simple regardless of the event order they were added.
  const slabs: Array<{ edgeIndex: number; polygon: Pt[] }> = [];
  for (let i = 0; i < n; i++) {
    const start = { x: ring[i].x, y: ring[i].y };
    const end = { x: ring[(i + 1) % n].x, y: ring[(i + 1) % n].y };
    const ex = end.x - start.x;
    const ey = end.y - start.y;
    const el = Math.hypot(ex, ey) || 1;
    const ux = ex / el;
    const uy = ey / el;
    // interior nodes (after the seed at index 0), deduped
    const interiorRaw = edgeChain[i].slice(1);
    const interior: Pt[] = [];
    for (const p of interiorRaw) {
      if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) continue;
      if (interior.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-3)) continue;
      interior.push(p);
    }
    // sort descending by projection so we walk end → start along the apex line
    interior.sort(
      (p, q) =>
        (q.x - start.x) * ux + (q.y - start.y) * uy -
        ((p.x - start.x) * ux + (p.y - start.y) * uy),
    );
    const poly: Pt[] = [start, end];
    for (const p of interior) {
      const last = poly[poly.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 1e-4) poly.push(p);
    }
    while (
      poly.length > 3 &&
      Math.hypot(
        poly[poly.length - 1].x - poly[0].x,
        poly[poly.length - 1].y - poly[0].y,
      ) < 1e-4
    ) {
      poly.pop();
    }
    if (poly.length >= 3) slabs.push({ edgeIndex: i, polygon: poly });
  }

  return { arcs, slabs };
}

/** Rebuild a ring with each edge snapped to H or V; collapse collinear/dupes.
 *  Returns null if any edge can't be axis-snapped within tol. */
function rectilinearSnap(ring: Pt[], tol: number): Pt[] | null {
  const n = ring.length;
  if (n < 4) return null;
  const pts = ring.map((p) => ({ x: p.x, y: p.y }));
  // For each edge decide H or V; build constraint. Use a simple pass: snap the
  // shorter delta to 0.
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < tol && dy < tol) continue; // tiny edge — will be collapsed later
    if (dx >= tol && dy >= tol) return null; // genuinely diagonal edge → bail
  }
  // GLOBAL coordinate clustering (the jitter fix). The event simulation needs
  // walls that SHOULD share a coordinate to be NUMERICALLY EXACT — ~1px of
  // AI-trace jitter, snapped per-edge independently, left them slightly unequal
  // and desynced the simultaneous-event ordering (the review's production
  // blocker). Cluster all x's and all y's with a SMALL tol (absorbs jitter,
  // never merges real walls, which sit many px apart) and snap every vertex to
  // its cluster mean, so a visually-rectilinear ring becomes exact.
  const ctol = Math.max(1.5, tol * 0.5);
  const snapAxis = (get: (p: Pt) => number, set: (p: Pt, v: number) => void) => {
    const sorted = pts.map(get).sort((a, b) => a - b);
    const means: number[] = [];
    let sum = sorted[0];
    let count = 1;
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const v = sorted[i];
      if (v - prev <= ctol) {
        sum += v;
        count++;
      } else {
        means.push(sum / count);
        sum = v;
        count = 1;
      }
      prev = v;
    }
    means.push(sum / count);
    for (const p of pts) {
      const v = get(p);
      let best = means[0];
      let bestD = Infinity;
      for (const mu of means) {
        const d = Math.abs(mu - v);
        if (d < bestD) {
          bestD = d;
          best = mu;
        }
      }
      set(p, best);
    }
  };
  snapAxis(
    (p) => p.x,
    (p, v) => {
      p.x = v;
    },
  );
  snapAxis(
    (p) => p.y,
    (p, v) => {
      p.y = v;
    },
  );
  // Snap: walk edges; for a horizontal edge, set both y equal; vertical, both x.
  // Iterate twice to propagate.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx < tol && dy < tol) continue;
      if (dy <= dx) {
        // horizontal — equalize y
        const avg = (a.y + b.y) / 2;
        a.y = avg;
        b.y = avg;
      } else {
        const avg = (a.x + b.x) / 2;
        a.x = avg;
        b.x = avg;
      }
    }
  }
  // Collapse near-duplicate and collinear vertices.
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= tol) out.pop();
  }
  // remove collinear (three consecutive sharing x or y straight line)
  const out2: Pt[] = [];
  const m = out.length;
  for (let i = 0; i < m; i++) {
    const prev = out[(i - 1 + m) % m];
    const cur = out[i];
    const next = out[(i + 1) % m];
    const cr =
      (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    const collinear = Math.abs(cr) < tol * tol * 0.5 + EPS;
    // also collinear if both edges same axis & same fixed coord
    const sameH =
      Math.abs(prev.y - cur.y) < tol && Math.abs(cur.y - next.y) < tol;
    const sameV =
      Math.abs(prev.x - cur.x) < tol && Math.abs(cur.x - next.x) < tol;
    if ((sameH || sameV) && collinear) continue;
    out2.push(cur);
  }
  return out2.length >= 4 ? out2 : out.length >= 4 ? out : null;
}

/**
 * Top-level engine, identical signature to deriveRoofSkeleton. Returns EMPTY
 * (never throws) on any failure so the caller falls back.
 */
export function deriveRoofSkeletonStraight(
  perimeter: readonly Pt[],
  opts?: { eaveSegments?: readonly Seg[]; rakeSegments?: readonly Seg[] },
): RoofSkeleton {
  try {
    const finite = (perimeter ?? []).filter(isFinitePt);
    if (finite.length < 4) return EMPTY;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of finite) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!isFiniteNum(span) || span <= 0) return EMPTY;
    const tol = Math.max(2, span * 0.03);
    const eaveTol = tol * 2;

    let ring = cleanRing(finite, tol);
    if (ring.length < 4) return EMPTY;

    // Orient CCW.
    if (signedArea(ring) < 0) ring = ring.slice().reverse();

    // Rectilinear snap; bail to fallback on any diagonal.
    const snapped = rectilinearSnap(ring, tol);
    if (!snapped) return EMPTY;
    ring = snapped;
    if (signedArea(ring) < 0) ring = ring.slice().reverse();
    const n = ring.length;
    if (n < 4) return EMPTY;
    // Reject a degenerate (zero-area / sliver) ring — e.g. all-collinear input.
    if (Math.abs(signedArea(ring)) < Math.max(1, span * span * 0.001))
      return EMPTY;

    const eaveSegs = (opts?.eaveSegments ?? []).filter(
      (s) => s && isFinitePt(s[0]) && isFinitePt(s[1]),
    );
    const rakeSegs = (opts?.rakeSegments ?? []).filter(
      (s) => s && isFinitePt(s[0]) && isFinitePt(s[1]),
    );
    const haveEaves = eaveSegs.length > 0;

    // Per-edge eave/gable classification mirroring deriveRoofSkeleton's isGable.
    // First, the useEaves gate: do ANY eaves align with a ring edge?
    let anyEaveMatch = false;
    if (haveEaves) {
      for (let i = 0; i < n && !anyEaveMatch; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
        if (vertical) {
          if (
            sideHasEave(
              "v",
              (a.x + b.x) / 2,
              Math.min(a.y, b.y),
              Math.max(a.y, b.y),
              eaveSegs,
              eaveTol,
            )
          )
            anyEaveMatch = true;
        } else if (
          sideHasEave(
            "h",
            (a.y + b.y) / 2,
            Math.min(a.x, b.x),
            Math.max(a.x, b.x),
            eaveSegs,
            eaveTol,
          )
        ) {
          anyEaveMatch = true;
        }
      }
    }
    const useEaves = haveEaves && anyEaveMatch;

    const isGableEdge = (a: Pt, b: Pt): boolean => {
      const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
      const axis: "h" | "v" = vertical ? "v" : "h";
      const fixed = vertical ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
      const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      if (sideEaveCoverage(axis, fixed, lo, hi, eaveSegs, eaveTol) > 0.6)
        return false;
      if (sideHasEave(axis, fixed, lo, hi, rakeSegs, eaveTol)) return true;
      if (!useEaves) return false;
      return !sideMiddleHasEave(axis, fixed, lo, hi, eaveSegs, eaveTol);
    };

    const speed: number[] = [];
    const gables: SkeletonLine[] = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      if (isGableEdge(a, b)) {
        speed.push(0);
        gables.push({ points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] });
      } else {
        speed.push(1);
      }
    }

    // If EVERY edge is a gable (speed 0 everywhere) the offset never moves —
    // degenerate. Bail.
    if (!speed.some((s) => s > 0)) return EMPTY;

    const res = runStraightSkeleton(ring, speed);
    if (!res) return EMPTY;

    // Map arcs → ridges / hips / valleys.
    const ridges: SkeletonLine[] = [];
    const hips: SkeletonLine[] = [];
    const valleys: SkeletonLine[] = [];
    for (const arc of res.arcs) {
      const len = Math.hypot(arc.b.x - arc.a.x, arc.b.y - arc.a.y);
      if (len < Math.max(1, tol * 0.25)) continue; // drop zero/near-zero arcs
      if (!isFinitePt(arc.a) || !isFinitePt(arc.b)) return EMPTY;
      // A corner trace that runs ALONG a gable wall (onWall) is the rake line,
      // already recorded in gables[] — not a hip or valley. Drop it so a gable
      // end shows no hip and no spurious valley.
      if (arc.onWall) continue;
      const line: SkeletonLine = {
        points: [
          { x: arc.a.x, y: arc.a.y },
          { x: arc.b.x, y: arc.b.y },
        ],
      };
      if (arc.originType === "convex") hips.push(line);
      else if (arc.originType === "reflex") valleys.push(line);
      else ridges.push(line);
    }

    // Build faces: one per EAVE edge (speed 1). Gable edges emit no own face.
    const faces: RoofFace[] = [];
    for (const slab of res.slabs) {
      if (speed[slab.edgeIndex] < EPS) continue; // gable edge: no face
      const a = ring[slab.edgeIndex];
      const b = ring[(slab.edgeIndex + 1) % n];
      // The plane slopes DOWN toward its eave — the OUTWARD normal (opposite
      // the inward-offset direction). Snap to exact cardinal for axis edges.
      const ni = inwardNormal(a, b);
      const dh = { x: -ni.x, y: -ni.y };
      const downhill = {
        x: Math.abs(dh.x) > Math.abs(dh.y) ? Math.sign(dh.x) : 0,
        y: Math.abs(dh.y) >= Math.abs(dh.x) ? Math.sign(dh.y) : 0,
      };
      if (downhill.x === 0 && downhill.y === 0) continue;
      const poly = slab.polygon.filter(isFinitePt);
      if (poly.length < 3) continue;
      faces.push({ polygon: poly, downhill });
    }

    if (faces.length === 0) return EMPTY;

    return { ridges, hips, valleys, gables, faces };
  } catch {
    return EMPTY;
  }
}

/**
 * Validate a candidate skeleton: non-degenerate, finite, lines have exactly 2
 * finite points, and face areas sum to within 5% of the footprint area. Used
 * by deriveRoofSkeleton to decide whether to keep the straight-skeleton result
 * or fall back to the grid-decomposition engine.
 */
export function validateSkeleton(
  s: RoofSkeleton,
  perimeter: readonly Pt[],
): boolean {
  try {
    if (!s || s.faces.length < 1) return false;
    const lineOk = (l: SkeletonLine) =>
      l &&
      Array.isArray(l.points) &&
      l.points.length === 2 &&
      isFinitePt(l.points[0]) &&
      isFinitePt(l.points[1]);
    for (const grp of [s.ridges, s.hips, s.valleys, s.gables]) {
      for (const l of grp) if (!lineOk(l)) return false;
    }
    for (const f of s.faces) {
      if (!f || !Array.isArray(f.polygon) || f.polygon.length < 3) return false;
      for (const p of f.polygon) if (!isFinitePt(p)) return false;
      if (!isFinitePt(f.downhill)) return false;
    }
    const polyArea = (poly: Pt[]) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a) / 2;
    };
    const span = (() => {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of perimeter.filter(isFinitePt)) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return Math.max(maxX - minX, maxY - minY);
    })();
    if (!isFiniteNum(span) || span <= 0) return false;
    const footArea = Math.abs(signedArea(cleanRing(perimeter, Math.max(2, span * 0.03))));
    if (footArea <= 0) return false;
    const facesArea = s.faces.reduce((acc, f) => acc + polyArea(f.polygon), 0);
    const rel = Math.abs(facesArea - footArea) / footArea;
    if (rel > 0.05) return false;

    // Reject a DEGENERATE "fan / pyramid" that still tiles: when the offset
    // events all collapse to ONE central apex, every hip meets at the centre and
    // there is NO ridge spine — the faces are sliver triangles radiating from the
    // hub. It passes the area gate but renders as a wrong star. A correct roof on
    // an ELONGATED or ARTICULATED footprint ALWAYS has a real ridge, so require
    // one there. (A near-square 4-corner footprint legitimately has no ridge — a
    // true pyramid — so it's exempt.)
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of perimeter.filter(isFinitePt)) {
      if (p.x < bx0) bx0 = p.x;
      if (p.x > bx1) bx1 = p.x;
      if (p.y < by0) by0 = p.y;
      if (p.y > by1) by1 = p.y;
    }
    const W = bx1 - bx0;
    const H = by1 - by0;
    const aspect = Math.max(W, H) / Math.max(1e-6, Math.min(W, H));
    const corners = cleanRing(perimeter, Math.max(2, span * 0.03)).length;
    const ridgeLen = s.ridges.reduce(
      (a, l) =>
        a + Math.hypot(l.points[1].x - l.points[0].x, l.points[1].y - l.points[0].y),
      0,
    );
    if ((aspect > 1.35 || corners > 4) && ridgeLen < 0.08 * span) return false;

    // Reject a fan by its HUB too: a single point that is an endpoint of many
    // skeleton lines (a proper straight-skeleton node has degree ~3).
    const allLines = [...s.ridges, ...s.hips, ...s.valleys];
    const hubTol = Math.max(2, span * 0.02);
    for (const a of allLines) {
      const c = a.points[0];
      let deg = 0;
      for (const b of allLines) {
        if (
          Math.hypot(b.points[0].x - c.x, b.points[0].y - c.y) <= hubTol ||
          Math.hypot(b.points[1].x - c.x, b.points[1].y - c.y) <= hubTol
        )
          deg++;
      }
      if (deg > 7) return false;
    }
    return true;
  } catch {
    return false;
  }
}
