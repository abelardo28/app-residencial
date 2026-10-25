// Datos de ejemplo: dos residenciales y la empresa. Los usa el modo demo de la APP y la semilla de la API.
// Las cuentas no traen credenciales: cada consumidor agrega las suyas (la API con Argon2id).
import { buildToken } from '../access.js';
import { lastMonths, monthKey, monthLabel } from '../format.js';

export const DEMO_PASSWORD = 'Demo#2026';
export const DEMO_COMPANY_PASSWORD = 'Empresa#2026';
// Invitación pendiente de ejemplo (Mariana López) para probar la activación.
export const DEMO_INVITE = { userId: 'res5', token: 'Q2FzYTExLWRlbW8tYWN0aXZhY2lvbi10b2tlbi0yMDI2', code: '739154' };

const h = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();
const d = (days) => h(days * 24);

/** @param {{ sign: (payload: string) => string }} options */
export function seedTenant({ sign }) {
  const units = Array.from({ length: 12 }, (_, i) => ({
    id: `u${i + 1}`,
    label: `Casa ${i + 1}`,
    street: i < 6 ? 'Privada Olivo' : 'Privada Encino',
  }));

  const users = [
    { id: 'adm1', name: 'Laura Méndez', role: 'admin', email: 'admin@residencial.mx', phone: '+525512340001' },
    { id: 'grd1', name: 'Jorge Ramírez', role: 'guard', email: 'caseta@residencial.mx', phone: '+525512340002', shift: 'Matutino' },
    { id: 'grd2', name: 'Miguel Ortega', role: 'guard', email: 'caseta2@residencial.mx', phone: '+525512340003', shift: 'Nocturno' },
    {
      id: 'res1',
      name: 'Ana Torres',
      role: 'resident',
      unitId: 'u3',
      email: 'ana@correo.mx',
      phone: '+525520000003',
      vehicles: ['PXR482A'],
    },
    {
      id: 'res2',
      name: 'Carlos Ruiz',
      role: 'resident',
      unitId: 'u5',
      email: 'carlos@correo.mx',
      phone: '+525520000005',
      vehicles: ['NHT2291'],
    },
    { id: 'res3', name: 'Sofía Herrera', role: 'resident', unitId: 'u7', email: 'sofia@correo.mx', phone: '+525520000007', vehicles: [] },
    {
      id: 'res4',
      name: 'Roberto Garza',
      role: 'resident',
      unitId: 'u9',
      email: 'roberto@correo.mx',
      phone: '+525520000009',
      vehicles: ['MKD771B'],
    },
    {
      id: 'res5',
      name: 'Mariana López',
      role: 'resident',
      unitId: 'u11',
      email: 'mariana@correo.mx',
      phone: '+525520000011',
      vehicles: [],
    },
  ];

  const mkPass = (p) => {
    const pass = { uses: [], status: 'active', days: [], timeFrom: '00:00', timeTo: '23:59', maxUses: 1, createdAt: d(-1), ...p };
    pass.token = buildToken(pass, sign);
    return pass;
  };
  const passes = [
    mkPass({
      id: 'p1',
      code: 'K7M2QX',
      residentId: 'res1',
      unitId: 'u3',
      visitorName: 'Mamá (Rosa Torres)',
      type: 'familiar',
      mode: 'single',
      validFrom: h(-1),
      validTo: h(5),
      expectedPlate: 'JKL3345',
    }),
    mkPass({
      id: 'p2',
      code: 'H4T9ZB',
      residentId: 'res1',
      unitId: 'u3',
      visitorName: 'Lupita (limpieza)',
      type: 'trabajador',
      mode: 'recurrent',
      validFrom: d(-10),
      validTo: d(80),
      days: [1, 3, 5],
      timeFrom: '08:00',
      timeTo: '17:00',
    }),
    mkPass({
      id: 'p3',
      code: 'R8D3NW',
      residentId: 'res2',
      unitId: 'u5',
      visitorName: 'Plomería Express',
      type: 'proveedor',
      mode: 'single',
      validFrom: d(-3),
      validTo: d(-3 + 0.2),
      uses: [{ at: d(-3 + 0.05), guardId: 'grd1' }],
    }),
  ];

  const accessLogs = [
    {
      id: 'a1',
      kind: 'pass',
      passId: 'p3',
      visitorName: 'Plomería Express',
      type: 'proveedor',
      unitId: 'u5',
      plate: 'NBC4410',
      plateMatch: null,
      guardId: 'grd1',
      at: d(-3 + 0.05),
      exitAt: d(-3 + 0.12),
    },
    {
      id: 'a2',
      kind: 'general',
      visitorName: 'Recolección de basura',
      type: 'basura',
      unitId: null,
      plate: 'SM04821',
      guardId: 'grd1',
      at: d(-1),
      exitAt: d(-1 + 0.03),
    },
    {
      id: 'a3',
      kind: 'walkin',
      visitorName: 'Repartidor Amazon',
      type: 'paqueteria',
      unitId: 'u7',
      plate: '',
      guardId: 'grd2',
      at: h(-5),
      exitAt: h(-4.9),
    },
  ];

  const months = lastMonths(4);
  const fee = 1500;
  const payments = [];
  ['res1', 'res2', 'res3', 'res4'].forEach((rid, idx) => {
    const unitId = users.find((u) => u.id === rid).unitId;
    months.slice(0, 3).forEach((m, j) => {
      if (rid === 'res3' && j > 0) return; // Sofía con adeudo
      payments.push({
        id: `pay_${rid}_${m}`,
        residentId: rid,
        unitId,
        concept: 'Cuota de mantenimiento',
        period: m,
        amount: fee,
        method: ['transfer', 'ecartpay', 'cash'][(idx + j) % 3],
        status: 'approved',
        reference: `REF-${m.replace('-', '')}-${unitId}`,
        createdAt: new Date(`${m}-05T12:00:00`).toISOString(),
        reviewedBy: 'adm1',
        reviewedAt: new Date(`${m}-06T10:00:00`).toISOString(),
      });
    });
  });
  payments.push({
    id: 'pay_pend1',
    residentId: 'res2',
    unitId: 'u5',
    concept: 'Cuota de mantenimiento',
    period: monthKey(),
    amount: fee,
    method: 'transfer',
    status: 'pending',
    reference: 'SPEI 0938271',
    createdAt: h(-20),
    receipt: { id: 'f_demo', name: 'comprobante-spei.svg', type: 'image/svg+xml', dataUrl: demoReceipt() },
  });

  const notices = [
    {
      id: 'n1',
      title: 'Asamblea ordinaria de condóminos',
      category: 'reunion',
      body: 'Se convoca a la asamblea ordinaria para revisar el presupuesto anual y la propuesta de cámaras nuevas en accesos. Tu asistencia es importante para alcanzar quórum.',
      eventDate: d(6),
      location: 'Casa club',
      authorId: 'adm1',
      createdAt: d(-2),
      attachments: [],
      readBy: ['res2'],
      requireConfirm: true,
      confirmations: { res2: 'si' },
    },
    {
      id: 'n2',
      title: 'Mantenimiento de alberca',
      category: 'mantenimiento',
      body: 'La alberca permanecerá cerrada del lunes al miércoles por limpieza profunda y cambio de filtros.',
      authorId: 'adm1',
      createdAt: d(-5),
      attachments: [],
      readBy: ['res1', 'res2', 'res4'],
    },
    {
      id: 'n3',
      title: 'Reglamento interno actualizado',
      category: 'documento',
      body: 'Compartimos el reglamento con los cambios aprobados en la última asamblea (horarios de mudanza y uso de áreas comunes).',
      authorId: 'adm1',
      createdAt: d(-12),
      attachments: [
        {
          id: 'f_reg',
          name: 'reglamento-2026.txt',
          type: 'text/plain',
          size: 320,
          dataUrl:
            'data:text/plain;charset=utf-8,' +
            encodeURIComponent(
              'REGLAMENTO INTERNO\n\n1. Mudanzas: lunes a sábado de 9:00 a 18:00.\n2. Áreas comunes: reservar con 24 h de anticipación.\n3. Mascotas: siempre con correa en áreas comunes.\n4. Ruido: respetar descanso de 22:00 a 8:00.',
            ),
        },
      ],
      readBy: ['res1', 'res2', 'res3', 'res4'],
    },
  ];

  const notifications = [
    {
      id: 'nt1',
      userId: 'res1',
      title: 'Pago aprobado',
      body: `Tu pago de ${monthLabel(months[2])} fue aprobado.`,
      kind: 'payment',
      link: '/pagos',
      read: true,
      createdAt: d(-20),
    },
    {
      id: 'nt2',
      userId: 'res1',
      title: 'Nuevo aviso: Asamblea ordinaria',
      body: 'Casa club',
      kind: 'notice',
      link: '/avisos',
      read: false,
      createdAt: d(-2),
    },
    {
      id: 'nt3',
      userId: 'adm1',
      title: 'Comprobante por revisar',
      body: 'Carlos Ruiz · Casa 5 subió un comprobante de $1,500.',
      kind: 'payment',
      link: '/pagos',
      read: false,
      createdAt: h(-20),
    },
  ];

  const settings = {
    name: 'Residencial Las Palmas',
    monthlyFee: fee,
    dueDay: 10,
    lateFee: 150,
    lateFeeGraceDays: 0,
    whatsapp: { enabled: true, notices: true, reminders: true, number: '+52 55 1234 0000' },
    gate: { autoOpenOnPass: true, residentOpen: true, autoOpenResidentPlates: true },
    restrictions: { enabled: true, minMonths: 2, reservations: true, recurrentPasses: true },
    bank: { name: 'BBVA', clabe: '012 180 0011 2233 4455', holder: 'Asociación de Colonos Las Palmas A.C.' },
    amenities: [
      { id: 'am1', name: 'Casa club', capacity: 60, open: '09:00', close: '22:00', deposit: 1000 },
      { id: 'am2', name: 'Asadores', capacity: 20, open: '10:00', close: '21:00', deposit: 300 },
      { id: 'am3', name: 'Cancha de pádel', capacity: 4, open: '07:00', close: '22:00', deposit: 0 },
      { id: 'am4', name: 'Alberca', capacity: 30, open: '08:00', close: '20:00', deposit: 0 },
    ],
    generalProviders: ['Recolección de basura', 'Pipa de agua', 'Gas', 'Jardinería', 'Fumigación', 'Mantenimiento CFE'],
    // Concepto además de la cuota, para ver cómo aparece en el estado de cuenta
    charges: [
      {
        id: 'ch_imper',
        name: 'Impermeabilización de casetas',
        amount: 450,
        kind: 'once',
        dueDate: d(20).slice(0, 10),
        unitIds: [],
        createdAt: d(-2),
      },
    ],
  };

  const reservations = [
    {
      id: 'r1',
      amenityId: 'am1',
      residentId: 'res4',
      unitId: 'u9',
      date: d(3).slice(0, 10),
      from: '16:00',
      to: '21:00',
      guests: 25,
      status: 'approved',
      createdAt: d(-1),
    },
    {
      id: 'r2',
      amenityId: 'am3',
      residentId: 'res1',
      unitId: 'u3',
      date: d(1).slice(0, 10),
      from: '08:00',
      to: '09:00',
      guests: 4,
      status: 'approved',
      createdAt: d(-1),
    },
  ];

  const incidents = [
    {
      id: 'i1',
      title: 'Luminaria fundida en Privada Olivo',
      category: 'Alumbrado',
      description: 'La lámpara frente a casa 4 no enciende desde hace 3 días.',
      residentId: 'res1',
      unitId: 'u3',
      status: 'en_proceso',
      createdAt: d(-3),
      comments: [{ id: 'c1', userId: 'adm1', text: 'Ya se pidió la refacción al proveedor.', at: d(-2) }],
    },
    {
      id: 'i2',
      title: 'Fuga de agua en jardín común',
      category: 'Plomería',
      description: 'Hay un charco permanente junto al asador 2.',
      residentId: 'res2',
      unitId: 'u5',
      status: 'abierta',
      createdAt: h(-8),
      comments: [],
    },
  ];

  const packages = [
    {
      id: 'k1',
      unitId: 'u3',
      carrier: 'Mercado Libre',
      description: 'Caja mediana',
      receivedBy: 'grd1',
      receivedAt: h(-3),
      status: 'waiting',
      pickupCode: '4821',
    },
  ];

  const polls = [
    {
      id: 'pl1',
      question: '¿Aprobamos instalar cámaras con lectura de placas en ambos accesos?',
      options: [
        { id: 'o1', text: 'Sí, con cuota extraordinaria' },
        { id: 'o2', text: 'Sí, usando el fondo de reserva' },
        { id: 'o3', text: 'No por ahora' },
      ],
      votes: { res2: 'o2', res4: 'o2' },
      closesAt: d(5),
      authorId: 'adm1',
      createdAt: d(-1),
    },
  ];

  const expenses = [
    { id: 'e1', concept: 'Nómina vigilancia', category: 'Seguridad', amount: 24000, date: d(-15).slice(0, 10) },
    { id: 'e2', concept: 'Jardinería mensual', category: 'Mantenimiento', amount: 4500, date: d(-12).slice(0, 10) },
    { id: 'e3', concept: 'Energía eléctrica áreas comunes', category: 'Servicios', amount: 3120, date: d(-8).slice(0, 10) },
    { id: 'e4', concept: 'Químicos alberca', category: 'Mantenimiento', amount: 1850, date: d(-4).slice(0, 10) },
  ];

  return {
    version: 1,
    settings,
    units,
    users,
    passes,
    accessLogs,
    payments,
    notices,
    notifications,
    reservations,
    incidents,
    packages,
    polls,
    expenses,
    sos: [],
    bankMovements: [],
    ...seedGate(d),
  };
}

