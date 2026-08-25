import { useState } from 'react';
import { Shell, type ViewId } from './features/shell/Shell';
import { ChatView } from './features/chat/ChatView';
import { ProvidersView } from './features/views/ProvidersView';
import { QuotaView } from './features/views/QuotaView';
import { StatsView } from './features/views/StatsView';
import { SettingsView } from './features/views/SettingsView';
import { AlatView } from './features/views/AlatView';

export default function App() {
  const [view, setView] = useState<ViewId>('chat');

  return (
    <Shell current={view} onNavigate={setView}>
      {view === 'chat' && <ChatView />}
      {view === 'providers' && <ProvidersView />}
      {view === 'quota' && <QuotaView />}
      {view === 'stats' && <StatsView />}
      {view === 'settings' && <SettingsView />}
      {view === 'tools' && <AlatView />}
    </Shell>
  );
}