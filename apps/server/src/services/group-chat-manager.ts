import { db } from '../db/index.js';
import { getAdapter } from '../db/adapter.js';
import { broadcast, broadcastToGroupChat } from '../ws/index.js';
import { GroupChatRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import { scanMessage, SEVERITY_ORDER } from './prompt-guard.js';
import { getPromptGuardConfig } from '../agent-types/openclaw/security-profiles.js';
import { addSecurityEvent } from './instance-manager.js';
import type {
  ChatAttachment,
  GroupChat,
  GroupChatMember,
  GroupChatMessage,
  GroupChatMessagesResponse,
  CreateGroupChatRequest,
  UpdateGroupChatRequest,
  AddGroupChatMemberRequest,
  UpdateGroupChatMemberRequest,
  DeliveryStatusEntry,
  DeliveryStatusValue,
  SecurityProfile,
} from '@aquarium/shared';

const MAX_AUTO_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000; // 1s, 2s, 4s exponential

const CHAT_EVENT_THROTTLE_MS = 60_000; // 1 event per minute per instance
const chatEventLastInsert = new Map<string, number>();

function toMember(row: Record<string, unknown>): GroupChatMember {
  return {
    id: row.id as string,
    groupChatId: row.group_chat_id as string,
    instanceId: (row.instance_id as string) || null,
    displayName: row.display_name as string,
    role: (row.role as string) || null,
    isHuman: (row.is_human as boolean) || false,
    userId: (row.user_id as string) || null,
    joinedAt: String(row.joined_at),
  };
}

function toGroupChat(row: Record<string, unknown>, memberRows: Record<string, unknown>[]): GroupChat {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    defaultMentionMode: row.default_mention_mode as GroupChat['defaultMentionMode'],
    maxBotChainDepth: row.max_bot_chain_depth as number,
    members: memberRows.map(toMember),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toDeliveryStatus(row: Record<string, unknown>): DeliveryStatusEntry {
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    targetInstanceId: row.target_instance_id as string,
    status: row.status as DeliveryStatusValue,
    errorMessage: (row.error_message as string) || null,
    responseMessageId: (row.response_message_id as string) || null,
    retryCount: (row.retry_count as number) || 0,
    maxRetries: (row.max_retries as number) || 3,
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    processingAt: row.processing_at ? String(row.processing_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorAt: row.error_at ? String(row.error_at) : null,
    createdAt: String(row.created_at),
  };
}

function toMessage(row: Record<string, unknown>, deliveryRows: Record<string, unknown>[] = []): GroupChatMessage {
  let mentionedIds: string[] = [];
  const raw = row.mentioned_instance_ids;
  if (Array.isArray(raw)) {
    mentionedIds = raw as string[];
  } else if (typeof raw === 'string') {
    try { mentionedIds = JSON.parse(raw) as string[]; } catch { mentionedIds = []; }
  }

  return {
    id: row.id as string,
    groupChatId: row.group_chat_id as string,
    senderType: row.sender_type as GroupChatMessage['senderType'],
    senderInstanceId: (row.sender_instance_id as string) || null,
    senderUserId: (row.sender_user_id as string) || null,
    content: row.content as string,
    mentionedInstanceIds: mentionedIds,
    replyToMessageId: (row.reply_to_message_id as string) || null,
    chainDepth: (row.chain_depth as number) || 0,
    createdAt: String(row.created_at),
    deliveryStatus: deliveryRows.length > 0 ? deliveryRows.map(toDeliveryStatus) : undefined,
  };
}

async function fetchGroupChatOwned(groupChatId: string, userId: string): Promise<Record<string, unknown> | undefined> {
  return db('group_chats').where({ id: groupChatId, user_id: userId }).first();
}

async function fetchGroupChatAccessible(groupChatId: string, userId: string): Promise<Record<string, unknown> | undefined> {
  const row = await db('group_chats').where({ id: groupChatId }).first();
  if (!row) return undefined;
  if ((row.user_id as string) === userId) return row;
  const membership = await db('group_chat_members')
    .where({ group_chat_id: groupChatId, user_id: userId, is_human: true })
    .first();
  return membership ? row : undefined;
}

async function fetchMembers(groupChatId: string): Promise<Record<string, unknown>[]> {
  return db('group_chat_members').where({ group_chat_id: groupChatId }).orderBy('joined_at', 'asc');
}

export async function createGroupChat(userId: string, req: CreateGroupChatRequest): Promise<GroupChat> {
  const [row] = await db('group_chats')
    .insert({
      user_id: userId,
      name: req.name,
      default_mention_mode: req.defaultMentionMode || 'broadcast',
      max_bot_chain_depth: req.maxBotChainDepth ?? 3,
    })
    .returning('*');

  for (const instanceId of req.instanceIds) {
    await db('group_chat_members').insert({
      group_chat_id: row.id,
      instance_id: instanceId,
      display_name: req.displayNames[instanceId] || instanceId,
      role: req.roles?.[instanceId] || null,
      is_human: false,
    });
  }

  const members = await fetchMembers(row.id as string);
  return toGroupChat(row, members);
}

export async function listGroupChats(userId: string): Promise<GroupChat[]> {
  const rows = await db('group_chats')
    .where({ user_id: userId })
    .unionAll(
      db('group_chats')
        .join('group_chat_members', 'group_chats.id', 'group_chat_members.group_chat_id')
        .where({ 'group_chat_members.user_id': userId, 'group_chat_members.is_human': true })
        .whereNot({ 'group_chats.user_id': userId })
        .select('group_chats.*'),
    )
    .orderBy('created_at', 'desc');
  const result: GroupChat[] = [];
  for (const row of rows) {
    const members = await fetchMembers(row.id as string);
    result.push(toGroupChat(row, members));
  }
  return result;
}

export async function getGroupChat(groupChatId: string, userId: string): Promise<GroupChat | null> {
  const row = await fetchGroupChatAccessible(groupChatId, userId);
  if (!row) return null;
  const members = await fetchMembers(groupChatId);
  return toGroupChat(row, members);
}

export async function updateGroupChat(groupChatId: string, userId: string, req: UpdateGroupChatRequest): Promise<GroupChat> {
  const row = await fetchGroupChatOwned(groupChatId, userId);
  if (!row) throw new Error('Group chat not found');

  const updates: Record<string, unknown> = { updated_at: db.fn.now() };
  if (req.name !== undefined) updates.name = req.name;
  if (req.defaultMentionMode !== undefined) updates.default_mention_mode = req.defaultMentionMode;
  if (req.maxBotChainDepth !== undefined) updates.max_bot_chain_depth = req.maxBotChainDepth;

  await db('group_chats').where({ id: groupChatId }).update(updates);
  return (await getGroupChat(groupChatId, userId))!;
}

export async function deleteGroupChat(groupChatId: string, userId: string): Promise<void> {
  const row = await fetchGroupChatOwned(groupChatId, userId);
  if (!row) throw new Error('Group chat not found');
  await db('group_chat_delivery_status')
    .whereIn('message_id', db('group_chat_messages').where({ group_chat_id: groupChatId }).select('id'))
    .delete();
  await db('group_chat_messages').where({ group_chat_id: groupChatId }).delete();
  await db('group_chat_members').where({ group_chat_id: groupChatId }).delete();
  await db('group_chats').where({ id: groupChatId }).delete();
}

export async function addMember(groupChatId: string, userId: string, req: AddGroupChatMemberRequest): Promise<GroupChatMember> {
  const row = await fetchGroupChatOwned(groupChatId, userId);
  if (!row) throw new Error('Group chat not found');

  const isHuman = req.isHuman ?? false;

  if (isHuman) {
    if (!req.userId) throw new Error('userId required for human members');
    const existing = await db('group_chat_members')
      .where({ group_chat_id: groupChatId, user_id: req.userId })
      .first();
    if (existing) throw new Error('User already a member');

    const [member] = await db('group_chat_members')
      .insert({
        group_chat_id: groupChatId,
        instance_id: null,
        user_id: req.userId,
        display_name: req.displayName,
        role: req.role || null,
        is_human: true,
      })
      .returning('*');
    return toMember(member);
  }

  // Bot member (existing logic)
  if (!req.instanceId) throw new Error('instanceId required for bot members');
  const existing = await db('group_chat_members')
    .where({ group_chat_id: groupChatId, instance_id: req.instanceId })
    .first();
  if (existing) throw new Error('Instance already a member');

  const [member] = await db('group_chat_members')
    .insert({
      group_chat_id: groupChatId,
      instance_id: req.instanceId,
      display_name: req.displayName,
      role: req.role || null,
      is_human: false,
    })
    .returning('*');
  return toMember(member);
}

export async function removeMember(groupChatId: string, userId: string, memberId: string): Promise<void> {
  const row = await fetchGroupChatOwned(groupChatId, userId);
  if (!row) throw new Error('Group chat not found');
  const deleted = await db('group_chat_members').where({ id: memberId, group_chat_id: groupChatId }).delete();
  if (!deleted) throw new Error('Member not found');
}

export async function updateMember(
  groupChatId: string,
  userId: string,
  memberId: string,
  req: UpdateGroupChatMemberRequest,
): Promise<GroupChatMember> {
  const row = await fetchGroupChatOwned(groupChatId, userId);
  if (!row) throw new Error('Group chat not found');

  const updates: Record<string, unknown> = {};
  if (req.displayName !== undefined) updates.display_name = req.displayName;
  if (req.role !== undefined) updates.role = req.role;

  if (Object.keys(updates).length === 0) throw new Error('No fields to update');

  const [updated] = await db('group_chat_members')
    .where({ id: memberId, group_chat_id: groupChatId })
    .update(updates)
    .returning('*');

  if (!updated) throw new Error('Member not found');
  return toMember(updated);
}

export async function getMessages(
  groupChatId: string,
  userId: string,
  opts: { limit?: number; before?: string; after?: string },
): Promise<GroupChatMessagesResponse> {
  const row = await fetchGroupChatAccessible(groupChatId, userId);
  if (!row) throw new Error('Group chat not found');

  const limit = Math.min(opts.limit || 50, 100);
  let query = db('group_chat_messages').where({ group_chat_id: groupChatId });

  if (opts.before) {
    query = query.where('created_at', '<', db('group_chat_messages').where({ id: opts.before }).select('created_at'));
  }
  if (opts.after) {
    query = query.where('created_at', '>', db('group_chat_messages').where({ id: opts.after }).select('created_at'));
  }

  const messageRows = await query.orderBy('created_at', 'desc').limit(limit + 1);
  const hasMore = messageRows.length > limit;
  const trimmed = messageRows.slice(0, limit).reverse();

  const messageIds = trimmed.map((r: Record<string, unknown>) => r.id as string);
  const deliveryRows = messageIds.length > 0
    ? await db('group_chat_delivery_status').whereIn('message_id', messageIds)
    : [];

  const deliveryByMessage = new Map<string, Record<string, unknown>[]>();
  for (const d of deliveryRows) {
    const mid = d.message_id as string;
    if (!deliveryByMessage.has(mid)) deliveryByMessage.set(mid, []);
    deliveryByMessage.get(mid)!.push(d);
  }

  const members = await fetchMembers(groupChatId);
  const memberByInstanceId = new Map(members.map(m => [m.instance_id as string, m.display_name as string]));

  const messages = trimmed.map((r: Record<string, unknown>) => {
    const msg = toMessage(r, deliveryByMessage.get(r.id as string) || []);
    if (msg.deliveryStatus) {
      msg.deliveryStatus = msg.deliveryStatus.map(ds => ({
        ...ds,
        targetDisplayName: memberByInstanceId.get(ds.targetInstanceId) || ds.targetInstanceId,
      }));
    }
    return msg;
  });

  return { messages, hasMore };
}

function parseMentions(content: string, members: Record<string, unknown>[]): string[] {
  const mentionRegex = /@(\S+)/g;
  const mentioned = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(content)) !== null) {
    const name = match[1].replace(/[,.:;!?]+$/, ''); // strip trailing punctuation
    const member = members.find(m => (m.display_name as string).toLowerCase() === name.toLowerCase());
    if (member) mentioned.add(member.instance_id as string);
  }
  return [...mentioned];
}

