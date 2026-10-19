import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Escáner de QR con la cámara trasera. Llama a onScan una sola vez por lectura.
export default function QrScanner({ onScan }) {
  const id = useRef('qr-' + Math.random().toString(36).slice(2));
  const cb = useRef(onScan);
  cb.current = onScan;
  const [error, setError] = useState('');

  useEffect(() => {
    const scanner = new Html5Qrcode(id.current, { verbose: false });
    let started = false;
    let last = '';
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (text) => {
          if (text === last) return;
          last = text;
          setTimeout(() => (last = ''), 3000);
          cb.current(text);
        },
        () => {},
      )
      .then(() => {
        started = true;
      })
      .catch(() => setError('No se pudo abrir la cámara. Revisa los permisos o escribe el código manualmente.'));
    return () => {
      if (started)
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
    };
  }, []);

  return (
    <div>
      <div id={id.current} className="scanner" />
      {error && (
        <p className="faint" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
