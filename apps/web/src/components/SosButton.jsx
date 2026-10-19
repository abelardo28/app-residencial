import { useState } from 'react';
import { Siren } from 'lucide-react';
import { useStore } from '../data/store';
import { Modal, Button } from './ui';

const KINDS = ['Emergencia médica', 'Intrusión / robo', 'Incendio', 'Violencia', 'Otra emergencia'];

export default function SosButton() {
  const { actions, toast } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn sos-btn sm" onClick={() => setOpen(true)}>
        <Siren size={16} /> SOS
      </button>
      {open && (
        <Modal title="Alerta de emergencia" onClose={() => setOpen(false)}>
          <p className="muted" style={{ marginBottom: 14 }}>
            Se avisará de inmediato a la caseta y a administración con tu domicilio.
          </p>
          <div className="stack">
            {KINDS.map((k) => (
              <Button
                key={k}
                size="lg"
                className="block"
                onClick={() => {
                  setOpen(false);
                  actions.triggerSos(k).then(
                    () => toast('Alerta enviada', 'Vigilancia fue notificada.', 'bad'),
                    () => {},
                  );
                }}
              >
                {k}
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
