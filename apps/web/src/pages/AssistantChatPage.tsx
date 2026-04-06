import './AssistantChatPage.css';
import './MyAssistantsPage.css';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatSession } from '../components/assistant/useChatSession';
import { ChatTopbar } from '../components/assistant/ChatTopbar';
import { ChatMessageList } from '../components/assistant/ChatMessageList';
import { ChatInputBar } from '../components/assistant/ChatInputBar';
import { SessionDrawer } from '../components/chat/SessionDrawer';
import { ChatSkeleton } from '@/components/skeletons';

export function AssistantChatPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const chat = useChatSession(id);

  if (chat.loading) return <div className="achat-page"><ChatSkeleton /></div>;
  if (!chat.instance) return <div className="achat-page"><div className="achat-loading">{t('instance.notFound')}</div></div>;

  return (
    <div className="achat-page">
      <ChatTopbar
        instance={chat.instance}
        showSettings={chat.showSettings}
        onToggleSettings={() => chat.setShowSettings(!chat.showSettings)}
        sessionModel={chat.sessionModel}
        onSessionModelChange={chat.setSessionModel}
        sessionThinking={chat.sessionThinking}
        onSessionThinkingChange={chat.setSessionThinking}
        savingSettings={chat.savingSettings}
        onSaveSettings={chat.handleSaveSettings}
        modelSuggestions={chat.modelSuggestions}
        onNewChat={chat.handleNewChat}
        onOpenDrawer={() => chat.setDrawerOpen(!chat.drawerOpen)}
        drawerOpen={chat.drawerOpen}
      />

      <div className="achat-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <SessionDrawer
          instanceId={id!}
          currentSessionKey={chat.sessionKey}
          isOpen={chat.drawerOpen}
          isStreaming={chat.isStreaming}
          onSelectSession={chat.handleSelectSession}
          onNewChat={chat.handleNewChat}
          onClose={() => chat.setDrawerOpen(false)}
          refreshFlag={chat.sessionRefreshFlag}
          mode="sidebar"
        />
        <div className="achat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <ChatMessageList
            messages={chat.messages}
            streamText={chat.streamText}
            isStreaming={chat.isStreaming}
            sending={chat.sending}
            chatError={chat.chatError}
            onDismissError={() => chat.setChatError(null)}
            onRetry={chat.handleRetry}
            retrying={chat.retrying}
            isAtBottom={chat.isAtBottom}
            onScrollToBottom={chat.scrollToBottom}
            messagesContainerRef={chat.messagesContainerRef}
            instance={chat.instance}
            copiedIdx={chat.copiedIdx}
            onCopyMessage={chat.handleCopyMessage}
            onSuggestionClick={chat.sendMessage}
            onMessagesScroll={chat.handleMessagesScroll}
            suggestions={chat.suggestions}
            onOpenSettings={() => chat.setShowSettings(true)}
          />
          <ChatInputBar
            inputValue={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.sendMessage}
            onAbort={chat.handleAbort}
            sending={chat.sending}
            isStreaming={chat.isStreaming}
            attachments={chat.attachments}
            onRemoveAttachment={chat.removeAttachment}
            onFileSelect={chat.processFiles}
            onLoadHistory={chat.loadHistory}
            onPaste={chat.handlePaste}
            onDrop={chat.handleDrop}
            instance={chat.instance}
            textareaRef={chat.textareaRef}
            fileInputRef={chat.fileInputRef}
          />
        </div>
      </div>
    </div>
  );
}
