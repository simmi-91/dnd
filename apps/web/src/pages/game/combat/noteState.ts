import { useState, type Dispatch, type SetStateAction } from 'react';

export interface NoteState {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  done: { number: number; text: string }[];
  setDone: Dispatch<SetStateAction<{ number: number; text: string }[]>>;
}

/** Teksten og lista over sendte notater bor i `RoundView`, så de overlever at bredden krysser 1100 px. */
export function useNoteState(): NoteState {
  const [text, setText] = useState('');
  const [done, setDone] = useState<NoteState['done']>([]);
  return { text, setText, done, setDone };
}
