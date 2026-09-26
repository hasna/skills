import type { RemoteCreditCheckoutOptions } from "./remote-credit-checkout.js";
import type { RemoteSkillsClient } from "./remote-client.js";

/** Shared customer operation declarations for MCP registration and its discovery contract. */
export const REMOTE_CUSTOMER_OPERATIONS = [
  { name: "get_account", title: "Get Account Identity", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.getIdentity() },
  { name: "get_server_capabilities", title: "Get Server Capabilities", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.getCapabilities() },
  { name: "list_remote_skills", title: "List Remote Skills", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.listSkills() },
  { name: "get_billing_status", title: "Get Billing Status", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.getBillingStatus() },
  { name: "list_credit_packs", title: "List Credit Packs", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.listCreditPacks() },
  { name: "create_credit_checkout", title: "Create Credit Checkout", parameter: "pack_id", mutates: true, invoke: (client: RemoteSkillsClient, value: string, options?: RemoteCreditCheckoutOptions) => client.createCreditCheckout(value, options) },
  { name: "get_billing_usage", title: "Get Billing Usage", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.getUsage() },
  { name: "list_invoices", title: "List Invoices", parameter: null, mutates: false, invoke: (client: RemoteSkillsClient) => client.listInvoices() },
  { name: "create_billing_checkout", title: "Create Billing Checkout", parameter: null, mutates: true, invoke: (client: RemoteSkillsClient) => client.createBillingCheckout() },
  { name: "create_billing_portal", title: "Create Billing Portal", parameter: null, mutates: true, invoke: (client: RemoteSkillsClient) => client.createBillingPortal() },
  { name: "get_run_logs", title: "Get Run Logs", parameter: "run_id", mutates: false, invoke: (client: RemoteSkillsClient, value: string) => client.getRunLogs(value) },
  { name: "cancel_run", title: "Cancel Run", parameter: "run_id", mutates: true, invoke: (client: RemoteSkillsClient, value: string) => client.cancelRun(value) },
  { name: "resume_run", title: "Resume Run", parameter: "run_id", mutates: true, invoke: (client: RemoteSkillsClient, value: string) => client.resumeRun(value) },
  { name: "list_run_artifacts", title: "List Run Artifacts", parameter: "run_id", mutates: false, invoke: (client: RemoteSkillsClient, value: string) => client.getRunArtifacts(value) },
] as const;
