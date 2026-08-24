import { useState } from 'react';
import { Shell, type ViewId } from './features/shell/Shell';
import { ChatView } from './features/chat/ChatView';
import { AlatView } from './features/views/AlatView';
import { SettingsView } from './features/views/SettingsView';

function ProvidersView() {
  return <p>🔌 AI Provider & katalog model dari key — hadir di Fase 12C.</p>;
}

function QuotaView() {
  return <p>📡 Pelacakan Kuota: AI mana yang bisa dipakai sekarang — hadir di Fase 12D.</p>;
}

function StatsView() {
  return <p>📊 Statistik penggunaan saat ini — hadir di Fase 12E.</p>;
}

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