/** Equipos de caseta de ejemplo: dos plumas, un lector de tags y una cámara de placas. */
function seedGate(d) {
  const device = (id, name, kind, lane, barrierId = null) => ({
    id,
    name,
    kind,
    lane,
    barrierId,
    version: 1,
    status: 'active',
    createdAt: d(-30),
    connectedAt: d(-1),
    disconnectedAt: null,
  });
  return {
    devices: [
      device('dv_pl1', 'Pluma de visitas', 'barrier', 'entrada'),
      device('dv_pl2', 'Pluma de residentes', 'barrier', 'residentes'),
      device('dv_rf1', 'Lector de tags', 'reader', 'residentes', 'dv_pl2'),
      device('dv_cam1', 'Cámara de placas', 'camera', 'residentes', 'dv_pl2'),
    ],
    tags: [
      { id: 'tg1', unitId: 'u3', code: 'A1B2C3D4', label: 'Auto Mazda', status: 'active', createdAt: d(-30) },
      { id: 'tg2', unitId: 'u5', code: '0012345678', label: 'Camioneta', status: 'active', createdAt: d(-30) },
      { id: 'tg3', unitId: 'u7', code: 'FF00AA11', label: 'Tag extraviado', status: 'blocked', createdAt: d(-60) },
    ],
    gateCommands: [],
    gateEvents: [],
    whatsappOptOuts: [],
  };
}

