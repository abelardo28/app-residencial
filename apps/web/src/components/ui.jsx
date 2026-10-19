import { useRef, useState } from 'react';
import { X, Upload, FileText, Download } from 'lucide-react';

export const Card = ({ className = '', children, ...p }) => (
  <div className={`card ${className}`} {...p}>
    {children}
  </div>
);

export function CardHead({ title, subtitle, children }) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

// `fab`: acción principal; en celular se muestra como botón flotante sobre la barra inferior.
export function PageHead({ title, subtitle, children, fab, keep }) {
  return (
    <div className={`page-head ${keep ? 'keep' : ''}`}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
      {fab && (
        <button className="fab" onClick={fab.onClick} disabled={fab.disabled} style={fab.disabled ? { opacity: 0.5 } : null}>
          {fab.icon}
          {fab.label}
        </button>
      )}
    </div>
  );
}

export const Button = ({ variant = '', size = '', className = '', children, ...p }) => (
  <button className={`btn ${variant} ${size} ${className}`} {...p}>
    {children}
  </button>
);

export const Badge = ({ tone = '', children }) => <span className={`badge ${tone}`}>{children}</span>;

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="faint">{hint}</small>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide, footer }) {
  // En celular la ventana es una hoja inferior que se cierra deslizándola hacia abajo.
  const [drag, setDrag] = useState(0);
  const start = useRef(null);
  const sheetRef = useRef();
  const onTouchStart = (e) => {
    if (sheetRef.current.scrollTop > 0) return;
    start.current = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    if (start.current === null) return;
    setDrag(Math.max(0, e.touches[0].clientY - start.current));
  };
  const onTouchEnd = () => {
    if (drag > 110) onClose();
    start.current = null;
    setDrag(0);
  };
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={sheetRef}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-label={title}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : { transition: 'transform .2s' }}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="sheet-handle" />
          <div className="row between" style={{ marginBottom: 16, flexWrap: 'nowrap' }}>
            <h2>{title}</h2>
            <button className="btn ghost icon-btn" onClick={onClose} aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" className={`tab ${value === it.value ? 'on' : ''}`} onClick={() => onChange(it.value)}>
          {it.icon}
          {it.label}
          {it.count ? (
            <span className="badge" style={{ padding: '0 7px' }}>
              {it.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Chips({ value, onChange, options, multi, scroll }) {
  const isOn = (v) => (multi ? value.includes(v) : value === v);
  const toggle = (v) => (multi ? onChange(isOn(v) ? value.filter((x) => x !== v) : [...value, v]) : onChange(v));
  return (
    <div className={`chips ${scroll ? 'scroll' : ''}`}>
      {options.map((o) => (
        <button type="button" key={o.value} className={`chip ${isOn(o.value) ? 'on' : ''}`} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FileDrop({ onFiles, accept, multiple, label = 'Arrastra un archivo o toca para elegir', capture }) {
  const ref = useRef();
  return (
    <div
      className="drop"
      onClick={() => ref.current.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <Upload size={20} style={{ marginBottom: 6 }} />
      <div>{label}</div>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        capture={capture}
        onChange={(e) => {
          onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Attachment({ file, onRemove }) {
  const isImg = file.type?.startsWith('image/');
  return (
    <div className="row" style={{ padding: 8, borderRadius: 12, background: 'var(--surface-sunk)' }}>
      {isImg ? (
        <img src={file.dataUrl} alt="" className="thumb" />
      ) : (
        <div className="avatar">
          <FileText size={18} />
        </div>
      )}
      <div className="grow" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
        {file.size ? <div className="faint">{(file.size / 1024).toFixed(0)} KB</div> : null}
      </div>
      <a className="btn ghost sm" href={file.dataUrl} download={file.name} target="_blank" rel="noreferrer">
        <Download size={15} />
      </a>
      {onRemove && (
        <button className="btn ghost sm" onClick={onRemove}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export const Empty = ({ icon, children }) => (
  <div className="empty">
    {icon && <div style={{ marginBottom: 8, opacity: 0.6 }}>{icon}</div>}
    {children}
  </div>
);

export function Stat({ label, value, sub, icon }) {
  return (
    <Card className="stat">
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </Card>
  );
}
