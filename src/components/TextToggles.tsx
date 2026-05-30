import type { Toggles, TrackKey } from '../types'

interface Props {
  toggles: Toggles
  onToggle: (key: TrackKey) => void
}

const LABELS: Record<TrackKey, string> = {
  fr: 'FR',
  pt: 'PT',
}

export default function TextToggles({ toggles, onToggle }: Props) {
  return (
    <div className="toggles">
      {(Object.keys(LABELS) as TrackKey[]).map((key) => (
        <button
          key={key}
          className={`chip ${toggles[key] ? 'chip-on' : ''}`}
          aria-pressed={toggles[key]}
          onClick={() => onToggle(key)}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  )
}
