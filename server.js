// خادم إشعارات Web Push لتطبيق "المصحف الأشرف" — مصمَّم عمدًا ليكون خفيفًا جدًا
// (لا قاعدة بيانات، لا معالجة ثقيلة) ليعمل بجانب خدماتك الأخرى على الراسبيري باي
// بدون أي تأثير محسوس. راجع README.md لخطوات التشغيل الكاملة.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const webpush = require('web-push');

if (process.env.TZ) process.TZ = process.env.TZ; // يُقرأ فعليًا عبر متغير البيئة أدناه

const PORT = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, 'data', 'subscribers.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error('❌ مفاتيح VAPID غير مضبوطة. شغّل: npm run generate-vapid ثم ضعها في .env');
  process.exit(1);
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/* ------------------------------------------------------------------ */
/* تخزين بسيط جدًا: ملف JSON واحد، مناسب لعدد قليل من المشتركين        */
/* (تطبيق عائلي/شخصي) بدون أي حمل إضافي على السيرفر                   */
/* ------------------------------------------------------------------ */
function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
  } catch (e) {
    console.error('تعذرت قراءة ملف البيانات، سيبدأ فارغًا:', e.message);
    return {};
  }
}

function saveDB(db) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE); // كتابة ذرية لتفادي تلف الملف عند انقطاع الكهرباء مثلاً
  } catch (e) {
    console.error('تعذرت كتابة ملف البيانات:', e.message);
  }
}

let db = loadDB();

/* ------------------------------------------------------------------ */
/* واجهة HTTP الصغيرة                                                  */
/* ------------------------------------------------------------------ */
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',') }));

app.get('/health', (req, res) => {
  res.json({ ok: true, subscribers: Object.keys(db).length });
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// تسجيل/تحديث اشتراك + تفضيلات المستخدم (تُستدعى من app.js عند كل تغيير في إعدادات التذكيرات)
app.post('/api/subscribe', (req, res) => {
  const { subscription, lat, lng, prefs } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: 'subscription.endpoint مطلوب' });
  }

  const key = subscription.endpoint;
  const existing = db[key] || {};

  db[key] = {
    subscription,
    lat: (typeof lat === 'number') ? lat : (existing.lat ?? null),
    lng: (typeof lng === 'number') ? lng : (existing.lng ?? null),
    prefs: prefs || existing.prefs || {},
    prayerTimings: existing.prayerTimings || null,
    prayerTimingsDate: existing.prayerTimingsDate || null,
    lastSent: existing.lastSent || {},
    lastMayyitAt: existing.lastMayyitAt || 0,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  saveDB(db);
  res.json({ ok: true });

  // إذا كانت الصلاة مفعّلة وليس لدينا مواقيت اليوم بعد، اجلبها فورًا (خارج الاستجابة حتى لا تؤخرها)
  maybeRefreshPrayerTimingsFor(key).catch(() => {});
});

app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint && db[endpoint]) {
    delete db[endpoint];
    saveDB(db);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ خادم إشعارات المصحف الأشرف يعمل على المنفذ ${PORT}`);
});

/* ------------------------------------------------------------------ */
/* إرسال إشعار وحذف الاشتراكات المنتهية تلقائيًا (رد 404/410)          */
/* ------------------------------------------------------------------ */
async function sendPush(endpoint, payload) {
  const entry = db[endpoint];
  if (!entry) return;
  try {
    // urgency: 'high' يطلب من خدمة الدفع (مثل FCM على أندرويد) تسليم
    // الإشعار بأعلى أولوية، وهو ما يزيد كثيرًا من احتمال ظهوره كنافذة
    // منبثقة (heads-up) فوق الشاشة مباشرة بدل أن يذهب فقط للوحة الإشعارات
    await webpush.sendNotification(entry.subscription, JSON.stringify(payload), {
      urgency: 'high',
      TTL: 60
    });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      delete db[endpoint];
      saveDB(db);
    } else {
      console.error('فشل إرسال إشعار:', err.statusCode || err.message);
    }
  }
}

/* ------------------------------------------------------------------ */
/* جلب مواقيت الصلاة اليومية لمشترك واحد (يُستخدم عند التسجيل وعند      */
/* منتصف الليل يوميًا لكل المشتركين المفعّل لديهم تذكير الصلاة)          */
/* ------------------------------------------------------------------ */
async function maybeRefreshPrayerTimingsFor(endpoint) {
  const entry = db[endpoint];
  if (!entry) return;
  if (!entry.prefs || !entry.prefs.prayers || !entry.prefs.prayers.enabled) return;
  if (entry.lat == null || entry.lng == null) return;

  const today = todayStr();
  if (entry.prayerTimingsDate === today && entry.prayerTimings) return; // موجودة بالفعل

  try {
    const res = await fetch(
      `https://api.aladhan.com/v1/timings?latitude=${entry.lat}&longitude=${entry.lng}&method=5`
    );
    const data = await res.json();
    if (data && data.data && data.data.timings) {
      entry.prayerTimings = data.data.timings;
      entry.prayerTimingsDate = today;
      entry.lastSent = entry.lastSent || {};
      entry.lastSent.prayers = {}; // إعادة الضبط ليوم جديد
      saveDB(db);
    }
  } catch (e) {
    console.error('تعذر جلب مواقيت الصلاة لمشترك:', e.message);
  }
}

