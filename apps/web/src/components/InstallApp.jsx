import { useState } from 'react';
import { Download, Share, SquarePlus } from 'lucide-react';
import { useInstall } from '../lib/install';
import { Button, Modal } from './ui';

/** Botón «Instalar app». Sólo aparece si el navegador lo permite o en iPhone/iPad (con instrucciones). */
export default function InstallApp({ className = '', label = 'Instalar app' }) {
  const { mode, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (!mode) return null;
  return (
    <>
      <Button className={className} onClick={() => (mode === 'prompt' ? install() : setHelp(true))}>
        <Download size={16} /> {label}
      </Button>
      {help && (
        <Modal title="Instalar en tu iPhone" onClose={() => setHelp(false)}>
          <ol className="install-steps">
            <li>
              Abre esta página en <b>Safari</b>.
            </li>
            <li>
              Toca <Share size={16} /> <b>Compartir</b> en la barra de abajo.
            </li>
            <li>
              Elige <SquarePlus size={16} /> <b>Agregar a inicio</b> y luego <b>Agregar</b>.
            </li>
          </ol>
          <p className="faint">La app aparecerá en tu pantalla de inicio y se abrirá como una aplicación, sin la barra del navegador.</p>
        </Modal>
      )}
    </>
  );
}
