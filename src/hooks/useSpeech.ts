import { useState, useCallback, useRef } from 'react';
import Groq from 'groq-sdk';

// Reuse the module-level client (same key, no second instance needed)
const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY as string,
  dangerouslyAllowBrowser: true,
});

const SPEECH_THRESHOLD = 18;   // 0–255 RMS above which we consider speech active
const SILENCE_MS       = 1800; // ms of silence after speech before auto-stop
const MIN_RECORD_MS    = 600;  // don't trigger silence detection before this

// ── PlayAI TTS via Groq ───────────────────────────────────────────────
// Browse available voices at https://console.groq.com/docs/speech-text
const TTS_MODEL = 'playai-tts';
const TTS_VOICE = 'Celeste-PlayAI'; // calm, clear female voice

export type SpeechHook = {
  /** Empty while recording, 'PROCESSING…' while transcribing. */
  liveTranscript: string;
  isListening: boolean;
  isSpeaking: boolean;
  /** Start recording. onResult is called once with the transcript when done. */
  startListening: (onResult: (text: string) => void) => void;
  /** Stop recording early — still transcribes and calls onResult. */
  stopListening: () => void;
  speak: (text: string) => void;
  cancelSpeech: () => void;
  supported: boolean;
};

export function useSpeech(): SpeechHook {
  const [isListening, setIsListening]     = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isSpeaking, setIsSpeaking]       = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  // Prevents double-stop from both silence timer and manual click
  const stoppedRef  = useRef(false);

  // TTS playback refs — Web Audio API gives clean start/stop control
  const ttsCtxRef    = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const supported = 'mediaDevices' in navigator;

  const startListening = useCallback(async (onResult: (text: string) => void) => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      console.warn('Microphone access denied.');
      return;
    }

    stoppedRef.current = false;
    const chunks: Blob[] = [];

    // ── Silence detection via Web Audio API ───────────────────────────
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    audioCtx.createMediaStreamSource(stream).connect(analyser);

    const freq = new Uint8Array(analyser.frequencyBinCount);
    let speechDetected = false;
    let silenceStart   = 0;
    let rafId          = 0;
    const sessionStart = Date.now();

    const tick = () => {
      if (stoppedRef.current) return;
      analyser.getByteFrequencyData(freq);
      const rms = Math.sqrt(freq.reduce((s, v) => s + v * v, 0) / freq.length);

      if (rms > SPEECH_THRESHOLD) {
        speechDetected = true;
        silenceStart   = 0;
      } else if (speechDetected && Date.now() - sessionStart > MIN_RECORD_MS) {
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart > SILENCE_MS) {
          doStop();
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // ── MediaRecorder ─────────────────────────────────────────────────
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      cancelAnimationFrame(rafId);
      audioCtx.close();
      stream.getTracks().forEach((t) => t.stop()); // release the OS mic indicator

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1000) {                       // too short — ignore
        setIsListening(false);
        setLiveTranscript('');
        return;
      }

      setLiveTranscript('PROCESSING…');
      try {
        const file   = new File([blob], 'recording.webm', { type: blob.type });
        const result = await groq.audio.transcriptions.create({
          file,
          model:    'whisper-large-v3-turbo',
          language: 'en',
        });
        const text = result.text.trim();
        if (text) onResult(text);
      } catch (err) {
        console.error('Whisper transcription error:', err);
      } finally {
        setIsListening(false);
        setLiveTranscript('');
        recorderRef.current = null;
      }
    };

    const doStop = () => {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      if (recorder.state !== 'inactive') recorder.stop();
    };

    recorderRef.current = recorder;
    recorder.start(100); // emit chunks every 100 ms
    setIsListening(true);
    setLiveTranscript('');
  }, []);

  const stopListening = useCallback(() => {
    if (!stoppedRef.current && recorderRef.current?.state !== 'inactive') {
      stoppedRef.current = true;
      recorderRef.current?.stop();
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.stop(); } catch { /* already stopped */ }
      ttsSourceRef.current = null;
    }
    if (ttsCtxRef.current) {
      ttsCtxRef.current.close();
      ttsCtxRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    // Cancel anything currently playing
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.stop(); } catch { /* already stopped */ }
      ttsSourceRef.current = null;
    }
    if (ttsCtxRef.current) {
      ttsCtxRef.current.close();
      ttsCtxRef.current = null;
    }

    setIsSpeaking(true);
    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY as string}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          model:           TTS_MODEL,
          input:           text,
          voice:           TTS_VOICE,
          response_format: 'wav',
        }),
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(`TTS ${response.status}: ${msg}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioCtx    = new AudioContext();
      ttsCtxRef.current = audioCtx;

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source      = audioCtx.createBufferSource();
      source.buffer     = audioBuffer;
      source.connect(audioCtx.destination);
      ttsSourceRef.current = source;

      source.onended = () => {
        setIsSpeaking(false);
        ttsCtxRef.current?.close();
        ttsCtxRef.current    = null;
        ttsSourceRef.current = null;
      };

      source.start();
    } catch (err) {
      console.error('TTS error:', err);
      setIsSpeaking(false);
    }
  }, []);

  return { liveTranscript, isListening, isSpeaking, startListening, stopListening, speak, cancelSpeech, supported };
}
