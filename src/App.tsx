import { useState } from 'react';
import { Sidebar, type ViewId } from './features/shell/Sidebar';
import { ChatView } from './features/chat/ChatView';
import { ProvidersView } from './features/views/ProvidersView';
import { QuotaView } from './features/views/QuotaView';
import { StatsView } from './features/views/StatsView';
import { SettingsView } from './features/views/SettingsView';
import { AlatView } from './features/views/AlatView';
import { useChats } from './services/chatStore';
import './styles/gemini.css';

export default function App() {
  const [view, setView] = useState<ViewId>('chat');
  const chatsApi = useChats();

  return (
    <div className="g-app">
      <Sidebar
        view={view}
        onNavigate={setView}
        chats={chatsApi.chats}
        activeId={chatsApi.activeId}
        onSelectChat={(id) => {
          chatsApi.setActiveId(id);
          setView('chat');
        }}
        onNewChat={() => {
          chatsApi.newChat();
          setView('chat');
        }}
        onDeleteChat={chatsApi.deleteChat}
      />

      {view === 'chat' && <ChatView chatsApi={chatsApi} />}

      {view !== 'chat' && (
        <main className="g-view">
          {view === 'providers' && <ProvidersView />}
          {view === 'quota' && <QuotaView />}
          {view === 'stats' && <StatsView />}
          {view === 'settings' && <SettingsView />}
          {view === 'tools' && <AlatView />}
        </main>
      )}
    </div>
  );
}