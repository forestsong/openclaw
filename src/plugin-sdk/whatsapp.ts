import {
  hasAnyWhatsAppAuth,
  listEnabledWhatsAppAccounts,
  resolveWhatsAppAccount,
  resolveWhatsAppGroupRequireMention,
  resolveWhatsAppGroupToolPolicy,
  listWhatsAppDirectoryGroupsFromConfig,
  listWhatsAppDirectoryPeersFromConfig,
} from "../channels/whatsapp/plugin-sdk-bridge.js";
import type {
  WebChannelStatus,
  WebInboundMessage,
  WebListenerCloseReason,
  WebMonitorTuning,
} from "../channels/whatsapp/plugin-sdk-bridge.js";
import {
  createWhatsAppLoginTool,
  createWaSocket,
  DEFAULT_WEB_MEDIA_BYTES,
  extractMediaPlaceholder,
  extractText,
  formatError,
  getActiveWebListener,
  getDefaultLocalRoots,
  getStatusCode,
  getWebAuthAgeMs,
  HEARTBEAT_PROMPT,
  HEARTBEAT_TOKEN,
  loadWebMedia,
  loadWebMediaRaw,
  loginWeb,
  logWebSelfId,
  logoutWeb,
  monitorWebChannel,
  monitorWebInbox,
  optimizeImageToJpeg,
  pickWebChannel,
  readWebSelfId,
  resolveHeartbeatRecipients,
  runWebHeartbeatOnce,
  sendMessageWhatsApp,
  sendPollWhatsApp,
  sendReactionWhatsApp,
  waitForWaConnection,
  WA_WEB_AUTH_DIR,
  webAuthExists,
} from "../channels/whatsapp/plugin-sdk-bridge.js";

export type { ChannelMessageActionName } from "../channels/plugins/types.js";
export type { OpenClawConfig } from "../config/config.js";
export type { DmPolicy, GroupPolicy, WhatsAppAccountConfig } from "../config/types.js";
export type { WebChannelStatus, WebInboundMessage, WebListenerCloseReason, WebMonitorTuning };
export type {
  ChannelMessageActionContext,
  ChannelPlugin,
  OpenClawPluginApi,
  PluginRuntime,
} from "./channel-plugin-common.js";
export {
  DEFAULT_ACCOUNT_ID,
  PAIRING_APPROVED_MESSAGE,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  deleteAccountFromConfigSection,
  emptyPluginConfigSchema,
  formatPairingApproveHint,
  getChatChannelMeta,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
} from "./channel-plugin-common.js";
export { formatCliCommand } from "../cli/command-format.js";
export { formatDocsLink } from "../terminal/links.js";
export {
  formatWhatsAppConfigAllowFromEntries,
  resolveWhatsAppConfigAllowFrom,
  resolveWhatsAppConfigDefaultTo,
} from "./channel-config-helpers.js";
export { normalizeWhatsAppAllowFromEntries } from "../channels/plugins/normalize/whatsapp.js";
export { listWhatsAppDirectoryGroupsFromConfig, listWhatsAppDirectoryPeersFromConfig };
export {
  collectAllowlistProviderGroupPolicyWarnings,
  collectOpenGroupPolicyRouteAllowlistWarnings,
} from "../channels/plugins/group-policy-warnings.js";
export { buildAccountScopedDmSecurityPolicy } from "../channels/plugins/helpers.js";
export { resolveWhatsAppOutboundTarget } from "../whatsapp/resolve-outbound-target.js";
export { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "../whatsapp/normalize.js";

export {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "../config/runtime-group-policy.js";
export { resolveWhatsAppGroupRequireMention, resolveWhatsAppGroupToolPolicy };
export {
  createWhatsAppOutboundBase,
  resolveWhatsAppGroupIntroHint,
  resolveWhatsAppMentionStripRegexes,
} from "../channels/plugins/whatsapp-shared.js";
export { resolveWhatsAppHeartbeatRecipients } from "../channels/plugins/whatsapp-heartbeat.js";
export { WhatsAppConfigSchema } from "../config/zod-schema.providers-whatsapp.js";

export { createActionGate, readStringParam } from "../agents/tools/common.js";
export { createPluginRuntimeStore } from "./runtime-store.js";
export { normalizeE164 } from "../utils.js";

export { hasAnyWhatsAppAuth, listEnabledWhatsAppAccounts, resolveWhatsAppAccount };
export {
  createWaSocket,
  createWhatsAppLoginTool,
  DEFAULT_WEB_MEDIA_BYTES,
  extractMediaPlaceholder,
  extractText,
  formatError,
  getActiveWebListener,
  getDefaultLocalRoots,
  getStatusCode,
  getWebAuthAgeMs,
  HEARTBEAT_PROMPT,
  HEARTBEAT_TOKEN,
  loadWebMedia,
  loadWebMediaRaw,
  loginWeb,
  logWebSelfId,
  logoutWeb,
  monitorWebChannel,
  monitorWebInbox,
  optimizeImageToJpeg,
  pickWebChannel,
  readWebSelfId,
  resolveHeartbeatRecipients,
  runWebHeartbeatOnce,
  sendMessageWhatsApp,
  sendPollWhatsApp,
  sendReactionWhatsApp,
  waitForWaConnection,
  WA_WEB_AUTH_DIR,
  webAuthExists,
};