async function refreshAllPrayerTimings() {
  const endpoints = Object.keys(db);
  for (const endpoint of endpoints) {
    await maybeRefreshPrayerTimingsFor(endpoint);
    await new Promise((r) => setTimeout(r, 300)); // تباعد بسيط بين الطلبات حتى لا نُثقل الشبكة دفعة واحدة
  }
}

/* ------------------------------------------------------------------ */
/* أدوات وقت                                                           */
/* ------------------------------------------------------------------ */
function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function nowHM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const PRAYER_LABELS = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };

/* ------------------------------------------------------------------ */
/* المُجدوِل الرئيسي: يعمل كل دقيقة، ولا يفعل شيئًا سوى مقارنات نصية       */
/* بسيطة على مصفوفة صغيرة في الذاكرة — استهلاك موارد يُذكر لا شيء تقريبًا  */
/* ------------------------------------------------------------------ */
cron.schedule('* * * * *', async () => {
  const today = todayStr();
  const hm = nowHM();
  const isFriday = new Date().getDay() === 5;
  let changed = false;

  for (const endpoint of Object.keys(db)) {
    const entry = db[endpoint];
    const p = entry.prefs || {};
    entry.lastSent = entry.lastSent || {};

    if (p.sabah && p.sabah.enabled && entry.lastSent.sabah !== today && hm >= p.sabah.time) {
      await sendPush(endpoint, { title: 'أذكار الصباح ☀️', body: 'حان وقت أذكار الصباح، اضغط لفتح المصحف الأشرف وقراءتها.', tag: 'sabah', url: './index.html' });
      entry.lastSent.sabah = today;
      changed = true;
    }

    if (p.masaa && p.masaa.enabled && entry.lastSent.masaa !== today && hm >= p.masaa.time) {
      await sendPush(endpoint, { title: 'أذكار المساء 🌙', body: 'حان وقت أذكار المساء، اضغط لفتح المصحف الأشرف وقراءتها.', tag: 'masaa', url: './index.html' });
      entry.lastSent.masaa = today;
      changed = true;
    }

    if (p.kahf && p.kahf.enabled && isFriday && entry.lastSent.kahf !== today && hm >= p.kahf.time) {
      await sendPush(endpoint, { title: 'سورة الكهف 📖', body: 'اليوم الجمعة، لا تنسَ قراءة سورة الكهف بارك الله فيك.', tag: 'kahf', url: './index.html' });
      entry.lastSent.kahf = today;
      changed = true;
    }

    if (p.wird && p.wird.enabled && entry.lastSent.wird !== today && hm >= p.wird.time) {
      await sendPush(endpoint, { title: 'تذكير الورد اليومي 📅', body: 'حان وقت وردك اليومي من القرآن، اضغط لفتح المصحف ومتابعة القراءة.', tag: 'wird', url: './index.html' });
      entry.lastSent.wird = today;
      changed = true;
    }

    if (p.naom && p.naom.enabled && entry.lastSent.naom !== today && hm >= p.naom.time) {
      await sendPush(endpoint, { title: 'أذكار النوم 🛏️', body: 'حان وقت أذكار النوم، تقبّل الله منك.', tag: 'naom', url: './index.html' });
      entry.lastSent.naom = today;
      changed = true;
    }

    if (p.prayers && p.prayers.enabled && entry.prayerTimings) {
      entry.lastSent.prayers = entry.lastSent.prayers || {};
      for (const key of Object.keys(PRAYER_LABELS)) {
        const t = entry.prayerTimings[key];
        if (!t) continue;
        if (entry.lastSent.prayers[key] !== today && hm >= t) {
          await sendPush(endpoint, { title: `حان وقت صلاة ${PRAYER_LABELS[key]} 🕌`, body: 'حي على الصلاة، حي على الفلاح.', tag: 'prayer-' + key, url: './index.html' });
          entry.lastSent.prayers[key] = today;
          changed = true;
        }
      }
    }

    // دعاء للفقيد أشرف أحمد جاهين — بالفترة التي حددها كل مستخدم بنفسه من إعدادات التطبيق
    // (بالدقائق أو الساعات)، بدل فترة ثابتة كل 4 ساعات للجميع
    if (p.mayyit4h && p.mayyit4h.enabled) {
      const intervalMin = Number(p.mayyit4h.intervalMinutes) > 0 ? Number(p.mayyit4h.intervalMinutes) : 240;
      const elapsedMs = Date.now() - (entry.lastMayyitAt || 0);
      if (!entry.lastMayyitAt || elapsedMs >= intervalMin * 60 * 1000) {
        await sendPush(endpoint, {
          title: 'دعاء للفقيد 🕊️',
          body: 'اللهم اغفر لأشرف أحمد جاهين وارحمه وأسكنه فسيح جناتك — قل: اللهم اغفر له وارحمه.',
          tag: 'mayyit4h',
          url: './widget-duas.html'
        });
        entry.lastMayyitAt = Date.now();
        changed = true;
      }
    }
  }

  if (changed) saveDB(db);
});

// تحديث مواقيت الصلاة لكل المشتركين مرة يوميًا بعد منتصف الليل بقليل
cron.schedule('10 0 * * *', () => { refreshAllPrayerTimings().catch(() => {}); });

// وأيضًا عند إقلاع السيرفر (تعويض أي إعادة تشغيل فاتت وقتها اليومي)
refreshAllPrayerTimings().catch(() => {});
