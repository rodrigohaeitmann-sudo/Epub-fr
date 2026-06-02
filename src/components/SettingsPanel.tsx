import type { Settings } from '../types'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
  onClose: () => void
}

const SCALES: { label: string; value: number }[] = [
  { label: 'Pequeno', value: 0.85 },
  { label: 'Médio', value: 1 },
  { label: 'Grande', value: 1.2 },
  { label: 'Enorme', value: 1.4 },
]

const FONTS: { label: string; value: Settings['fontFamily'] }[] = [
  { label: 'Padrão', value: 'system' },
  { label: 'Serifada', value: 'serif' },
  { label: 'Mono', value: 'mono' },
]

const SPEED_MIN = 0.6
const SPEED_MAX = 2
const SPEED_STEP = 0.05

// Snap to the nearest 0.05 and clamp, avoiding floating-point drift.
function normalizeSpeed(v: number): number {
  const snapped = Math.round(v / SPEED_STEP) * SPEED_STEP
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, snapped))
  return Math.round(clamped * 100) / 100
}

// 0.6 -> "0,6×", 1 -> "1×", 1.25 -> "1,25×"
function formatSpeed(v: number): string {
  return `${v.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}×`
}

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Configurações</h2>
          <button className="close-btn" aria-label="Fechar" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="setting">
          <span className="setting-label">Tamanho da fonte</span>
          <div className="opt-row">
            {SCALES.map((o) => (
              <button
                key={o.value}
                className={`opt ${settings.fontScale === o.value ? 'opt-on' : ''}`}
                onClick={() => set({ fontScale: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <span className="setting-label">Fonte</span>
          <div className="opt-row">
            {FONTS.map((o) => (
              <button
                key={o.value}
                className={`opt ${settings.fontFamily === o.value ? 'opt-on' : ''}`}
                onClick={() => set({ fontFamily: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <span className="setting-label">
            Velocidade do áudio
            <span className="setting-value">{formatSpeed(settings.speed)}</span>
          </span>
          <div className="speed-row">
            <button
              className="speed-btn"
              aria-label="Diminuir velocidade"
              disabled={settings.speed <= SPEED_MIN}
              onClick={() => set({ speed: normalizeSpeed(settings.speed - SPEED_STEP) })}
            >
              −
            </button>
            <input
              className="speed-slider"
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={settings.speed}
              aria-label="Velocidade do áudio"
              onChange={(e) => set({ speed: normalizeSpeed(Number(e.target.value)) })}
            />
            <button
              className="speed-btn"
              aria-label="Aumentar velocidade"
              disabled={settings.speed >= SPEED_MAX}
              onClick={() => set({ speed: normalizeSpeed(settings.speed + SPEED_STEP) })}
            >
              +
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
