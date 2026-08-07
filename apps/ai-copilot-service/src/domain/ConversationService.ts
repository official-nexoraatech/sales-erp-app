import { and, asc, desc, eq } from 'drizzle-orm';
import { copilotConversations, copilotMessages } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { NotFoundError } from '@erp/types';

export class ConversationService {
  constructor(private readonly db: ErpDatabase) {}

  async listForUser(tenantId: number, userId: number) {
    return this.db
      .select()
      .from(copilotConversations)
      .where(
        and(eq(copilotConversations.tenantId, tenantId), eq(copilotConversations.userId, userId))
      )
      .orderBy(desc(copilotConversations.updatedAt));
  }

  async getOrCreate(tenantId: number, userId: number, conversationId?: number) {
    if (conversationId) {
      const [row] = await this.db
        .select()
        .from(copilotConversations)
        .where(
          and(
            eq(copilotConversations.id, conversationId),
            eq(copilotConversations.tenantId, tenantId),
            eq(copilotConversations.userId, userId)
          )
        );
      if (!row) throw new NotFoundError('CopilotConversation', conversationId);
      return row;
    }
    const [row] = await this.db
      .insert(copilotConversations)
      .values({ tenantId, userId })
      .returning();
    if (!row) throw new Error('Failed to create conversation');
    return row;
  }

  async getHistory(conversationId: number, tenantId: number) {
    return this.db
      .select()
      .from(copilotMessages)
      .where(
        and(
          eq(copilotMessages.conversationId, conversationId),
          eq(copilotMessages.tenantId, tenantId)
        )
      )
      .orderBy(asc(copilotMessages.createdAt));
  }

  async appendMessage(
    conversationId: number,
    tenantId: number,
    role: 'user' | 'assistant' | 'tool',
    content: string,
    toolCalls?: Array<{
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
      result?: unknown;
    }>
  ) {
    await this.db.insert(copilotMessages).values({
      tenantId,
      conversationId,
      role,
      content,
      ...(toolCalls !== undefined ? { toolCalls } : {}),
    });
    await this.db
      .update(copilotConversations)
      .set({ updatedAt: new Date() })
      .where(eq(copilotConversations.id, conversationId));
  }

  async setTitleIfUnset(conversationId: number, tenantId: number, title: string) {
    const [row] = await this.db
      .select({ title: copilotConversations.title })
      .from(copilotConversations)
      .where(
        and(
          eq(copilotConversations.id, conversationId),
          eq(copilotConversations.tenantId, tenantId)
        )
      );
    if (row && !row.title) {
      await this.db
        .update(copilotConversations)
        .set({ title: title.slice(0, 200) })
        .where(eq(copilotConversations.id, conversationId));
    }
  }
}
