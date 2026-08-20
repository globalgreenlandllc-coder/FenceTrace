"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  Ban,
  CalendarDays,
  CalendarRange,
  Check,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ExternalLink,
  Hammer,
  MapPin,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Plus,
  Search,
  Trash2,
  Undo2,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  createAppointment,
  deleteAppointment,
  listAppointments,
  listSchedulableItems,
  updateAppointment,
  type AppointmentDTO,
  type SchedulableItem,
} from "@/app/actions/schedule";
import {
  cancelJob,
  listJobCalendarEvents,
  listWorkers,
  rescheduleJob,
  type JobCalendarEventDTO,
  type OwnerWorkerDTO,
} from "@/app/actions/workers";
import {
  listCrewAvailability,
  type CrewAvailabilityEntry,
} from "@/app/actions/availability";
import { cn } from "@/lib/utils";
import { dayKey } from "@/lib/day-key";
import { jobSpanDays } from "@/lib/job-span";

/* ------------------------------------------------------------------ */
/*  Time + grid constants                                             */
/* ------------------------------------------------------------------ */

const DAY_START_HOUR = 6; // 6 AM
const DAY_END_HOUR = 21; // 9 PM
const HOURS_PER_DAY = DAY_END_HOUR - DAY_START_HOUR;
const SLOT_MINUTES = 30;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const TOTAL_SLOTS = HOURS_PER_DAY * SLOTS_PER_HOUR;
const SLOT_PX = 28; // height of one 30-min slot
const HOUR_PX = SLOT_PX * SLOTS_PER_HOUR;
const GUTTER_PX = 60; // time-label column width

/* Working window the smart scheduler books inside. */
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;

/* Sensible default durations per appointment type (minutes). */
const DEFAULT_DURATION_MIN: Record<AppointmentDTO["type"], number> = {
  LEAD_VISIT: 60,
  JOB_INSTALL: 240,
  PROPOSAL_MEETING: 60,
  FOLLOW_UP: 30,
  OTHER: 60,
};

function defaultTypeForItem(item: SchedulableItem): AppointmentDTO["type"] {
  return item.kind === "lead" ? "LEAD_VISIT" : "JOB_INSTALL";
}

const TYPE_META: Record<
  AppointmentDTO["type"],
  { label: string; bg: string; ring: string; text: string; chip: string }
> = {
  LEAD_VISIT: {
    label: "Site visit",
    bg: "bg-sky-50",
    ring: "ring-sky-300",
    text: "text-sky-900",
    chip: "bg-sky-500",
  },
  JOB_INSTALL: {
    label: "Install",
    bg: "bg-emerald-50",
    ring: "ring-emerald-300",
    text: "text-emerald-900",
    chip: "bg-emerald-500",
  },
  PROPOSAL_MEETING: {
    label: "Proposal meeting",
    bg: "bg-violet-50",
    ring: "ring-violet-300",
    text: "text-violet-900",
    chip: "bg-violet-500",
  },
  FOLLOW_UP: {
    label: "Follow-up",
    bg: "bg-amber-50",
    ring: "ring-amber-300",
    text: "text-amber-900",
    chip: "bg-amber-500",
  },
  OTHER: {
    label: "Other",
    bg: "bg-zinc-50",
    ring: "ring-zinc-300",
    text: "text-zinc-900",
    chip: "bg-zinc-500",
  },
};

/* Per-worker tile palette for assigned-job overlays — deterministic on the
   workerId so a worker keeps their color across weeks. */
const WORKER_PALETTE = [
  { bg: "bg-indigo-50", ring: "ring-indigo-300", text: "text-indigo-900", chip: "bg-indigo-500" },
  { bg: "bg-teal-50", ring: "ring-teal-300", text: "text-teal-900", chip: "bg-teal-500" },
  { bg: "bg-orange-50", ring: "ring-orange-300", text: "text-orange-900", chip: "bg-orange-500" },
  { bg: "bg-fuchsia-50", ring: "ring-fuchsia-300", text: "text-fuchsia-900", chip: "bg-fuchsia-500" },
  { bg: "bg-lime-50", ring: "ring-lime-300", text: "text-lime-900", chip: "bg-lime-600" },
  { bg: "bg-cyan-50", ring: "ring-cyan-300", text: "text-cyan-900", chip: "bg-cyan-500" },
] as const;

function workerTone(workerId: string) {
  let h = 0;
  for (let i = 0; i < workerId.length; i++) h = (h * 31 + workerId.charCodeAt(i)) >>> 0;
  return WORKER_PALETTE[h % WORKER_PALETTE.length];
}

/* Worker-set day availability, keyed workerId → "YYYY-MM-DD" (local). */
type DayAvailability = "AVAILABLE" | "UNAVAILABLE";
type AvailabilityMap = Map<string, Map<string, DayAvailability>>;

function buildAvailabilityMap(entries: CrewAvailabilityEntry[]): AvailabilityMap {
  const map: AvailabilityMap = new Map();
  for (const e of entries) {
    let inner = map.get(e.workerId);
    if (!inner) {
      inner = new Map();
      map.set(e.workerId, inner);
    }
    inner.set(e.date, e.status);
  }
  return map;
}

/* Job lifecycle paint — the calendar answers "did they accept? are they on
   site? is it done?" at a glance, so nobody phones anybody. Single source of
   both the label and the colors for a job status. */
const JOB_STATUS_META: Record<
  JobCalendarEventDTO["status"],
  { label: string; pill: string; dot: string }
> = {
  OFFERED: { label: "offered", pill: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  ACCEPTED: { label: "accepted", pill: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  IN_PROGRESS: { label: "in progress", pill: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  COMPLETED: { label: "done", pill: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400" },
  DECLINED: { label: "declined", pill: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  CANCELLED: { label: "cancelled", pill: "bg-zinc-100 text-zinc-500", dot: "bg-zinc-300" },
};

function JobStatusPill({
  status,
  className,
}: {
  status: JobCalendarEventDTO["status"];
  className?: string;
}) {
  const meta = JOB_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
        meta.pill,
        className,
      )}
    >
      {status === "IN_PROGRESS" ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
        </span>
      ) : status === "COMPLETED" ? (
        <Check className="h-2.5 w-2.5" />
      ) : (
        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      )}
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Date helpers — local-time week math                               */
/* ------------------------------------------------------------------ */

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  // Monday-first; getDay returns 0 for Sun.
  const day = out.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + diff);
  return out;
}

function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  return out;
}

function fmtDay(d: Date): { weekday: string; date: string } {
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    date: d.toLocaleDateString(undefined, { day: "numeric" }),
  };
}

function fmtRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: "numeric" };
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, sameYear ? opts : yearOpts)}, ${end.getFullYear()}`;
}

function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateForSlot(weekStart: Date, dayIndex: number, slotIndex: number): Date {
  const out = addDays(weekStart, dayIndex);
  out.setHours(DAY_START_HOUR, 0, 0, 0);
  out.setMinutes(slotIndex * SLOT_MINUTES);
  return out;
}

function minutesFromDayStart(d: Date): number {
  return (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
}

/* ------------------------------------------------------------------ */
/*  Overlap layout — side-by-side columns for events that collide     */
/* ------------------------------------------------------------------ */

type DayTile =
  | { kind: "appt"; key: string; start: Date; end: Date; appt: AppointmentDTO }
  | {
      kind: "job";
      key: string;
      start: Date;
      end: Date;
      job: JobCalendarEventDTO;
      /** 1-based "Day N of M" position when the job spans several days. */
      dayIdx?: number;
      spanDays?: number;
    };

/**
 * A multi-day job's slice for one calendar day: the job's daily clock
 * window repeated on every covered day ("crew on site 8–4, Mon–Wed"),
 * with an overlap clamp for overnight-shaped windows. Null when the day
 * is outside the span.
 */
function jobSegmentForDay(
  j: { startsAt: string; endsAt: string },
  day: Date,
): { start: Date; end: Date; dayIdx: number; spanDays: number } | null {
  const s = new Date(j.startsAt);
  const e = new Date(j.endsAt);
  const spanDays = jobSpanDays(s, e);
  const dayMid = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const sMid = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const dayIdx = Math.round((dayMid.getTime() - sMid.getTime()) / 86_400_000) + 1;
  if (dayIdx < 1 || dayIdx > spanDays) return null;
  let segStart = new Date(dayMid);
  segStart.setHours(s.getHours(), s.getMinutes(), 0, 0);
  let segEnd = new Date(dayMid);
  segEnd.setHours(e.getHours(), e.getMinutes(), 0, 0);
  if (segEnd <= segStart) {
    // End clock earlier than start clock — clamp to the real overlap.
    // Calendar-constructor midnight, not +24h, so DST days stay aligned.
    const nextMid = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    segStart = s > dayMid ? s : dayMid;
    segEnd = e < nextMid ? e : nextMid;
    if (segEnd <= segStart) return null;
  }
  return { start: segStart, end: segEnd, dayIdx, spanDays };
}

type PositionedTile = { tile: DayTile; col: number; cols: number };

/** Greedy interval-graph coloring: overlapping tiles get side-by-side
 *  columns instead of stacking on top of each other. */
function layoutOverlaps(tiles: DayTile[]): PositionedTile[] {
  const sorted = [...tiles].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime(),
  );
  const out: PositionedTile[] = [];
  let active: { col: number; end: number }[] = [];
  let cluster: PositionedTile[] = [];
  let clusterCols = 0;
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const p of cluster) p.cols = clusterCols;
    out.push(...cluster);
    cluster = [];
    active = [];
    clusterCols = 0;
    clusterEnd = -Infinity;
  };

  for (const tile of sorted) {
    const s = tile.start.getTime();
    const e = tile.end.getTime();
    if (cluster.length && s >= clusterEnd) flush();
    active = active.filter((a) => a.end > s);
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col++;
    active.push({ col, end: e });
    const positioned: PositionedTile = { tile, col, cols: 1 };
    cluster.push(positioned);
    clusterCols = Math.max(clusterCols, col + 1);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/*  Smart slot suggestions                                            */
/* ------------------------------------------------------------------ */

type SmartSlot = {
  start: Date;
  end: Date;
  backToBack: boolean; // adjacent to an existing booking → fewer trips
};

type BusyInterval = { start: number; end: number };

/**
 * Scans the next 14 days for open working-hour slots that fit `durationMin`,
 * skipping Sundays and anything that collides with an appointment or an
 * assigned crew job. Prefers the earliest options, with a bonus for slots
 * back-to-back with an existing booking (route/trip clustering).
 *
 * When a crew member's availability is supplied, days they marked
 * unavailable are skipped entirely and days they marked available get a
 * scoring bonus — the scheduler books where the crew said they'd be.
 */
function findSmartSlots(
  durationMin: number,
  busy: BusyInterval[],
  now: Date,
  workerDays?: Map<string, DayAvailability>,
): SmartSlot[] {
  const candidates: { slot: SmartSlot; score: number }[] = [];
  const dayZero = new Date(now);
  dayZero.setHours(0, 0, 0, 0);

  for (let day = 0; day < 14; day++) {
    const date = addDays(dayZero, day);
    if (date.getDay() === 0) continue; // Sundays off
    const avail = workerDays?.get(dayKey(date)) ?? null;
    if (avail === "UNAVAILABLE") continue; // the crew member blocked this day

    for (
      let min = WORK_START_HOUR * 60;
      min + durationMin <= WORK_END_HOUR * 60;
      min += SLOT_MINUTES
    ) {
      const start = new Date(date);
      start.setMinutes(min);
      const end = new Date(start.getTime() + durationMin * 60000);
      if (start.getTime() < now.getTime()) continue;

      const s = start.getTime();
      const e = end.getTime();
      if (busy.some((b) => b.start < e && b.end > s)) continue;

      const backToBack = busy.some(
        (b) =>
          sameDay(new Date(b.start), start) &&
          (Math.abs(b.end - s) <= 30 * 60000 || Math.abs(b.start - e) <= 30 * 60000),
      );

      // Earlier is better; back-to-back with an existing visit wins the day;
      // a day the crew member marked available beats an unmarked one.
      const score =
        day * 24 * 60 + min - (backToBack ? 240 : 0) - (avail === "AVAILABLE" ? 480 : 0);
      candidates.push({ slot: { start, end, backToBack }, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  // At most one suggestion per day so the user sees real alternatives.
  const seenDays = new Set<string>();
  const out: SmartSlot[] = [];
  for (const c of candidates) {
    const dayStr = c.slot.start.toDateString();
    if (seenDays.has(dayStr)) continue;
    seenDays.add(dayStr);
    out.push(c.slot);
    if (out.length >= 4) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

type ViewMode = "day" | "week" | "month";

type DropPreview = {
  dayIndex: number;
  slotIndex: number;
  durationMin: number;
  label: string;
};

export function CalendarBoard({
  /** Chrome-free pop-out mode (?view=standalone): the scheduling rail starts
   *  collapsed so one crew member's calendar fills the screen. */
  standalone = false,
}: {
  standalone?: boolean;
} = {}) {
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [appointments, setAppointments] = useState<AppointmentDTO[]>([]);
  const [jobEvents, setJobEvents] = useState<JobCalendarEventDTO[]>([]);
  const [schedulable, setSchedulable] = useState<SchedulableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AppointmentDTO | null>(null);
  const [creating, setCreating] = useState<{
    startsAt: string;
    endsAt: string;
    seed?: SchedulableItem;
    workerId?: string | null;
  } | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [crew, setCrew] = useState<OwnerWorkerDTO[]>([]);
  const [availabilityEntries, setAvailabilityEntries] = useState<CrewAvailabilityEntry[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  // Non-null while a calendar tile (not a sidebar card) is being dragged —
  // turns the sidebar into a "drop to unschedule" target.
  const [dragSource, setDragSource] = useState<"appt" | "job" | null>(null);
  const [smartFor, setSmartFor] = useState<SchedulableItem | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [monthHoverDay, setMonthHoverDay] = useState<string | null>(null);
  // The right-hand "to schedule" rail. Collapsed by default in a pop-out —
  // the point of a per-worker tab is a full-width calendar — toggleable back
  // for drag-to-schedule.
  const [railOpen, setRailOpen] = useState(!standalone);

  // Restore the last-used view across visits. First visit on a phone
  // defaults to the day agenda — 7 grid columns are unreadable there.
  useEffect(() => {
    const saved = window.localStorage.getItem("calendar-view");
    if (saved === "month" || saved === "week" || saved === "day") {
      setView(saved);
    } else if (window.innerWidth < 1024) {
      setView("day");
    }
    // ?worker=<id> deep-links straight into one crew member's calendar —
    // this is what the crew-bar "pop out" button opens in a new tab.
    const workerParam = new URLSearchParams(window.location.search).get("worker");
    if (workerParam) setSelectedWorkerId(workerParam);
  }, []);

  // Keep the URL shareable: selecting a crew member writes ?worker=<id>
  // without triggering a navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedWorkerId) url.searchParams.set("worker", selectedWorkerId);
    else url.searchParams.delete("worker");
    window.history.replaceState(null, "", url.toString());
  }, [selectedWorkerId]);
  const switchView = useCallback((v: ViewMode) => {
    setView(v);
    window.localStorage.setItem("calendar-view", v);
  }, []);

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);
  const gridStart = useMemo(() => startOfMonthGrid(anchor), [anchor]);
  // Day view fetches the whole surrounding week so stepping through the
  // days of one week never refetches.
  const rangeStart = view === "month" ? gridStart : weekStart;
  const rangeEnd = useMemo(
    () => addDays(rangeStart, view === "month" ? 42 : 7),
    [rangeStart, view],
  );

  // Bumped on every optimistic drag mutation. The silent poll uses it to drop
  // a response that raced a just-committed move (else a stale in-flight fetch
  // would snap the tile back to where it was dragged from).
  const mutationSeq = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [appts, jobs, items, workers, avail] = await Promise.all([
      listAppointments(rangeStart.toISOString(), rangeEnd.toISOString()),
      listJobCalendarEvents(rangeStart.toISOString(), rangeEnd.toISOString()),
      listSchedulableItems(),
      listWorkers(),
      listCrewAvailability(rangeStart.toISOString(), rangeEnd.toISOString()),
    ]);
    setAppointments(appts);
    setJobEvents(jobs);
    setSchedulable(items);
    setCrew(workers);
    setAvailabilityEntries(avail);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime(), rangeEnd.getTime()]);

  // The live-status poll only re-fetches the two things a crew tap changes
  // (appointments + job events) — not workers/availability/schedulable, which
  // move on human cadence and are already refreshed on mount, range change,
  // and after mutations. Keeps the per-minute cost to 2 light queries.
  const refreshLive = useCallback(async () => {
    if (dragData.current) return; // never fight an in-progress drag
    const seq = mutationSeq.current;
    const [appts, jobs] = await Promise.all([
      listAppointments(rangeStart.toISOString(), rangeEnd.toISOString()),
      listJobCalendarEvents(rangeStart.toISOString(), rangeEnd.toISOString()),
    ]);
    // A drag or mutation landed while we were fetching → our snapshot is
    // already stale; drop it rather than clobber the optimistic state.
    if (dragData.current || mutationSeq.current !== seq) return;
    setAppointments(appts);
    setJobEvents(jobs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime(), rangeEnd.getTime()]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live board: crew "start job" / "done" taps show up within a minute without
  // anyone reloading. Paused while the tab is hidden (a backgrounded tab
  // shouldn't burn queries), and refreshed once the moment it's shown again.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") refreshLive();
    };
    const t = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshLive]);

  const availability = useMemo(
    () => buildAvailabilityMap(availabilityEntries),
    [availabilityEntries],
  );
  const selectedWorker = useMemo(
    () => crew.find((w) => w.id === selectedWorkerId) ?? null,
    [crew, selectedWorkerId],
  );
  // A ?worker= deep link (or a since-removed worker) can leave selectedWorkerId
  // pointing at nobody — which would dim every tile with no chip to explain or
  // clear it. Once crew has loaded, drop a selection that matches no member.
  useEffect(() => {
    if (selectedWorkerId && crew.length > 0 && !crew.some((w) => w.id === selectedWorkerId)) {
      setSelectedWorkerId(null);
    }
  }, [crew, selectedWorkerId]);
  /** Day availability of the selected crew member, or null when nobody is
   *  selected / the day is unmarked. */
  const dayStatusFor = useCallback(
    (d: Date): DayAvailability | null =>
      selectedWorkerId
        ? (availability.get(selectedWorkerId)?.get(dayKey(d)) ?? null)
        : null,
    [selectedWorkerId, availability],
  );

  const filteredSidebar = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    if (!q) return schedulable;
    return schedulable.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.address?.toLowerCase().includes(q) ?? false),
    );
  }, [schedulable, sidebarFilter]);

  /* Drag-and-drop wire-up. Native DataTransfer + a ref-based payload because
     one mechanism covers drop-from-sidebar, move, and resize with no deps.
     effectAllowed and dropEffect must AGREE ("move" everywhere) — a
     copy/move mismatch makes browsers silently cancel the drop. */
  const dragData = useRef<
    | { kind: "item"; item: SchedulableItem }
    | { kind: "appt-move"; appt: AppointmentDTO; grabOffsetMin: number }
    | { kind: "appt-resize"; appt: AppointmentDTO }
    | {
        kind: "job-move";
        job: JobCalendarEventDTO;
        grabOffsetMin: number;
        /** 0-based day of the grabbed segment inside a multi-day job —
         *  dropping Day 2 on Tuesday must land Day 1 on Monday. */
        dayOffset: number;
      }
    | null
  >(null);

  function clearDrag() {
    dragData.current = null;
    setDropPreview(null);
    setMonthHoverDay(null);
    setDragSource(null);
  }

  function startDragItem(e: DragEvent, item: SchedulableItem) {
    dragData.current = { kind: "item", item };
    e.dataTransfer.effectAllowed = "move";
    // Setting some data is required for Firefox to actually start a drag.
    e.dataTransfer.setData("text/plain", item.id);
  }

  function startDragAppt(e: DragEvent, appt: AppointmentDTO) {
    const grab =
      ((e.clientY -
        (e.currentTarget as HTMLElement).getBoundingClientRect().top) /
        SLOT_PX) *
      SLOT_MINUTES;
    dragData.current = {
      kind: "appt-move",
      appt,
      grabOffsetMin: Math.round(grab / SLOT_MINUTES) * SLOT_MINUTES,
    };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", appt.id);
    setDragSource("appt");
  }

  function startDragJob(e: DragEvent, job: JobCalendarEventDTO, dayIdx?: number) {
    const grab =
      ((e.clientY -
        (e.currentTarget as HTMLElement).getBoundingClientRect().top) /
        SLOT_PX) *
      SLOT_MINUTES;
    dragData.current = {
      kind: "job-move",
      job,
      grabOffsetMin: Math.round(grab / SLOT_MINUTES) * SLOT_MINUTES,
      dayOffset: (dayIdx ?? 1) - 1,
    };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", job.id);
    setDragSource("job");
  }

  function startResizeAppt(e: DragEvent, appt: AppointmentDTO) {
    dragData.current = { kind: "appt-resize", appt };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", appt.id);
  }

  /**
   * Resolves a pointer position into (dayIndex, slotIndex) grid coords.
   * The grid's first GUTTER_PX are the time labels — subtract them before
   * dividing by day-column width, or every drop lands a column early.
   */
  function gridCoords(
    e: DragEvent,
    container: HTMLElement,
  ): { dayIndex: number; slotIndex: number } | null {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left - GUTTER_PX;
    const y = e.clientY - rect.top + container.scrollTop;
    if (x < 0) return null;
    const dayWidth = (rect.width - GUTTER_PX) / 7;
    const dayCol = Math.floor(x / dayWidth);
    const slot = Math.floor(y / SLOT_PX);
    if (dayCol < 0 || dayCol > 6) return null;
    if (slot < 0 || slot >= TOTAL_SLOTS) return null;
    return { dayIndex: dayCol, slotIndex: slot };
  }

  /** Live ghost while dragging over the week grid, so the user sees exactly
   *  where the booking will land before letting go. */
  function onGridDragOver(e: DragEvent, container: HTMLElement) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = gridCoords(e, container);
    const d = dragData.current;
    if (!target || !d) {
      setDropPreview(null);
      return;
    }
    let preview: DropPreview | null = null;
    if (d.kind === "item") {
      preview = {
        dayIndex: target.dayIndex,
        slotIndex: target.slotIndex,
        durationMin: DEFAULT_DURATION_MIN[defaultTypeForItem(d.item)],
        label: d.item.title,
      };
    } else if (d.kind === "appt-move" || d.kind === "job-move") {
      const src = d.kind === "appt-move" ? d.appt : d.job;
      let dur =
        (new Date(src.endsAt).getTime() - new Date(src.startsAt).getTime()) / 60000;
      let label = src.title;
      if (d.kind === "job-move") {
        // A multi-day job's ghost shows its DAILY window, not a tile
        // flooding the column for 72 hours; the day count rides the label.
        const seg = jobSegmentForDay(d.job, new Date(d.job.startsAt));
        if (seg) {
          dur = (seg.end.getTime() - seg.start.getTime()) / 60000;
          if (seg.spanDays > 1) label = `${src.title} · ${seg.spanDays} days`;
        }
      }
      const slotShift = Math.round(d.grabOffsetMin / SLOT_MINUTES);
      preview = {
        dayIndex: target.dayIndex,
        slotIndex: Math.max(0, target.slotIndex - slotShift),
        durationMin: dur,
        label,
      };
    }
    setDropPreview((prev) =>
      prev &&
      preview &&
      prev.dayIndex === preview.dayIndex &&
      prev.slotIndex === preview.slotIndex
        ? prev
        : preview,
    );
  }

  async function onGridDrop(e: DragEvent, container: HTMLElement) {
    e.preventDefault();
    const target = gridCoords(e, container);
    const d = dragData.current;
    clearDrag();
    if (!target || !d) return;
    mutationSeq.current++; // this drop supersedes any in-flight live poll

    if (d.kind === "item") {
      // New appointment seeded from a lead / proposal — opens the create
      // modal so the user can confirm/tweak before persist.
      const start = dateForSlot(weekStart, target.dayIndex, target.slotIndex);
      const durMin = DEFAULT_DURATION_MIN[defaultTypeForItem(d.item)];
      const end = new Date(start.getTime() + durMin * 60000);
      setCreating({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        seed: d.item,
        workerId: selectedWorkerId,
      });
      return;
    }

    if (d.kind === "job-move") {
      const newStart = dateForSlot(weekStart, target.dayIndex, target.slotIndex);
      newStart.setMinutes(newStart.getMinutes() - d.grabOffsetMin);
      // Dropping a Day-N segment keeps that day AS Day N.
      newStart.setDate(newStart.getDate() - d.dayOffset);
      const duration =
        new Date(d.job.endsAt).getTime() - new Date(d.job.startsAt).getTime();
      const newEnd = new Date(newStart.getTime() + duration);
      setJobEvents((prev) =>
        prev.map((j) =>
          j.id === d.job.id
            ? { ...j, startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() }
            : j,
        ),
      );
      const r = await rescheduleJob(d.job.id, newStart.toISOString(), newEnd.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (!r.ok) refresh();
      return;
    }

    if (d.kind === "appt-move") {
      const newStart = dateForSlot(weekStart, target.dayIndex, target.slotIndex);
      newStart.setMinutes(newStart.getMinutes() - d.grabOffsetMin);
      const oldStart = new Date(d.appt.startsAt);
      const oldEnd = new Date(d.appt.endsAt);
      const duration = oldEnd.getTime() - oldStart.getTime();
      const newEnd = new Date(newStart.getTime() + duration);
      // Optimistic UI update — server reconciles on refresh.
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === d.appt.id
            ? { ...a, startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() }
            : a,
        ),
      );
      const r = await updateAppointment(d.appt.id, {
        startsAt: newStart.toISOString(),
        endsAt: newEnd.toISOString(),
      });
      if (!r.ok) refresh();
      return;
    }

    if (d.kind === "appt-resize") {
      // Bottom-edge resize: the drop point becomes the new endsAt.
      const newEnd = dateForSlot(weekStart, target.dayIndex, target.slotIndex);
      newEnd.setMinutes(newEnd.getMinutes() + SLOT_MINUTES); // include the slot we landed in
      const start = new Date(d.appt.startsAt);
      if (newEnd.getTime() <= start.getTime()) return;
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === d.appt.id ? { ...a, endsAt: newEnd.toISOString() } : a,
        ),
      );
      const r = await updateAppointment(d.appt.id, {
        endsAt: newEnd.toISOString(),
      });
      if (!r.ok) refresh();
    }
  }

  /** Month-view drop: items land at 9 AM on the target day; moved
   *  appointments keep their time-of-day and just change the date. */
  async function onMonthDrop(e: DragEvent, day: Date) {
    e.preventDefault();
    const d = dragData.current;
    clearDrag();
    if (!d) return;
    mutationSeq.current++; // this drop supersedes any in-flight live poll

    if (d.kind === "item") {
      const start = new Date(day);
      start.setHours(9, 0, 0, 0);
      const durMin = DEFAULT_DURATION_MIN[defaultTypeForItem(d.item)];
      setCreating({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + durMin * 60000).toISOString(),
        seed: d.item,
        workerId: selectedWorkerId,
      });
      return;
    }

    if (d.kind === "appt-move") {
      const oldStart = new Date(d.appt.startsAt);
      const duration = new Date(d.appt.endsAt).getTime() - oldStart.getTime();
      const newStart = new Date(day);
      newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
      const newEnd = new Date(newStart.getTime() + duration);
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === d.appt.id
            ? { ...a, startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() }
            : a,
        ),
      );
      const r = await updateAppointment(d.appt.id, {
        startsAt: newStart.toISOString(),
        endsAt: newEnd.toISOString(),
      });
      if (!r.ok) refresh();
      return;
    }

    if (d.kind === "job-move") {
      const oldStart = new Date(d.job.startsAt);
      const duration = new Date(d.job.endsAt).getTime() - oldStart.getTime();
      const newStart = new Date(day);
      newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
      // Dropping a Day-N chip keeps that day AS Day N.
      newStart.setDate(newStart.getDate() - d.dayOffset);
      const newEnd = new Date(newStart.getTime() + duration);
      setJobEvents((prev) =>
        prev.map((j) =>
          j.id === d.job.id
            ? { ...j, startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() }
            : j,
        ),
      );
      const r = await rescheduleJob(d.job.id, newStart.toISOString(), newEnd.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (!r.ok) refresh();
    }
  }

  /**
   * The reverse direction: dropping a calendar tile onto the sidebar takes it
   * OFF the schedule. Appointments are deleted (their lead/proposal card
   * re-surfaces in the list); crew jobs are cancelled (the worker's offer is
   * withdrawn). Both confirm first — a stray drop shouldn't nuke a booking.
   */
  async function onSidebarDrop(e: DragEvent) {
    e.preventDefault();
    const d = dragData.current;
    clearDrag();
    if (!d) return;
    mutationSeq.current++; // this unschedule supersedes any in-flight live poll

    if (d.kind === "appt-move") {
      const ok = window.confirm(
        `Take "${d.appt.title}" off the calendar? It goes back to the scheduling list.`,
      );
      if (!ok) return;
      setAppointments((prev) => prev.filter((a) => a.id !== d.appt.id));
      const r = await deleteAppointment(d.appt.id);
      if (!r.ok) alert(r.reason);
      refresh();
      return;
    }

    if (d.kind === "job-move") {
      const ok = window.confirm(
        `Unschedule "${d.job.title}"? The job offered to ${d.job.workerName} will be cancelled.`,
      );
      if (!ok) return;
      setJobEvents((prev) => prev.filter((j) => j.id !== d.job.id));
      const r = await cancelJob(d.job.id);
      if (!r.ok) alert(r.reason);
      refresh();
    }
  }

  function stepAnchor(dir: -1 | 1) {
    setAnchor((a) =>
      view === "day"
        ? addDays(a, dir)
        : view === "week"
          ? addDays(startOfWeek(a), dir * 7)
          : addMonths(a, dir),
    );
  }

  /* Range stats for the strip under the header. */
  const stats = useMemo(() => {
    const visits = appointments.filter((a) => a.type === "LEAD_VISIT").length;
    const installs = appointments.filter((a) => a.type === "JOB_INSTALL").length;
    return { visits, installs, crewJobs: jobEvents.length, toSchedule: schedulable.length };
  }, [appointments, jobEvents, schedulable]);

  /* Bookings per crew member in the visible range (jobs + assigned appts) —
     shown as a count on each crew chip. */
  const workerEventCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const j of jobEvents) map.set(j.workerId, (map.get(j.workerId) ?? 0) + 1);
    for (const a of appointments)
      if (a.workerId) map.set(a.workerId, (map.get(a.workerId) ?? 0) + 1);
    return map;
  }, [jobEvents, appointments]);

  return (
    <div className="space-y-4">
      <Header
        view={view}
        onView={switchView}
        rangeLabel={
          view === "day"
            ? anchor.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })
            : view === "week"
              ? fmtRange(weekStart, addDays(weekStart, 6))
              : fmtMonth(anchor)
        }
        onPrev={() => stepAnchor(-1)}
        onNext={() => stepAnchor(1)}
        onToday={() => setAnchor(new Date())}
        onNew={() => {
          const now = new Date();
          const start = new Date(now);
          start.setMinutes(0, 0, 0);
          if (now.getMinutes() > 0) start.setHours(start.getHours() + 1);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          setCreating({
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
          });
        }}
      />

      <StatsStrip stats={stats} view={view} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        {crew.length > 0 ? (
          <CrewBar
            crew={crew}
            counts={workerEventCounts}
            selectedId={selectedWorkerId}
            onSelect={(id) =>
              setSelectedWorkerId((prev) => (prev === id ? null : id))
            }
          />
        ) : (
          <span aria-hidden />
        )}
        {/* Rail toggle — hidden below lg where the rail stacks anyway. */}
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          title={railOpen ? "Hide the scheduling list — full-width calendar" : "Show the scheduling list"}
          className="transition-smooth ring-focus press-scale hidden shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 shadow-sm hover:bg-zinc-50 lg:inline-flex"
        >
          {railOpen ? (
            <>
              <PanelRightClose className="h-3 w-3" />
              Hide list
            </>
          ) : (
            <>
              <PanelRightOpen className="h-3 w-3" />
              To schedule
            </>
          )}
        </button>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          railOpen && "lg:grid-cols-[1fr_320px]",
        )}
      >
        {view === "day" ? (
          <DayAgenda
            weekStart={weekStart}
            anchor={anchor}
            appointments={appointments}
            jobEvents={jobEvents}
            loading={loading}
            selectedWorker={selectedWorker}
            dayStatusFor={dayStatusFor}
            onPickDay={(d) => setAnchor(d)}
            onApptClick={(a) => setEditing(a)}
            onNew={(d) => {
              const start = new Date(d);
              start.setHours(9, 0, 0, 0);
              setCreating({
                startsAt: start.toISOString(),
                endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
                workerId: selectedWorkerId,
              });
            }}
          />
        ) : view === "week" ? (
          <WeekGrid
            weekStart={weekStart}
            appointments={appointments}
            jobEvents={jobEvents}
            loading={loading}
            dropPreview={dropPreview}
            selectedWorkerId={selectedWorkerId}
            dayStatusFor={dayStatusFor}
            onApptClick={(a) => setEditing(a)}
            onApptDragStart={startDragAppt}
            onApptResizeStart={startResizeAppt}
            onJobDragStart={startDragJob}
            onDragOver={onGridDragOver}
            onDrop={onGridDrop}
            onDragEnd={clearDrag}
            onEmptyClick={(start, end) =>
              setCreating({
                startsAt: start.toISOString(),
                endsAt: end.toISOString(),
                workerId: selectedWorkerId,
              })
            }
          />
        ) : (
          <MonthGrid
            gridStart={gridStart}
            month={anchor.getMonth()}
            appointments={appointments}
            jobEvents={jobEvents}
            loading={loading}
            hoverDay={monthHoverDay}
            selectedWorkerId={selectedWorkerId}
            dayStatusFor={dayStatusFor}
            onHoverDay={setMonthHoverDay}
            onDrop={onMonthDrop}
            onDragEnd={clearDrag}
            onApptClick={(a) => setEditing(a)}
            onApptDragStart={startDragAppt}
            onJobDragStart={startDragJob}
            onDayOpen={(d) => {
              setAnchor(d);
              switchView("week");
            }}
            onEmptyClick={(d) => {
              const start = new Date(d);
              start.setHours(9, 0, 0, 0);
              setCreating({
                startsAt: start.toISOString(),
                endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
                workerId: selectedWorkerId,
              });
            }}
          />
        )}

        {/* Below lg the rail stacks under the grid and the collapse toggle is
            hidden, so it must stay reachable there — collapse is lg-only. */}
        <div className={cn(!railOpen && "lg:hidden")}>
          <Sidebar
            items={filteredSidebar}
            filter={sidebarFilter}
            dropActive={dragSource !== null}
            dropKind={dragSource}
            onFilter={setSidebarFilter}
            onDragStart={startDragItem}
            onDragEnd={clearDrag}
            onSmart={(item) => setSmartFor(item)}
            onUnscheduleDragOver={(e) => {
              const d = dragData.current;
              if (d?.kind === "appt-move" || d?.kind === "job-move") {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onUnscheduleDrop={onSidebarDrop}
          />
        </div>
      </div>

      {editing && (
        <EditModal
          appt={editing}
          crew={crew}
          availability={availability}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
          onDeleted={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {creating && (
        <CreateModal
          startsAt={creating.startsAt}
          endsAt={creating.endsAt}
          seed={creating.seed}
          defaultWorkerId={creating.workerId ?? null}
          crew={crew}
          availability={availability}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            refresh();
          }}
        />
      )}
      {smartFor && (
        <SmartScheduleModal
          item={smartFor}
          worker={selectedWorker}
          availability={availability}
          onClose={() => setSmartFor(null)}
          onPick={(slot) => {
            setSmartFor(null);
            setCreating({
              startsAt: slot.start.toISOString(),
              endsAt: slot.end.toISOString(),
              seed: smartFor,
              workerId: selectedWorkerId,
            });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Day agenda — phone-first single-day list                          */
/* ------------------------------------------------------------------ */

/**
 * The mobile answer to the 7-column grids: a tappable week strip on top
 * and the selected day's events as full-width cards underneath. No
 * drag-and-drop here (native DnD doesn't exist on touch) — scheduling
 * happens through the sidebar's ⚡ smart slots or the New button.
 */
function DayAgenda({
  weekStart,
  anchor,
  appointments,
  jobEvents,
  loading,
  selectedWorker,
  dayStatusFor,
  onPickDay,
  onApptClick,
  onNew,
}: {
  weekStart: Date;
  anchor: Date;
  appointments: AppointmentDTO[];
  jobEvents: JobCalendarEventDTO[];
  loading: boolean;
  selectedWorker: OwnerWorkerDTO | null;
  dayStatusFor: (d: Date) => DayAvailability | null;
  onPickDay: (d: Date) => void;
  onApptClick: (a: AppointmentDTO) => void;
  onNew: (d: Date) => void;
}) {
  const anchorAvail = selectedWorker ? dayStatusFor(anchor) : null;
  const today = new Date();
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Tiles overlapping the selected day — a multi-day crew job still shows
  // on its middle days, matching how the week grid clips it per column.
  const tilesForDay = useCallback(
    (day: Date): DayTile[] => {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = addDays(dayStart, 1);
      const overlaps = (s: Date, e: Date) => s < dayEnd && e > dayStart;
      const out: DayTile[] = [];
      for (const a of appointments) {
        const start = new Date(a.startsAt);
        const end = new Date(a.endsAt);
        if (overlaps(start, end))
          out.push({ kind: "appt", key: `a-${a.id}`, start, end, appt: a });
      }
      for (const j of jobEvents) {
        const seg = jobSegmentForDay(j, day);
        if (seg)
          out.push({
            kind: "job",
            key: `j-${j.id}`,
            start: seg.start,
            end: seg.end,
            job: j,
            dayIdx: seg.dayIdx,
            spanDays: seg.spanDays,
          });
      }
      return out.sort((x, y) => x.start.getTime() - y.start.getTime());
    },
    [appointments, jobEvents],
  );

  const tiles = useMemo(() => tilesForDay(anchor), [tilesForDay, anchor]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-card">
      {/* Week strip — jump between the days of the fetched week. */}
      <div className="grid grid-cols-7 gap-1 border-b border-zinc-200/70 p-2">
        {days.map((d) => {
          const active = sameDay(d, anchor);
          const isToday = sameDay(d, today);
          const busy = tilesForDay(d).length > 0;
          const f = fmtDay(d);
          return (
            <button
              key={d.toISOString()}
              onClick={() => onPickDay(d)}
              className={cn(
                "transition-smooth ring-focus press-scale flex flex-col items-center gap-0.5 rounded-lg py-1.5",
                active
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-50",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-medium uppercase",
                  active ? "text-white/80" : "text-zinc-400",
                )}
              >
                {f.weekday}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  !active && isToday && "text-accent-700",
                )}
              >
                {f.date}
              </span>
              <span
                className={cn(
                  "h-1 w-1 rounded-full",
                  busy
                    ? active
                      ? "bg-white/90"
                      : "bg-accent-500"
                    : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>

      {/* Selected crew member's availability for the picked day */}
      {selectedWorker && (
        <div
          className={cn(
            "flex items-center gap-1.5 border-b border-zinc-200/70 px-3 py-1.5 text-[11px] font-medium",
            anchorAvail === "AVAILABLE"
              ? "bg-emerald-50 text-emerald-800"
              : anchorAvail === "UNAVAILABLE"
                ? "bg-rose-50 text-rose-800"
                : "bg-zinc-50 text-zinc-500",
          )}
        >
          {anchorAvail === "AVAILABLE" ? (
            <Check className="h-3 w-3" />
          ) : anchorAvail === "UNAVAILABLE" ? (
            <Ban className="h-3 w-3" />
          ) : (
            <UserRound className="h-3 w-3" />
          )}
          {selectedWorker.name || selectedWorker.email}
          {anchorAvail === "AVAILABLE"
            ? " is available this day"
            : anchorAvail === "UNAVAILABLE"
              ? " marked this day unavailable"
              : " hasn't marked this day"}
        </div>
      )}

      {/* Agenda list */}
      {loading ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <CalendarDays className="h-6 w-6 text-zinc-300" />
          <div className="text-sm font-medium text-zinc-600">
            Nothing scheduled
          </div>
          <div className="text-xs text-zinc-400">
            Free day — book a visit or an install.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {tiles.map((tile) =>
            tile.kind === "appt" ? (
              <button
                key={tile.key}
                onClick={() => onApptClick(tile.appt)}
                className={cn(
                  "transition-smooth ring-focus flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-zinc-50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 h-10 w-1 shrink-0 rounded-full",
                    TYPE_META[tile.appt.type].chip,
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-900">
                      {tile.appt.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {fmtTime(tile.start)} – {fmtTime(tile.end)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "text-[11px] font-medium",
                      TYPE_META[tile.appt.type].text,
                    )}
                  >
                    {TYPE_META[tile.appt.type].label}
                  </div>
                  {(tile.appt.address || tile.appt.clientName) && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500">
                      {tile.appt.address && (
                        <>
                          <MapPin className="h-3 w-3 shrink-0 text-zinc-400" />
                          <span className="truncate">{tile.appt.address}</span>
                        </>
                      )}
                      {!tile.appt.address && tile.appt.clientName}
                    </div>
                  )}
                </div>
              </button>
            ) : (
              <div key={tile.key} className="flex items-start gap-3 px-3 py-3">
                <span
                  className={cn(
                    "mt-0.5 h-10 w-1 shrink-0 rounded-full",
                    workerTone(tile.job.workerId).chip,
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-900">
                      {tile.job.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                      {fmtTime(tile.start)} – {fmtTime(tile.end)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 text-[11px] font-medium",
                      workerTone(tile.job.workerId).text,
                    )}
                  >
                    <Hammer className="h-3 w-3" />
                    <span className="truncate">
                      {tile.job.workerName} · {tile.job.kindLabel}
                    </span>
                    <JobStatusPill status={tile.job.status} />
                    {(tile.spanDays ?? 1) > 1 && (
                      <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] font-semibold text-zinc-600">
                        Day {tile.dayIdx} of {tile.spanDays}
                      </span>
                    )}
                  </div>
                  {tile.job.address && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500">
                      <MapPin className="h-3 w-3 shrink-0 text-zinc-400" />
                      <span className="truncate">{tile.job.address}</span>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      <div className="border-t border-zinc-200/70 p-3">
        <button
          onClick={() => onNew(anchor)}
          className="transition-smooth ring-focus press-scale flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 py-2 text-xs font-medium text-zinc-500 hover:border-accent-400 hover:text-accent-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Add to {sameDay(anchor, today) ? "today" : fmtDay(anchor).weekday}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header bar                                                        */
/* ------------------------------------------------------------------ */

function Header({
  view,
  onView,
  rangeLabel,
  onPrev,
  onNext,
  onToday,
  onNew,
}: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-sm">
          <CalendarDays className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
            Schedule
          </h2>
          <p className="text-xs text-zinc-500">
            Drag on to book, drag off to unschedule — click a crew member to see
            their days, or hit ⚡ for a smart slot.
          </p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="hidden text-sm font-medium text-zinc-700 sm:block">
          {rangeLabel}
        </div>
        {/* Day / Week / Month toggle */}
        <div className="flex items-center rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm">
          <button
            onClick={() => onView("day")}
            className={cn(
              "transition-smooth ring-focus press-scale inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
              view === "day"
                ? "bg-accent-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-50",
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Day
          </button>
          <button
            onClick={() => onView("week")}
            className={cn(
              "transition-smooth ring-focus press-scale inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
              view === "week"
                ? "bg-accent-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-50",
            )}
          >
            <Columns3 className="h-3.5 w-3.5" />
            Week
          </button>
          <button
            onClick={() => onView("month")}
            className={cn(
              "transition-smooth ring-focus press-scale inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
              view === "month"
                ? "bg-accent-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-50",
            )}
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Month
          </button>
        </div>
        <div className="flex items-center rounded-lg border border-zinc-200 bg-white shadow-sm">
          <button
            onClick={onPrev}
            className="transition-smooth ring-focus press-scale flex h-9 w-9 items-center justify-center rounded-l-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
            aria-label={`Previous ${view}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onToday}
            className="transition-smooth ring-focus press-scale border-x border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Today
          </button>
          <button
            onClick={onNext}
            className="transition-smooth ring-focus press-scale flex h-9 w-9 items-center justify-center rounded-r-lg text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
            aria-label={`Next ${view}`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={onNew}
          className="transition-smooth ring-focus press-scale inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-accent-700"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New appointment</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats strip + worker legend                                       */
/* ------------------------------------------------------------------ */

function StatsStrip({
  stats,
  view,
}: {
  stats: { visits: number; installs: number; crewJobs: number; toSchedule: number };
  view: ViewMode;
}) {
  // Day view still fetches (and counts) the surrounding week.
  const rangeWord = view === "month" ? "this month" : "this week";
  const cells: { label: string; value: number; dot: string }[] = [
    { label: `Site visits ${rangeWord}`, value: stats.visits, dot: "bg-sky-500" },
    { label: `Installs ${rangeWord}`, value: stats.installs, dot: "bg-emerald-500" },
    { label: `Crew jobs ${rangeWord}`, value: stats.crewJobs, dot: "bg-indigo-500" },
    { label: "Waiting to be scheduled", value: stats.toSchedule, dot: "bg-amber-500" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <div
          key={c.label}
          className="surface flex items-center gap-2.5 px-3 py-2 shadow-card"
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} />
          <div className="min-w-0">
            <div className="text-base font-semibold tabular-nums text-zinc-900">
              {c.value}
            </div>
            <div className="truncate text-[10px] text-zinc-500">{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * All of the owner's crew (workers + subcontractors) as selectable chips.
 * Clicking one paints that person's availability onto the calendar, spotlights
 * their bookings, and pre-selects them in every scheduling flow. Click again
 * to deselect.
 */
function CrewBar({
  crew,
  counts,
  selectedId,
  onSelect,
}: {
  crew: OwnerWorkerDTO[];
  counts: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const groups: { label: string; members: OwnerWorkerDTO[] }[] = [
    { label: "Crew", members: crew.filter((w) => w.kind !== "SALES") },
    { label: "Sales", members: crew.filter((w) => w.kind === "SALES") },
  ].filter((g) => g.members.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {groups.map((g) => (
        <span key={g.label} className="contents">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500",
              g.label === "Sales" && "ml-2",
            )}
          >
            {g.label === "Sales" ? (
              <UserRound className="h-3.5 w-3.5" />
            ) : (
              <Users className="h-3.5 w-3.5" />
            )}
            {g.label}
          </span>
          {g.members.map((w) => {
            const tone = workerTone(w.id);
            const selected = selectedId === w.id;
            const count = counts.get(w.id) ?? 0;
            const disabled = w.status === "DISABLED";
            return (
              <button
                key={w.id}
                onClick={() => !disabled && onSelect(w.id)}
                title={
                  disabled
                    ? "Disabled worker"
                    : selected
                      ? "Click to stop viewing their calendar"
                      : "See their availability + bookings"
                }
                className={cn(
                  "transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  disabled
                    ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
                    : selected
                      ? "border-accent-500 bg-accent-50 text-accent-900 shadow-sm"
                      : "border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", tone.chip, disabled && "opacity-30")} />
                <span>{w.name || w.email}</span>
                {w.trade && !selected && (
                  <span className="hidden text-[10px] text-zinc-400 sm:inline">{w.trade}</span>
                )}
                {count > 0 && (
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] tabular-nums",
                      selected ? "bg-accent-100 text-accent-800" : "bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {count}
                  </span>
                )}
                {selected && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </span>
      ))}
      {selectedId && (
        <>
          <a
            href={`/dashboard/calendar?worker=${selectedId}&view=standalone`}
            target="_blank"
            rel="noreferrer"
            title="Pop out this person's calendar full-screen in its own tab"
            className="transition-smooth ring-focus press-scale inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 shadow-sm hover:bg-zinc-50"
          >
            <ExternalLink className="h-3 w-3" />
            Pop out
          </a>
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            available
            <span className="ml-1 h-1.5 w-1.5 rounded-full bg-rose-400" />
            <span className="text-rose-700">off</span>
          </span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Week grid + event tiles                                           */
/* ------------------------------------------------------------------ */

function WeekGrid({
  weekStart,
  appointments,
  jobEvents,
  loading,
  dropPreview,
  selectedWorkerId,
  dayStatusFor,
  onApptClick,
  onApptDragStart,
  onApptResizeStart,
  onJobDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEmptyClick,
}: {
  weekStart: Date;
  appointments: AppointmentDTO[];
  jobEvents: JobCalendarEventDTO[];
  loading: boolean;
  dropPreview: DropPreview | null;
  selectedWorkerId: string | null;
  dayStatusFor: (d: Date) => DayAvailability | null;
  onApptClick: (a: AppointmentDTO) => void;
  onApptDragStart: (e: DragEvent, a: AppointmentDTO) => void;
  onApptResizeStart: (e: DragEvent, a: AppointmentDTO) => void;
  onJobDragStart: (e: DragEvent, j: JobCalendarEventDTO, dayIdx?: number) => void;
  onDragOver: (e: DragEvent, container: HTMLElement) => void;
  onDrop: (e: DragEvent, container: HTMLElement) => void;
  onDragEnd: () => void;
  onEmptyClick: (start: Date, end: Date) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const today = new Date();

  // Merge appointments + crew jobs per day, then column-pack overlaps so
  // colliding bookings render side-by-side instead of stacked.
  const tilesByDay = useMemo(() => {
    const map: Record<number, PositionedTile[]> = {};
    for (let i = 0; i < 7; i++) {
      const tiles: DayTile[] = [];
      for (const a of appointments) {
        if (sameDay(new Date(a.startsAt), days[i])) {
          tiles.push({
            kind: "appt",
            key: `a-${a.id}`,
            start: new Date(a.startsAt),
            end: new Date(a.endsAt),
            appt: a,
          });
        }
      }
      for (const j of jobEvents) {
        // Multi-day fence jobs repeat their daily clock window on every
        // covered day instead of one giant tile on the start day.
        const seg = jobSegmentForDay(j, days[i]);
        if (seg) {
          tiles.push({
            kind: "job",
            key: `j-${j.id}-${i}`,
            start: seg.start,
            end: seg.end,
            job: j,
            dayIdx: seg.dayIdx,
            spanDays: seg.spanDays,
          });
        }
      }
      map[i] = layoutOverlaps(tiles);
    }
    return map;
  }, [appointments, jobEvents, days]);

  // Current-time indicator (red line). Only show when "today" is in view.
  const todayIndex = days.findIndex((d) => sameDay(d, today));
  const nowOffset =
    todayIndex >= 0
      ? Math.max(0, Math.min(TOTAL_SLOTS * SLOT_PX, (minutesFromDayStart(today) / 60) * HOUR_PX))
      : null;

  return (
    <div className="surface overflow-hidden shadow-card">
      {/* Day header row */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-zinc-200 bg-zinc-50/60">
        <div />
        {days.map((d, i) => {
          const f = fmtDay(d);
          const isToday = sameDay(d, today);
          const avail = selectedWorkerId ? dayStatusFor(d) : null;
          return (
            <div
              key={i}
              className={cn(
                "border-l border-zinc-200 px-2 py-2 text-center",
                isToday && "bg-accent-50",
              )}
            >
              <div className="font-label text-[10px] text-zinc-500">
                {f.weekday}
              </div>
              <div
                className={cn(
                  "mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-lg font-semibold tabular-nums",
                  isToday ? "bg-accent-600 text-white" : "text-zinc-900",
                )}
              >
                {f.date}
              </div>
              {avail && (
                <div
                  className={cn(
                    "mx-auto mt-0.5 w-fit rounded-full px-1.5 text-[9px] font-semibold uppercase tracking-wide",
                    avail === "AVAILABLE"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700",
                  )}
                >
                  {avail === "AVAILABLE" ? "Available" : "Off"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Grid body — scrollable for the time column */}
      <div
        ref={containerRef}
        className="relative max-h-[70vh] overflow-y-auto"
        onDragOver={(e) => containerRef.current && onDragOver(e, containerRef.current)}
        onDrop={(e) => containerRef.current && onDrop(e, containerRef.current)}
        onDragEnd={onDragEnd}
      >
        <div
          className="relative grid grid-cols-[60px_repeat(7,1fr)]"
          style={{ height: TOTAL_SLOTS * SLOT_PX }}
        >
          {/* Time column */}
          <div className="relative">
            {Array.from({ length: HOURS_PER_DAY }, (_, i) => (
              <div
                key={i}
                className="font-label border-t border-zinc-100 pl-2 text-[10px] text-zinc-400"
                style={{ height: HOUR_PX }}
              >
                {((DAY_START_HOUR + i) % 12 || 12) +
                  (DAY_START_HOUR + i < 12 ? " AM" : " PM")}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, dayIdx) => (
            <div
              key={dayIdx}
              className="relative border-l border-zinc-100"
            >
              {/* Hour grid lines */}
              {Array.from({ length: HOURS_PER_DAY }, (_, i) => (
                <div
                  key={i}
                  className="border-t border-zinc-100"
                  style={{ height: HOUR_PX }}
                />
              ))}
              {/* Half-hour clickable slots (transparent) */}
              {Array.from({ length: TOTAL_SLOTS }, (_, slotIdx) => (
                <button
                  key={slotIdx}
                  type="button"
                  className="absolute inset-x-0 hover:bg-accent-50/40"
                  style={{ top: slotIdx * SLOT_PX, height: SLOT_PX }}
                  onClick={() => {
                    const s = dateForSlot(weekStart, dayIdx, slotIdx);
                    const e = new Date(s.getTime() + 60 * 60 * 1000);
                    onEmptyClick(s, e);
                  }}
                />
              ))}
              {/* Today highlight overlay */}
              {sameDay(d, today) && (
                <div className="pointer-events-none absolute inset-0 bg-accent-50/30" />
              )}
              {/* Selected crew member's availability wash */}
              {selectedWorkerId && dayStatusFor(d) === "AVAILABLE" && (
                <div className="pointer-events-none absolute inset-0 bg-emerald-100/35" />
              )}
              {selectedWorkerId && dayStatusFor(d) === "UNAVAILABLE" && (
                <div
                  className="pointer-events-none absolute inset-0 bg-rose-50/60"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, transparent, transparent 10px, rgba(225,29,72,0.07) 10px, rgba(225,29,72,0.07) 20px)",
                  }}
                />
              )}
              {/* Drop ghost — shows where the drag will land */}
              {dropPreview && dropPreview.dayIndex === dayIdx && (
                <div
                  className="pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed border-accent-500 bg-accent-100/60 px-2 py-1"
                  style={{
                    top: dropPreview.slotIndex * SLOT_PX,
                    height: Math.max(
                      (dropPreview.durationMin / 60) * HOUR_PX - 2,
                      SLOT_PX - 2,
                    ),
                  }}
                >
                  <span className="truncate text-[11px] font-semibold text-accent-800">
                    {dropPreview.label}
                  </span>
                </div>
              )}
              {/* Event tiles (overlap-aware side-by-side layout) */}
              {tilesByDay[dayIdx].map((p) =>
                p.tile.kind === "appt" ? (
                  <EventTile
                    key={p.tile.key}
                    appt={p.tile.appt}
                    col={p.col}
                    cols={p.cols}
                    dim={
                      selectedWorkerId != null &&
                      p.tile.appt.workerId !== selectedWorkerId
                    }
                    onClick={() => onApptClick((p.tile as Extract<DayTile, { kind: "appt" }>).appt)}
                    onDragStart={(e) =>
                      onApptDragStart(e, (p.tile as Extract<DayTile, { kind: "appt" }>).appt)
                    }
                    onResizeStart={(e) =>
                      onApptResizeStart(e, (p.tile as Extract<DayTile, { kind: "appt" }>).appt)
                    }
                  />
                ) : (
                  <JobTile
                    key={p.tile.key}
                    job={p.tile.job}
                    start={p.tile.start}
                    end={p.tile.end}
                    dayIdx={p.tile.dayIdx}
                    spanDays={p.tile.spanDays}
                    col={p.col}
                    cols={p.cols}
                    dim={
                      selectedWorkerId != null &&
                      p.tile.job.workerId !== selectedWorkerId
                    }
                    onDragStart={(e) =>
                      onJobDragStart(
                        e,
                        (p.tile as Extract<DayTile, { kind: "job" }>).job,
                        (p.tile as Extract<DayTile, { kind: "job" }>).dayIdx,
                      )
                    }
                  />
                ),
              )}
            </div>
          ))}

          {/* "Now" line */}
          {nowOffset !== null && (
            <div
              className="pointer-events-none absolute left-[60px] right-0 z-10"
              style={{ top: nowOffset }}
            >
              <div className="relative">
                <div
                  className="absolute h-0.5 bg-rose-500"
                  style={{
                    left: `calc(${todayIndex} * ((100% - 0px) / 7))`,
                    width: `calc((100% - 0px) / 7)`,
                  }}
                />
                <div
                  className="absolute -top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-rose-500 ring-2 ring-white"
                  style={{ left: `calc(${todayIndex} * ((100% - 0px) / 7))` }}
                />
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div
            role="status"
            aria-label="Loading calendar…"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40"
          >
            <div className="w-40 space-y-1.5">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shared horizontal placement for overlap columns. */
function colStyle(col: number, cols: number): React.CSSProperties {
  if (cols <= 1) return { left: 4, right: 4 };
  const w = 100 / cols;
  return {
    left: `calc(${col * w}% + 4px)`,
    width: `calc(${w}% - 6px)`,
  };
}

function EventTile({
  appt,
  col,
  cols,
  dim,
  onClick,
  onDragStart,
  onResizeStart,
}: {
  appt: AppointmentDTO;
  col: number;
  cols: number;
  dim?: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent) => void;
  onResizeStart: (e: DragEvent) => void;
}) {
  const start = new Date(appt.startsAt);
  const end = new Date(appt.endsAt);
  const topMin = minutesFromDayStart(start);
  const durMin = Math.max(SLOT_MINUTES, (end.getTime() - start.getTime()) / 60000);
  const meta = TYPE_META[appt.type];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        "group absolute cursor-grab overflow-hidden rounded-md ring-1 transition-shadow hover:shadow-md active:cursor-grabbing",
        meta.bg,
        meta.ring,
        appt.status === "CANCELLED" && "opacity-40 line-through",
        dim && "opacity-35",
      )}
      style={{
        top: (topMin / 60) * HOUR_PX,
        height: Math.max((durMin / 60) * HOUR_PX - 2, SLOT_PX - 2),
        backgroundColor: appt.colorHex ?? undefined,
        ...colStyle(col, cols),
      }}
    >
      {/* Left type-color bar */}
      <span
        className={cn("absolute inset-y-0 left-0 w-[3px]", meta.chip)}
        aria-hidden
      />
      <div className="flex items-center gap-1 pl-3 pr-2 pt-1">
        <span
          className={cn(
            "truncate text-[11px] font-semibold",
            meta.text,
          )}
        >
          {appt.title}
        </span>
      </div>
      <div
        className={cn("truncate pl-3 pr-2 pb-1 text-[10px] opacity-80", meta.text)}
      >
        {fmtTime(start)} – {fmtTime(end)}
        {appt.address ? ` · ${appt.address.split(",")[0]}` : ""}
      </div>
      {appt.workerName && (
        <div
          className={cn(
            "flex items-center gap-1 truncate pl-3 pr-2 pb-1 text-[10px] opacity-80",
            meta.text,
          )}
        >
          <UserRound className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{appt.workerName}</span>
          {/* The worker's answer — the office shouldn't have to call to
              ask "did you see Tuesday?". */}
          {appt.workerResponse === "CONFIRMED" && (
            <span
              title={`${appt.workerName} confirmed`}
              className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-700"
            >
              <Check className="h-2.5 w-2.5" /> OK
            </span>
          )}
          {appt.workerResponse === "DECLINED" && (
            <span
              title={
                appt.workerDeclineReason
                  ? `Can't make it: ${appt.workerDeclineReason}`
                  : "Can't make it"
              }
              className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-100 px-1 py-px text-[9px] font-semibold text-rose-700"
            >
              <X className="h-2.5 w-2.5" /> Can&apos;t
            </span>
          )}
          {appt.workerResponse === "PENDING" && (
            <span
              title="Awaiting the worker's confirmation"
              className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700"
            >
              <Clock3 className="h-2.5 w-2.5" /> ?
            </span>
          )}
        </div>
      )}
      {/* Bottom resize handle */}
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onResizeStart(e);
        }}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize bg-transparent group-hover:bg-zinc-900/10"
        title="Drag to resize"
      />
    </div>
  );
}

/** Tile for a job assigned to a WORKER. Draggable — drop on another slot to
 *  reschedule, or on the sidebar to cancel; click through for details.
 *  Color is per-worker so a glance shows who's where; a small status word
 *  shows offered / accepted / declined / done. */
function JobTile({
  job,
  start: segStart,
  end: segEnd,
  dayIdx,
  spanDays,
  col,
  cols,
  dim,
  onDragStart,
}: {
  job: JobCalendarEventDTO;
  /** This day's slice of the job (jobSegmentForDay) — a 3-day install
   *  renders one clock-window tile per covered day, not one giant tile. */
  start: Date;
  end: Date;
  dayIdx?: number;
  spanDays?: number;
  col: number;
  cols: number;
  dim?: boolean;
  onDragStart: (e: DragEvent) => void;
}) {
  const start = segStart;
  const end = segEnd;
  // Clamp to the visible band: a midnight-anchored middle-day segment
  // must not paint above 6 AM or push past the grid's bottom edge.
  const rawTop = minutesFromDayStart(start);
  const rawDur = (end.getTime() - start.getTime()) / 60000;
  const topMin = Math.max(0, rawTop);
  const durMin = Math.min(
    Math.max(SLOT_MINUTES, rawDur - (topMin - rawTop)),
    TOTAL_SLOTS * SLOT_MINUTES - topMin,
  );
  const tone = workerTone(job.workerId);
  const dimmed = job.status === "DECLINED" || job.status === "COMPLETED";
  const multiDay = (spanDays ?? 1) > 1;

  return (
    <a
      href="/dashboard/workers"
      draggable
      onDragStart={onDragStart}
      className={cn(
        "absolute z-[5] block cursor-grab overflow-hidden rounded-md ring-1 transition-shadow hover:shadow-md active:cursor-grabbing",
        tone.bg,
        tone.ring,
        dimmed && "opacity-45",
        job.status === "DECLINED" && "line-through",
        dim && "opacity-35",
      )}
      style={{
        top: (topMin / 60) * HOUR_PX,
        height: Math.max((durMin / 60) * HOUR_PX - 2, SLOT_PX - 2),
        ...colStyle(col, cols),
      }}
      title={`${job.title} — ${job.workerName} (${JOB_STATUS_META[job.status].label}) — drag to reschedule`}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", tone.chip)} aria-hidden />
      <div className="flex items-center gap-1 pl-3 pr-2 pt-1">
        <Hammer className={cn("h-3 w-3 shrink-0", tone.text)} />
        <span className={cn("truncate text-[11px] font-semibold", tone.text)}>{job.title}</span>
      </div>
      <div className={cn("flex items-center gap-1 pl-3 pr-2 text-[10px] opacity-90", tone.text)}>
        <span className="truncate">{job.workerName}</span>
        <JobStatusPill status={job.status} />
      </div>
      <div className={cn("flex items-center gap-1 truncate pl-3 pr-2 pb-1 text-[10px] opacity-70", tone.text)}>
        <span>
          {fmtTime(start)} – {fmtTime(end)}
        </span>
        {multiDay && (
          <span
            className={cn(
              "shrink-0 rounded-full px-1 py-px text-[9px] font-semibold ring-1 ring-inset",
              tone.ring,
            )}
          >
            Day {dayIdx} of {spanDays}
          </span>
        )}
      </div>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Month grid                                                        */
/* ------------------------------------------------------------------ */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthGrid({
  gridStart,
  month,
  appointments,
  jobEvents,
  loading,
  hoverDay,
  selectedWorkerId,
  dayStatusFor,
  onHoverDay,
  onDrop,
  onDragEnd,
  onApptClick,
  onApptDragStart,
  onJobDragStart,
  onDayOpen,
  onEmptyClick,
}: {
  gridStart: Date;
  month: number;
  appointments: AppointmentDTO[];
  jobEvents: JobCalendarEventDTO[];
  loading: boolean;
  hoverDay: string | null;
  selectedWorkerId: string | null;
  dayStatusFor: (d: Date) => DayAvailability | null;
  onHoverDay: (key: string | null) => void;
  onDrop: (e: DragEvent, day: Date) => void;
  onDragEnd: () => void;
  onApptClick: (a: AppointmentDTO) => void;
  onApptDragStart: (e: DragEvent, a: AppointmentDTO) => void;
  onJobDragStart: (e: DragEvent, j: JobCalendarEventDTO, dayIdx?: number) => void;
  onDayOpen: (d: Date) => void;
  onEmptyClick: (d: Date) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  );
  const today = new Date();

  const byDay = useMemo(() => {
    type MonthJobChip = { job: JobCalendarEventDTO; dayIdx: number; spanDays: number };
    const map = new Map<string, { appts: AppointmentDTO[]; jobs: MonthJobChip[] }>();
    const keyOf = (d: Date) => d.toDateString();
    for (const d of days) map.set(keyOf(d), { appts: [], jobs: [] });
    for (const a of appointments) {
      const k = keyOf(new Date(a.startsAt));
      map.get(k)?.appts.push(a);
    }
    // A multi-day job drops one chip on EVERY covered day — a 3-day
    // install visibly blocks Tue AND Wed, not just its start morning.
    for (const j of jobEvents) {
      for (const d of days) {
        const seg = jobSegmentForDay(j, d);
        if (seg)
          map
            .get(keyOf(d))
            ?.jobs.push({ job: j, dayIdx: seg.dayIdx, spanDays: seg.spanDays });
      }
    }
    for (const v of map.values()) {
      v.appts.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      v.jobs.sort((a, b) => a.job.startsAt.localeCompare(b.job.startsAt));
    }
    return map;
  }, [appointments, jobEvents, days]);

  return (
    <div className="surface relative overflow-hidden shadow-card">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50/60">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            className="font-label border-l border-zinc-200 px-2 py-2 text-center text-[10px] text-zinc-500 first:border-l-0"
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7" onDragEnd={onDragEnd}>
        {days.map((d, i) => {
          const key = d.toDateString();
          const cell = byDay.get(key)!;
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, today);
          const total = cell.appts.length + cell.jobs.length;
          const MAX_CHIPS = 3;
          const shownAppts = cell.appts.slice(0, MAX_CHIPS);
          const shownJobs = cell.jobs.slice(0, Math.max(0, MAX_CHIPS - shownAppts.length));
          const more = total - shownAppts.length - shownJobs.length;
          const avail = selectedWorkerId ? dayStatusFor(d) : null;

          return (
            <div
              key={i}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverDay !== key) onHoverDay(key);
              }}
              onDragLeave={() => hoverDay === key && onHoverDay(null)}
              onDrop={(e) => onDrop(e, d)}
              onClick={() => onEmptyClick(d)}
              className={cn(
                "transition-smooth relative min-h-[104px] cursor-pointer border-b border-l border-zinc-100 p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0",
                inMonth ? "bg-white hover:bg-accent-50/30" : "bg-zinc-50/50",
                isToday && "bg-accent-50/50",
                avail === "AVAILABLE" && "bg-emerald-50/70",
                avail === "UNAVAILABLE" && "bg-rose-50/70",
                hoverDay === key && "bg-accent-100/60 ring-2 ring-inset ring-accent-400",
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDayOpen(d);
                  }}
                  title="Open week view"
                  className={cn(
                    "transition-smooth ring-focus inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums hover:ring-2 hover:ring-accent-300",
                    isToday
                      ? "bg-accent-600 text-white"
                      : inMonth
                        ? "text-zinc-900"
                        : "text-zinc-400",
                  )}
                >
                  {d.getDate()}
                </button>
                <span className="flex items-center gap-1">
                  {avail && (
                    <span
                      title={avail === "AVAILABLE" ? "Crew member available" : "Crew member off"}
                      className={cn(
                        "h-2 w-2 rounded-full",
                        avail === "AVAILABLE" ? "bg-emerald-500" : "bg-rose-400",
                      )}
                    />
                  )}
                  {total > 0 && (
                    <span className="rounded bg-zinc-100 px-1 text-[10px] tabular-nums text-zinc-500">
                      {total}
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-1 space-y-0.5">
                {shownAppts.map((a) => {
                  const meta = TYPE_META[a.type];
                  return (
                    <div
                      key={a.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        onApptDragStart(e, a);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApptClick(a);
                      }}
                      className={cn(
                        // Color/ring hover only — a transform here would
                        // distort the native drag image (see DraggableCard).
                        "transition-smooth flex cursor-grab items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium ring-1 hover:ring-2 active:cursor-grabbing",
                        meta.bg,
                        meta.ring,
                        meta.text,
                        a.status === "CANCELLED" && "opacity-40 line-through",
                        selectedWorkerId != null && a.workerId !== selectedWorkerId && "opacity-35",
                      )}
                      title={`${a.title} · ${fmtTime(new Date(a.startsAt))}`}
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.chip)} />
                      <span className="shrink-0 tabular-nums opacity-70">
                        {fmtTime(new Date(a.startsAt))}
                      </span>
                      <span className="truncate">{a.title}</span>
                    </div>
                  );
                })}
                {shownJobs.map(({ job: j, dayIdx, spanDays }) => {
                  const tone = workerTone(j.workerId);
                  return (
                    <a
                      key={`${j.id}-${dayIdx}`}
                      href="/dashboard/workers"
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        onJobDragStart(e, j, dayIdx);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "transition-smooth ring-focus flex cursor-grab items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium ring-1 hover:ring-2 active:cursor-grabbing",
                        tone.bg,
                        tone.ring,
                        tone.text,
                        (j.status === "DECLINED" || j.status === "COMPLETED") && "opacity-45",
                        selectedWorkerId != null && j.workerId !== selectedWorkerId && "opacity-35",
                      )}
                      title={`${j.title} — ${j.workerName} (${JOB_STATUS_META[j.status].label})${spanDays > 1 ? ` — day ${dayIdx} of ${spanDays}` : ""} — drag to reschedule`}
                    >
                      <Hammer className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">
                        {spanDays > 1 ? `D${dayIdx}/${spanDays} · ` : ""}
                        {j.workerName.split(" ")[0]} · {j.title}
                      </span>
                      {j.status === "IN_PROGRESS" ? (
                        <span className="relative ml-auto flex h-1.5 w-1.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-70" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "ml-auto h-1.5 w-1.5 shrink-0 rounded-full",
                            JOB_STATUS_META[j.status].dot,
                          )}
                        />
                      )}
                    </a>
                  );
                })}
                {more > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayOpen(d);
                    }}
                    className="transition-smooth ring-focus w-full rounded px-1 py-0.5 text-left text-[10px] font-medium text-accent-700 hover:bg-accent-50"
                  >
                    +{more} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div
          role="status"
          aria-label="Loading calendar…"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40"
        >
          <div className="w-40 space-y-1.5">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar — schedulable items                                       */
/* ------------------------------------------------------------------ */

function Sidebar({
  items,
  filter,
  dropActive,
  dropKind,
  onFilter,
  onDragStart,
  onDragEnd,
  onSmart,
  onUnscheduleDragOver,
  onUnscheduleDrop,
}: {
  items: SchedulableItem[];
  filter: string;
  /** True while a calendar tile is mid-drag — the sidebar becomes the
   *  "drop to unschedule" target. */
  dropActive: boolean;
  dropKind: "appt" | "job" | null;
  onFilter: (v: string) => void;
  onDragStart: (e: DragEvent, item: SchedulableItem) => void;
  onDragEnd: () => void;
  onSmart: (item: SchedulableItem) => void;
  onUnscheduleDragOver: (e: DragEvent) => void;
  onUnscheduleDrop: (e: DragEvent) => void;
}) {
  const leads = items.filter((i) => i.kind === "lead");
  const proposals = items.filter((i) => i.kind === "proposal");

  return (
    <aside
      onDragOver={onUnscheduleDragOver}
      onDrop={onUnscheduleDrop}
      className={cn(
        "surface space-y-3 self-start p-3 shadow-card transition-smooth",
        dropActive && "ring-2 ring-dashed ring-amber-400",
      )}
    >
      {dropActive && (
        <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900">
          <Undo2 className="h-4 w-4 shrink-0 text-amber-600" />
          {dropKind === "job"
            ? "Drop here to unschedule — the job offer is cancelled"
            : "Drop here to take it off the calendar"}
        </div>
      )}
      <div className="flex items-center gap-2">
        <MousePointer2 className="h-4 w-4 text-accent-600" />
        <h2 className="text-sm font-semibold text-zinc-900">Drag onto calendar</h2>
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">
        Drag a card onto a time slot, or tap{" "}
        <Zap className="inline h-3 w-3 text-amber-500" /> and we&apos;ll find the
        best open slot for you.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter…"
          className="input h-8 pl-8 pr-2 text-xs"
        />
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
          Nothing here yet. Visit a lead or save a draft proposal and it&apos;ll show up
          to drag onto your week.
        </p>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {leads.length > 0 && (
            <Group title="Leads to visit" count={leads.length}>
              {leads.map((i) => (
                <DragItem
                  key={i.id}
                  item={i}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onSmart={onSmart}
                />
              ))}
            </Group>
          )}
          {proposals.length > 0 && (
            <Group title="Proposals to install" count={proposals.length}>
              {proposals.map((i) => (
                <DragItem
                  key={i.id}
                  item={i}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onSmart={onSmart}
                />
              ))}
            </Group>
          )}
        </div>
      )}
    </aside>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-label mb-1.5 flex items-center justify-between px-1 text-[10px] text-zinc-500">
        <span>{title}</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">
          {count}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DragItem({
  item,
  onDragStart,
  onDragEnd,
  onSmart,
}: {
  item: SchedulableItem;
  onDragStart: (e: DragEvent, item: SchedulableItem) => void;
  onDragEnd: () => void;
  onSmart: (item: SchedulableItem) => void;
}) {
  const color =
    item.kind === "lead"
      ? "border-sky-200 bg-sky-50 hover:bg-sky-100"
      : "border-emerald-200 bg-emerald-50 hover:bg-emerald-100";
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
      className={cn(
        // Color/shadow transitions only — a transform here would skew the
        // native HTML5 drag image.
        "transition-smooth group relative cursor-grab rounded-lg border px-2.5 py-1.5 pr-9 text-xs shadow-sm active:cursor-grabbing",
        color,
      )}
      title="Drag onto the calendar"
    >
      <div className="flex items-center gap-1.5">
        {item.kind === "lead" ? (
          <MapPin className="h-3 w-3 shrink-0 text-sky-700" />
        ) : (
          <Hammer className="h-3 w-3 shrink-0 text-emerald-700" />
        )}
        <span className="truncate font-medium text-zinc-900">{item.title}</span>
      </div>
      {item.address && (
        <div className="truncate text-[11px] text-zinc-500">{item.address}</div>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSmart(item);
        }}
        title="Smart-schedule: find the best open slot"
        className="transition-smooth ring-focus absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-white/70 text-amber-500 opacity-70 shadow-sm ring-1 ring-zinc-200 hover:bg-amber-50 hover:opacity-100"
      >
        <Zap className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Smart-schedule modal                                              */
/* ------------------------------------------------------------------ */

function SmartScheduleModal({
  item,
  worker,
  availability,
  onClose,
  onPick,
}: {
  item: SchedulableItem;
  worker: OwnerWorkerDTO | null;
  availability: AvailabilityMap;
  onClose: () => void;
  onPick: (slot: SmartSlot) => void;
}) {
  const [slots, setSlots] = useState<SmartSlot[] | null>(null);
  const durationMin = DEFAULT_DURATION_MIN[defaultTypeForItem(item)];
  const workerName = worker ? worker.name || worker.email : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Conflicts come from BOTH your appointments and assigned crew jobs
      // over the scan horizon. With a crew member selected, only THEIR
      // bookings block — and their availability days steer the picks.
      const now = new Date();
      const scanStart = new Date(now);
      scanStart.setHours(0, 0, 0, 0);
      const scanEnd = addDays(scanStart, 14);
      const [appts, jobs] = await Promise.all([
        listAppointments(scanStart.toISOString(), scanEnd.toISOString()),
        listJobCalendarEvents(scanStart.toISOString(), scanEnd.toISOString()),
      ]);
      if (cancelled) return;
      const busy: BusyInterval[] = [
        ...appts
          .filter((a) => a.status !== "CANCELLED")
          .filter((a) => (worker ? a.workerId === worker.id || !a.workerId : true))
          .map((a) => ({
            start: new Date(a.startsAt).getTime(),
            end: new Date(a.endsAt).getTime(),
          })),
        ...jobs
          .filter((j) => j.status !== "DECLINED" && j.status !== "COMPLETED")
          .filter((j) => (worker ? j.workerId === worker.id : true))
          .map((j) => ({
            start: new Date(j.startsAt).getTime(),
            end: new Date(j.endsAt).getTime(),
          })),
      ];
      setSlots(
        findSmartSlots(
          durationMin,
          busy,
          now,
          worker ? availability.get(worker.id) : undefined,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, durationMin, worker, availability]);

  return (
    <ModalShell onClose={onClose} title="Smart schedule">
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
        <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span>
          Best open slots for <strong>{item.title}</strong> — a{" "}
          {durationMin >= 60 ? `${durationMin / 60}h` : `${durationMin}min`}{" "}
          {item.kind === "lead" ? "site visit" : "install"}, inside working hours
          (8 AM–5 PM, no Sundays), avoiding your bookings and crew jobs.
          {workerName && (
            <>
              {" "}
              Matching <strong>{workerName}</strong>&apos;s schedule — days they
              marked off are skipped, days they marked available come first.
            </>
          )}
        </span>
      </div>

      {slots === null ? (
        // Skeleton slot rows shaped like the results they become.
        <div className="space-y-1.5" role="status" aria-label="Checking your calendar…">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[62px] rounded-lg" />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-500">
          No open slots in the next two weeks. Try dragging it onto the calendar
          manually.
        </p>
      ) : (
        <div className="space-y-1.5">
          {slots.map((s, idx) => (
            <button
              key={s.start.toISOString()}
              onClick={() => onPick(s)}
              className={cn(
                "transition-smooth ring-focus press-scale flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left",
                idx === 0
                  ? "border-accent-300 bg-accent-50 hover:bg-accent-100"
                  : "border-zinc-200 bg-white hover:bg-zinc-50",
              )}
            >
              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-white ring-1 ring-zinc-200">
                <span className="font-label text-[9px] text-zinc-500">
                  {s.start.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="text-sm font-bold tabular-nums text-zinc-900">
                  {s.start.getDate()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-900">
                  {s.start.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  · {fmtTime(s.start)} – {fmtTime(s.end)}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {idx === 0 ? "Earliest available" : "Open"}
                  {s.backToBack ? " · back-to-back with another stop" : ""}
                </div>
              </div>
              {idx === 0 && (
                <span className="rounded-full bg-accent-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Best
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Modals — create + edit                                            */
/* ------------------------------------------------------------------ */

function CreateModal({
  startsAt,
  endsAt,
  seed,
  defaultWorkerId,
  crew,
  availability,
  onClose,
  onCreated,
}: {
  startsAt: string;
  endsAt: string;
  seed?: SchedulableItem;
  defaultWorkerId: string | null;
  crew: OwnerWorkerDTO[];
  availability: AvailabilityMap;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState(seed?.title ?? "");
  const [address, setAddress] = useState(seed?.address ?? "");
  const [clientName, setClientName] = useState(seed?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState(seed?.clientEmail ?? "");
  const [type, setType] = useState<AppointmentDTO["type"]>(
    seed ? defaultTypeForItem(seed) : "OTHER",
  );
  const [start, setStart] = useState(toLocalInput(startsAt));
  const [end, setEnd] = useState(toLocalInput(endsAt));
  const [workerId, setWorkerId] = useState<string | null>(defaultWorkerId);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setSaving(true);
    setErr(null);
    const r = await createAppointment({
      title,
      type,
      startsAt: fromLocalInput(start),
      endsAt: fromLocalInput(end),
      address: address || null,
      notes: notes || null,
      clientName: clientName || null,
      clientPhone: clientPhone || null,
      clientEmail: clientEmail || null,
      leadId: seed?.kind === "lead" ? seed.id : null,
      proposalId: seed?.kind === "proposal" ? seed.id : null,
      workerId,
    });
    setSaving(false);
    if (!r.ok) {
      setErr(r.reason);
      return;
    }
    onCreated();
  }

  return (
    <ModalShell onClose={onClose} title="New appointment">
      <Form
        title={title}
        setTitle={setTitle}
        type={type}
        setType={setType}
        start={start}
        setStart={setStart}
        end={end}
        setEnd={setEnd}
        address={address}
        setAddress={setAddress}
        clientName={clientName}
        setClientName={setClientName}
        clientPhone={clientPhone}
        setClientPhone={setClientPhone}
        clientEmail={clientEmail}
        setClientEmail={setClientEmail}
        notes={notes}
        setNotes={setNotes}
        workerId={workerId}
        setWorkerId={setWorkerId}
        crew={crew}
        availability={availability}
      />
      {err && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="transition-smooth ring-focus press-scale rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Schedule"}
        </button>
      </div>
    </ModalShell>
  );
}

function EditModal({
  appt,
  crew,
  availability,
  onClose,
  onSaved,
  onDeleted,
}: {
  appt: AppointmentDTO;
  crew: OwnerWorkerDTO[];
  availability: AvailabilityMap;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(appt.title);
  const [type, setType] = useState<AppointmentDTO["type"]>(appt.type);
  const [start, setStart] = useState(toLocalInput(appt.startsAt));
  const [end, setEnd] = useState(toLocalInput(appt.endsAt));
  const [address, setAddress] = useState(appt.address ?? "");
  const [clientName, setClientName] = useState(appt.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(appt.clientPhone ?? "");
  const [clientEmail, setClientEmail] = useState(appt.clientEmail ?? "");
  const [workerId, setWorkerId] = useState<string | null>(appt.workerId);
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setErr(null);
    const r = await updateAppointment(appt.id, {
      title,
      type,
      startsAt: fromLocalInput(start),
      endsAt: fromLocalInput(end),
      address,
      notes,
      clientName,
      clientPhone,
      clientEmail,
      workerId,
    });
    setSaving(false);
    if (!r.ok) {
      setErr(r.reason);
      return;
    }
    onSaved();
  }

  async function onDelete() {
    if (!confirm("Delete this appointment?")) return;
    setSaving(true);
    const r = await deleteAppointment(appt.id);
    setSaving(false);
    if (!r.ok) {
      setErr(r.reason);
      return;
    }
    onDeleted();
  }

  return (
    <ModalShell onClose={onClose} title="Edit appointment">
      <Form
        title={title}
        setTitle={setTitle}
        type={type}
        setType={setType}
        start={start}
        setStart={setStart}
        end={end}
        setEnd={setEnd}
        address={address}
        setAddress={setAddress}
        clientName={clientName}
        setClientName={setClientName}
        clientPhone={clientPhone}
        setClientPhone={setClientPhone}
        clientEmail={clientEmail}
        setClientEmail={setClientEmail}
        notes={notes}
        setNotes={setNotes}
        workerId={workerId}
        setWorkerId={setWorkerId}
        crew={crew}
        availability={availability}
      />
      {err && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={onDelete}
          className="transition-smooth ring-focus press-scale inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="transition-smooth ring-focus press-scale rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="transition-smooth ring-focus press-scale rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Esc closes — small thing, big feel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="anim-enter-fade absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="surface anim-pop relative z-10 max-h-[85dvh] w-full max-w-lg space-y-3 overflow-y-auto overscroll-contain p-5 shadow-elevated">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="transition-smooth ring-focus rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Form(props: {
  title: string;
  setTitle: (v: string) => void;
  type: AppointmentDTO["type"];
  setType: (v: AppointmentDTO["type"]) => void;
  start: string;
  setStart: (v: string) => void;
  end: string;
  setEnd: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  clientName: string;
  setClientName: (v: string) => void;
  clientPhone: string;
  setClientPhone: (v: string) => void;
  clientEmail: string;
  setClientEmail: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  workerId: string | null;
  setWorkerId: (v: string | null) => void;
  crew: OwnerWorkerDTO[];
  availability: AvailabilityMap;
}) {
  const assignable = props.crew.filter((w) => w.status !== "DISABLED");
  const chosen = assignable.find((w) => w.id === props.workerId) ?? null;
  // datetime-local is "YYYY-MM-DDTHH:mm" — the first 10 chars are the day key.
  const startDayKey = props.start.slice(0, 10);
  const chosenAvail: DayAvailability | null = chosen
    ? (props.availability.get(chosen.id)?.get(startDayKey) ?? null)
    : null;
  return (
    <div className="space-y-3">
      <div>
        <Label>Title</Label>
        <input
          value={props.title}
          onChange={(e) => props.setTitle(e.target.value)}
          placeholder="Site visit, fence install, …"
          className={inputCls}
        />
      </div>
      <div>
        <Label>Type</Label>
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(TYPE_META) as [
            AppointmentDTO["type"],
            (typeof TYPE_META)[AppointmentDTO["type"]],
          ][]).map(([k, m]) => (
            <button
              key={k}
              type="button"
              onClick={() => props.setType(k)}
              className={cn(
                "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                props.type === k
                  ? "border-accent-500 bg-accent-50 text-accent-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", m.chip)} />
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Start</Label>
          <input
            type="datetime-local"
            value={props.start}
            onChange={(e) => props.setStart(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <Label>End</Label>
          <input
            type="datetime-local"
            value={props.end}
            onChange={(e) => props.setEnd(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      {assignable.length > 0 && (
        <div>
          <Label>Assign to</Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => props.setWorkerId(null)}
              className={cn(
                "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                props.workerId === null
                  ? "border-accent-500 bg-accent-50 text-accent-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              Unassigned
            </button>
            {assignable.map((w) => {
              const tone = workerTone(w.id);
              const active = props.workerId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => props.setWorkerId(active ? null : w.id)}
                  className={cn(
                    "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                    active
                      ? "border-accent-500 bg-accent-50 text-accent-900"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.chip)} />
                  {w.name || w.email}
                </button>
              );
            })}
          </div>
          {chosen && (
            <div
              className={cn(
                "mt-1.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium",
                chosenAvail === "AVAILABLE"
                  ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                  : chosenAvail === "UNAVAILABLE"
                    ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
                    : "bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200",
              )}
            >
              {chosenAvail === "AVAILABLE" ? (
                <Check className="h-3 w-3 shrink-0" />
              ) : chosenAvail === "UNAVAILABLE" ? (
                <Ban className="h-3 w-3 shrink-0" />
              ) : (
                <UserRound className="h-3 w-3 shrink-0" />
              )}
              {chosenAvail === "AVAILABLE"
                ? `${chosen.name || chosen.email} is available that day.`
                : chosenAvail === "UNAVAILABLE"
                  ? `${chosen.name || chosen.email} marked that day unavailable — pick another day or double-check with them.`
                  : `${chosen.name || chosen.email} hasn't marked that day yet.`}
            </div>
          )}
        </div>
      )}
      <div>
        <Label>Address</Label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={props.address}
            onChange={(e) => props.setAddress(e.target.value)}
            placeholder="1247 Maple Ridge Drive…"
            className={cn(inputCls, "pl-8")}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <Label>Client</Label>
          <input
            value={props.clientName}
            onChange={(e) => props.setClientName(e.target.value)}
            placeholder="Name"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Phone</Label>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={props.clientPhone}
              onChange={(e) => props.setClientPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className={cn(inputCls, "pl-8")}
            />
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <input
            value={props.clientEmail}
            onChange={(e) => props.setClientEmail(e.target.value)}
            placeholder="name@…"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <textarea
          value={props.notes}
          onChange={(e) => props.setNotes(e.target.value)}
          rows={2}
          placeholder="Bring extension ladder, gate code 4321…"
          className={cn(inputCls, "min-h-[3rem] resize-y")}
        />
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-label mb-1 text-[10px] text-zinc-500">
      {children}
    </div>
  );
}

const inputCls = "input";

/* ------------------------------------------------------------------ */
/*  datetime-local <-> ISO helpers                                    */
/* ------------------------------------------------------------------ */

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string {
  // datetime-local has no timezone; treat as local time.
  return new Date(local).toISOString();
}
