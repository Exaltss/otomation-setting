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
  const [sideOpen, setSideOpen] = useState(false);
  const chatsApi = useChats();

  const navigate = (v: ViewId) => {
    setView(v);
    setSideOpen(false);
  };

  return (
    <div className="g-app">
      <button className="g-burger" onClick={() => setSideOpen((o) => !o)} title="menu">
        ☰
      </button>
      {sideOpen && <div className="g-backdrop show" onClick={() => setSideOpen(false)} />}

      <Sidebar
        open={sideOpen}
        view={view}
        onNavigate={navigate}
        chats={chatsApi.chats}
        activeId={chatsApi.activeId}
        onSelectChat={(id) => {
          chatsApi.setActiveId(id);
          navigate('chat');
        }}
        onNewChat={() => {
          chatsApi.newChat();
          navigate('chat');
        }}
        onDeleteChat={chatsApi.deleteChat}
      />

      {view === 'chat' ? (
        <ChatView chatsApi={chatsApi} />
      ) : (
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