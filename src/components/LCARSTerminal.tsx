import { useReducer, useRef, useEffect, useState, useCallback } from 'react';
import { useGroqStream } from '../hooks/useGroqStream';
import { useSpeech } from '../hooks/useSpeech';
import './LCARSTerminal.css';

// ── Types ──────────────────────────────────────────────────────────────

type Message = { role: 'user' | 'assistant'; content: string };

type State = {
  history: Message[];
  streaming: string;
  isStreaming: boolean;
};

type Action =
  | { type: 'USER_MESSAGE'; content: string }
  | { type: 'STREAM_CHUNK'; chunk: string }
  | { type: 'STREAM_DONE'; full: string }
  | { type: 'CLEAR' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'USER_MESSAGE':
      return { ...state, history: [...state.history, { role: 'user', content: action.content }], isStreaming: true, streaming: '' };
    case 'STREAM_CHUNK':
      return { ...state, streaming: state.streaming + action.chunk };
    case 'STREAM_DONE':
      return { history: [...state.history, { role: 'assistant', content: action.full }], streaming: '', isStreaming: false };
    case 'CLEAR':
      return { history: [], streaming: '', isStreaming: false };
    default:
      return state;
  }
}

// ── Stardate ───────────────────────────────────────────────────────────

function getStardate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor((now.getTime() - new Date(year, 0, 0).getTime()) / 86_400_000);
  const base = (year - 2000 + 55) * 1000 + Math.floor((dayOfYear / 365) * 1000);
  return `${base}.${now.getHours()}`;
}

// ── Sidebar blocks ─────────────────────────────────────────────────────

const SIDEBAR_BLOCKS: { color: string; height: number; label?: string }[] = [
  { color: '#ff9900', height: 44, label: 'HELM' },
  { color: '#ff9900', height: 14 },
  { color: '#9966cc', height: 56, label: 'TACTICAL' },
  { color: '#ff9900', height: 14 },
  { color: '#cc6699', height: 44, label: 'COMMS' },
  { color: '#ff9900', height: 14 },
  { color: '#5577bb', height: 64, label: 'ENGINEERING' },
  { color: '#ff9900', height: 14 },
  { color: '#9966cc', height: 44, label: 'SENSORS' },
  { color: '#ff9900', height: 14 },
  { color: '#cc7733', height: 56, label: 'SCIENCE' },
  { color: '#ff9900', height: 14 },
  { color: '#4499cc', height: 44, label: 'MEDICAL' },
  { color: '#ff9900', height: 14 },
  { color: '#cc4444', height: 44, label: 'SECURITY' },
];

// ── Waveform bar heights (px) for the live voice animation ─────────────

const WAVE_HEIGHTS = [8, 22, 14, 30, 10, 26, 18, 32, 12, 24, 16, 28, 10, 20];

// ── Component ──────────────────────────────────────────────────────────

