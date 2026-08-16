// المصحف الأشرف — طبقة الاتصال بمصادر بيانات القرآن الكريم (نظام صفحات مصحف المدينة)
// المصدر الرئيسي: alquran.cloud (نص مصحف حفص، تفسير الميسر، صوت الشيخ العفاسي)
// المصدر الثانوي لمعاني الكلمات: quran.com API v4
const QuranAPI = (() => {
  const BASE = 'https://api.alquran.cloud/v1';
  const QCOM = 'https://api.quran.com/api/v4';
  const CACHE_PREFIX = 'almus-hraf-cache:';

  // دالة جلب مع التخزين المحلي (Cache) لتسريع التحميل وتوفير الترافيك
  async function cachedFetchJSON(url, ttlHours = 24 * 30) {
    const key = CACHE_PREFIX + url;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.t < ttlHours * 3600 * 1000) {
          return parsed.d;
        }
      }
    } catch (e) { /* تجاهل أخطاء التخزين المحلي */ }

    const res = await fetch(url);
    if (!res.ok) throw new Error('تعذر الاتصال بالخادم: ' + res.status);
    const data = await res.json();
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) { /* عند امتلاء الذاكرة */ }
    return data;
  }

  // رابط جلب صفحة خام (بدون تخزين محلي) — تستخدمه أداة التحميل الكامل للعمل بدون إنترنت
  // (تفتح الرابط عبر fetch مباشرة ليعترضها Service Worker ويخزّنها في ذاكرته الدائمة)
  function pageURL(pageNumber) {
    return `${BASE}/page/${pageNumber}/quran-uthmani`;
  }

  // 1️⃣ جلب بيانات صفحة محددة من صفحات المصحف الـ 604
  async function getPage(pageNumber) {
    if (pageNumber < 1 || pageNumber > 604) throw new Error('رقم الصفحة يجب أن يكون بين 1 و 604');
    
    const data = await cachedFetchJSON(`${BASE}/page/${pageNumber}/quran-uthmani`);
    const rawAyahs = data.data.ayahs;

    if (!rawAyahs || rawAyahs.length === 0) throw new Error('لا توجد بيانات لهذه الصفحة');

    // استخراج معلومات الهيدر العلوي للصفحة (اسم السورة الرئيسية، الجزء، الصفحة)
    const primarySurah = rawAyahs[0].surah;
    const juz = rawAyahs[0].juz;
    const page = pageNumber;

    // معالجة الآيات وتنظيم ترويسات السور والبسملة
    const ayahs = rawAyahs.map((a) => {
      let cleanText = a.text;
      const isFirstAyahInSurah = a.numberInSurah === 1;

      // إزالة البسملة المدمجة في نص أول آية (باستثناء الفاتحة والتوبة) لتعرض في تصميم منفصل
      if (isFirstAyahInSurah && a.surah.number !== 1 && a.surah.number !== 9) {
        cleanText = cleanText.replace(/^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, '');
      }

      return {
        number: a.number,                   // الرقم العام للآية في المصحف
        numberInSurah: a.numberInSurah,     // رقم الآية داخل السورة
        text: cleanText,                    // النص العثماني النظيف
        surah: {
          number: a.surah.number,
          nameAr: a.surah.name,
          englishName: a.surah.englishName,
          revelationType: a.surah.revelationType === 'Meccan' ? 'مكية' : 'مدنية',
          numberOfAyahs: a.surah.numberOfAyahs
        },
        juz: a.juz,
        manzil: a.manzil,
        page: a.page,
        ruku: a.ruku,
        hizbQuarter: a.hizbQuarter,
        sajda: a.sajda || false,
        isSurahStart: isFirstAyahInSurah     // هل تبدأ سورة جديدة عند هذه الآية
      };
    });

    return {
      pageNumber: page,
      juzNumber: juz,
      headerSurahName: primarySurah.name,
      ayahs: ayahs
    };
  }

  // 2️⃣ قائمة السور الـ 114 للبحث والانتقال السريع (مع رقم صفحة بداية كل سورة)
  async function getSurahList() {
    const data = await cachedFetchJSON(`${BASE}/meta`);
    return data.data.surahs.references.map((s) => ({
      number: s.number,
      nameAr: s.name,
      nameEn: s.englishName,
      nameTranslation: s.englishNameTranslation,
      ayahCount: s.numberOfAyahs,
      revelationType: s.revelationType === 'Meccan' ? 'مكية' : 'مدنية'
    }));
  }

  // 3️⃣ معرفة رقم الصفحة التي تبدأ عندها سورة معينة
  async function getSurahStartPage(surahNumber) {
    const data = await cachedFetchJSON(`${BASE}/surah/${surahNumber}/quran-uthmani`);
    if (data.data && data.data.ayahs && data.data.ayahs.length > 0) {
      return data.data.ayahs[0].page;
    }
    return 1;
  }

  // 4️⃣ تفسير الميسر لآية محددة
  async function getTafsir(surah, ayah) {
    const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/ar.muyassar`);
    return {
      text: data.data.text,
      source: 'التفسير الميسّر — مجمع الملك فهد لطباعة المصحف الشريف'
    };
  }

  // 5️⃣ رابط تلاوة صوتية للآية (الشيخ مشاري العفاسي)
  async function getAyahAudio(surah, ayah) {
    const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/ar.alafasy`, 24 * 365);
    return data.data.audio;
  }

  // 6️⃣.٥ البحث داخل نص القرآن نفسه بكلمة معينة (وليس بأسماء السور فقط)
  // يستخدم واجهة البحث في alquran.cloud، ويعيد كل الآيات المطابقة في كامل المصحف
  async function searchQuran(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return [];

    const cacheKey = CACHE_PREFIX + 'search:' + kw;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.t < 24 * 3600 * 1000) return parsed.d;
      }
    } catch (e) { /* تجاهل أخطاء التخزين المحلي */ }

    const url = `${BASE}/search/${encodeURIComponent(kw)}/all/quran-uthmani`;
    const res = await fetch(url);

    // الواجهة البرمجية ترجع 404 عند عدم وجود أي نتائج مطابقة، وهذا ليس خطأ اتصال
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('تعذر الاتصال بالخادم: ' + res.status);

    const data = await res.json();
    const matches = (data.data && data.data.matches) || [];
    const results = matches.map((m) => ({
      surahNum: m.surah.number,
      surahNameAr: m.surah.name,
      ayahNum: m.numberInSurah,
      text: m.text,
      page: m.page
    }));

    try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: results })); } catch (e) { /* عند امتلاء الذاكرة */ }
    return results;
  }

  // 6️⃣ معاني الكلمات (تحليل كلمة كلمة) عبر quran.com
  async function getWordMeanings(surah, ayah) {
    const url = `${QCOM}/verses/by_key/${surah}:${ayah}?language=ar&words=true&word_fields=text_uthmani,translation&word_translation_language=ar`;
    const data = await cachedFetchJSON(url);
    const words = (data.verse && data.verse.words) || [];
    return words
      .filter((w) => w.char_type_name === 'word')
      .map((w) => ({
        text: w.text_uthmani || w.text,
        meaning: (w.translation && w.translation.text) || ''
      }));
  }

  return { 
    getPage, 
    getSurahList, 
    getSurahStartPage, 
    getTafsir, 
    getAyahAudio, 
    getWordMeanings,
    searchQuran,
    pageURL
  };
})();