// المصحف الأشرف — طبقة الاتصال بمصادر بيانات القرآن الكريم (نظام صفحات مصحف المدينة)
// المصدر الرئيسي: alquran.cloud (نص مصحف حفص، تفسير الميسر، صوت الشيخ العفاسي)
// المصدر الثانوي لمعاني الكلمات: quran.com API v4
const QuranAPI = (() => {
  const BASE = 'https://api.alquran.cloud/v1';
  const QCOM = 'https://api.quran.com/api/v4';
  const CACHE_PREFIX = 'almus-hraf-cache:';

  // فهرس دائم (سورة → رقم الصفحة) يُبنى تلقائيًا محليًا كلما عُرضت صفحة
  // (سواء من الشبكة أو من الكاش)، ويُستخدم أيضًا أثناء "تحميل كل الصفحات".
  // بهذا يعمل الانتقال المباشر لأي سورة فورًا وبدون إنترنت بمجرد أن تكون
  // صفحتها قد مرّت مرة واحدة على الجهاز، دون أي اعتماد على نقطة اتصال أخرى
  // قد لا تكون مخزَّنة (مثل نقطة /surah/{n} التي لا يخزّنها زر التحميل الشامل).
  const SURAH_PAGE_MAP_KEY = CACHE_PREFIX + 'surahPageMap';

  function loadSurahPageMap() {
    try {
      const raw = localStorage.getItem(SURAH_PAGE_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveSurahStartPage(surahNumber, pageNumber) {
    try {
      const map = loadSurahPageMap();
      if (map[surahNumber] !== pageNumber) {
        map[surahNumber] = pageNumber;
        localStorage.setItem(SURAH_PAGE_MAP_KEY, JSON.stringify(map));
      }
    } catch (e) { /* عند امتلاء الذاكرة */ }
  }

  // يفحص بيانات صفحة خام (كما ترجع من نقطة page/{n}) ويسجّل بداية أي سورة
  // تبدأ في هذه الصفحة. تُستخدم من getPage تلقائيًا، ومن أداة التحميل الشامل
  // في app.js حتى يكتمل الفهرس بمجرد تحميل كل الصفحات ولو مرة واحدة.
  function recordSurahStartPagesFromRawPage(rawData) {
    try {
      const ayahs = rawData && rawData.data && rawData.data.ayahs;
      if (!ayahs) return;
      ayahs.forEach((a) => {
        if (a.numberInSurah === 1) {
          saveSurahStartPage(a.surah.number, a.page);
        }
      });
    } catch (e) { /* تجاهل أي بيانات غير متوقعة */ }
  }

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

    // كل مرة تُعرض فيها صفحة (من الشبكة أو من الكاش) نُحدّث فهرس بدايات
    // السور محليًا، حتى يعمل الانتقال المباشر لأي سورة بدون إنترنت لاحقًا
    recordSurahStartPagesFromRawPage(data);

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
  // أولوية القراءة من الفهرس المحلي الدائم (يعمل فورًا وبدون إنترنت إن كانت
  // صفحة هذه السورة قد مرّت على الجهاز من قبل، سواء بالتصفح أو بالتحميل
  // الشامل)، فإن لم توجد نلجأ للشبكة كحل احتياطي ونضيف النتيجة للفهرس.
  async function getSurahStartPage(surahNumber) {
    const map = loadSurahPageMap();
    if (map[surahNumber]) return map[surahNumber];

    const data = await cachedFetchJSON(`${BASE}/surah/${surahNumber}/quran-uthmani`);
    if (data.data && data.data.ayahs && data.data.ayahs.length > 0) {
      const page = data.data.ayahs[0].page;
      saveSurahStartPage(surahNumber, page);
      return page;
    }
    return 1;
  }

  // 3️⃣.٥ نص نطاق من الآيات (من آية إلى آية) داخل سورة معينة — لمشاركة عدة آيات كصورة واحدة.
  // تُبنى من نقطة "page" نفسها المستخدمة في القراءة العادية وفي "تحميل كل الصفحات"،
  // فتعمل بدون إنترنت طالما أن صفحات هذه السورة سبق أن مرّت على الجهاز (بالتصفح أو بالتحميل الشامل)
  async function getAyahRange(surahNumber, fromAyah, toAyah) {
    const needed = toAyah - fromAyah + 1;
    let page = await getSurahStartPage(surahNumber);
    const collected = [];
    let guard = 0;

    while (collected.length < needed && page <= 604 && guard < 40) {
      let data;
      try {
        data = await getPage(page);
      } catch (e) {
        break;
      }
      let passedSurah = false;
      data.ayahs.forEach((a) => {
        if (a.surah.number === surahNumber && a.numberInSurah >= fromAyah && a.numberInSurah <= toAyah) {
          collected.push({ numberInSurah: a.numberInSurah, text: a.text });
        }
        if (a.surah.number > surahNumber) passedSurah = true;
      });
      if (passedSurah && collected.length < needed) break;
      page += 1;
      guard += 1;
    }

    collected.sort((a, b) => a.numberInSurah - b.numberInSurah);
    return collected;
  }

  // 4️⃣ تفسير الميسر لآية محددة
  async function getTafsir(surah, ayah) {
    const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/ar.muyassar`);
    return {
      text: data.data.text,
      source: 'التفسير الميسّر — مجمع الملك فهد لطباعة المصحف الشريف'
    };
  }

  // قائمة القراء المتاحين للاستماع (معرّفات إصدارات الصوت في شبكة alquran.cloud / cdn.islamic.network)
  const RECITERS = [
    { id: 'ar.alafasy', name: 'مشاري العفاسي' },
    { id: 'ar.abdulbasitmurattal', name: 'عبد الباسط عبد الصمد (مرتل)' },
    { id: 'ar.abdurrahmaansudais', name: 'عبد الرحمن السديس' },
    { id: 'ar.husary', name: 'محمود خليل الحصري' },
    { id: 'ar.minshawi', name: 'محمد صديق المنشاوي' },
    { id: 'ar.mahermuaiqly', name: 'ماهر المعيقلي' },
    { id: 'ar.saoodshuraym', name: 'سعود الشريم' },
    { id: 'ar.ahmedajamy', name: 'أحمد العجمي' },
    // القراء الأربعة التالية بتسجيلات حديثة (مصاحف مرتلة حديثة، وليست تسجيلات قديمة)
    // مصدرها مكتبة mp3quran.net الصوتية بدلاً من alquran.cloud، لأن الأخيرة لا تملك
    // إصدارات آية-بآية لهؤلاء القراء (انظر CUSTOM_SURAH_AUDIO أدناه لروابط السور الكاملة)
    { id: 'ar.yasseraldosari', name: 'ياسر الدوسري' },
    { id: 'ar.faresabbad', name: 'فارس عباد' },
    { id: 'ar.haithamaldukhain', name: 'هيثم الدخين' },
    { id: 'ar.saadalghamdi', name: 'سعد الغامدي' }
  ];

  // روابط مباشرة لسور كاملة من مكتبة mp3quran.net لقراء لا تتوفر تلاواتهم على شبكة
  // cdn.islamic.network (تسجيلات حديثة تمّ التحقق من مصدرها يدويًا). المفتاح هو نفس
  // معرّف القارئ في RECITERS أعلاه، والقيمة دالة تبني رابط ملف mp3 لرقم سورة معيّن
  // (أرقام السور هنا بصيغة 3 خانات مثل 001 وليس 1، بخلاف نمط cdn.islamic.network)
  // ملاحظة مهمة: روابط ملفات mp3quran.net الفعلية تمر عبر مسار "/download/" وليس
  // مباشرة تحت اسم القارئ (تم التحقق من المسار الصحيح يدويًا من صفحات الموقع نفسه)،
  // وبدون هذا الجزء من الرابط كانت كل السور بهؤلاء القراء الأربعة تفشل بصمت
  const CUSTOM_SURAH_AUDIO = {
    'ar.yasseraldosari': (n) => `https://server11.mp3quran.net/download/yasser/${String(n).padStart(3, '0')}.mp3`,
    'ar.faresabbad': (n) => `https://server8.mp3quran.net/download/frs_a/${String(n).padStart(3, '0')}.mp3`,
    'ar.haithamaldukhain': (n) => `https://server16.mp3quran.net/download/h_dukhain/Rewayat-Hafs-A-n-Assem/${String(n).padStart(3, '0')}.mp3`,
    'ar.saadalghamdi': (n) => `https://server7.mp3quran.net/download/s_gmd/${String(n).padStart(3, '0')}.mp3`
  };

  // هل هذا القارئ من القراء الذين لا تتوفر لهم إلا ملفات سورة كاملة (بلا تسجيل آية-بآية)؟
  function isCustomAudioReciter(editionId) {
    return !!CUSTOM_SURAH_AUDIO[editionId];
  }

  // رابط ملف صوتي لسورة كاملة بصوت قارئ محدد
  function getSurahAudioURL(surahNumber, editionId) {
    const ed = editionId || 'ar.alafasy';
    if (CUSTOM_SURAH_AUDIO[ed]) return CUSTOM_SURAH_AUDIO[ed](surahNumber);
    return `https://cdn.islamic.network/quran/audio-surah/128/${ed}/${surahNumber}.mp3`;
  }

  // 5️⃣ رابط تلاوة صوتية للآية (افتراضيًا الشيخ مشاري العفاسي، أو أي قارئ آخر من RECITERS)
  // ملاحظة: القراء الأربعة أعلاه ليس لديهم تسجيل آية-بآية على alquran.cloud (تسجيلاتهم
  // متوفرة سورة كاملة فقط)، لذلك يتفادى app.js استدعاء هذه الدالة لهم أصلاً (انظر
  // isCustomAudioReciter و getSurahAudioURL) ويشغّل لهم ملف السورة الكاملة مباشرة
  // بدل استبدال صوتهم بصوت قارئ آخر بصمت
  async function getAyahAudio(surah, ayah, editionId) {
    const ed = editionId || 'ar.alafasy';
    const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/${ed}`, 24 * 365);
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
    getAyahRange,
    getTafsir, 
    getAyahAudio, 
    getWordMeanings,
    searchQuran,
    pageURL,
    RECITERS,
    getSurahAudioURL,
    isCustomAudioReciter,
    recordSurahStartPagesFromRawPage
  };
})();