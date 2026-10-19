// Hashes PBKDF2 precalculados de las contraseñas de demostración (Demo#2026 / Empresa#2026).
// Sólo para el modo demo: con la API las cuentas viven en el servidor (Argon2id).
export const DEMO_AUTH = {
  adm1: {
    salt: 'd2003f2d2434b418679ca426b4fcd4cd',
    hash: 'e8b54bdbc7cdb2bdddd0fa5995186c1327a53bbbe88e6aa52a9e2fa1c7407c69',
    iter: 120000,
  },
  grd1: {
    salt: '448482d48902b3c72a940bbb13f507ed',
    hash: '8b84d6cf1d2589fd465d706a637cb92ae5b6ab7cffec2f3763b4de4b9f1de517',
    iter: 120000,
  },
  grd2: {
    salt: '44f875461363667066f8a817190a3495',
    hash: '9d4230a19596c1c75b5fe6495e515e590bd07eaab7243c2ec5d16af066c40943',
    iter: 120000,
  },
  res1: {
    salt: '490e81fd6aba73fbd362f15cdf983c3b',
    hash: 'cee3e046d30e661581b959938a8efaa6094693894ddb08097825c80c028c1d07',
    iter: 120000,
  },
  res2: {
    salt: '39db4c03d1e01853d74295b9a81695a4',
    hash: 'cb2962d3900aea28a1cce15139267206b9c743a2204e87aefa861fb503faf4b5',
    iter: 120000,
  },
  res3: {
    salt: 'f186df8518183b045f9eba3e1e1f91a0',
    hash: 'f17e0739b0032721285fa05f280acdd1d072be63a3681b7d816bbb58bc51f881',
    iter: 120000,
  },
  res4: {
    salt: '8358ddc35f2167ed39505427d2bccf17',
    hash: '66dcd2160e56cbf1069e012e5e5699f9d74ab9f72e80cf568eb6a7a6e67cf99f',
    iter: 120000,
  },
  adm_t2: {
    salt: '09b1d543bc36c128d7bfe1ee81d152d8',
    hash: '752ea5cf02626612ba72d471929fe2a6c434262d018e1fb294c2013631011a30',
    iter: 120000,
  },
  stf1: {
    salt: '723acc05e6d458a6c13c6e4ca2852a5b',
    hash: '7fd94b64858a3e48aa1c012c431731d31ba267c3bea2c094629ab12aa24dca07',
    iter: 120000,
  },
};

// Hashes de la invitación de ejemplo (Mariana López); el enlace y el código están en @residencial/shared/demo.
export const DEMO_INVITE_HASHES = {
  tokenHash: '3b25694747c49c30a0d33a14898170e6dd09348677b5a378ae9c97e326aacf52',
  codeHash: 'd9cf72d379461bca2543c4abcb9fce8c488da7c714ef8eed103dfa133a20ef01',
};
