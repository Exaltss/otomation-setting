/**
 * Sidebar gaya Gemini: logo, chat baru, navigasi, recents.
 */
import type { Chat } from '../../services/chatStore';

export type ViewId = 'chat' | 'providers' | 'quota' | 'stats' | 'settings' | 'tools';

interface SidebarProps {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  chats: Chat[];
  activeId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}

const NAV: { id: ViewId; icon: string; label: string }[] = [
  { id: 'providers', icon: '🔌', label: 'AI Provider' },
  { id: 'quota', icon: '📡', label: 'Pelacakan Kuota' },
  { id: 'stats', icon: '📊', label: 'Statistik' },
  { id: 'settings', icon: '⚙️', label: 'Setting' },
  { id: 'tools', icon: '🧪', label: 'Alat' },
];

export function Sidebar({ view, onNavigate, chats, activeId, onSelectChat, onNewChat, onDeleteChat }: SidebarProps) {
  return (
    <aside className="g-side">
      <div className="g-logo">
        <span className="spark">✦</span> Otomation Setting
      </div>

      <button className="g-newchat" onClick={onNewChat}>
        ＋ Chat baru
      </button>

      {NAV.map((n) => (
        <button
          key={n.id}
          className={`g-navitem ${view === n.id ? 'active' : ''}`}
          onClick={() => onNavigate(n.id)}
        >
          <span>{n.icon}</span> {n.label}
        </button>
      ))}

      <div className="g-sidelabel">Belakangan</div>
      <div className="g-recents">
        {chats.length === 0 && (
          <div style={{ padding: '6px 22px', fontSize: 12, opacity: 0.6 }}>
            Belum ada percakapan.
          </div>
        )}
        {chats.map((c) => (
          <div key={c.id} className={`g-recent ${activeId === c.id ? 'active' : ''}`}>
            <button
              style={{ all: 'unset', flex: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => onSelectChat(c.id)}
            >
              {c.title}
            </button>
            <button className="del" title="hapus" onClick={() => onDeleteChat(c.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="g-sidefoot">local operator · gateway :4123</div>
    </aside>
  );
}