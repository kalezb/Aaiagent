import { json } from "./_http_runtime";
import { getMessageDelayPolicy } from "./_message_delay";
export { getMessageDelayPolicy };
import { sanitizeStaleAssistantReply } from "./_assistant_output";
export { sanitizeStaleAssistantReply };
import { handleMediaLibraryRequest } from "./_media_library_api";
import { handleProgramRulesRequest } from "./_program_rules_api";
import { handleAgentRulesRequest } from "./_agent_rules_api";
import { handlePersonaManagementRequest } from "./_persona_management_api";
import { handleIncidentRequest } from "./_incident_api";
import { handleDeviceControlRequest } from "./_device_control_api";
import { handleReplyTaskRequest } from "./_reply_task_api";
import { handleDashboardCustomerRequest } from "./_dashboard_customer_api";
import { handleAdminCrudRequest } from "./_admin_crud_api";
import { handleEntryMediaRequest } from "./_entry_media_api";
import { handleMessageSyncRequest } from "./_message_sync_api";
import { handleVisionConfigRequest } from "./_vision_config_api";
import { handleChatRequest } from "./_chat_api";

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dashboard-Password",
      },
    });
  }

  try {
    const entryMediaResponse = await handleEntryMediaRequest({
      request,
      env,
      path,
      method,
    });
    if (entryMediaResponse) return entryMediaResponse;

    const dashboardCustomerResponse = await handleDashboardCustomerRequest({
      request,
      env,
      url,
      path,
      method,
    });
    if (dashboardCustomerResponse) return dashboardCustomerResponse;

    const deviceControlResponse = await handleDeviceControlRequest({
      request,
      env,
      url,
      path,
      method,
    });
    if (deviceControlResponse) return deviceControlResponse;

    const mediaLibraryResponse = await handleMediaLibraryRequest({
      request,
      env,
      path,
      method,
    });
    if (mediaLibraryResponse) return mediaLibraryResponse;

    const personaManagementResponse = await handlePersonaManagementRequest({
      request,
      env,
      url,
      path,
      method,
    });
    if (personaManagementResponse) return personaManagementResponse;

    const programRulesResponse = await handleProgramRulesRequest({
      request,
      env,
      path,
      method,
    });
    if (programRulesResponse) return programRulesResponse;

    const incidentResponse = await handleIncidentRequest({
      request,
      env,
      url,
      path,
      method,
    });
    if (incidentResponse) return incidentResponse;

    const agentRulesResponse = await handleAgentRulesRequest({
      request,
      env,
      path,
      method,
    });
    if (agentRulesResponse) return agentRulesResponse;

    const replyTaskResponse = await handleReplyTaskRequest({
      request,
      env,
      url,
      path,
      method,
    });
    if (replyTaskResponse) return replyTaskResponse;

    const adminCrudResponse = await handleAdminCrudRequest({
      request,
      env,
      url,
      path,
      method,
    });
    if (adminCrudResponse) return adminCrudResponse;

    const messageSyncResponse = await handleMessageSyncRequest({
      request,
      env,
      context,
      path,
      method,
    });
    if (messageSyncResponse) return messageSyncResponse;

    const chatResponse = await handleChatRequest({
      request,
      env,
      context,
      path,
      method,
    });
    if (chatResponse) return chatResponse;

    const visionConfigResponse = await handleVisionConfigRequest({
      request,
      env,
      path,
      method,
    });
    if (visionConfigResponse) return visionConfigResponse;

    return json({ error: "Not Found" }, 404);
  } catch (error) {
    console.error("API request failed", path, error instanceof Error ? error.stack || error.message : String(error));
    return json({ error: "服务器内部错误" }, 500);
  }
};
