"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { FenceEstimator } from "@/components/fence/fence-estimator";

/**
 * /estimate — the FenceTrace estimator. Entry modes:
 *   ?address=<street address>   — scan straight away (start-page handoff)
 *   (nothing)                   — show the address form
 * Satellite tile + Regrid property lines + draw-the-fence canvas → live
 * takeoff and Good/Better/Best pricing → proposal draft.
 */
export default function EstimatePage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <FenceEstimator />
      </Suspense>
    </AuthGate>
  );
}