export function LCARSTerminal() {
  const [state, dispatch] = useReducer(reducer, { history: [], streaming: '', isStreaming: false });
  const [input, setInput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { streamCompletion } = useGroqStream();
  const { liveTranscript, isListening, isSpeaking, startListening, stopListening, speak, cancelSpeech, supported } =
    useSpeech();

  // Auto-scroll whenever output changes
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [state.history, state.streaming]);

  // Core submit — accepts text directly so both keyboard and voice can call it
  const submitText = useCallback(async (text: string) => {
    if (!text.trim() || state.isStreaming) return;

    dispatch({ type: 'USER_MESSAGE', content: text.trim() });
    const newHistory: Message[] = [...state.history, { role: 'user', content: text.trim() }];

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    let fullResponse = '';

    try {
      await streamCompletion(
        newHistory,
        (chunk) => {
          fullResponse += chunk;
          dispatch({ type: 'STREAM_CHUNK', chunk });
        },
        abortRef.current.signal,
      );
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        fullResponse = '[ERROR: Unable to reach LCARS core systems.]';
        dispatch({ type: 'STREAM_CHUNK', chunk: fullResponse });
      }
    } finally {
      dispatch({ type: 'STREAM_DONE', full: fullResponse });
      if (fullResponse) speak(fullResponse);
    }
  }, [state.history, state.isStreaming, streamCompletion, speak]);

  const handleSubmit = useCallback(() => {
    submitText(input);
    setInput('');
  }, [input, submitText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }, [handleSubmit]);

  // ── Mic button ────────────────────────────────────────────────────────
  const handleMicClick = useCallback(() => {
    if (isListening) {
      // Early stop — onstop still transcribes and auto-submits
      stopListening();
    } else {
      startListening((text) => submitText(text));
    }
  }, [isListening, startListening, stopListening, submitText]);

  // Stop listening as soon as we start streaming a response
  useEffect(() => {
    if (state.isStreaming && isListening) stopListening();
  }, [state.isStreaming, isListening, stopListening]);

  return (
    <div className="lcars">
      {/* ── Header ── */}
      <div className="lcars-elbow-top" />
      <div className="lcars-header-bar">
        <span className="lcars-title">LCARS COMPUTER TERMINAL</span>
        <span className="lcars-stardate">STARDATE {getStardate()}</span>
      </div>

      {/* ── Sidebar ── */}
      <div className="lcars-sidebar">
        {SIDEBAR_BLOCKS.map((b, i) => (
          <div key={i} className="lcars-block" style={{ background: b.color, height: b.height }}>
            {b.label && <span className="lcars-block-label">{b.label}</span>}
          </div>
        ))}
        <div className="lcars-sidebar-spacer" />
      </div>

      {/* ── Output ── */}
      <div className="lcars-output" ref={outputRef}>
        {state.history.length === 0 && !state.isStreaming && (
          <p className="lcars-welcome">
            LCARS ONLINE<br />
            STARFLEET DATABASE ACCESS: GRANTED<br />
            AWAITING QUERY
          </p>
        )}
        {state.history.map((msg, i) => (
          <div key={i} className={`lcars-message lcars-message--${msg.role}`}>
            <span className="lcars-message-label">{msg.role === 'user' ? 'OPERATOR' : 'LCARS'}</span>
            <span className="lcars-message-content">{msg.content}</span>
          </div>
        ))}
        {state.isStreaming && (
          <div className="lcars-message lcars-message--assistant">
            <span className="lcars-message-label">LCARS</span>
            <span className="lcars-message-content">
              {state.streaming}<span className="lcars-cursor">▌</span>
            </span>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="lcars-elbow-bottom" />

      {isListening ? (
        /* ── Live voice mode ── */
        <div className="lcars-input-bar lcars-input-bar--listening">
          <div className="lcars-waveform" aria-hidden="true">
            {WAVE_HEIGHTS.map((h, i) => (
              <div
                key={i}
                className="lcars-waveform-bar"
                style={{ '--max-h': `${h}px`, animationDelay: `${i * 0.07}s` } as React.CSSProperties}
              />
            ))}
          </div>
          <span className="lcars-live-transcript">
            {liveTranscript || 'LISTENING…'}
          </span>
          <button className="lcars-btn lcars-btn--stop" onClick={handleMicClick}>
            STOP
          </button>
        </div>
      ) : (
        /* ── Normal input mode ── */
        <div className="lcars-input-bar">
          <button
            className="lcars-btn lcars-btn--mic"
            onClick={handleMicClick}
            disabled={!supported || state.isStreaming}
            title={supported ? 'Voice input' : 'Voice not supported in this browser'}
            aria-label="Voice input"
          >
            🎤
          </button>
          <input
            className="lcars-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ENTER QUERY…"
            disabled={state.isStreaming}
            autoFocus
            spellCheck={false}
          />
          {isSpeaking && (
            <button className="lcars-btn lcars-btn--cancel" onClick={cancelSpeech} aria-label="Cancel speech">
              ◼
            </button>
          )}
          <button
            className="lcars-btn lcars-btn--send"
            onClick={handleSubmit}
            disabled={!input.trim() || state.isStreaming}
          >
            TRANSMIT
          </button>
        </div>
      )}
    </div>
  );
}
