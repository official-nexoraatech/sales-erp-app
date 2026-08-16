import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@erp/logger';
import { TenantScopedDatabase, PlatformAuditLogger } from '@erp/sdk';
import { BusinessError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { COPILOT_TOOLS, executeTool, type ToolExecutionContext } from './ToolRegistry.js';
import type { ConversationService } from './ConversationService.js';

const logger = createLogger({ serviceName: 'ai-copilot-service' });

// Runaway-loop / cost protection — bounded, not configurable per tenant in v1.
const MAX_TOOL_USE_TURNS = 5;
const MODEL = 'claude-sonnet-4-5';

const SYSTEM_PROMPT = `You are the NEXORAA ERP Copilot, an assistant embedded in a multi-tenant,
multi-vertical retail ERP (cloth retail, grocery, and more). You can answer questions and read
data using the tools provided, but you CANNOT create, update, or delete any record in this
version — you are read-only.

Rules you must follow:
1. Never fabricate business numbers (revenue, stock, balances, dates). If a question needs
   real data, call a tool. If no tool can answer it, say so plainly.
2. For report/analytics questions, call list_reports first to find the right report slug,
   then run_report — never estimate or compute financial totals yourself from partial data.
3. When asked to draft a quotation summary, email, or WhatsApp message, write the draft
   directly in your response, clearly labeled as a DRAFT the user must review and send
   themselves through the normal ERP screens — you have no tool to actually send anything.
4. Every tool call you make only returns data the requesting user is already permitted to
   see in the ERP itself — if a tool returns a permission error, tell the user plainly rather
   than guessing why.
5. Be concise. This is a business tool, not a general chatbot.`;

export interface CopilotResponse {
  conversationId: number;
  reply: string;
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
}

export class ClaudeOrchestrator {
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string | undefined,
    private readonly db: ErpDatabase,
    private readonly conversations: ConversationService
  ) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async sendMessage(params: {
    tenantId: number;
    userId: number;
    userJwt: string;
    conversationId: number;
    userMessage: string;
  }): Promise<CopilotResponse> {
    if (!this.client) {
      // Matches this codebase's existing "blocked only on missing external credential, not a
      // code defect" pattern (see NIC_API_KEY for e-Invoice/e-Way Bill) — a clear, honest
      // error rather than a crash or a silently-fake response. Must be a BusinessError (not a
      // plain Error): registerErrorHandler's shared handler only preserves the real
      // code/message for ERPError subclasses — a plain Error falls through to a generic
      // "An unexpected error occurred" 500, which would have silently defeated the whole
      // point of this clear-error design (found via live E2E testing).
      throw new BusinessError(
        'COPILOT_NOT_CONFIGURED',
        'AI Copilot is not configured — ANTHROPIC_API_KEY is missing. Contact your administrator.'
      );
    }

    const { tenantId, userId, userJwt, conversationId, userMessage } = params;
    const auditLogger = new PlatformAuditLogger(
      new TenantScopedDatabase(tenantId, this.db),
      userId
    );
    const toolCtx: ToolExecutionContext = { userJwt, tenantId };

    await this.conversations.appendMessage(conversationId, tenantId, 'user', userMessage);
    await this.conversations.setTitleIfUnset(conversationId, tenantId, userMessage);

    // Known limitation: history is replayed as plain text only — a prior turn's actual
    // tool_use/tool_result content blocks are not reconstructed here, only the final text
    // ConversationService.appendMessage stored (toolCalls is kept as separate metadata for
    // display, not replayed to the model). Within a single sendMessage() call the live
    // tool-use loop below is fully correct (tested); across turns, Claude sees a clean
    // transcript of what it concluded rather than the raw tool trace — a deliberate
    // context-window/cost tradeoff, not an oversight, but it does mean a follow-up question
    // referencing specifics from a tool result several turns back may need Claude to
    // re-fetch rather than recall it verbatim.
    const history = await this.conversations.getHistory(conversationId, tenantId);
    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role === 'tool' ? 'user' : (m.role as 'user' | 'assistant'),
      content: m.content,
    }));

    const allToolCalls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
    let finalText = '';

    for (let turn = 0; turn < MAX_TOOL_USE_TURNS; turn++) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: COPILOT_TOOLS,
      });

      const textBlocks = response.content.filter((b) => b.type === 'text');
      finalText = textBlocks.map((b) => (b as Anthropic.TextBlock).text).join('\n');

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
        break;
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const input = block.input as Record<string, unknown>;
        allToolCalls.push({ toolName: block.name, input });

        const result = await executeTool(block.name, input, toolCtx);

        await auditLogger.log({
          action: 'COPILOT_TOOL_CALL',
          entityType: 'CopilotConversation',
          entityId: conversationId,
          metadata: { toolName: block.name, input },
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    await this.conversations.appendMessage(
      conversationId,
      tenantId,
      'assistant',
      finalText,
      allToolCalls.length > 0
        ? allToolCalls.map((c, i) => ({
            toolUseId: String(i),
            toolName: c.toolName,
            input: c.input,
          }))
        : undefined
    );

    logger.info(
      { tenantId, conversationId, toolCallCount: allToolCalls.length },
      'Copilot turn completed'
    );

    return { conversationId, reply: finalText, toolCalls: allToolCalls };
  }
}
