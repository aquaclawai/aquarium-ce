import type {
  GroupChatMessage,
  GroupChatWsMessage,
  GroupChatDeliveryWsMessage,
} from '@aquarium/shared';

export type DeliveryPayload = GroupChatDeliveryWsMessage['payload'] & {
  retryCount?: number;
  maxRetries?: number;
  nextRetryAt?: string | null;
};

export function buildMessageFromWs(
  payload: GroupChatWsMessage['payload'],
  chatId: string
): GroupChatMessage {
  return {
    id: payload.messageId,
    groupChatId: chatId,
    senderType: payload.senderType,
    senderInstanceId: payload.senderInstanceId,
    senderUserId: payload.senderUserId || null,
    senderDisplayName: payload.senderName,
    content: payload.content,
    mentionedInstanceIds: [],
    replyToMessageId: null,
    chainDepth: payload.chainDepth,
    createdAt: payload.createdAt,
    deliveryStatus: payload.deliveryStatus?.map(ds => ({
      id: `${payload.messageId}-${ds.targetInstanceId}`,
      messageId: payload.messageId,
      targetInstanceId: ds.targetInstanceId,
      targetDisplayName: ds.targetDisplayName,
      status: ds.status,
      errorMessage: ds.errorMessage || null,
      responseMessageId: null,
      retryCount: 0,
      maxRetries: 3,
      nextRetryAt: null,
      deliveredAt: null,
      processingAt: null,
      completedAt: null,
      errorAt: null,
      createdAt: payload.createdAt,
    })),
  };
}

export function applyDeliveryStatus(
  messages: GroupChatMessage[],
  payload: DeliveryPayload
): GroupChatMessage[] {
  return messages.map(msg => {
    if (msg.id !== payload.messageId) return msg;
    const existing = msg.deliveryStatus || [];
    const idx = existing.findIndex(s => s.targetInstanceId === payload.targetInstanceId);
    const next = [...existing];
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        status: payload.status,
        errorMessage: payload.errorMessage || null,
        responseMessageId: payload.responseMessageId || null,
        retryCount: payload.retryCount ?? next[idx].retryCount,
        maxRetries: payload.maxRetries ?? next[idx].maxRetries,
        nextRetryAt: payload.nextRetryAt ?? next[idx].nextRetryAt,
      };
    } else {
      next.push({
        id: `${payload.messageId}-${payload.targetInstanceId}`,
        messageId: payload.messageId,
        targetInstanceId: payload.targetInstanceId,
        targetDisplayName: payload.targetDisplayName,
        status: payload.status,
        errorMessage: payload.errorMessage || null,
        responseMessageId: payload.responseMessageId || null,
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        deliveredAt: null,
        processingAt: null,
        completedAt: null,
        errorAt: null,
        createdAt: payload.timestamp,
      });
    }
    return { ...msg, deliveryStatus: next };
  });
}
