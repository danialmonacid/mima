// Tarea diaria: revisa las facturas y manda los avisos al celular.
// La corre GitHub (.github/workflows/avisos.yml) todos los días a las 8 a. m. de Colombia.
import admin from "firebase-admin";
import { hoyColombia, masDias, ymd, facturasQueVencen, facturasVencidas, mensaje, recordatorio } from "./logica.mjs";

const APP = process.env.APP;                       // "mima" o "suma"
const NOMBRE = APP === "suma" ? "Suma" : "Mima";
const PRUEBA = process.env.PRUEBA === "true";      // botón "Run workflow" con la casilla de prueba
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT en GitHub."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore(), fcm = admin.messaging();

// Mima: un solo espacio de datos. Suma: uno por persona (usuarios/<id>/...)
const espacios = APP === "suma" ? (await db.collection("usuarios").listDocuments()).map(d => "usuarios/" + d.id + "/") : [""];
const hoy = hoyColombia(), en2 = masDias(hoy, 2);
let enviados = 0;

for (const base of espacios) {
  const cache = {};
  const leer = async p => (p in cache) ? cache[p] : (cache[p] = (await db.doc(base + p).get()).data() || null);
  const cfg = await leer("config/main");
  const celulares = (cfg && cfg.avisos && cfg.avisos.celulares) || [];
  if (!celulares.length) { console.log(`${base || "mima"}: sin celulares con avisos activos`); continue; }

  const comunes = PRUEBA
    ? [{ titulo: "Aviso de prueba", cuerpo: `Si ves esto, los avisos de ${NOMBRE} funcionan.`, tag: "prueba" }]
    : [mensaje("vencida", await facturasVencidas(leer, hoy), hoy, NOMBRE),
       mensaje("hoy", await facturasQueVencen(leer, hoy), hoy, NOMBRE),
       mensaje("pronto", await facturasQueVencen(leer, en2), en2, NOMBRE)].filter(Boolean);

  const malos = [], recordados = [];
  for (const cel of celulares) {
    const rec = PRUEBA ? null : recordatorio(cel, hoy, NOMBRE);   // depende de cuándo abrió la app ese celular
    const msgs = rec ? [...comunes, rec] : comunes;
    if (!msgs.length) { console.log(`${cel.equipo || "celular"}: hoy no hay avisos`); continue; }
    for (const m of msgs) {
      try {
        await fcm.send({ token: cel.token, data: { ...m, url: "./" }, webpush: { headers: { Urgency: "high", TTL: "43200" } } });
        enviados++; console.log(`Enviado a ${cel.equipo || "celular"}: ${m.titulo}`);
        if (m === rec) recordados.push(cel.token);
      } catch (e) {
        console.log(`No se pudo enviar a ${cel.equipo || "celular"}: ${e.code || e.message}`);
        if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(e.code)) { malos.push(cel.token); break; }
      }
    }
  }
  if (recordados.length) await db.runTransaction(async t => { const ref = db.doc(base + "config/main"); const d = (await t.get(ref)).data();
    d.avisos.celulares = (d.avisos.celulares || []).map(c => recordados.includes(c.token) ? { ...c, recordado: ymd(hoy) } : c); t.set(ref, d); });
  if (malos.length) { // celulares que ya no existen o desactivaron los avisos
    await db.runTransaction(async t => { const ref = db.doc(base + "config/main"); const d = (await t.get(ref)).data();
      d.avisos.celulares = (d.avisos.celulares || []).filter(c => !malos.includes(c.token)); t.set(ref, d); });
    console.log(`Quité ${malos.length} celular(es) que ya no reciben avisos.`);
  }
}
console.log(`Listo: ${enviados} aviso(s) enviados.`);
