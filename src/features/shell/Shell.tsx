/**
 * App shell — burger menu + area konten.
 * Chat sebagai wajah utama; setting/provider/kuota/statistik menu pendukung.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';

export type ViewId =
  | 'chat'
  | 'providers'
  | 'quota'
  | 'stats'
  | 'settings'
  | 'tools';

const MENU_ITEMS: { id: ViewId; label: string }[] = [
  { id: 'chat', label: '💬 Chat' },
  { id: 'providers', label: '🔌 AI Provider' },
  { id: 'quota', label: '📡 Pelacakan Kuota' },
  { id: 'stats', label: '📊 Statistik' },
  { id: 'settings', label: '⚙️ Setting' },
  { id: 'tools', label: '🧪 Alat' },
];

interface ShellProps {
  current: ViewId;
  onNavigate: (view: ViewId) => void;
  children: ReactNode;
}

export function Shell({ current, onNavigate, children }: ShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 16px',
          borderBottom: '1px solid #333',
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          aria-label="Buka menu"
          style={{ padding: '4px 10px', fontSize: '16px' }}
        >
          ☰
        </button>
        <h1 style={{ fontSize: '16px', margin: 0 }}>Otomation Setting</h1>
      </header>

      {open && (
        <nav
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            padding: '10px 16px',
            borderBottom: '1px solid #333',
          }}
        >
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                setOpen(false);
              }}
              style={{
                padding: '6px 12px',
                border: '1px solid #333',
                borderRadius: '6px',
                background: current === item.id ? '#2563eb' : 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '1000px',
          margin: '0 auto',
          padding: '16px',
        }}
      >
        {children}
      </main>
    </div>
  );
}