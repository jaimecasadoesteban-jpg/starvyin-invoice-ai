/**
 * NIF españoles: DNI, NIE y CIF de entidades, con su dígito de control.
 *
 * Se usa en la configuración (el NIF de cada empresa del YAML) y en la
 * validación de facturas (el NIF del emisor). Un NIF con el control mal es, o
 * una mala lectura del modelo, o un error del emisor: en los dos casos, una
 * persona lo mira.
 */

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const LETRAS_CONTROL_CIF = 'JABCDEFGHI';

/** Quita espacios, guiones y puntos, pasa a mayúsculas y quita el prefijo de país «ES» (Grecia: «GR» → «EL», como en el VIES). */
export function normalizarNif(entrada: string): string {
  const limpio = entrada.toUpperCase().replace(/[\s.\-/]/g, '');
  if (limpio.startsWith('ES') && limpio.length === 11) return limpio.slice(2);
  return limpio.startsWith('GR') ? `EL${limpio.slice(2)}` : limpio;
}

/** `ue`: número de IVA de otro país de la UE (fase 19), sólo válido como NIF de un EMISOR. */
export type TipoNif = 'dni' | 'nie' | 'cif' | 'ue';

export type ResultadoNif =
  | { readonly valido: true; readonly nif: string; readonly tipo: TipoNif }
  | { readonly valido: false; readonly nif: string; readonly motivo: 'formato' | 'control' };

export function validarNif(entrada: string): ResultadoNif {
  const nif = normalizarNif(entrada);

  if (/^\d{8}[A-Z]$/.test(nif)) {
    const esperada = LETRAS_DNI[Number(nif.slice(0, 8)) % 23];
    return nif[8] === esperada ? { valido: true, nif, tipo: 'dni' } : { valido: false, nif, motivo: 'control' };
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) {
    const numero = Number(String('XYZ'.indexOf(nif.charAt(0))) + nif.slice(1, 8));
    const esperada = LETRAS_DNI[numero % 23];
    return nif[8] === esperada ? { valido: true, nif, tipo: 'nie' } : { valido: false, nif, motivo: 'control' };
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) {
    const digitos = nif.slice(1, 8);
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digitos.charAt(i));
      // Posiciones impares (1.ª, 3.ª…): se dobla y se suman las cifras.
      suma += i % 2 === 0 ? Math.floor((d * 2) / 10) + ((d * 2) % 10) : d;
    }
    const control = (10 - (suma % 10)) % 10;
    const letra = nif.charAt(0);
    const final = nif.charAt(8);
    const porDigito = final === String(control);
    const porLetra = final === LETRAS_CONTROL_CIF.charAt(control);
    // Unas letras exigen control con letra, otras con número, y el resto admite los dos.
    const valido = 'PQRSNW'.includes(letra) ? porLetra : 'ABEH'.includes(letra) ? porDigito : porDigito || porLetra;
    return valido ? { valido: true, nif, tipo: 'cif' } : { valido: false, nif, motivo: 'control' };
  }

  return { valido: false, nif, motivo: 'formato' };
}

// ── NIF-IVA de otros países de la UE (fase 19) ───────────────────────────────

/**
 * El formato del número de IVA de cada país de la UE (el que publica el VIES),
 * sin el prefijo. Sólo el FORMATO: las cifras de control de cada país no se
 * comprueban y el VIES no se consulta (sería un tercero más con datos). Lo que
 * protege de una mala lectura es lo de siempre: que el NIF esté en el texto del
 * documento o sea de un proveedor conocido (`nif_no_verificable`) y el aviso de
 * proveedor nuevo.
 */
export const FORMATOS_IVA_UE: Readonly<Record<string, RegExp>> = {
  AT: /U\d{8}/, BE: /[01]\d{9}/, BG: /\d{9,10}/, CY: /\d{8}[A-Z]/, CZ: /\d{8,10}/, DE: /\d{9}/, DK: /\d{8}/, EE: /\d{9}/,
  EL: /\d{9}/, FI: /\d{8}/, FR: /[0-9A-HJ-NP-Z]{2}\d{9}/, HR: /\d{11}/, HU: /\d{8}/, IE: /\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W]/,
  IT: /\d{11}/, LT: /\d{12}|\d{9}/, LU: /\d{8}/, LV: /\d{11}/, MT: /\d{8}/, NL: /\d{9}B\d{2}/, PL: /\d{10}/, PT: /\d{9}/,
  RO: /\d{2,10}/, SE: /\d{10}01/, SI: /\d{8}/, SK: /\d{10}/,
};

/** Cómo puede ser un NIF de emisor guardado: el mismo patrón que la restricción de la base (migración 0012). */
export const NIF_EMISOR_GUARDADO = new RegExp(`^([A-Z0-9]{9}|(${Object.keys(FORMATOS_IVA_UE).join('|')})[A-Z0-9+*]{2,12})$`);

/** ¿Es un número de IVA de otro país de la UE, con el formato de ese país? España no: para eso está `validarNif`. */
export function validarIvaUe(entrada: string): ResultadoNif {
  const nif = normalizarNif(entrada);
  const formato = FORMATOS_IVA_UE[nif.slice(0, 2)];
  if (formato === undefined) return { valido: false, nif, motivo: 'formato' };
  return new RegExp(`^(?:${formato.source})$`).test(nif.slice(2)) ? { valido: true, nif, tipo: 'ue' } : { valido: false, nif, motivo: 'formato' };
}

/**
 * El NIF de quien factura: uno español (con su control) o, desde la fase 19, el
 * número de IVA de una empresa de otro país de la UE (software, suscripciones).
 * Las empresas del cliente siguen siendo sólo españolas (`validarNif`).
 */
export function validarNifEmisor(entrada: string): ResultadoNif {
  const es = validarNif(entrada);
  return es.valido ? es : validarIvaUe(entrada).valido ? validarIvaUe(entrada) : es;
}

/**
 * Saca el NIF de un texto que puede traer algo pegado. Lo enseñó la
 * evaluación: el modelo leyó «ES-<NIF>-RPP» (el NIF seguido del registro de
 * productores) y el NIF no validaba. Si el texto entero no es un NIF válido, se
 * busca dentro **el primero que sí lo sea**; si no hay ninguno, se devuelve el
 * texto normalizado tal cual y la validación lo marcará.
 */
export function extraerNif(entrada: string): string {
  const directo = validarNifEmisor(entrada);
  if (directo.valido) return directo.nif;
  const compacto = entrada.toUpperCase().replace(/[\s.\-/]/g, '');
  for (const m of compacto.matchAll(/[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]/g)) {
    const r = validarNif(m[0]);
    if (r.valido) return r.nif;
  }
  // «VAT No.: IE9999990WA» o con algo pegado detrás: el primero de la UE con su formato.
  for (const [pais, formato] of Object.entries(FORMATOS_IVA_UE)) {
    const m = new RegExp(`${pais === 'EL' ? '(?:EL|GR)' : pais}(?:${formato.source})`).exec(compacto);
    if (m !== null && validarIvaUe(m[0]).valido) return validarIvaUe(m[0]).nif;
  }
  return directo.nif;
}

/**
 * NIF del rango que usan los datos de ejemplo y el juego de pruebas
 * (`99999…`, `B99999…`). Al arrancar se avisa si un cliente real los tiene:
 * es que alguien copió el YAML de ejemplo y no lo terminó.
 */
export function pareceDeEjemplo(nif: string): boolean {
  return /^[A-Z]?99999/.test(normalizarNif(nif));
}
