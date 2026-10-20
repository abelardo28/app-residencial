// Pase para la visita: se abre desde el enlace que el residente reenvía (por ejemplo, desde WhatsApp).
// No necesita sesión: el QR es el propio token firmado y en caseta se valida contra el servidor.
import { useLocation } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { fmtDateTime } from '../lib/utils';

export default function PublicPass() {
  const params = new URLSearchParams(useLocation().search);
  const token = params.get('t') || '';
  const name = (params.get('n') || '').slice(0, 120);
  const exp = Number(token.split('.')[2]) * 1000;
  const valid = token.startsWith('RES1.') && Number.isFinite(exp);
  const expired = valid && exp < Date.now();
  return (
    <div className="login">
      <div className="card pass" style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        {!valid ? (
          <p>Este enlace de pase no es válido. Pide a quien te invitó que te lo envíe de nuevo.</p>
        ) : (
          <>
            <div className="faint">Pase de acceso</div>
            <h2 style={{ margin: '4px 0 14px' }}>{name || 'Visita'}</h2>
            <div style={{ background: '#fff', padding: 16, borderRadius: 16, display: 'inline-block', opacity: expired ? 0.3 : 1 }}>
              <QRCodeCanvas value={token} size={220} level="M" marginSize={0} />
            </div>
            <p style={{ marginTop: 14 }}>{expired ? 'Este pase ya venció.' : 'Muestra este código en la caseta de vigilancia.'}</p>
            <p className="faint">Vence {fmtDateTime(new Date(exp))}</p>
          </>
        )}
      </div>
    </div>
  );
}