async function updateDeliveryStatus(
  messageId: string,
  targetInstanceId: string,
  status: DeliveryStatusValue,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const timestampCol = `${status}_at`;
  await db('group_chat_delivery_status')
    .where({ message_id: messageId, target_instance_id: targetInstanceId })
    .update({ status, [timestampCol]: db.fn.now(), ...extra });
}

async function getCurrentRetryCount(messageId: string, targetInstanceId: string): Promise<number> {
  const row = await db('group_chat_delivery_status')
    .where({ message_id: messageId, target_instance_id: targetInstanceId })
    .select('retry_count')
    .first();
  return (row?.retry_count as number) || 0;
}

async function scheduleAutoRetry(
  groupChatId: string,
  chatName: string,
  messageId: string,
  content: string,
  senderName: string,
  targetInstanceId: string,
  targetDisplayName: string,
  targetRole: string | null,
  allMemberNames: string[],
  chainDepth: number,
  maxBotChainDepth: number,
  members: Record<string, unknown>[],
  retryCount: number,
  attachments?: ChatAttachment[],
): Promise<void> {
  if (retryCount >= MAX_AUTO_RETRIES) {
    console.log(`[group-chat] Max retries (${MAX_AUTO_RETRIES}) reached for message ${messageId} → ${targetInstanceId}`);
    return;
  }

  const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
  const nextRetryAt = new Date(Date.now() + delayMs);

  await db('group_chat_delivery_status')
    .where({ message_id: messageId, target_instance_id: targetInstanceId })
    .update({
      status: 'pending',
      error_message: null,
      error_at: null,
      retry_count: retryCount + 1,
      next_retry_at: nextRetryAt,
    });

  broadcastDeliveryUpdate(groupChatId, messageId, targetInstanceId, targetDisplayName, 'pending');

  setTimeout(() => {
    const processedInChain = new Set<string>([targetInstanceId]);
    fanOutToBot(
      groupChatId, chatName, messageId, content, senderName,
      targetInstanceId, targetDisplayName, targetRole, allMemberNames,
      chainDepth, maxBotChainDepth, members, processedInChain, attachments,
    ).catch(err => {
      console.error(`[group-chat] Auto-retry #${retryCount + 1} failed for ${targetInstanceId}:`, err);
    });
  }, delayMs);
}

