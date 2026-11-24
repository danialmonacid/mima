// Decide qué avisos mandar hoy. No depende de Firebase, para poder probarla aparte.
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const dinero = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO").replace(/,/g, ".");
export const mesKey = f => f.getUTCFullYear() + "-" + String(f.getUTCMonth() + 1).padStart(2, "0");
export const mesSig = k => { let [y, m] = k.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return y + "-" + String(m).padStart(2, "0"); };
const diasMes = k => { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const ymd = f => mesKey(f) + "-" + String(f.getUTCDate()).padStart(2, "0");

// Fecha de hoy en Colombia (como fecha UTC a medianoche, para sumar días sin líos de zona horaria)
export function hoyColombia(ahora = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const masDias = (f, n) => new Date(f.getTime() + n * 86400000);

// Facturas sin pagar que vencen en la fecha f. leer(path) devuelve el documento o null.
export async function facturasQueVencen(leer, f) {
  const cfg = await leer("config/main"); const estado = await leer("estado/main");
  const actual = estado && estado.mesActual; if (!cfg || !actual) return [];
  const k = mesKey(f), dia = f.getUTCDate();
  let estadoDe, toca;
  if (k === actual) { // mes en curso
    const mes = (await leer("meses/" + k)) || {};
    estadoDe = id => (mes.cuentas || {})[id] || {};
    toca = c => c.cada === 2 ? !!estadoDe(c.id).toca : true;
  } else if (k === mesSig(actual)) { // mes siguiente (aún no se ha cerrado el actual)
    const mesAct = (await leer("meses/" + actual)) || {};
    const b = await leer("borrador/" + k);
    estadoDe = id => ((b && b.mes === k) ? (b.cuentas || {})[id] : null) || {};
    toca = c => c.cada === 2 ? !((mesAct.cuentas || {})[c.id] || {}).toca : true;
  } else return [];
  return (cfg.cuentas || [])
    .filter(c => !c.archivada && !c.ejemplo)
    .filter(c => Math.min(Number(c.dia) || 0, diasMes(k)) === dia && toca(c) && !estadoDe(c.id).pagada)
    .map(c => { const st = estadoDe(c.id); return { nombre: c.nombre, valor: st.valor ?? c.valor, verificar: !!c.variable && !(st.verificada || st.cambiada) }; });
}

// Facturas sin pagar cuya fecha ya pasó (antes de hoy), con los días de atraso.
export async function facturasVencidas(leer, hoy) {
  const cfg = await leer("config/main"); const estado = await leer("estado/main");
  const actual = estado && estado.mesActual; if (!cfg || !actual) return [];
  const meses = [actual]; if (mesKey(hoy) === mesSig(actual)) meses.push(mesSig(actual));
  const out = [];
  for (const k of meses) {
    const [y, m] = k.split("-").map(Number);
    for (let d = 1; d <= diasMes(k); d++) {
      const f = new Date(Date.UTC(y, m - 1, d)); if (f >= hoy) break;
      for (const c of await facturasQueVencen(leer, f)) out.push({ ...c, atraso: Math.round((hoy - f) / 86400000) });
    }
  }
  return out;
}

// Arma los textos. cuando: "hoy" | "pronto" (2 días antes)
export function mensaje(cuando, fs, f, app) {
  if (!fs.length) return null;
  if (cuando === "vencida") {
    const uno = fs.length === 1, c = fs[0];
    return {
      titulo: uno ? `Venció: ${c.nombre}` : `Tienes ${fs.length} facturas vencidas`,
      cuerpo: uno ? `${dinero(c.valor)} · Venció hace ${c.atraso === 1 ? "1 día" : c.atraso + " días"}. Si ya la pagaste, márcala en ${app}.`
                  : fs.map(x => `${x.nombre} ${dinero(x.valor)}`).join(" · ") + `. Si ya las pagaste, márcalas en ${app}.`,
      tag: "vencida-" + ymd(f) };
  }
  const uno = fs.length === 1, c = fs[0];
  const cuandoTxt = cuando === "hoy" ? "Hoy" : "El " + DIAS[f.getUTCDay()] + " " + f.getUTCDate();
  if (cuando === "pronto") return { // 2 días antes: título con el nombre, descripción solo el valor
    titulo: uno ? `${c.nombre} vence en 2 días` : `${fs.length} facturas vencen en 2 días`,
    cuerpo: uno ? dinero(c.valor) : fs.map(x => `${x.nombre} ${dinero(x.valor)}`).join(" · "),
    tag: "pronto-" + ymd(f) };
  const titulo = uno ? `${cuandoTxt} vence: ${c.nombre}` : `${cuandoTxt} vencen ${fs.length} facturas`;
  const cuerpo = uno
    ? (c.verificar ? `Más o menos ${dinero(c.valor)} · Revisa el recibo.` : `${dinero(c.valor)} ·`) + (cuando === "hoy" ? ` Cuando la pagues, márcala en ${app}.` : " Faltan 2 días.")
    : fs.map(x => `${x.nombre} ${dinero(x.valor)}`).join(" · ");
  return { titulo, cuerpo, tag: cuando + "-" + ymd(f) };
}

// Recordatorio de anotar gastos: si el celular lleva más de 3 días sin abrir la app.
// Se repite cada 3 días mientras siga sin entrar.
export function recordatorio(cel, hoy, app) {
  const ult = cel.ultimaVez || cel.desde; if (!ult) return null;
  const dias = Math.round((hoy - new Date(ult + "T00:00:00Z")) / 86400000);
  if (dias <= 3) return null;
  if (cel.recordado) { const desde = Math.round((hoy - new Date(cel.recordado + "T00:00:00Z")) / 86400000); if (desde < 3 && cel.recordado > ult) return null; }
  return { titulo: "¿Anotaste tus gastos?", cuerpo: `Hace ${dias} días no entras a ${app}. Ábrela y anota lo que has gastado.`, tag: "gastos-" + ymd(hoy) };
}
