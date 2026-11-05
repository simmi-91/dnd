import { GAME_COVERS, type GameCover } from '@dnd/shared';
import { useId } from 'react';
import styles from './CoverPicker.module.css';
import { COVER_LABELS, coverStyle } from './covers';

interface CoverPickerProps {
  value: GameCover;
  onChange: (cover: GameCover) => void;
}

export function CoverPicker({ value, onChange }: CoverPickerProps) {
  const name = useId();
  return (
    <fieldset className={styles.picker}>
      <legend className="field__label">Omslag</legend>
      <div className={styles.options}>
        {GAME_COVERS.map((c) => (
          <label key={c} className={styles.option}>
            <input
              type="radio"
              name={name}
              value={c}
              checked={value === c}
              onChange={() => onChange(c)}
              className={styles.radio}
            />
            <span className={styles.swatch} style={coverStyle(c)} aria-hidden="true" />
            <span className={styles.label}>{COVER_LABELS[c]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