async function fanOutToBot(
  groupChatId: string,
  chatName: string,
  messageId: string,
  content: string,
  senderName: string,
  targetInstanceId: string,
  targetDisplayName: string,
  targetRole: string | null,
  allMemberNames: string[],
  chainDepth: number,
  maxBotChainDepth: number,
  members: Record<string, unknown>[],
  processedInChain: Set<string>,
  attachments?: ChatAttachment[],
): Promise<void> {
  try {
    await updateDeliveryStatus(messageId, targetInstanceId, 'delivered');
    broadcastDeliveryUpdate(groupChatId, messageId, targetInstanceId, targetDisplayName, 'delivered');

    const instance = await db('instances').where({ id: targetInstanceId }).first();
    if (!instance || !instance.control_endpoint || !instance.auth_token) {
      await updateDeliveryStatus(messageId, targetInstanceId, 'error', { error_message: 'Instance not running or unreachable' });
      broadcastDeliveryUpdate(groupChatId, messageId, targetInstanceId, targetDisplayName, 'error', 'Instance not running or unreachable');
      return;
    }

    await updateDeliveryStatus(messageId, targetInstanceId, 'processing');
    broadcastDeliveryUpdate(groupChatId, messageId, targetInstanceId, targetDisplayName, 'processing');

    const memberDescriptions = members.map(m => {
      const name = m.display_name as string;
      const role = m.role as string | null;
      const isHuman = m.is_human as boolean;
      const type = isHuman ? '(human)' : '(AI)';
      return role ? `- ${name} ${type}: ${role}` : `- ${name} ${type}`;
    }).join('\n');

    const contextContent = [
      `[Group Chat: ${chatName}]`,
      `[You are: ${targetDisplayName}]`,
      `[Your role: ${targetRole || 'no specific role'}]`,
      `[Participants:]`,
      memberDescriptions,
      `[Rules: You may use your tools (web search, file read/write, etc.) to answer thoroughly. Do NOT send messages through channels (WhatsApp, Telegram, etc.). Use @name to mention other participants. Keep your response focused and concise.]`,
      `[${senderName}]: ${content}`,
    ].join('\n');

    const sessionKey = `gc-${groupChatId}-${messageId}`;
    const rpc = new GroupChatRPCClient(
      instance.control_endpoint as string,
      instance.auth_token as string,
      instance.id as string,
    );

    let replyText: string;
    try {
      replyText = await rpc.sendChat(contextContent, sessionKey, 120_000, attachments);
    } finally {
      rpc.close();
    }

    const _adapter = getAdapter();
    const [replyRow] = await db('group_chat_messages')
      .insert({
        group_chat_id: groupChatId,
        sender_type: 'bot',
        sender_instance_id: targetInstanceId,
        content: replyText || '',
        mentioned_instance_ids: _adapter.dialect === 'pg'
          ? db.raw('?::uuid[]', [[]])
          : JSON.stringify([]),
        chain_depth: chainDepth + 1,
      })
      .returning('*');

    await updateDeliveryStatus(messageId, targetInstanceId, 'completed', {
      response_message_id: replyRow.id,
    });
    broadcastDeliveryUpdate(groupChatId, messageId, targetInstanceId, targetDisplayName, 'completed');

    const now = Date.now();
    const lastInsert = chatEventLastInsert.get(targetInstanceId) ?? 0;
    if (now - lastInsert >= CHAT_EVENT_THROTTLE_MS) {
      chatEventLastInsert.set(targetInstanceId, now);
      db('instance_events').insert({
        instance_id: targetInstanceId,
        event_type: 'CHAT_MESSAGE',
        metadata: JSON.stringify({ groupChatId, groupChatName: chatName }),
      }).catch(() => {});
    }

    broadcastToGroupChat(groupChatId, {
      type: 'group_chat:message',
      groupChatId,
      payload: {
        messageId: replyRow.id,
        senderType: 'bot',
        senderInstanceId: targetInstanceId,
        senderName: targetDisplayName,
        content: replyText,
        chainDepth: chainDepth + 1,
        createdAt: String(replyRow.created_at),
      },
    });

    if (chainDepth + 1 < maxBotChainDepth) {
      const botMentions = parseMentions(replyText, members);
      const newTargets = botMentions.filter(id => id !== targetInstanceId && !processedInChain.has(id));

      if (newTargets.length > 0) {
        for (const nextTargetId of newTargets) {
          processedInChain.add(nextTargetId);
          const nextMember = members.find(m => (m.instance_id as string) === nextTargetId);
          if (!nextMember) continue;

          await db('group_chat_delivery_status').insert({
            message_id: replyRow.id as string,
            target_instance_id: nextTargetId,
            status: 'pending',
          });

          const nextRole = (nextMember.role as string | null) || null;
          fanOutToBot(
            groupChatId,
            chatName,
            replyRow.id as string,
            replyText,
            targetDisplayName,
            nextTargetId,
            nextMember.display_name as string,
            nextRole,
            allMemberNames,
            chainDepth + 1,
            maxBotChainDepth,
            members,
            processedInChain,
          ).catch(err => {
            console.error(`[group-chat] Bot chain error for instance ${nextTargetId}:`, err);
          });
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const currentRetryCount = await getCurrentRetryCount(messageId, targetInstanceId);
    await updateDeliveryStatus(messageId, targetInstanceId, 'error', { error_message: errorMsg });
    broadcastDeliveryUpdate(groupChatId, messageId, targetInstanceId, targetDisplayName, 'error', errorMsg);

    scheduleAutoRetry(
      groupChatId, chatName, messageId, content, senderName,
      targetInstanceId, targetDisplayName, targetRole, allMemberNames,
      chainDepth, maxBotChainDepth, members, currentRetryCount, attachments,
    ).catch(retryErr => {
      console.error(`[group-chat] Failed to schedule retry for ${targetInstanceId}:`, retryErr);
    });
  }
}

function broadcastDeliveryUpdate(
  groupChatId: string,
  messageId: string,
  targetInstanceId: string,
  targetDisplayName: string,
  status: DeliveryStatusValue,
  errorMessage?: string,
): void {
  broadcastToGroupChat(groupChatId, {
    type: 'group_chat:delivery_status',
    groupChatId,
    payload: {
      messageId,
      targetInstanceId,
      targetDisplayName,
      status,
      ...(errorMessage ? { errorMessage } : {}),
      timestamp: new Date().toISOString(),
    },
  });
}

export async function sendMessage(groupChatId: string, userId: string, content: string, attachments?: ChatAttachment[]): Promise<string> {
  const chatRow = await db('group_chats').where({ id: groupChatId }).first();
  if (!chatRow) throw new Error('Group chat not found');

  const isOwner = (chatRow.user_id as string) === userId;
  const humanMember = !isOwner
    ? await db('group_chat_members')
        .where({ group_chat_id: groupChatId, user_id: userId, is_human: true })
        .first()
    : null;

  if (!isOwner && !humanMember) throw new Error('Not authorized to send messages in this group chat');

  const members = await fetchMembers(groupChatId);
  const mentionedIds = parseMentions(content, members);

  const botMembers = members.filter(m => !(m.is_human as boolean) && m.instance_id);
  let targetInstanceIds: string[];
  if (mentionedIds.length > 0) {
    targetInstanceIds = mentionedIds.filter(id => botMembers.some(m => (m.instance_id as string) === id));
  } else if ((chatRow.default_mention_mode as string) === 'broadcast') {
    targetInstanceIds = botMembers.map(m => m.instance_id as string);
  } else {
    targetInstanceIds = [];
  }

  const senderDisplayName = humanMember
    ? (humanMember.display_name as string)
    : 'User';

  const adapter = getAdapter();
  const [msgRow] = await db('group_chat_messages')
    .insert({
      group_chat_id: groupChatId,
      sender_type: 'user',
      sender_instance_id: null,
      sender_user_id: isOwner ? userId : (humanMember?.user_id as string),
      content,
      mentioned_instance_ids: adapter.dialect === 'pg'
        ? db.raw('?::uuid[]', [targetInstanceIds])
        : JSON.stringify(targetInstanceIds),
      chain_depth: 0,
    })
    .returning('*');

  const messageId = msgRow.id as string;

  for (const instanceId of targetInstanceIds) {
    await db('group_chat_delivery_status').insert({
      message_id: messageId,
      target_instance_id: instanceId,
      status: 'pending',
    });
  }

  const memberNameMap = new Map(members.map(m => [
    (m.instance_id as string) || (m.user_id as string),
    m.display_name as string,
  ]));
  const allMemberNames = members.map(m => m.display_name as string);

  const initialDeliveryStatus = targetInstanceIds.map(id => ({
    targetInstanceId: id,
    targetDisplayName: memberNameMap.get(id) || id,
    status: 'pending' as DeliveryStatusValue,
  }));

  broadcastToGroupChat(groupChatId, {
    type: 'group_chat:message',
    groupChatId,
    payload: {
      messageId,
      senderType: 'user',
      senderInstanceId: null,
      senderUserId: isOwner ? userId : (humanMember?.user_id as string) || null,
      senderName: senderDisplayName,
      content,
      chainDepth: 0,
      createdAt: String(msgRow.created_at),
      deliveryStatus: initialDeliveryStatus,
    },
  });

  if (targetInstanceIds.length > 0) {
    const profileRows = await db('instances')
      .whereIn('id', targetInstanceIds)
      .select('id', 'security_profile');
    const profileMap = new Map<string, SecurityProfile>(profileRows.map((r: Record<string, unknown>) => [r.id as string, ((r.security_profile as SecurityProfile | null | undefined) ?? 'standard')] as [string, SecurityProfile]));
    const scannedByProfile = new Map<string, ReturnType<typeof scanMessage>>();

    for (const instanceId of targetInstanceIds) {
      const profile = profileMap.get(instanceId) ?? 'standard';
      const guardConfig = getPromptGuardConfig(profile);
      if (!guardConfig.enabled) continue;

      let scanResult = scannedByProfile.get(profile);
      if (!scanResult) {
        scanResult = scanMessage(content, guardConfig.customPatterns);
        scannedByProfile.set(profile, scanResult);
      }

      if (scanResult.detected && scanResult.maxSeverity && SEVERITY_ORDER[scanResult.maxSeverity] >= SEVERITY_ORDER[guardConfig.minAlertSeverity]) {
        if (guardConfig.logEvents) {
          addSecurityEvent(instanceId, scanResult).catch(() => {});
        }
        if (guardConfig.pushEvents) {
          broadcast(instanceId, {
            type: 'security_event',
            instanceId,
            payload: {
              category: 'security:prompt_injection_detected',
              severity: scanResult.maxSeverity,
              matchCount: scanResult.matches.length,
              categories: [...new Set(scanResult.matches.map(m => m.category))],
              durationMs: scanResult.durationMs,
              timestamp: new Date().toISOString(),
            },
          });
        }
      }
    }
  }

  const chatName = chatRow.name as string;
  const maxBotChainDepth = chatRow.max_bot_chain_depth as number;
  const processedInChain = new Set(targetInstanceIds);

  for (const instanceId of targetInstanceIds) {
    const displayName = memberNameMap.get(instanceId) || instanceId;
    const role = (members.find(m => (m.instance_id as string) === instanceId)?.role as string | null) || null;
    fanOutToBot(
      groupChatId, chatName, messageId, content, senderDisplayName,
      instanceId, displayName, role, allMemberNames,
      0, maxBotChainDepth, members, processedInChain, attachments,
    ).catch(err => {
      console.error(`[group-chat] Fanout error for instance ${instanceId}:`, err);
    });
  }

  return messageId;
}

export async function retryMessage(
  groupChatId: string,
  userId: string,
  messageId: string,
  targetInstanceId?: string,
): Promise<number> {
  const chatRow = await fetchGroupChatOwned(groupChatId, userId);
  if (!chatRow) throw new Error('Group chat not found');

  const msgRow = await db('group_chat_messages').where({ id: messageId, group_chat_id: groupChatId }).first();
  if (!msgRow) throw new Error('Message not found');

  let query = db('group_chat_delivery_status')
    .where({ message_id: messageId, status: 'error' });
  if (targetInstanceId) {
    query = query.where({ target_instance_id: targetInstanceId });
  }
  const errorRows = await query;

  if (errorRows.length === 0) return 0;

  const members = await fetchMembers(groupChatId);
  const memberNameMap = new Map(members.map(m => [m.instance_id as string, m.display_name as string]));
  const allMemberNames = members.map(m => m.display_name as string);
  const chatName = chatRow.name as string;
  const maxBotChainDepth = chatRow.max_bot_chain_depth as number;

  const senderName = msgRow.sender_type === 'user'
    ? 'User'
    : (memberNameMap.get(msgRow.sender_instance_id as string) || 'Bot');

  const processedInChain = new Set<string>();

  for (const errRow of errorRows) {
    const instId = errRow.target_instance_id as string;
    const displayName = memberNameMap.get(instId) || instId;
    processedInChain.add(instId);

    await db('group_chat_delivery_status')
      .where({ id: errRow.id })
      .update({ status: 'pending', error_message: null, error_at: null });

    const role = (members.find(m => (m.instance_id as string) === instId)?.role as string | null) || null;
    fanOutToBot(
      groupChatId,
      chatName,
      messageId,
      msgRow.content as string,
      senderName,
      instId,
      displayName,
      role,
      allMemberNames,
      (msgRow.chain_depth as number) || 0,
      maxBotChainDepth,
      members,
      processedInChain,
    ).catch(err => {
      console.error(`[group-chat] Retry fanout error for instance ${instId}:`, err);
    });
  }

  return errorRows.length;
}
