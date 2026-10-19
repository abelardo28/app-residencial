import { useEffect, useRef, useState } from 'react';
import { Camera, ScanText, RefreshCw, ImagePlus } from 'lucide-react';
import { compressImage } from '../lib/utils';
import { readPlate } from '../services/ocr';
import { Button, Field } from './ui';

// Toma la foto de la placa, la lee con OCR y llena el campo automáticamente.
// El vigilante siempre puede corregir el texto antes de guardar.
export default function PlateCapture({ plate, onPlate, photo, onPhoto }) {
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [candidates, setCandidates] = useState([]);
  const videoRef = useRef();
  const streamRef = useRef();
  const fileRef = useRef();

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1600 } } });
      streamRef.current = stream;
      setLive(true);
      requestAnimationFrame(() => { videoRef.current.srcObject = stream; videoRef.current.play(); });
    } catch {
      fileRef.current.click(); // sin cámara en vivo: usa la cámara nativa / galería
    }
  }

  function snap() {
    const v = videoRef.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setLive(false);
    handleImage(c.toDataURL('image/jpeg', 0.92));
  }

  async function handleImage(src) {
    const full = typeof src === 'string' ? src : await compressImage(src, 1600, 0.92);
    onPhoto(await compressImage(full, 720, 0.7));
    setBusy(true);
    setProgress(0);
    setCandidates([]);
    try {
      const res = await readPlate(full, (m) => {
        setStage(m.status === 'recognizing text' ? 'Leyendo placa…' : 'Preparando lector…');
        if (typeof m.progress === 'number') setProgress(m.progress);
      });
      setCandidates(res.candidates);
      if (res.plate) onPlate(res.plate);
      setStage(res.plate ? 'Placa detectada. Verifica que sea correcta.' : 'No se reconoció la placa; escríbela manualmente.');
    } catch {
      setStage('No se pudo leer la imagen; escribe la placa manualmente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {live ? (
        <div className="stack">
          <video ref={videoRef} playsInline muted className="photo-preview" style={{ maxHeight: 280 }} />
          <Button variant="primary" onClick={snap}><Camera size={16} /> Tomar foto</Button>
        </div>
      ) : photo ? (
        <img src={photo} alt="Placa" className="photo-preview" />
      ) : null}

      {!live && (
        <div className="row">
          <Button onClick={openCamera}><Camera size={16} /> {photo ? 'Repetir foto' : 'Foto de placa'}</Button>
          <Button variant="ghost" onClick={() => fileRef.current.click()}><ImagePlus size={16} /> Subir imagen</Button>
          {photo && !busy && <Button variant="ghost" onClick={() => handleImage(photo)}><RefreshCw size={16} /> Releer</Button>}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files[0] && handleImage(e.target.files[0])} />

      {(busy || stage) && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row faint"><ScanText size={14} /> {stage}</div>
          {busy && <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        </div>
      )}

      <Field label="Placa">
        <input className="input plate" value={plate} onChange={(e) => onPlate(e.target.value.toUpperCase())} placeholder="ABC-123-D" />
      </Field>
      {candidates.length > 1 && (
        <div className="chips">
          {candidates.map((c) => <button type="button" key={c} className={`chip ${c === plate ? 'on' : ''}`} onClick={() => onPlate(c)}>{c}</button>)}
        </div>
      )}
    </div>
  );
}
