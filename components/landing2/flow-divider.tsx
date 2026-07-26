/**
 * Thin full-width "property line" divider between the hero and the stats band:
 * a dashed survey line running left to right with a few marker points.
 * Pure CSS animation (anim-flow from globals.css, ls-drip from landing.css);
 * both are disabled under prefers-reduced-motion.
 */
export function FlowDivider() {
  const drips = [
    { x: 180, d: "0s" },
    { x: 620, d: "0.9s" },
    { x: 1010, d: "1.6s" },
  ];
  return (
    <div aria-hidden className="overflow-hidden">
      <svg
        viewBox="0 0 1200 44"
        preserveAspectRatio="none"
        className="h-11 w-full"
      >
        <path
          d="M0 12 H1200"
          fill="none"
          stroke="rgba(52,141,81,0.45)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="10 14"
          className="anim-flow"
        />
        {drips.map((p) => (
          <circle
            key={p.x}
            cx={p.x}
            cy={18}
            r="3"
            fill="rgba(52,141,81,0.45)"
            className="ls-drip"
            style={{ animationDelay: p.d }}
          />
        ))}
      </svg>
    </div>
  );
}
