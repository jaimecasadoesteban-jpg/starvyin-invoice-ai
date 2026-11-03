/**
 * IBAN: sus dos cifras de control (ISO 13616, módulo 97) detectan casi cualquier
 * cifra de más, de menos o cambiada. Lo enseñó la evaluación (fase 16): en fotos
 * y escaneos el modelo lee «…6666666666…» con una cifra de más o de menos, y un
 * IBAN así, copiado para pagar, manda el dinero a otra parte (o lo rechaza el banco).
 */

/** Longitud por país (los de la zona SEPA más habituales); otro país: entre 15 y 34. */
const LONGITUD: Readonly<Record<string, number>> = { ES: 24, PT: 25, FR: 27, DE: 22, IT: 27, NL: 18, BE: 16, IE: 22, LU: 20, AD: 24, GB: 22 };

export type ValidacionIban = { readonly valido: true; readonly iban: string } | { readonly valido: false; readonly motivo: 'enmascarado' | 'formato' | 'longitud' | 'control' };

export function validarIban(texto: string): ValidacionIban {
  const iban = texto.replace(/[\s.-]+/g, '').toUpperCase();
  // «ES21 0237 …****»: la cuenta del cliente impresa a medias; no es un IBAN que se pueda usar.
  if (iban.includes('*') || /X{3,}/.test(iban.slice(4))) return { valido: false, motivo: 'enmascarado' };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { valido: false, motivo: 'formato' };
  const largo = LONGITUD[iban.slice(0, 2)];
  if (largo !== undefined ? iban.length !== largo : iban.length < 15 || iban.length > 34) return { valido: false, motivo: 'longitud' };
  // Las 4 primeras al final, las letras como números (A=10…Z=35), y el resto entre 97 tiene que dar 1.
  const numerico = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (l) => String(l.charCodeAt(0) - 55));
  let resto = 0;
  for (const d of numerico) resto = (resto * 10 + Number(d)) % 97;
  return resto === 1 ? { valido: true, iban } : { valido: false, motivo: 'control' };
}
