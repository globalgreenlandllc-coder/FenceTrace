import { redirect } from "next/navigation";
import { getMe, type MeData } from "@/app/actions/me";

export async function requireSuperAdmin(): Promise<MeData> {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect_url=/admin");
  if (me.user.role !== "SUPER_ADMIN") redirect("/dashboard");
  return me;
}

export async function getOptionalSuperAdmin(): Promise<MeData | null> {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") return null;
  return me;
}
