import { useEffect, useRef, useState } from 'react';
import { Modal, ModalHeader } from './Modal.jsx';
import Icon from './Icon.jsx';
import { inp, lbl } from '../styles.js';
import { useAccentColor } from '../lib/AccentColorContext.js';

const MAX_SECONDS = 90;

function pickMimeType() {
  if (!window.MediaRecorder) return '';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VoiceEntryModal({ jobs, onProcess, onDraft, onClose, online }) {
  const accent = useAccentColor();
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const elapsedRef = useRef(0);
  const [state, setState] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [memo, setMemo] = useState('');

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  const canRecord = supported && online && jobs.length > 0 && state !== 'processing';

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function startRecording() {
    if (!canRecord) return;
    setError('');
    setMemo('');
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = e => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        clearInterval(timerRef.current);
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        processRecording(mimeType || recorder.mimeType || 'audio/webm');
      };

      recorder.start();
      elapsedRef.current = 0;
      setElapsed(0);
      setState('recording');
      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1;
          elapsedRef.current = next;
          if (next >= MAX_SECONDS) stopRecording();
          return Math.min(next, MAX_SECONDS);
        });
      }, 1000);
    } catch {
      setError('Microphone access was blocked or unavailable.');
      setState('idle');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  async function processRecording(mimeType) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    if (!blob.size) {
      setError('No audio was captured.');
      setState('idle');
      return;
    }

    setState('processing');
    try {
      const result = await onProcess(blob, { mimeType, elapsedSeconds: elapsedRef.current });
      if (result?.error) {
        setError(result.error.message || 'Could not process the voice note.');
        setState('idle');
        return;
      }
      onDraft(result);
    } catch {
      setError('Could not process the voice note. You can still add the entry manually.');
      setState('idle');
    }
  }

  function submitMemo() {
    if (!memo.trim()) return;
    onDraft({
      session: { notes: memo.trim() },
      transcript: memo.trim(),
      warnings: ['Typed fallback: review job and time before saving.'],
      assumptions: [],
      confidence: { job: 0, date: 0, time: 0, notes: 0.7 },
    });
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Voice Entry" subtitle="Record a work note" onClose={onClose} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ border: `1.5px solid ${state === 'recording' ? accent : '#e8e8e8'}`, borderRadius: 14, padding: 18, background: state === 'recording' ? `${accent}12` : '#fafafa', textAlign: 'center' }}>
          <button
            onClick={state === 'recording' ? stopRecording : startRecording}
            disabled={!canRecord && state !== 'recording'}
            style={{ width: 78, height: 78, borderRadius: '50%', border: 'none', background: state === 'recording' ? '#c0392b' : accent, color: '#fff', cursor: canRecord || state === 'recording' ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: canRecord || state === 'recording' ? 1 : 0.45 }}
            aria-label={state === 'recording' ? 'Stop recording' : 'Start recording'}
          >
            <Icon name={state === 'recording' ? 'stop' : 'mic'} size={28} />
          </button>
          <div style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: '#111', fontFamily: "'DM Mono', monospace" }}>{fmtTime(elapsed)}</div>
          <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
            {state === 'recording' ? 'Tap stop when you are done.' : state === 'processing' ? 'Turning this into an entry...' : `Up to ${MAX_SECONDS} seconds`}
          </div>
        </div>

        {!supported && <div style={{ color: '#c0392b', fontSize: 12, padding: '10px 12px', background: '#fde8e8', borderRadius: 8 }}>This browser does not support audio recording.</div>}
        {!online && <div style={{ color: '#c87020', fontSize: 12, padding: '10px 12px', background: '#fff8f0', borderRadius: 8 }}>Voice processing needs internet. Manual entries still work offline.</div>}
        {jobs.length === 0 && <div style={{ color: '#c87020', fontSize: 12, padding: '10px 12px', background: '#fff8f0', borderRadius: 8 }}>Add an active job before using voice entries.</div>}
        {error && <div style={{ color: '#c0392b', fontSize: 12, padding: '10px 12px', background: '#fde8e8', borderRadius: 8 }}>{error}</div>}

        <div>
          <label style={lbl}>Fallback note</label>
          <textarea
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder="Type what you would have said..."
            style={{ ...inp, minHeight: 76, resize: 'vertical' }}
          />
        </div>
        <button
          onClick={submitMemo}
          disabled={!memo.trim() || state === 'processing' || state === 'recording'}
          style={{ padding: '12px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', background: memo.trim() ? '#fff' : '#f4f4f4', color: memo.trim() ? '#333' : '#aaa', cursor: memo.trim() ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700 }}
        >
          Review Typed Note
        </button>
      </div>
    </Modal>
  );
}
