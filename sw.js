// Mima: guarda la app para que abra rápido. Los datos siempre vienen de Firebase.
const CACHE = "mima-v25";
const ARCHIVOS = ["./", "index.html", "logo.png", "avatar.png", "icon-192.png", "icon-512.png", "manifest.webmanifest", "badge.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Primero internet (para ver siempre la versión nueva); si no hay, lo guardado.
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

// Avisos en el celular: llegan desde la tarea diaria de GitHub (Firebase Cloud Messaging).
self.addEventListener("push", e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j.notification || j; } catch (err) {}
  const titulo = d.titulo || d.title || "Mima";
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || d.body || "",
    icon: "icon-192.png",
    badge: "badge.png",
    tag: d.tag || "aviso",
    lang: "es",
    data: { url: d.url || "./" }
  }));
});
// Al tocar el aviso, abre la app (o la trae al frente si ya estaba abierta).
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope) && "focus" in w) return w.focus();
    return clients.openWindow(url);
  }));
});
