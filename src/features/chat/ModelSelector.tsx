/**
 * Model selector gaya Gemini:
 * atas = Auto Fusion (semua + per provider) + Combo custom,
 * bawah = semua model dari semua API key.
 */
import { useEffect, useRef, useState } from 'react';
import {
  deleteCombo,
  fetchCombos,
  type Combo,
  type ProviderInfo,
} from '../../services/gatewayClient';
import { ComboModal } from './ComboModal';

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  models: string[];
  providers: ProviderInfo[];
}

export function ModelSelector({ value, onChange, models, providers }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const activeProviders = providers.filter((p) => p.hasKey && p.enabled);

  const loadCombos = () => {
    fetchCombos()
      .then(setCombos)
      .catch(() => {});
  };

  useEffect(() => {
    loadCombos();
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const labelOf = (v: string): string => {
    if (v === 'auto') return '✨ Auto Fusion · semua provider';
    if (v.startsWith('fusion:')) return `✨ Auto Fusion · ${v.slice(7)}`;
    if (v.startsWith('combo:')) {
      const c = combos.find((x) => x.id === v.slice(6));
      return c ? `🎯 ${c.name}` : '🎯 Combo';
    }
    return `🤖 ${v.split('/').slice(1).join('/')}`;
  };

  const grouped = models.reduce<Record<string, string[]>>((acc, slug) => {
    const prov = slug.split('/')[0];
    (acc[prov] ??= []).push(slug);
    return acc;
  }, {});

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button className="g-modelbtn" onClick={() => setOpen((o) => !o)}>
        {labelOf(value)} ▾
      </button>

      {open && (
        <div className="g-modelmenu">
          <div className="g-mm-head">Auto Fusion</div>
          <button
            className={`g-mm-item ${value === 'auto' ? 'sel' : ''}`}
            onClick={() => { onChange('auto'); setOpen(false); }}
          >
            ✨ Auto Fusion · semua provider
          </button>
          {activeProviders.map((p) => (
            <button
              key={p.id}
              className={`g-mm-item ${value === `fusion:${p.id}` ? 'sel' : ''}`}
              onClick={() => { onChange(`fusion:${p.id}`); setOpen(false); }}
            >
              ✨ Auto Fusion · {p.id}
            </button>
          ))}

          <div className="g-mm-head">Combo custom</div>
          {combos.map((c) => (
            <div key={c.id} className={`g-mm-item ${value === `combo:${c.id}` ? 'sel' : ''}`}>
              <button
                style={{ all: 'unset', flex: 1, cursor: 'pointer' }}
                onClick={() => { onChange(`combo:${c.id}`); setOpen(false); }}
              >
                🎯 {c.name} ({c.models.length} model)
              </button>
              <button
                className="del"
                title="hapus combo"
                onClick={() => {
                  deleteCombo(c.id).then(loadCombos);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="g-mm-item g-mm-create"
            onClick={() => { setShowCreate(true); setOpen(false); }}
          >
            ＋ Buat combo baru…
          </button>

          <div className="g-mm-head">Semua model</div>
          {Object.entries(grouped).map(([prov, list]) => (
            <div key={prov}>
              <div className="g-mm-sub">{prov}</div>
              {list.map((slug) => (
                <button
                  key={slug}
                  className={`g-mm-item ${value === slug ? 'sel' : ''}`}
                  onClick={() => { onChange(slug); setOpen(false); }}
                >
                  {slug.split('/').slice(1).join('/')}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <ComboModal
          models={models}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            loadCombos();
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}