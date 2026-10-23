import { useCallback, useReducer, useState } from 'react';
import { clamp, durationOf } from './timeline.js';

export function historyReducer(state, action) {
  if (action.type === 'reset') return { present: action.doc, past: [], future: [], gesture: null };
  if (action.type === 'begin') return { ...state, gesture: state.present, group: null };
  if (action.type === 'cancel') return { ...state, present: state.gesture ?? state.present, gesture: null };
  if (action.type === 'end') return state.gesture && state.gesture !== state.present
    ? { ...state, past: [...state.past.slice(-99), state.gesture], future: [], gesture: null }
    : { ...state, gesture: null };
  if (action.type === 'undo') {
    if (!state.past.length || state.gesture) return state;
    return { present: state.past.at(-1), past: state.past.slice(0, -1), future: [state.present, ...state.future], gesture: null };
  }
  if (action.type === 'redo') {
    if (!state.future.length || state.gesture) return state;
    return { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1), gesture: null };
  }
  if (action.type !== 'edit') return state;
  const next = action.update(state.present);
  if (next === state.present || JSON.stringify(next) === JSON.stringify(state.present)) return state;
  if (state.gesture) return { ...state, present: next };
  const grouped = action.group && action.group === state.group && action.now - state.lastEdit < 700;
  return { present: next, past: grouped ? state.past : [...state.past.slice(-99), state.present],
    future: [], gesture: null, group: action.group, lastEdit: action.now };
}
export default function useTimelineState(initial) {
  const [history, dispatch] = useReducer(historyReducer, { present: initial, past: [], future: [], gesture: null });
  const [time, setTime] = useState(0);
  const [zoom, setZoom] = useState(64);
  const duration = durationOf(history.present);
  const currentTime = clamp(time, 0, duration);
  const edit = useCallback((update, group) => dispatch({ type: 'edit', update, group, now: Date.now() }), []);
  return { document: history.present, edit, currentTime, setCurrentTime: setTime, zoom, setZoom, duration,
    undo: useCallback(() => dispatch({ type: 'undo' }), []), redo: useCallback(() => dispatch({ type: 'redo' }), []),
    canUndo: !!history.past.length, canRedo: !!history.future.length,
    beginGesture: useCallback(() => dispatch({ type: 'begin' }), []),
    endGesture: useCallback(() => dispatch({ type: 'end' }), []),
    cancelGesture: useCallback(() => dispatch({ type: 'cancel' }), []),
  };
}
