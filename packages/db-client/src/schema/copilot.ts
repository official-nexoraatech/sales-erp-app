import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── AI Copilot conversations (tenant/user-scoped) ─────────────────────────
export const copilotConversations = pgTable(
  'copilot_conversations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    title: varchar('title', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_copilot_conv_tenant_user').on(t.tenantId, t.userId, t.updatedAt)]
);

// ─── AI Copilot messages (one row per turn, including tool calls/results) ──
export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    conversationId: integer('conversation_id').notNull(),
    role: varchar('role', { length: 20 }).notNull().$type<'user' | 'assistant' | 'tool'>(),
    content: text('content').notNull(),
    // Anthropic tool-use content blocks, when present — [{toolUseId, toolName, input, result?}]
    toolCalls: jsonb('tool_calls').$type<
      Array<{
        toolUseId: string;
        toolName: string;
        input: Record<string, unknown>;
        result?: unknown;
      }>
    >(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_copilot_msg_conversation').on(t.conversationId, t.createdAt)]
);

export type CopilotConversation = typeof copilotConversations.$inferSelect;
export type NewCopilotConversation = typeof copilotConversations.$inferInsert;
export type CopilotMessage = typeof copilotMessages.$inferSelect;
export type NewCopilotMessage = typeof copilotMessages.$inferInsert;
