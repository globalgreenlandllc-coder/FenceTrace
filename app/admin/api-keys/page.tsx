import { listApiKeys, listApiKeyAudit } from "@/app/actions/api-keys";
import { ApiKeysPage } from "@/components/admin/api-keys-page";

export default async function AdminApiKeysRoute() {
  const [rows, audit] = await Promise.all([listApiKeys(), listApiKeyAudit()]);
  return <ApiKeysPage rows={rows} audit={audit} />;
}
