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
      return {
        ...state,
        history: [...state.history, { role: 'user', content: action.content }],
        isStreaming: true,
        streaming: '',
      };
    case 'STREAM_CHUNK':
      return { ...state, streaming: state.streaming + action.chunk };
    case 'STREAM_DONE':
      return {
        history: [...state.history, { role: 'assistant', content: action.full }],
        streaming: '',
        isStreaming: false,
      };
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
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(year, 0, 0).getTime()) / 86_400_000,
  );
  const base = (year - 2000 + 55) * 1000 + Math.floor((dayOfYear / 365) * 1000);
  return `${base}.${now.getHours()}`;
}

// ── Sidebar blocks ─────────────────────────────────────────────────────

const SIDEBAR_BLOCKS: { color: string; height: number }[] = [
  { color: '#ff9900', height: 28 },
  { color: '#9966cc', height: 60 },
  { color: '#ff9900', height: 22 },
  { color: '#cc6699', height: 44 },
  { color: '#ff9900', height: 28 },
  { color: '#5577bb', height: 76 },
  { color: '#ff9900', height: 22 },
  { color: '#9966cc', height: 44 },
  { color: '#ff9900', height: 28 },
  { color: '#cc7733', height: 52 },
];

// ── Component ──────────────────────────────────────────────────────────

export function LCARSTerminal() {
  const [state, dispatch] = useReducer(reducer, {
    history: [],
    streaming: '',
    isStreaming: false,
  });
  const [input, setInput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { streamCompletion } = useGroqStream();
  const { transcript, isListening, isSpeaking, startListening, stopListening, speak, cancelSpeech, supported } =
    useSpeech();

  // Auto-scroll on new content
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [state.history, state.streaming]);

  // Feed speech transcript into the input field
  useEffect(() => {
    if (transcript) setInput(transcript);
  }, [transcript]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || state.isStreaming) return;

    setInput('');
    dispatch({ type: 'USER_MESSAGE', content: text });

    const newHistory: Message[] = [...state.history, { role: 'user', content: text }];
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
  }, [input, state.history, state.isStreaming, streamCompletion, speak]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="lcars">
      {/* ── Header row ── */}
      <div className="lcars-elbow-top" />
      <div className="lcars-header-bar">
        <span className="lcars-title">LCARS COMPUTER TERMINAL</span>
        <span className="lcars-stardate">STARDATE {getStardate()}</span>
      </div>

      {/* ── Sidebar ── */}
      <div className="lcars-sidebar">
        {SIDEBAR_BLOCKS.map((b, i) => (
          <div key={i} className="lcars-block" style={{ background: b.color, height: b.height }} />
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
            <span className="lcars-message-label">
              {msg.role === 'user' ? 'OPERATOR' : 'LCARS'}
            </span>
            <span className="lcars-message-content">{msg.content}</span>
          </div>
        ))}

        {state.isStreaming && (
          <div className="lcars-message lcars-message--assistant">
            <span className="lcars-message-label">LCARS</span>
            <span className="lcars-message-content">
              {state.streaming}
              <span className="lcars-cursor">▌</span>
            </span>
          </div>
        )}
      </div>

      {/* ── Footer row ── */}
      <div className="lcars-elbow-bottom" />
      <div className="lcars-input-bar">
        <button
          className={`lcars-btn lcars-btn--mic${isListening ? ' lcars-btn--active' : ''}`}
          onClick={isListening ? stopListening : startListening}
          disabled={!supported || state.isStreaming}
          title={supported ? (isListening ? 'Stop listening' : 'Voice input') : 'Voice not supported'}
          aria-label="Voice input"
        >
          {isListening ? '◉' : '🎤'}
        </button>

        <input
          className="lcars-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ENTER QUERY..."
          disabled={state.isStreaming}
          autoFocus
          spellCheck={false}
        />

        {isSpeaking && (
          <button
            className="lcars-btn lcars-btn--cancel"
            onClick={cancelSpeech}
            title="Cancel speech output"
            aria-label="Cancel speech"
          >
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
    </div>
  );
}