function demoReceipt() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560"><rect width="420" height="560" fill="#fafaf9"/><text x="30" y="60" font-family="Arial" font-size="22" font-weight="bold" fill="#1c1917">Comprobante de transferencia</text><text x="30" y="110" font-family="Arial" font-size="15" fill="#57534e">Clave de rastreo: SPEI 0938271</text><text x="30" y="140" font-family="Arial" font-size="15" fill="#57534e">Beneficiario: Asociación de Colonos</text><text x="30" y="170" font-family="Arial" font-size="15" fill="#57534e">Concepto: Mantenimiento Casa 5</text><text x="30" y="240" font-family="Arial" font-size="34" font-weight="bold" fill="#1c1917">$1,500.00 MXN</text><text x="30" y="300" font-family="Arial" font-size="13" fill="#a8a29e">Documento de ejemplo</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Residencial pequeño adicional para mostrar el portal de empresa con varias residencias.
export function seedSecondTenant() {
  const units = Array.from({ length: 8 }, (_, i) => ({ id: `u${i + 1}`, label: `Depto ${101 + i}`, street: 'Torre A' }));
  return {
    version: 1,
    settings: {
      name: 'Residencial Los Robles',
      monthlyFee: 1100,
      dueDay: 5,
      lateFee: 100,
      bank: { name: 'Banorte', clabe: '072 180 0099 8877 6655', holder: 'Condominio Los Robles A.C.' },
      amenities: [{ id: 'am1', name: 'Salón de usos múltiples', capacity: 40, open: '09:00', close: '22:00', deposit: 800 }],
      generalProviders: ['Recolección de basura', 'Gas', 'Jardinería'],
    },
    units,
    users: [{ id: 'adm_t2', name: 'Ricardo Salas', role: 'admin', email: 'admin@losrobles.mx', phone: '+525533330001' }],
    passes: [],
    accessLogs: [],
    payments: [],
    notices: [],
    notifications: [],
    reservations: [],
    incidents: [],
    packages: [],
    polls: [],
    expenses: [],
    sos: [],
    bankMovements: [],
    devices: [],
    tags: [],
    gateCommands: [],
    gateEvents: [],
    whatsappOptOuts: [],
  };
}

