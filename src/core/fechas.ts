/**
 * Fechas de calendario (sin hora), en la zona horaria de cada cliente.
 *
 * Un vencimiento es una fecha, no un instante: «vence el 25» significa el día
 * 25 en Madrid, y a las 23:30 UTC del 24 en Madrid ya es 25. Todo lo que decide
 * «qué día es hoy» pasa por `diaLocal`, con la zona del YAML del cliente (docs/ENGINEERING_RULES.md,
 * regla 8: un solo reloj, el `ahora` del proceso, interpretado en su zona).
 *
 * `FechaLocal` es una cadena `AAAA-MM-DD` con marca de tipo: sólo se construye
 * aquí, así que una fecha sin validar no puede llegar a una comparación.
 */

declare const marca: unique symbol;
export type FechaLocal = string & { readonly [marca]: 'FechaLocal' };

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valida `AAAA-MM-DD` como fecha real (rechaza el 31 de febrero). */
export function fechaLocal(texto: string): FechaLocal {
  const m = FORMATO.exec(texto);
  if (m === null) throw new RangeError(`fecha con formato inválido: «${texto}» (se espera AAAA-MM-DD)`);
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const comprobada = new Date(Date.UTC(a, mes - 1, d));
  if (comprobada.getUTCFullYear() !== a || comprobada.getUTCMonth() !== mes - 1 || comprobada.getUTCDate() !== d) {
    throw new RangeError(`fecha inexistente: «${texto}»`);
  }
  return texto as FechaLocal;
}

/** El día del calendario que es `instante` en la zona `zona` (p. ej. `Europe/Madrid`). */
export function diaLocal(instante: Date, zona: string): FechaLocal {
  // `en-CA` formatea como AAAA-MM-DD.
  const texto = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
  return fechaLocal(texto);
}

/** ¿Existe esta zona horaria? (Para validar el YAML: una zona mal escrita no arranca.) */
export function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior). Fechas de calendario: sin horas ni cambios de hora. */
export function diasEntre(desde: FechaLocal, hasta: FechaLocal): number {
  const utc = (f: FechaLocal): number => Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)));
  return Math.round((utc(hasta) - utc(desde)) / 86_400_000);
}
