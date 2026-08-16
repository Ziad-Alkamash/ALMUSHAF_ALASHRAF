const CACHE_NAME = 'mushaf-ashraf-v4';

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