import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockMessagesCreate };
  },
}));

vi.mock('@erp/sdk', () => ({
  TenantScopedDatabase: class {
    constructor(
      public tenantId: number,
      public raw: unknown
    ) {}
  },
  PlatformAuditLogger: class {
    log = vi.fn();
  },
}));

vi.mock('../domain/ToolRegistry.js', () => ({
  COPILOT_TOOLS: [],
  executeTool: vi.fn(async (toolName: string) => ({ toolName, mocked: true })),
}));

import { ClaudeOrchestrator } from '../domain/ClaudeOrchestrator.js';
import { executeTool } from '../domain/ToolRegistry.js';

function makeConversations() {
  return {
    appendMessage: vi.fn(),
    setTitleIfUnset: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([]),
  };
}

describe('ClaudeOrchestrator', () => {
  beforeEach(() => {
    mockMessagesCreate.mockReset();
    vi.mocked(executeTool).mockClear();
  });

  it('throws a clear, non-crashing error when ANTHROPIC_API_KEY is not configured', async () => {
    const conversations = makeConversations();
    const orchestrator = new ClaudeOrchestrator(undefined, {} as never, conversations as never);

    await expect(
      orchestrator.sendMessage({
        tenantId: 1,
        userId: 1,
        userJwt: 'x',
        conversationId: 1,
        userMessage: 'hi',
      })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('returns the final text reply directly when Claude answers without using a tool', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello, how can I help?' }],
      stop_reason: 'end_turn',
    });
    const conversations = makeConversations();
    const orchestrator = new ClaudeOrchestrator('fake-key', {} as never, conversations as never);

    const result = await orchestrator.sendMessage({
      tenantId: 1,
      userId: 1,
      userJwt: 'x',
      conversationId: 5,
      userMessage: 'hi',
    });

    expect(result.reply).toBe('Hello, how can I help?');
    expect(result.toolCalls).toHaveLength(0);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call, feeds the result back, and returns the follow-up answer', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'list_invoices', input: { pageSize: 5 } }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'You have 3 recent invoices.' }],
        stop_reason: 'end_turn',
      });
    const conversations = makeConversations();
    const orchestrator = new ClaudeOrchestrator('fake-key', {} as never, conversations as never);

    const result = await orchestrator.sendMessage({
      tenantId: 1,
      userId: 1,
      userJwt: 'jwt-token',
      conversationId: 5,
      userMessage: 'show my recent invoices',
    });

    expect(executeTool).toHaveBeenCalledWith(
      'list_invoices',
      { pageSize: 5 },
      { userJwt: 'jwt-token', tenantId: 1 }
    );
    expect(result.reply).toBe('You have 3 recent invoices.');
    expect(result.toolCalls).toEqual([{ toolName: 'list_invoices', input: { pageSize: 5 } }]);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('stops after MAX_TOOL_USE_TURNS to prevent a runaway loop', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_x', name: 'list_invoices', input: {} }],
      stop_reason: 'tool_use',
    });
    const conversations = makeConversations();
    const orchestrator = new ClaudeOrchestrator('fake-key', {} as never, conversations as never);

    await orchestrator.sendMessage({
      tenantId: 1,
      userId: 1,
      userJwt: 'x',
      conversationId: 5,
      userMessage: 'loop forever',
    });

    // MAX_TOOL_USE_TURNS = 5 — bounded, not infinite.
    expect(mockMessagesCreate).toHaveBeenCalledTimes(5);
  });
});