export const PLANS = [
  { id: 'basic', name: 'Básico', price: 1490, maxUnits: 50, features: ['Accesos con QR', 'Avisos', 'Pagos con comprobante'] },
  {
    id: 'pro',
    name: 'Profesional',
    price: 2990,
    maxUnits: 200,
    features: ['Todo lo de Básico', 'Ecart Pay', 'Lectura de placas', 'Reservas y votaciones'],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 5490,
    maxUnits: 1000,
    features: ['Todo lo de Profesional', 'Varias casetas', 'Soporte prioritario', 'Reportes avanzados'],
  },
];

/** Cuenta de la empresa para las transferencias de la suscripción (ejemplo). */
export const COMPANY_BANK = { name: 'Santander', clabe: '014 180 6550 1234 5672', holder: 'Residencial Cloud S.A. de C.V.' };

/** Datos de la empresa: residencias, planes, personal y cargos de los últimos meses. */
export function seedCompany() {
  const months = lastMonths(3);
  const residencias = [
    {
      id: 't1',
      name: 'Residencial Las Palmas',
      address: 'Av. Las Palmas 120, Zapopan, Jal.',
      plan: 'pro',
      status: 'active',
      createdAt: d(-200),
      contact: 'Laura Méndez',
    },
    {
      id: 't2',
      name: 'Residencial Los Robles',
      address: 'Calle Roble 45, Guadalajara, Jal.',
      plan: 'basic',
      status: 'active',
      createdAt: d(-60),
      contact: 'Ricardo Salas',
    },
  ];
  const invoices = [];
  residencias.forEach((r) => {
    const price = PLANS.find((p) => p.id === r.plan).price;
    months.forEach((m, i) => {
      const current = i === months.length - 1;
      const paid = !current;
      invoices.push({
        id: `inv_${r.id}_${m}`,
        tenantId: r.id,
        period: m,
        amount: price,
        status: paid ? 'paid' : 'pending',
        // Las Palmas tiene el cargo del mes por vencer (para probar el pago desde la app); Los Robles ya vencido
        dueDate: current && r.id === 't1' ? d(3).slice(0, 10) : `${m}-10`,
        method: paid ? 'transfer' : null,
        reference: paid ? `SPEI-${m.replace('-', '')}-${r.id}` : '',
        paidAt: paid ? new Date(`${m}-08T12:00:00`).toISOString() : null,
        createdAt: new Date(`${m}-01T09:00:00`).toISOString(),
      });
    });
  });
  return {
    company: { name: 'Residencial Cloud', bank: COMPANY_BANK },
    staff: [{ id: 'stf1', name: 'Dirección general', email: 'empresa@residencial.cloud', phone: '+525500000000', role: 'owner' }],
    plans: PLANS,
    residencias,
    invoices,
  };
}
