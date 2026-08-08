'use client';

import { useRef, useState, useEffect } from 'react';

interface Props {
  url: string;
  onSave: (newUrl: string) => void;
  onClose: () => void;
}

const PREVIEW_W = 216;
const PREVIEW_H = 384; // 9:16
const OUTPUT_W  = 1080;
const OUTPUT_H  = 1920;

export default function VideoEditorModal({ url, onSave, onClose }: Props) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const previewRef    = useRef<HTMLDivElement>(null);
  const dragRef       = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const [offsetX, setOffsetX]     = useState(0);
  const [offsetY, setOffsetY]     = useState(0);
  const [scale, setScale]         = useState(1);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd]     = useState(0);   // 0 = full duration
  const [duration, setDuration]   = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress]   = useState(0);   // 0-100
  const [playing, setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => { setDuration(v.duration); setTrimEnd(v.duration); };
    const onTime = () => setCurrentTime(v.currentTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    return () => { v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('timeupdate', onTime); };
  }, []);

  // Clamp playback within trim window
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime < trimStart) v.currentTime = trimStart;
    if (trimEnd > 0 && v.currentTime > trimEnd) { v.pause(); v.currentTime = trimStart; setPlaying(false); }
  }, [currentTime, trimStart, trimEnd]);

  function autoFit() {
    setOffsetX(0);
    setOffsetY(0);
    // Scale to fill the 9:16 frame with the video (cover)
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) { setScale(1); return; }
    const videoAspect = v.videoWidth / v.videoHeight;
    const frameAspect = PREVIEW_W / PREVIEW_H; // 9:16
    if (videoAspect > frameAspect) {
      // Landscape → scale to height, crop sides
      setScale(PREVIEW_H / (PREVIEW_W / videoAspect));
    } else {
      // Portrait → scale to width
      setScale(1);
    }
  }

  // Auto-fit on load
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => autoFit();
    v.addEventListener('loadedmetadata', onReady);
    return () => v.removeEventListener('loadedmetadata', onReady);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else {
      if (v.currentTime < trimStart || (trimEnd > 0 && v.currentTime >= trimEnd)) v.currentTime = trimStart;
      v.play(); setPlaying(true);
    }
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const trimDuration = (trimEnd || duration) - trimStart;

  async function processAndUpload() {
    const v = videoRef.current;
    if (!v) return;
    setProcessing(true);
    setProgress(0);

    try {
      // Build crop params relative to output canvas
      const displayVideoW = PREVIEW_W * scale;
      const displayVideoH = (PREVIEW_W / (v.videoWidth || PREVIEW_W) * (v.videoHeight || PREVIEW_H)) * scale;
      const imgLeft = (PREVIEW_W - displayVideoW) / 2 + offsetX;
      const imgTop  = (PREVIEW_H - displayVideoH) / 2 + offsetY;

      const scaleX = v.videoWidth  / displayVideoW;
      const scaleY = v.videoHeight / displayVideoH;
      const srcX = Math.max(0, -imgLeft * scaleX);
      const srcY = Math.max(0, -imgTop  * scaleY);
      const srcW = Math.min(v.videoWidth  - srcX, PREVIEW_W  * scaleX);
      const srcH = Math.min(v.videoHeight - srcY, PREVIEW_H * scaleY);

      const canvas = document.createElement('canvas');
      canvas.width  = OUTPUT_W;
      canvas.height = OUTPUT_H;
      const ctx = canvas.getContext('2d')!;

      // Capture streams — canvas video + original audio
      const canvasStream = canvas.captureStream(30);
      let combinedStream: MediaStream = canvasStream;
      try {
        const videoStream = (v as any).captureStream?.() as MediaStream | undefined;
        if (videoStream) {
          const audioTracks = videoStream.getAudioTracks();
          if (audioTracks.length) {
            combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
          }
        }
      } catch { /* no audio */ }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

      const endTime = trimEnd > 0 ? trimEnd : duration;
      const totalDuration = endTime - trimStart;

      await new Promise<void>((resolve, reject) => {
        recorder.onerror = reject;
        recorder.onstop = () => resolve();
        recorder.start(100);

        v.currentTime = trimStart;
        v.play();

        function drawFrame() {
          if (!v) return;
          const elapsed = v.currentTime - trimStart;
          setProgress(Math.min(99, Math.round((elapsed / totalDuration) * 100)));

          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);
          ctx.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_W, OUTPUT_H);

          if (v.currentTime >= endTime - 0.05 || v.ended) {
            v.pause();
            recorder.stop();
          } else {
            requestAnimationFrame(drawFrame);
          }
        }
        requestAnimationFrame(drawFrame);
      });

      setProgress(100);
      const blob = new Blob(chunks, { type: 'video/webm' });

      // Upload via signed URL
      const signRes = await fetch('/api/crm/social/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'short.webm', contentType: 'video/webm', size: blob.size }),
      });
      const signData = await signRes.json();
      if (!signRes.ok || !signData.signedUrl) throw new Error(signData.error || 'Upload prep failed');

      const putRes = await fetch(signData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/webm' },
        body: blob,
      });
      if (!putRes.ok) throw new Error('Storage upload failed');

      onSave(signData.publicUrl);
    } catch (e) {
      alert(`Processing failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 18, padding: 24, width: 460, maxWidth: '96vw', maxHeight: '96vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,.55)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Edit for YouTube Shorts</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Crop to 9:16 · Trim · Drag to reposition</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={autoFit}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #C9A84C', background: '#fffbeb', fontSize: 11, fontWeight: 700, color: '#92400e', cursor: 'pointer' }}
            >
              ✨ Auto-Fit
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
          </div>
        </div>

        {/* 9:16 Preview */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div
            ref={previewRef}
            style={{
              width: PREVIEW_W, height: PREVIEW_H,
              overflow: 'hidden', borderRadius: 12,
              background: '#000', position: 'relative',
              cursor: 'grab', userSelect: 'none', touchAction: 'none',
              outline: '3px solid #FF0000',
            }}
            onPointerDown={e => {
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offsetX, oy: offsetY };
            }}
            onPointerMove={e => {
              if (!dragRef.current) return;
              setOffsetX(dragRef.current.ox + (e.clientX - dragRef.current.sx));
              setOffsetY(dragRef.current.oy + (e.clientY - dragRef.current.sy));
            }}
            onPointerUp={() => { dragRef.current = null; }}
            onWheel={e => {
              e.preventDefault();
              setScale(prev => Math.min(4, Math.max(0.3, prev - e.deltaY * 0.001)));
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              src={url}
              crossOrigin="anonymous"
              playsInline
              preload="metadata"
              style={{
                position: 'absolute',
                width: `${PREVIEW_W * scale}px`,
                top: '50%', left: '50%',
                transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`,
                pointerEvents: 'none',
                maxWidth: 'none',
              }}
            />
            {/* Play/pause overlay */}
            <button
              onClick={togglePlay}
              style={{
                position: 'absolute', bottom: 8, right: 8, zIndex: 2,
                background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                width: 32, height: 32, color: '#fff', fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {playing ? '⏸' : '▶'}
            </button>
            {/* 9:16 label */}
            <div style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4 }}>
              9:16
            </div>
          </div>
        </div>

        {/* Zoom */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 }}>Zoom</label>
            <span style={{ fontSize: 11, color: '#6b7280' }}>{Math.round(scale * 100)}%</span>
          </div>
          <input type="range" min={30} max={400} value={Math.round(scale * 100)} onChange={e => setScale(Number(e.target.value) / 100)} style={{ width: '100%', accentColor: '#FF0000' }} />
        </div>

        {/* Trim */}
        {duration > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 }}>Trim</label>
              <span style={{ fontSize: 11, color: trimDuration > 60 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                {fmt(trimStart)} → {fmt(trimEnd || duration)} · {fmt(trimDuration)}
                {trimDuration > 60 && ' ⚠️ over 60s'}
              </span>
            </div>
            <div style={{ position: 'relative', height: 36, background: '#f3f4f6', borderRadius: 8, overflow: 'hidden' }}>
              {/* Progress bar */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(currentTime / duration) * 100}%`, width: 2, background: '#FF0000', zIndex: 3 }} />
              {/* Active range */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0, background: '#fecaca',
                left: `${(trimStart / duration) * 100}%`,
                width: `${((trimEnd || duration) - trimStart) / duration * 100}%`,
              }} />
              {/* Start handle */}
              <input
                type="range" min={0} max={duration} step={0.1} value={trimStart}
                onChange={e => { const v = Number(e.target.value); setTrimStart(Math.min(v, (trimEnd || duration) - 0.5)); if (videoRef.current) videoRef.current.currentTime = v; }}
                style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', zIndex: 4, height: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 3 }}>Start</label>
                <input
                  type="range" min={0} max={duration} step={0.1} value={trimStart}
                  onChange={e => { const v = Number(e.target.value); setTrimStart(Math.min(v, (trimEnd || duration) - 0.5)); if (videoRef.current) videoRef.current.currentTime = v; }}
                  style={{ width: '100%', accentColor: '#1a1a2e' }}
                />
                <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center' }}>{fmt(trimStart)}</div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 3 }}>End</label>
                <input
                  type="range" min={0} max={duration} step={0.1} value={trimEnd || duration}
                  onChange={e => { const v = Number(e.target.value); setTrimEnd(Math.max(v, trimStart + 0.5)); if (videoRef.current) videoRef.current.currentTime = v; }}
                  style={{ width: '100%', accentColor: '#1a1a2e' }}
                />
                <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center' }}>{fmt(trimEnd || duration)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Processing progress */}
        {processing && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Processing…</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{progress}%</span>
            </div>
            <div style={{ height: 6, background: '#f3f4f6', borderRadius: 4 }}>
              <div style={{ height: '100%', background: '#FF0000', borderRadius: 4, width: `${progress}%`, transition: 'width .2s' }} />
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 5 }}>Rendering and uploading — do not close this window</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { setOffsetX(0); setOffsetY(0); setScale(1); setTrimStart(0); setTrimEnd(duration); autoFit(); }}
            style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1.5px solid #e5e7eb', background: '#f9fafb', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6b7280' }}
          >
            Reset
          </button>
          <button
            onClick={processAndUpload}
            disabled={processing}
            style={{
              flex: 2, padding: '10px', borderRadius: 9, border: 'none',
              background: processing ? '#d1d5db' : '#FF0000',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: processing ? 'not-allowed' : 'pointer',
            }}
          >
            {processing ? `Processing… ${progress}%` : '▶️ Process & Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
