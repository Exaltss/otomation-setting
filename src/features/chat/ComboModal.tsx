/**
 * Modal pembuatan combo custom: nama + pilih model dari semua provider.
 */
import { useMemo, useState } from 'react';
import { createCombo } from '../../services/gatewayClient';

interface ComboModalProps {
  models: string[];
  onClose: () => void;
  onCreated: () => void;
}

export function ComboModal({ models, onClose, onCreated }: ComboModalProps) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(
    () =>
      models.reduce<Record<string, string[]>>((acc, slug) => {
        const prov = slug.split('/')[0];
        (acc[prov] ??= []).push(slug);
        return acc;
      }, {}),
    [models],
  );

  const toggle = (slug: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    try {
      await createCombo(name.trim(), [...picked]);
      onCreated();
    } catch {
      // abaikan; tombol bisa dicoba lagi
    }
    setBusy(false);
  };

  return (
    <div className="g-modal" onMouseDown={onClose}>
      <div className="card" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Buat combo custom</h3>
        <input
          type="text"
          placeholder="Nama combo, mis. Tim Coding Hemat"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="g-cb-list">
          {Object.entries(grouped).map(([prov, list]) => (
            <div key={prov}>
              <div className="g-cb-group">{prov}</div>
              {list.map((slug) => (
                <label key={slug} className="g-cb-item">
                  <input
                    type="checkbox"
                    checked={picked.has(slug)}
                    onChange={() => toggle(slug)}
                  />
                  {slug.split('/').slice(1).join('/')}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="foot">
          <span style={{ marginRight: 'auto', fontSize: 12, opacity: 0.7 }}>
            {picked.size} model terpilih
          </span>
          <button onClick={onClose}>Batal</button>
          <button
            className="primary"
            disabled={!name.trim() || picked.size === 0 || busy}
            onClick={() => void handleCreate()}
          >
            Simpan combo
          </button>
        </div>
      </div>
    </div>
  );
}