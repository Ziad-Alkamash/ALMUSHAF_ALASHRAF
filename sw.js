const CACHE_NAME = 'mushaf-ashraf-v12';

// طبقة تخزين منفصلة لبيانات القرآن المجلوبة من الإنترنت (صفحات المصحف، التفسير، الصوتيات، معاني الكلمات)
// تبقى هذه البيانات محفوظة دائمًا حتى بعد تحديث التطبيق، ولا تُمسح إلا يدويًا من إعدادات المتصفح
const API_CACHE_NAME = 'mushaf-ashraf-quran-data-v1';
const API_HOSTS = ['api.alquran.cloud', 'api.quran.com'];

// الملفات اللي هيتم حفظها للعمل بدون إنترنت
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './quran-api.js',
  './azkar-data.js',
  './duas-data.js',
  './asbab-data.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './notif-icon-192.png',
  './notif-icon-512.png',
  './notif-badge-96.png',
  './notify.mp3',
  './widget-duas.html',
  './widget-prayer.html',
  './manifest-widget-duas.json',
  './manifest-widget-prayer.json'
];

// 1. تثبيت الـ Service Worker وتخزين الملفات
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. تفعيل الـ Service Worker وتنظيف الكاش القديم عند التحديث
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== API_CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. قراءة الملفات من الكاش أولاً لتسريع التطبيق والعمل بدون إنترنت
self.addEventListener('fetch', (event) => {
  const reqURL = new URL(event.request.url);

  // طلبات بيانات القرآن (صفحات المصحف، التفسير، الصوت، معاني الكلمات): كاش أولاً ثم شبكة،
  // وأي استجابة ناجحة تُخزَّن دائمًا حتى تعمل لاحقًا بدون إنترنت (تُستخدم من زر "تحميل كل الصفحات"
  // في الإعدادات، وأيضًا تلقائيًا مع كل صفحة/آية يقرأها المستخدم بشكل عادي)
  if (API_HOSTS.includes(reqURL.hostname)) {
    event.respondWith(
      caches.open(API_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const netRes = await fetch(event.request);
          if (netRes && netRes.ok) cache.put(event.request, netRes.clone());
          return netRes;
        } catch (e) {
          return cached || new Response(JSON.stringify({ error: true, offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

/* ------------------------------------------------------------------ */
/* إشعارات الدفع الحقيقية (Web Push) — تعمل حتى بعد إغلاق التطبيق تمامًا */
/* الإشعار يصل من خادم الدفع (سيرفر الراسبيري باي) عبر شبكة المتصفح،    */
/* وهذا الـ Service Worker مسؤول فقط عن عرضه والتعامل مع الضغط عليه.    */
/* ------------------------------------------------------------------ */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'المصحف الأشرف', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'المصحف الأشرف';
  const options = {
    body: payload.body || '',
    icon: payload.icon || './notif-icon-512.png',
    badge: payload.badge || './notif-badge-96.png',
    dir: 'rtl',
    lang: 'ar',
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    silent: false,
    requireInteraction: true, // يبقى ظاهرًا حتى يتفاعل معه المستخدم بدل اختفائه سريعًا
    data: { url: payload.url || './index.html' },
    vibrate: [80, 40, 80]
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // نطلب من أي نافذة مفتوحة للتطبيق تشغيل صوت التنبيه وعرض البانر المنبثق
      // داخل الواجهة، لأن الـ Service Worker نفسه لا يستطيع تشغيل صوت أو رسم
      // واجهة مباشرة. إن كان التطبيق مغلقًا تمامًا فسيعتمد على إشعار النظام
      // نفسه (silent: false و requireInteraction أعلاه)
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientList.forEach((c) => c.postMessage({
        type: 'push-notification-shown',
        title,
        body: options.body
      }));
    })()
  );
});

// الضغط على الإشعار: يفتح التطبيق (أو يركّز على تبويب مفتوح بالفعل بدل فتح نسخة جديدة)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetURL = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', url: targetURL });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetURL);
    })
  );
});

// إذا ألغى المتصفح الاشتراك من تلقاء نفسه (نادر، مثل انتهاء صلاحيته)، نحاول تجديده تلقائيًا
// ونُبلّغ خادم الدفع بالاشتراك الجديد حتى لا يستمر بالإرسال إلى اشتراك ميت
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
        const applicationServerKey = event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : (event.newSubscription ? event.newSubscription.options.applicationServerKey : null);

        const newSub = event.newSubscription || await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });

        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (clientList[0]) {
          clientList[0].postMessage({ type: 'push-resubscribed', oldEndpoint, subscription: newSub.toJSON() });
        }
      } catch (e) { /* تجاهل — سيُعاد الاشتراك من الواجهة عند فتح التطبيق التالي */ }
    })()
  );
});