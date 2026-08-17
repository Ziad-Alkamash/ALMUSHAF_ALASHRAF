// المصحف الأشرف — منطق التطبيق الرئيسي (نظام صفحات مصحف المدينة)
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // إعدادات خادم إشعارات الدفع (Web Push) — عدّل القيمتين بعد تشغيل
  // سيرفر push-server على الراسبيري باي (راجع ملف push-server/README.md):
  //   serverUrl      : رابط الخادم كما يظهر للمتصفح (يُفضّل HTTPS، مثال عبر Cloudflare Tunnel)
  //   vapidPublicKey : المفتاح العام الذي طبعه أمر "node generate-vapid.js"
  // إذا تُركت فارغة، يستمر التطبيق بالعمل بالتذكيرات المحلية العادية فقط
  // (تعمل أثناء فتح التطبيق) بدون إشعارات push حقيقية بعد إغلاقه.
  // ------------------------------------------------------------------
  const PUSH_CONFIG = {
    serverUrl: 'https://grew-turban-appetite.ngrok-free.dev',
    vapidPublicKey: 'BB4w9rfIO6pY_Xlr5blDSvFxoU-WoSKgR0EN_SQoTvAWnDyw_o7af_hvAotdyx7D2XDVw9kJDKJZtd9qCG_rtng'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    surahList: [],
    currentPage: 1,
    currentPageData: null,
    activeAyah: null, // {surah, ayah, text, surahNameAr}
    audioEl: null,
    surahAudioEl: null,
    surahAudioSurah: null,
    surahAudioReciter: null,
    playerMode: null,        // 'surah' | 'ayah' | null — يحدد سلوك التالي/السابق وعنوان الشريط
    ayahPlayerAyahNum: null  // رقم الآية الحالية داخل السورة، مستخدَم فقط في وضع 'ayah'
  };

  /* ---------------------------------------------------------------- */
  /* أدوات مساعدة عامة                                                 */
  /* ---------------------------------------------------------------- */
  const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  function toArabicDigits(n) {
    return String(n).split('').map((d) => (ARABIC_DIGITS[d] !== undefined ? ARABIC_DIGITS[d] : d)).join('');
  }

  // إزالة علامات التشكيل (الحركات) من النص العربي لتسهيل القراءة والبحث
  // يشمل الحركات، والتنوين، والشدة، والسكون، والمدّة، وعلامة التطويل
  const TASHKEEL_REGEX = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;
  function stripTashkeel(str) {
    return String(str).replace(TASHKEEL_REGEX, '');
  }

  function cleanSurahName(nameAr) {
    return stripTashkeel(String(nameAr).replace(/^(سُورَةُ|سورة)\s*/, '').trim());
  }

  // عدد آيات سورة معينة من فهرس السور المُحمَّل (يُستخدم في محدد نطاق مشاركة الصورة)
  function surahAyahCount(surahNumber) {
    const s = (state.surahList || []).find((x) => x.number === surahNumber);
    return s ? Number(s.ayahCount) || 0 : 0;
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function openOverlay(id) { $(id).classList.add('open'); document.body.classList.add('no-scroll'); }
  function closeOverlay(id) { $(id).classList.remove('open'); document.body.classList.remove('no-scroll'); }

  /* ---------------------------------------------------------------- */
  /* التنقّل بين الأقسام + القائمة المنبثقة (بديل الشريط السفلي)       */
  /* ---------------------------------------------------------------- */
  function switchToTab(tab) {
    $$('.nav-item[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));

    if (tab === 'quran') {
      // في تبويب القرآن يعرض الهيدر اسم السورة الحالية وجزءها بدل عنوان ثابت
      updateQuranHeaderInfo();
      requestAnimationFrame(fitMushafPage);
    } else {
      $('#header-juz').textContent = '';
      $('#header-context').textContent =
        tab === 'home' ? 'ختمتي والملخص' :
        tab === 'azkar' ? 'الأذكار' :
        tab === 'duas' ? 'الأدعية الصحيحة' :
        tab === 'hadith' ? 'الحديث الشريف' :
        tab === 'favorites' ? 'المفضلة' : 'مواقيت الصلاة';
    }

    const audioBtn = $('#btn-header-surah-audio');
    if (audioBtn) audioBtn.classList.toggle('hidden', tab !== 'quran');

    if (tab === 'favorites') renderFavoritesView();
  }

  function updateQuranHeaderInfo() {
    const pageData = state.currentPageData;
    if (!pageData) return;
    const cName = cleanSurahName(pageData.headerSurahName);
    $('#header-context').textContent = cName ? `سورة ${cName}` : 'المصحف الأشرف';
    $('#header-juz').textContent = `جزء ${toArabicDigits(pageData.juzNumber)}`;
  }

  function initNavMenu() {
    $('#btn-menu').addEventListener('click', () => openOverlay('#nav-overlay'));
    $('#btn-close-nav').addEventListener('click', () => closeOverlay('#nav-overlay'));

    $$('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeOverlay('#nav-overlay');

        if (btn.dataset.tab) {
          switchToTab(btn.dataset.tab);
          return;
        }

        const action = btn.dataset.action;
        if (action === 'index') {
          openOverlay('#index-overlay');
        } else if (action === 'search') {
          openOverlay('#index-overlay');
          setTimeout(() => $('#surah-search').focus(), 260);
        } else if (action === 'settings') {
          openOverlay('#settings-overlay');
        } else if (action === 'player') {
          openPlayerOverlay();
        }
      });
    });

    const bookmarkBtn = $('#btn-header-bookmark');
    if (bookmarkBtn) bookmarkBtn.addEventListener('click', goToLastRead);

    // الضغط على اسم السورة أعلى يمين الشاشة يفتح فهرس السور مباشرة
    const headerContext = $('#header-context');
    if (headerContext) {
      headerContext.addEventListener('click', () => openOverlay('#index-overlay'));
    }
  }

  /* ---------------------------------------------------------------- */
  /* تبويب الرئيسية: اختصارات سريعة                                    */
  /* ---------------------------------------------------------------- */
  function initHomeTab() {
    $$('.home-quick-btn[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
    });

    const continueBtn = $('#btn-home-continue');
    if (continueBtn) continueBtn.addEventListener('click', () => switchToTab('quran'));

    const playerBtn = $('#btn-home-player');
    if (playerBtn) playerBtn.addEventListener('click', () => openPlayerOverlay());
  }

  /* ---------------------------------------------------------------- */
  /* تبويب الحديث الشريف: بحث في الموسوعة الحديثية بموقع الدرر السنية  */
  /* ---------------------------------------------------------------- */
  function initHadithTab() {
    const input = $('#hadith-search-input');
    const btn = $('#btn-hadith-search');
    if (!btn) return;

    function openDorarSearch() {
      const q = (input && input.value || '').trim();
      // موقع الدرر السنية يقرأ نص البحث من حقل الاستمارة عبر GET، هذا هو المفتاح
      // المستخدم فعليًا في نموذج البحث الشامل بالموقع
      const url = q
        ? `https://dorar.net/site/search?q=${encodeURIComponent(q)}`
        : 'https://dorar.net/site/search';
      window.open(url, '_blank', 'noopener');
    }

    btn.addEventListener('click', openDorarSearch);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openDorarSearch();
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* شريط الدعاء للصدقة الجارية                                       */
  /* ---------------------------------------------------------------- */
  function initDuaBanner() {
    const aminBtn = $('#btn-amin');
    const duaBanner = $('#dua-banner');

    if (aminBtn && duaBanner) {
      aminBtn.addEventListener('click', () => {
        showToast('آمين، جزاك الله خيراً وتقبل منك الدعاء 🤍');
        duaBanner.classList.add('hidden');
      });
      // تظهر الرسالة في كل مرة يُفتح فيها التطبيق (بدون أي إخفاء دائم)
    }
  }

  /* ---------------------------------------------------------------- */
  /* فهرس السور                                                       */
  /* ---------------------------------------------------------------- */
  async function loadSurahIndex() {
    try {
      state.surahList = await QuranAPI.getSurahList();
      renderSurahList(state.surahList);
    } catch (e) {
      $('#surah-list').innerHTML = `<p class="error-text">تعذر تحميل فهرس السور. تأكد من اتصال الإنترنت ثم أعد المحاولة.</p>`;
    }
  }

  function renderSurahList(list) {
    const wrap = $('#surah-list');
    wrap.innerHTML = list
      .map(
        (s) => {
          const cleanName = cleanSurahName(s.nameAr);
          const revType = (s.revelationType === 'Meccan' || s.revelationType === 'مكية') ? 'مكية' : 'مدنية';
          return `
        <button class="surah-item" data-num="${s.number}">
          <span class="surah-item-num">${toArabicDigits(s.number)}</span>
          <span class="surah-item-info">
            <span class="surah-item-name">سورة ${cleanName}</span>
            <span class="surah-item-sub">${revType} · ${toArabicDigits(s.ayahCount)} آية</span>
          </span>
        </button>`;
        }
      )
      .join('');

    $$('.surah-item', wrap).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const surahNum = Number(btn.dataset.num);
        closeOverlay('#index-overlay');
        switchToTab('quran');
        try {
          const startPage = await QuranAPI.getSurahStartPage(surahNum);
          loadPage(startPage);
        } catch (e) {
          showToast(navigator.onLine
            ? 'تعذر الانتقال لصفحة السورة'
            : 'هذه السورة لم تُفتح من قبل على هذا الجهاز؛ افتحها مرة وأنت متصل بالإنترنت، أو استخدم "تحميل كل الصفحات" من الإعدادات ليعمل الانتقال إليها لاحقًا بدون إنترنت');
        }
      });
    });
  }

  function switchToQuranTab() {
    switchToTab('quran');
  }

  function initIndexOverlay() {
    $('#btn-close-index').addEventListener('click', () => closeOverlay('#index-overlay'));
    $('#surah-search').addEventListener('input', (e) => {
      // البحث بدون تشكيل حتى لا يضطر المستخدم لكتابة الحركات
      const q = stripTashkeel(e.target.value.trim());
      if (!q) return renderSurahList(state.surahList);
      const filtered = state.surahList.filter(
        (s) => stripTashkeel(s.nameAr).includes(q) || s.nameEn.toLowerCase().includes(q.toLowerCase())
      );
      renderSurahList(filtered);
    });

    initIndexTabs();
    initAyahTextSearch();
  }

  /* -------- تبديل تبويبي (فهرس السور / بحث في الآيات) داخل نافذة الفهرس -------- */
  function initIndexTabs() {
    $$('.index-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.index-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.indexTab;
        $$('.index-tab-panel').forEach((p) => p.classList.toggle('active', p.id === `index-tab-${target}`));
        if (target === 'ayah') setTimeout(() => $('#ayah-search').focus(), 220);
      });
    });
  }

  /* -------- بحث حقيقي داخل نص القرآن نفسه (وليس بأسماء السور فقط) -------- */
  const TASHKEEL_SINGLE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/;

  function highlightAyahSnippet(original, query) {
    const strippedQuery = stripTashkeel(query).trim();
    if (!strippedQuery) return escapeHTML(original);

    let stripped = '';
    const mapping = [];
    for (let i = 0; i < original.length; i++) {
      if (!TASHKEEL_SINGLE.test(original[i])) {
        stripped += original[i];
        mapping.push(i);
      }
    }

    const idx = stripped.indexOf(strippedQuery);
    if (idx === -1) return escapeHTML(original);

    const startOrig = mapping[idx];
    const endOrig = mapping[idx + strippedQuery.length - 1] + 1;
    return (
      escapeHTML(original.slice(0, startOrig)) +
      '<mark class="ayah-hit">' + escapeHTML(original.slice(startOrig, endOrig)) + '</mark>' +
      escapeHTML(original.slice(endOrig))
    );
  }

  function renderAyahSearchResults(results, query) {
    const wrap = $('#ayah-search-results');
    if (!results.length) {
      wrap.innerHTML = `<p class="ayah-search-hint">لا توجد آيات تحتوي على "${escapeHTML(query)}"، جرّب كلمة أخرى بدون تشكيل.</p>`;
      return;
    }

    wrap.innerHTML = results
      .slice(0, 60)
      .map((r) => {
        const cName = cleanSurahName(r.surahNameAr);
        return `
        <button class="ayah-hit-item" data-page="${r.page}" data-surah="${r.surahNum}" data-ayah="${r.ayahNum}">
          <span class="ayah-hit-ref">سورة ${cName} — الآية ${toArabicDigits(r.ayahNum)}</span>
          <span class="ayah-hit-text">${highlightAyahSnippet(r.text, query)}</span>
        </button>`;
      })
      .join('');

    $$('.ayah-hit-item', wrap).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const page = Number(btn.dataset.page);
        const surahNum = btn.dataset.surah;
        const ayahNum = btn.dataset.ayah;
        closeOverlay('#index-overlay');
        switchToTab('quran');
        await loadPage(page);
        setTimeout(() => {
          const target = $(`.ayah[data-surah="${surahNum}"][data-ayah="${ayahNum}"]`);
          if (target) {
            target.classList.add('ayah-highlight');
            setTimeout(() => target.classList.remove('ayah-highlight'), 2500);
          }
        }, 300);
      });
    });
  }

  function initAyahTextSearch() {
    const input = $('#ayah-search');
    if (!input) return;
    let searchTimer = null;

    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchTimer);
      const wrap = $('#ayah-search-results');

      if (q.length < 2) {
        wrap.innerHTML = `<p class="ayah-search-hint">اكتب كلمة من أي آية في القرآن الكريم للوصول إليها مباشرة، بحث شامل في كل صفحات المصحف.</p>`;
        return;
      }

      wrap.innerHTML = `<p class="loading-text">جارٍ البحث في نص القرآن الكريم...</p>`;
      searchTimer = setTimeout(async () => {
        try {
          const results = await QuranAPI.searchQuran(q);
          // تجاهل النتيجة إن كان المستخدم قد غيّر نص البحث أثناء انتظار الرد
          if (input.value.trim() === q) renderAyahSearchResults(results, q);
        } catch (err) {
          wrap.innerHTML = `<p class="error-text">تعذّر البحث الآن. تحقّق من اتصال الإنترنت وحاول مجددًا.</p>`;
        }
      }, 500);
    });
  }

  /* ---------------------------------------------------------------- */
  /* عرض المصحف (نظام الصفحات 604)                                    */
  /* ---------------------------------------------------------------- */
  async function loadPage(pageNumber) {
    if (pageNumber < 1) pageNumber = 1;
    if (pageNumber > 604) pageNumber = 604;

    const container = $('#ayat-container');
    container.innerHTML = `<p class="loading-text">جارٍ تحميل الصفحة ${toArabicDigits(pageNumber)}...</p>`;

    try {
      const pageData = await QuranAPI.getPage(pageNumber);
      state.currentPage = pageNumber;
      state.currentPageData = pageData;
      localStorage.setItem('almus-hraf:currentPage', String(pageNumber));
      recordKhatmaPageRead(pageNumber);

      const cleanHeaderName = cleanSurahName(pageData.headerSurahName);
      $('#surah-name-ar').textContent = `سورة ${cleanHeaderName}`;

      const firstAyah = pageData.ayahs && pageData.ayahs[0];

      // اسم السورة يظهر بالبانر الزخرفي داخل الصفحة فقط إذا كانت الصفحة تبدأ بأول آية
      // من سورة جديدة فعليًا؛ أما صفحات استكمال نفس السورة فلا تكرر عرض الاسم هنا،
      // ويكفي وجوده في شريط الهيدر العلوي الرفيع.
      const startsNewSurah = !!(firstAyah && firstAyah.isSurahStart);
      $('#surah-header').classList.toggle('hidden', !startsNewSurah);

      if (firstAyah && firstAyah.surah) {
        const rev = (firstAyah.surah.revelationType === 'Meccan' || firstAyah.surah.revelationType === 'مكية') ? 'مكية' : 'مدنية';
        const ayahsCount = firstAyah.surah.numberOfAyahs || firstAyah.surah.ayahCount;
        $('#surah-meta').textContent = `${rev} · ${toArabicDigits(ayahsCount)} آية · الجزء ${toArabicDigits(pageData.juzNumber)} · الصفحة ${toArabicDigits(pageNumber)}`;
      } else {
        $('#surah-meta').textContent = `الجزء ${toArabicDigits(pageData.juzNumber)} · الصفحة ${toArabicDigits(pageNumber)}`;
      }

      renderPageContent(pageData);

      $('#surah-progress').textContent = `صفحة ${toArabicDigits(pageNumber)} / ٦٠٤`;

      if (firstAyah && firstAyah.hizbQuarter) {
        const hizbNum = Math.ceil(firstAyah.hizbQuarter / 4);
        const quarterInHizb = ((firstAyah.hizbQuarter - 1) % 4) + 1;
        $('#page-hizb-info').textContent = `الحزب ${toArabicDigits(hizbNum)} · ${toArabicDigits(quarterInHizb)}/٤`;
      } else {
        $('#page-hizb-info').textContent = '';
      }

      updateQuranHeaderInfo();
      requestAnimationFrame(fitMushafPage);
    } catch (e) {
      container.innerHTML = `<p class="error-text">تعذّر تحميل الصفحة. تحقّق من اتصال الإنترنت وحاول مجددًا.<br><button class="chip-btn" id="retry-page">إعادة المحاولة</button></p>`;
      const retry = $('#retry-page');
      if (retry) retry.addEventListener('click', () => loadPage(pageNumber));
    }
  }

  function renderPageContent(pageData) {
    const container = $('#ayat-container');
    const frag = document.createDocumentFragment();

    const bismillahEl = $('#bismillah');
    if (bismillahEl) bismillahEl.style.display = 'none';

    pageData.ayahs.forEach((a) => {
      if (a.isSurahStart) {
        if (a.numberInSurah === 1 && a.surah.number !== pageData.ayahs[0].surah.number) {
          const headerDiv = document.createElement('div');
          headerDiv.className = 'mushaf-surah-divider';

          const cName = cleanSurahName(a.surah.nameAr);

          headerDiv.innerHTML = `
            <span class="mushaf-surah-divider-name">سورة ${cName}</span>
          `;
          frag.appendChild(headerDiv);
        }

        if (a.surah.number !== 1 && a.surah.number !== 9) {
          const bisDiv = document.createElement('div');
          bisDiv.className = 'mushaf-bismillah';
          bisDiv.textContent = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
          frag.appendChild(bisDiv);
        }
      }

      const span = document.createElement('span');
      span.className = 'ayah';
      span.dataset.surah = a.surah.number;
      span.dataset.ayah = a.numberInSurah;
      span.dataset.page = pageData.pageNumber;

      span.textContent = a.text + ' ';

      const marker = document.createElement('span');
      marker.className = 'ayah-marker';
      marker.textContent = toArabicDigits(a.numberInSurah);
      span.appendChild(marker);

      span.addEventListener('click', () => openAyahModal(a.surah.number, a.numberInSurah, a.text, a.surah.nameAr));
      frag.appendChild(span);
    });

    container.innerHTML = '';
    container.appendChild(frag);

    // إن كان الصوت شغالًا حاليًا، ظلّل الآية الحالية إن كانت موجودة على هذه الصفحة الجديدة
    if (window.__playerControls && window.__playerControls.reapplyAyahHighlight) {
      window.__playerControls.reapplyAyahHighlight();
    }
  }

  /* ---------------------------------------------------------------- */
  /* التلاؤم التلقائي: تصغير خط الصفحة تدريجيًا حتى تظهر كاملة بدون    */
  /* أي حاجة للتمرير الرأسي، تمامًا كصفحات المصحف الورقي الحقيقية.     */
  /* ---------------------------------------------------------------- */
  let fitRafId = null;
  function fitMushafPage() {
    if (fitRafId) cancelAnimationFrame(fitRafId);
    fitRafId = requestAnimationFrame(() => {
      const wrap = $('#mushaf-wrap');
      const page = $('#mushaf-page');
      if (!wrap || !page) return;

      const root = document.documentElement;
      let scale = 1;
      root.style.setProperty('--autofit-scale', '1');

      const available = wrap.clientHeight;
      let guard = 0;
      // نقيس ارتفاع محتوى الصفحة الفعلي (بدون قص) مقارنة بالمساحة المتاحة
      while (page.scrollHeight > available && scale > 0.45 && guard < 60) {
        scale -= 0.02;
        root.style.setProperty('--autofit-scale', scale.toFixed(3));
        guard++;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* تقليب الصفحات بالسحب (Swipe / Drag) — إحساس المصحف الحقيقي        */
  /* يعمل باللمس وبالماوس معًا عبر Pointer Events.                     */
  /* المصحف يُقرأ من اليمين لليسار: الصفحة الأولى (الفاتحة) في أقصى    */
  /* اليمين، وكل صفحة تالية (البقرة...) تأتي بعدها ناحية اليسار.       */
  /* لذلك: السحب من اليسار إلى اليمين (تحريك الإصبع لليمين) يكشف ما    */
  /* هو "بعدها" في المصحف فيقدّم الصفحة التالية (goNextPage).          */
  /* والسحب من اليمين إلى اليسار يرجع للصفحة السابقة (goPrevPage).     */
  /* ---------------------------------------------------------------- */
  let isFlipAnimating = false;

  // تأثير بسيط وخفيف: انزلاق أفقي مع تلاشٍ خطي بدون أي دوران ثلاثي الأبعاد
  // أو حسابات ظل معقّدة، فيبقى سلسًا وسريعًا حتى على الأجهزة الأضعف.
  // الصفحة تكمل الحركة في نفس اتجاه السحب مباشرة (بدون أي ارتداد للخلف
  // قبل أن تكمل)، والصفحة الجديدة تدخل من الجهة المقابلة فقط.
  function flipToPage(pageNumber, direction) {
    if (isFlipAnimating) return;
    const flipEl = $('#mushaf-page');
    if (!flipEl) { loadPage(pageNumber); return; }

    isFlipAnimating = true;
    const pageWidth = flipEl.getBoundingClientRect().width || 320;
    // "next" تعني أن السحب كان لليمين (قيمة موجبة)، فتكمل الصفحة الخارجة
    // نفس اتجاه السحب لليمين بدل الارتداد لليسار
    const exitX = direction === 'next' ? pageWidth * 0.55 : -pageWidth * 0.55;

    flipEl.style.transition = 'transform .15s ease-out, opacity .15s ease-out';
    flipEl.style.transform = `translateX(${exitX}px)`;
    flipEl.style.opacity = '0';

    setTimeout(async () => {
      await loadPage(pageNumber);

      // إدخال الصفحة الجديدة من الجهة المقابلة لاتجاه السحب
      flipEl.style.transition = 'none';
      const enterX = direction === 'next' ? -pageWidth * 0.55 : pageWidth * 0.55;
      flipEl.style.transform = `translateX(${enterX}px)`;
      flipEl.style.opacity = '0';

      // إجبار إعادة الرسم قبل بدء انتقال الدخول حتى تعمل الحركة
      void flipEl.offsetWidth;

      flipEl.style.transition = 'transform .17s ease-out, opacity .17s ease-out';
      flipEl.style.transform = 'translateX(0)';
      flipEl.style.opacity = '1';

      setTimeout(() => {
        flipEl.style.transition = '';
        isFlipAnimating = false;
      }, 180);
    }, 150);
  }

  function goNextPage() {
    const n = state.currentPage < 604 ? state.currentPage + 1 : 1;
    flipToPage(n, 'next');
  }
  function goPrevPage() {
    const n = state.currentPage > 1 ? state.currentPage - 1 : 604;
    flipToPage(n, 'prev');
  }

  function initSwipeNavigation() {
    const flipEl = $('#mushaf-page');
    const wrap = $('#mushaf-wrap');
    if (!flipEl || !wrap) return;

    const SWIPE_RATIO_THRESHOLD = 0.2;   // لازم تسحب ٢٠٪ من عرض الصفحة على الأقل
    const FLICK_VELOCITY_THRESHOLD = 0.55; // px/ms لسحبة سريعة خفيفة

    let dragging = false;
    let axisLocked = null; // 'x' | 'y' | null
    let startX = 0, startY = 0, currentX = 0;
    let pageWidth = 0;
    let lastX = 0, lastT = 0, velocity = 0;
    let hadDrag = false;

    function onPointerDown(e) {
      if (isFlipAnimating) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      axisLocked = null;
      hadDrag = false;
      pageWidth = flipEl.getBoundingClientRect().width || 320;
      startX = e.clientX;
      startY = e.clientY;
      currentX = 0;
      lastX = startX;
      lastT = performance.now();
      velocity = 0;
    }

    function onPointerMove(e) {
      if (!dragging || isFlipAnimating) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (axisLocked === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (axisLocked === 'x') flipEl.classList.add('dragging');
        }
      }

      if (axisLocked === 'y') return; // اترك التمرير الرأسي الطبيعي للصفحة يعمل

      if (axisLocked === 'x') {
        e.preventDefault();
        hadDrag = true;
        currentX = dx;

        const now = performance.now();
        const dt = now - lastT || 1;
        velocity = (e.clientX - lastX) / dt;
        lastX = e.clientX;
        lastT = now;

        const resistance = 0.6; // مقاومة بسيطة تعطي إحساس طبيعي للسحب
        const translate = currentX * resistance;
        const fade = Math.max(0.55, 1 - Math.abs(translate) / pageWidth);
        flipEl.style.transform = `translateX(${translate}px)`;
        flipEl.style.opacity = String(fade);
      }
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      flipEl.classList.remove('dragging');

      if (axisLocked !== 'x') { axisLocked = null; return; }
      axisLocked = null;

      const ratio = currentX / pageWidth;
      const isFlick = Math.abs(velocity) > FLICK_VELOCITY_THRESHOLD;

      // المصحف يُقرأ من اليمين لليسار: السحب لليمين (ratio موجب) يكشف
      // الصفحة "التالية" في ترتيب المصحف، والسحب لليسار (ratio سالب)
      // يرجع "للصفحة السابقة".
      if (ratio >= SWIPE_RATIO_THRESHOLD || (isFlick && currentX > 10)) {
        goNextPage();
      } else if (ratio <= -SWIPE_RATIO_THRESHOLD || (isFlick && currentX < -10)) {
        goPrevPage();
      } else {
        snapBack();
      }
    }

    function snapBack() {
      flipEl.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
      flipEl.style.transform = 'translateX(0)';
      flipEl.style.opacity = '1';
      setTimeout(() => { flipEl.style.transition = ''; }, 190);
    }

    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('pointermove', onPointerMove, { passive: false });
    wrap.addEventListener('pointerup', onPointerUp);
    wrap.addEventListener('pointercancel', onPointerUp);

    // منع فتح نافذة الآية بالخطأ لو كانت هذه اللمسة سحبة تقليب صفحة
    wrap.addEventListener(
      'click',
      (e) => {
        if (hadDrag) {
          e.stopPropagation();
          e.preventDefault();
          hadDrag = false;
        }
      },
      true
    );
  }

  function initSwipeHintOnce() {
    if (localStorage.getItem('almus-hraf:sawSwipeHint')) return;
    setTimeout(() => {
      showToast('مرّر بإصبعك يمينًا أو يسارًا لتقليب الصفحة 👉👈');
      localStorage.setItem('almus-hraf:sawSwipeHint', '1');
    }, 1400);
  }

  /* ---------------------------------------------------------------- */
  /* نافذة خيارات الآية ومشاركة الصورة                                  */
  /* ---------------------------------------------------------------- */
  function openAyahModal(surah, ayah, text, surahNameAr) {
    state.activeAyah = { surah, ayah, text, surahNameAr };
    const cName = cleanSurahName(surahNameAr);
    $('#ayah-modal-title').textContent = `سورة ${cName} — الآية ${toArabicDigits(ayah)}`;
    $('#ayah-modal-text').textContent = text;
    $('#ayah-panel-content').innerHTML = '';
    $('#ayah-panel-content').classList.remove('open');
    $$('.option-btn').forEach((b) => b.classList.remove('active'));

    const audioBtn = $('#btn-ayah-audio');
    if (audioBtn) audioBtn.querySelector('.opt-icon').innerHTML = '<svg><use href="#icon-play"></use></svg>';
    if (state.audioEl) { state.audioEl.pause(); state.audioEl = null; }

    openOverlay('#ayah-overlay');
  }

  function initAyahModal() {
    $('#btn-close-ayah').addEventListener('click', () => closeOverlay('#ayah-overlay'));

    $$('.option-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleAyahOption(btn.dataset.panel, btn));
    });
  }

  /* -------- زخارف مساعدة لصورة مشاركة الآية -------- */
  function drawCornerEmblem(ctx, cx, cy, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i;
      const x = Math.cos(angle) * 22;
      const y = Math.sin(angle) * 22;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawOrnamentDivider(ctx, cx, y, halfWidth, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, y);
    ctx.lineTo(cx - 28, y);
    ctx.moveTo(cx + 28, y);
    ctx.lineTo(cx + halfWidth, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, y - 12); ctx.lineTo(cx + 8, y); ctx.lineTo(cx, y + 12); ctx.lineTo(cx - 8, y);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* -------- توليد صورة أنيقة لآية واحدة أو مجموعة آيات متتالية، بنفس روح تصميم صفحة المصحف -------- */
  async function generateAyahImage(surahName, fromAyah, toAyah, ayahsList) {
    // تأكيد تحميل الخطوط المطلوبة قبل الرسم حتى لا تظهر بخط افتراضي بديل
    try {
      await Promise.all([
        document.fonts.load('700 44px "Aref Ruqaa"'),
        document.fonts.load('44px "Amiri Quran"'),
        document.fonts.load('400 24px "Tajawal"'),
        document.fonts.load('700 24px "Tajawal"')
      ]);
    } catch (e) { /* نتابع حتى لو تعذّر التأكد من تحميل الخط */ }

    const WIDTH = 1080;
    const cleanSurah = cleanSurahName(surahName);
    const maxTextWidth = WIDTH - 230;
    const isRange = fromAyah !== toAyah;

    // دمج الآيات في فقرة واحدة متصلة، وكل آية تنتهي بعلامة نهاية آية زخرفية (رقمها بالأرقام العربية)
    const fullText = ayahsList.map((a) => `${a.text.trim()} ﴿${toArabicDigits(a.num)}﴾`).join(' ');

    const measureCanvas = document.createElement('canvas');
    const mctx = measureCanvas.getContext('2d');

    function wrapText(fontSize) {
      mctx.font = `${fontSize}px "Amiri Quran", "Traditional Arabic", serif`;
      const words = fullText.split(' ');
      const lines = [];
      let line = '';
      words.forEach((w) => {
        const test = line ? line + ' ' + w : w;
        if (mctx.measureText(test).width > maxTextWidth && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      });
      if (line) lines.push(line);
      return lines;
    }

    // حجم خط تلقائي يتناسب مع طول النص حتى يملأ النص مساحة الصورة بشكل جيد
    let fontSize = fullText.length > 500 ? 32 : fullText.length > 340 ? 36 : fullText.length > 260 ? 40 : fullText.length > 170 ? 48 : fullText.length > 100 ? 58 : fullText.length > 50 ? 68 : 80;
    let lines = wrapText(fontSize);
    while (lines.length > 22 && fontSize > 26) {
      fontSize -= 2;
      lines = wrapText(fontSize);
    }

    const lineHeight = Math.round(fontSize * 1.85);
    const HEADER_H = 250;
    const FOOTER_H = 200;
    const textBlockHeight = lines.length * lineHeight;
    const HEIGHT = Math.max(1080, HEADER_H + FOOTER_H + textBlockHeight + 100);

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.direction = 'rtl';

    const GOLD = '#C9A227';
    const GOLD_DEEP = '#8B6914';
    const INK = '#171310';
    const INK_SOFT = '#5B4632';
    const EMERALD = '#06291F';

    // خلفية ورقية دافئة تحاكي صفحة المصحف الحقيقية
    const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    bgGrad.addColorStop(0, '#FBF6E7');
    bgGrad.addColorStop(1, '#F1E4BD');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // إطار ذهبي مزدوج على طراز زخرفة المصاحف
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 7;
    ctx.strokeRect(34, 34, WIDTH - 68, HEIGHT - 68);
    ctx.strokeStyle = GOLD_DEEP;
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 50, WIDTH - 100, HEIGHT - 100);

    // زخارف نجمية في الأركان الأربعة
    drawCornerEmblem(ctx, 70, 70, GOLD);
    drawCornerEmblem(ctx, WIDTH - 70, 70, GOLD);
    drawCornerEmblem(ctx, 70, HEIGHT - 70, GOLD);
    drawCornerEmblem(ctx, WIDTH - 70, HEIGHT - 70, GOLD);

    // اسم السورة ونطاق الآية/الآيات أعلى الصورة
    ctx.textAlign = 'center';
    ctx.fillStyle = EMERALD;
    ctx.font = '700 46px "Aref Ruqaa", serif';
    ctx.fillText(`سورة ${cleanSurah}`, WIDTH / 2, 148);

    ctx.fillStyle = GOLD_DEEP;
    ctx.font = '700 26px "Tajawal", sans-serif';
    ctx.fillText(
      isRange ? `الآيات ${toArabicDigits(fromAyah)} — ${toArabicDigits(toAyah)}` : `الآية ${toArabicDigits(fromAyah)}`,
      WIDTH / 2, 194
    );

    drawOrnamentDivider(ctx, WIDTH / 2, 224, 260, GOLD);

    // نص الآيات بخط القرآن يملأ منتصف الصورة بالكامل
    ctx.fillStyle = INK;
    ctx.font = `${fontSize}px "Amiri Quran", "Traditional Arabic", serif`;
    ctx.textAlign = 'center';
    const textTop = HEADER_H + (HEIGHT - HEADER_H - FOOTER_H - textBlockHeight) / 2;
    let y = textTop + lineHeight * 0.72;
    lines.forEach((line) => {
      ctx.fillText(line.trim(), WIDTH / 2, y);
      y += lineHeight;
    });

    // فاصل زخرفي سفلي وبيانات التطبيق
    const footTop = HEIGHT - FOOTER_H;
    drawOrnamentDivider(ctx, WIDTH / 2, footTop + 26, 260, GOLD);

    ctx.fillStyle = INK_SOFT;
    ctx.font = '24px "Tajawal", sans-serif';
    ctx.fillText('صدقة جارية عن المرحوم بإذن الله: أشرف أحمد جاهين', WIDTH / 2, footTop + 80);

    ctx.fillStyle = GOLD_DEEP;
    ctx.font = '700 26px "Aref Ruqaa", serif';
    ctx.fillText('المصحف الأشرف', WIDTH / 2, footTop + 128);

    const rangeLabel = isRange ? `${fromAyah}-${toAyah}` : `${fromAyah}`;
    canvas.toBlob((blob) => {
      if (!blob) return showToast('تعذّر إنشاء الصورة، حاول مجددًا');
      const file = new File([blob], `ayah-${rangeLabel}.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: `سورة ${cleanSurah}`,
          text: `${ayahsList.map((a) => a.text.trim()).join(' ')} [سورة ${cleanSurah}: ${rangeLabel}]`
        }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `المصحف-الأشرف-آية-${rangeLabel}.png`;
        a.click();
      }
    });
  }

  /* -------- محدد نطاق الآيات لمشاركتها كصورة واحدة (من آية كذا إلى آية كذا) -------- */
  async function renderShareImageRangePicker(panelEl, surah, ayah, surahNameAr) {
    panelEl.classList.add('open');
    panelEl.innerHTML = `<p class="loading-text">جارٍ التحميل...</p>`;

    if (!state.surahList || !state.surahList.length) {
      try { await loadSurahIndex(); } catch (e) { /* سنعتمد على الآية الحالية فقط إن تعذر */ }
    }
    const maxAyah = surahAyahCount(surah) || ayah;
    const cName = cleanSurahName(surahNameAr);

    panelEl.innerHTML = `
      <div class="share-range-picker">
        <p class="panel-text muted">اختر نطاق الآيات من سورة ${escapeHTML(cName)} التي تريد مشاركتها في صورة واحدة (يمكن اختيار آية واحدة أو أكثر).</p>
        <div class="share-range-row">
          <label class="share-range-field">
            <span>من الآية</span>
            <input type="number" id="share-range-from" class="time-input" min="1" max="${maxAyah}" value="${ayah}">
          </label>
          <label class="share-range-field">
            <span>إلى الآية</span>
            <input type="number" id="share-range-to" class="time-input" min="1" max="${maxAyah}" value="${ayah}">
          </label>
        </div>
        <button class="btn-primary" id="btn-generate-share-image">
          <span class="opt-icon">🖼️</span>
          <span>إنشاء الصورة ومشاركتها</span>
        </button>
      </div>`;

    const fromInput = $('#share-range-from', panelEl);
    const toInput = $('#share-range-to', panelEl);
    const genBtn = $('#btn-generate-share-image', panelEl);

    genBtn.addEventListener('click', async () => {
      let from = Math.round(Number(fromInput.value)) || ayah;
      let to = Math.round(Number(toInput.value)) || ayah;
      from = Math.min(Math.max(from, 1), maxAyah);
      to = Math.min(Math.max(to, 1), maxAyah);
      if (from > to) { const t = from; from = to; to = t; }

      genBtn.disabled = true;
      genBtn.querySelector('span').textContent = 'جارٍ تجهيز الصورة...';
      try {
        // ١) اجمع أولاً من بيانات الصفحة المفتوحة حاليًا في الذاكرة — بدون أي اتصال بالإنترنت إطلاقًا
        const collected = new Map();
        const cur = state.currentPageData;
        if (cur && cur.ayahs) {
          cur.ayahs.forEach((a) => {
            if (a.surah.number === surah && a.numberInSurah >= from && a.numberInSurah <= to) {
              collected.set(a.numberInSurah, a.text);
            }
          });
        }
        if (state.activeAyah && state.activeAyah.surah === surah && state.activeAyah.ayah >= from && state.activeAyah.ayah <= to) {
          collected.set(state.activeAyah.ayah, state.activeAyah.text);
        }

        // ٢) لو النطاق يمتد خارج الصفحة الحالية، أكمل الباقي عبر نفس نقطة جلب الصفحات
        // المستخدمة في القراءة العادية و"تحميل كل الصفحات" — فتعمل بدون إنترنت لو
        // كانت هذه الصفحات قد مرّت على الجهاز من قبل، بدل الاعتماد على اتصال جديد مختلف
        if (collected.size < (to - from + 1)) {
          const extra = await QuranAPI.getAyahRange(surah, from, to);
          extra.forEach((a) => { if (!collected.has(a.numberInSurah)) collected.set(a.numberInSurah, a.text); });
        }

        const ayahsList = Array.from(collected.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([num, text]) => ({ num, text }));

        if (!ayahsList.length) throw new Error('no-ayahs');
        await generateAyahImage(surahNameAr, from, to, ayahsList);
      } catch (e) {
        showToast('تعذّر تجهيز الصورة لبعض هذه الآيات، حاول فتح صفحاتها أولًا ثم أعد المحاولة');
      } finally {
        genBtn.disabled = false;
        genBtn.querySelector('span').textContent = 'إنشاء الصورة ومشاركتها';
      }
    });
  }

  async function handleAyahOption(panel, btnEl) {
    const { surah, ayah, text, surahNameAr } = state.activeAyah;
    const panelEl = $('#ayah-panel-content');

    if (panel === 'audio') {
      return toggleAyahAudio(btnEl);
    }
    if (panel === 'play-from-here') {
      closeOverlay('#ayah-overlay');
      if (window.__playerControls && window.__playerControls.playAyahContinuous) {
        window.__playerControls.playAyahContinuous(surah, ayah);
        showToast('بدأ التشغيل المتواصل من هذه الآية، وهيكمل تلقائيًا لحد ما توقفه 🎧');
      }
      return;
    }
    if (panel === 'bookmark') {
      localStorage.setItem(
        'almus-hraf:bookmark',
        JSON.stringify({
          page: state.currentPage,
          surah,
          ayah,
          surahNameAr,
          savedAt: Date.now()
        })
      );
      const cName = cleanSurahName(surahNameAr);
      showToast(`تم حفظ آخر قراءة: سورة ${cName} — آية ${toArabicDigits(ayah)} (صفحة ${toArabicDigits(state.currentPage)})`);
      return;
    }

    if (panel === 'share-img') {
      $$('.option-btn').forEach((b) => b.classList.toggle('active', b === btnEl));
      renderShareImageRangePicker(panelEl, surah, ayah, surahNameAr);
      return;
    }

    $$('.option-btn').forEach((b) => b.classList.toggle('active', b === btnEl));
    panelEl.classList.add('open');
    panelEl.innerHTML = `<p class="loading-text">جارٍ التحميل...</p>`;

    try {
      if (panel === 'tafsir') {
        const t = await QuranAPI.getTafsir(surah, ayah);
        panelEl.innerHTML = `<p class="panel-text">${escapeHTML(t.text)}</p><p class="panel-source">${escapeHTML(t.source)}</p>`;
      } else if (panel === 'asbab') {
        const key = `${surah}:${ayah}`;
        const found = typeof ASBAB_DATA !== 'undefined' ? ASBAB_DATA[key] : null;
        panelEl.innerHTML = found
          ? `<p class="panel-text">${escapeHTML(found)}</p>`
          : `<p class="panel-text muted">${escapeHTML(typeof ASBAB_FALLBACK !== 'undefined' ? ASBAB_FALLBACK : 'لا يوجد سبب نزول وارد لهذه الآية في المصدر المعتمد.')}</p>`;
      } else if (panel === 'gharib') {
        const words = await QuranAPI.getWordMeanings(surah, ayah);
        if (!words.length) throw new Error('no-data');
        panelEl.innerHTML = `<div class="gharib-list">${words
          .map(
            (w) => `<div class="gharib-item"><span class="gharib-word">${escapeHTML(w.text)}</span><span class="gharib-meaning">${escapeHTML(w.meaning || '—')}</span></div>`
          )
          .join('')}</div>`;
      }
    } catch (e) {
      panelEl.innerHTML = `<p class="error-text">تعذّر تحميل هذا المحتوى الآن. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.</p>`;
    }
  }

  function escapeHTML(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  const RECITER_KEY = 'almus-hraf:reciter';
  function getSelectedReciter() {
    return localStorage.getItem(RECITER_KEY) || 'ar.alafasy';
  }

  async function toggleAyahAudio(btnEl) {
    const iconWrap = btnEl.querySelector('.opt-icon');
    if (state.audioEl && !state.audioEl.paused) {
      state.audioEl.pause();
      iconWrap.innerHTML = '<svg><use href="#icon-play"></use></svg>';
      return;
    }
    try {
      // إيقاف مشغّل السورة كاملة إن كان يعمل، تجنبًا لتداخل صوتين معًا
      if (state.surahAudioEl && !state.surahAudioEl.paused) {
        state.surahAudioEl.pause();
        const surahPlayBtn = $('#surah-audio-playpause');
        if (surahPlayBtn) surahPlayBtn.innerHTML = '<svg><use href="#icon-play"></use></svg>';
      }

      if (!state.audioEl) {
        iconWrap.innerHTML = '⏳';
        const { surah, ayah } = state.activeAyah;
        const url = await QuranAPI.getAyahAudio(surah, ayah, getSelectedReciter());
        state.audioEl = new Audio(url);
        state.audioEl.addEventListener('ended', () => {
          iconWrap.innerHTML = '<svg><use href="#icon-play"></use></svg>';
        });
      }
      await state.audioEl.play();
      iconWrap.innerHTML = '<svg><use href="#icon-pause"></use></svg>';
    } catch (e) {
      iconWrap.innerHTML = '<svg><use href="#icon-play"></use></svg>';
      showToast('تعذّر تشغيل الصوت، تحقّق من الاتصال بالإنترنت');
    }
  }

  /* ---------------------------------------------------------------- */
  /* المشغّل الصوتي الكامل: اختيار أي سورة وأي قارئ، تشغيل متتابع        */
  /* ---------------------------------------------------------------- */
  const PLAYER_CONTINUOUS_KEY = 'almus-hraf:playerContinuous';

  function isPlayerContinuous() {
    return localStorage.getItem(PLAYER_CONTINUOUS_KEY) !== '0';
  }

  function reciterName(id) {
    const r = (typeof QuranAPI !== 'undefined' && QuranAPI.RECITERS || []).find((x) => x.id === id);
    return r ? r.name : id;
  }

  function formatPlayerTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return toArabicDigits(`${m}:${String(s).padStart(2, '0')}`);
  }

  // بطاقات اختيار القارئ تظهر في مكانين (الإعدادات والمشغّل)، ونُبقيها متزامنة معًا
  function renderReciterChips(containerSel) {
    const wrap = $(containerSel);
    if (!wrap || typeof QuranAPI === 'undefined' || !QuranAPI.RECITERS) return;
    const current = getSelectedReciter();
    wrap.innerHTML = QuranAPI.RECITERS.map(
      (r) => `<button class="chip-btn reciter-choice ${r.id === current ? 'active' : ''}" data-reciter="${r.id}">${escapeHTML(r.name)}</button>`
    ).join('');
    $$('.reciter-choice', wrap).forEach((btn) => {
      btn.addEventListener('click', () => {
        localStorage.setItem(RECITER_KEY, btn.dataset.reciter);
        document.dispatchEvent(new CustomEvent('reciter-changed'));
      });
    });
  }

  function initReciterSettings() {
    renderReciterChips('#reciter-choices');
  }

  const SHOW_BAR_FAB_POS_KEY = 'almus-hraf:playerFabPos';

  function initShowBarFabDrag(fab, onTap) {
    const MARGIN = 6;

    function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

    function applyPosition(left, top) {
      const maxLeft = window.innerWidth - fab.offsetWidth - MARGIN;
      const maxTop = window.innerHeight - fab.offsetHeight - MARGIN;
      const x = clamp(left, MARGIN, Math.max(MARGIN, maxLeft));
      const y = clamp(top, MARGIN, Math.max(MARGIN, maxTop));
      fab.style.left = x + 'px';
      fab.style.top = y + 'px';
      fab.style.bottom = 'auto';
      fab.style.right = 'auto';
      return { x, y };
    }

    // استعادة آخر موضع محفوظ للزرار العائم (إن وُجد) عند تحميل التطبيق
    try {
      const saved = JSON.parse(localStorage.getItem(SHOW_BAR_FAB_POS_KEY) || 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        applyPosition(saved.x, saved.y);
      }
    } catch (e) { /* تجاهل */ }

    let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false, pointerId = null;

    fab.addEventListener('pointerdown', (e) => {
      // تعطيل السلوك الافتراضي هنا يمنع المتصفح من توليد "نقرة تعويضية" (compatibility
      // click) بعد رفع الإصبع. بدون هذا كانت النقرة التعويضية تصل بعد ظهور الشريط
      // مباشرة وتسقط فوق زرار "إيقاف التشغيل" في الشريط (لأنه بيظهر بالضبط في نفس
      // مكان الزرار العائم افتراضيًا)، فيوقف الصوت فورًا بدل ما يفتح المشغّل فقط
      e.preventDefault();
      const rect = fab.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      pointerId = e.pointerId;
      fab.setPointerCapture(pointerId);
    });

    fab.addEventListener('pointermove', (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > 6) {
        dragging = true;
        fab.classList.add('dragging');
      }
      if (dragging) applyPosition(originLeft + dx, originTop + dy);
    });

    function endDrag(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      try { fab.releasePointerCapture(pointerId); } catch (err) { /* تجاهل */ }
      const wasDragging = dragging;
      fab.classList.remove('dragging');
      dragging = false;
      pointerId = null;
      if (wasDragging) {
        const rect = fab.getBoundingClientRect();
        try { localStorage.setItem(SHOW_BAR_FAB_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top })); } catch (err) { /* عند امتلاء الذاكرة */ }
      } else {
        onTap();
      }
    }

    fab.addEventListener('pointerup', endDrag);
    fab.addEventListener('pointercancel', endDrag);

    // إبقاء الزرار داخل حدود الشاشة عند تدوير الجهاز أو تغيير حجم النافذة
    window.addEventListener('resize', () => {
      const rect = fab.getBoundingClientRect();
      if (rect.width) applyPosition(rect.left, rect.top);
    });
  }

  function initSurahAudioPlayer() {
    const headerBtn = $('#btn-header-surah-audio');
    const bar = $('#surah-audio-bar');
    const barPlayBtn = $('#surah-audio-playpause');
    const barTitleEl = $('#surah-audio-title');
    const barReciterEl = $('#surah-audio-reciter');
    const barCloseBtn = $('#surah-audio-close');
    const barHideBtn = $('#surah-audio-hide');
    const barSeek = $('#surah-audio-seek');
    const barPrevBtn = $('#surah-audio-prev');   // إرجاع ١٠ ثوانٍ
    const barNextBtn = $('#surah-audio-next');   // تقديم ١٠ ثوانٍ
    const barJumpStartBtn = $('#surah-audio-jump-start'); // الآية السابقة
    const barJumpEndBtn = $('#surah-audio-jump-end');     // الآية التالية
    const barStopBtn = $('#surah-audio-stop');
    const barSpeedBtn = $('#surah-audio-speed');
    const barTimeCurrent = $('#surah-audio-time-current');
    const barTimeDuration = $('#surah-audio-time-duration');
    const barExpandBtn = $('#surah-audio-expand');
    const barMiniDisc = $('#surah-audio-mini-disc');
    const showBarFab = $('#btn-show-player-bar');

    const overlayTitleEl = $('#player-surah-title');
    const overlayReciterEl = $('#player-reciter-name');
    const overlayPlayBtn = $('#player-btn-playpause');
    const overlaySeek = $('#player-seek');
    const overlayCurrentTime = $('#player-time-current');
    const overlayDurationTime = $('#player-time-duration');
    const overlayDisc = $('#player-disc');
    const overlayPrevBtn = $('#player-btn-prev');
    const overlayNextBtn = $('#player-btn-next');
    const continuousToggle = $('#player-continuous-toggle');

    if (!bar) return;

    function surahNameByNumber(num) {
      const s = (state.surahList || []).find((x) => x.number === num);
      if (s) return cleanSurahName(s.nameAr);
      const pageData = state.currentPageData;
      if (pageData && pageData.ayahs && pageData.ayahs[0] && pageData.ayahs[0].surah.number === num) {
        return cleanSurahName(pageData.headerSurahName);
      }
      return '';
    }

    function ayahCountByNumber(num) {
      const s = (state.surahList || []).find((x) => x.number === num);
      return s ? Number(s.ayahCount) || 0 : 0;
    }

    function updatePlayPauseIcons(playing) {
      const icon = playing
        ? '<svg><use href="#icon-pause"></use></svg>'
        : '<svg><use href="#icon-play"></use></svg>';
      if (barPlayBtn) barPlayBtn.innerHTML = playing ? icon : icon;
      if (overlayPlayBtn) overlayPlayBtn.innerHTML = icon;
      if (overlayDisc) overlayDisc.classList.toggle('spinning', playing);
      if (barMiniDisc) barMiniDisc.classList.toggle('spinning', playing);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }

    function syncNowPlayingUI() {
      const num = state.surahAudioSurah;
      const ed = state.surahAudioReciter || getSelectedReciter();

      // شريط المشغّل المصغّر يعرض اسم السورة فقط (كتصميم "المصحف الذهبي")؛
      // نافذة المشغّل الكامل تضيف رقم الآية الحالية لأنها معلومة مفيدة هناك
      const barTitle = num ? `سورة ${surahNameByNumber(num)}` : '--';
      const overlayTitle = num
        ? `سورة ${surahNameByNumber(num)}${state.ayahPlayerAyahNum ? ' — آية ' + toArabicDigits(state.ayahPlayerAyahNum) : ''}`
        : 'اختر سورة لتبدأ الاستماع';

      if (barTitleEl) barTitleEl.textContent = barTitle;
      if (barReciterEl) barReciterEl.textContent = num ? reciterName(ed) : '--';
      if (overlayTitleEl) overlayTitleEl.textContent = overlayTitle;
      if (overlayReciterEl) overlayReciterEl.textContent = num ? reciterName(ed) : '--';

      $$('.surah-item.player-playing', $('#player-surah-list')).forEach((el) => el.classList.remove('player-playing'));
      if (num) {
        const activeItem = $(`.surah-item[data-num="${num}"]`, $('#player-surah-list'));
        if (activeItem) activeItem.classList.add('player-playing');
      }
    }

    /* -------- سرعة التشغيل -------- */
    const PLAYER_RATE_KEY = 'almus-hraf:playerRate';
    const PLAYER_RATES = [1, 1.25, 1.5, 2, 0.75];
    function getPlayerRate() {
      const saved = Number(localStorage.getItem(PLAYER_RATE_KEY));
      return PLAYER_RATES.includes(saved) ? saved : 1;
    }
    function formatRateLabel(rate) {
      return (rate === 1 ? '1' : String(rate).replace(/^0\./, '.')) + '×';
    }
    function cyclePlayerRate() {
      const idx = PLAYER_RATES.indexOf(getPlayerRate());
      const next = PLAYER_RATES[(idx + 1) % PLAYER_RATES.length];
      localStorage.setItem(PLAYER_RATE_KEY, String(next));
      if (barSpeedBtn) barSpeedBtn.textContent = formatRateLabel(next);
      if (state.surahAudioEl) state.surahAudioEl.playbackRate = next;
    }

    /* -------- تظليل الآية التي يقرأها القارئ الآن في صفحة المصحف -------- */
    let lastHighlightedAyahEl = null;
    let followPageInFlight = false;
    function clearAyahHighlight() {
      if (lastHighlightedAyahEl) {
        lastHighlightedAyahEl.classList.remove('ayah-playing');
        lastHighlightedAyahEl = null;
      }
    }
    function highlightPlayingAyah(surahNumber, ayahNumber) {
      clearAyahHighlight();
      const target = $(`.ayah[data-surah="${surahNumber}"][data-ayah="${ayahNumber}"]`);
      if (target) {
        target.classList.add('ayah-playing');
        lastHighlightedAyahEl = target;
        const rect = target.getBoundingClientRect();
        const wrap = $('#mushaf-wrap');
        const wrapRect = wrap && wrap.getBoundingClientRect();
        if (wrapRect && (rect.top < wrapRect.top || rect.bottom > wrapRect.bottom)) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      // الآية مش على الصفحة المعروضة حاليًا. لو المستخدم فاتح تبويب "القرآن" فعلاً،
      // نجيب رقم صفحتها وننقله لها تلقائيًا حتى تفضل الآية اللي بتتقرأ متحدّدة قدّامه
      // (تتبّع تلقائي للقراءة)، بدل ما التظليل يفضل مش ظاهر إلا لو هو بيقلّب يدويًا
      const quranView = $('#view-quran');
      if (!followPageInFlight && quranView && quranView.classList.contains('active') && typeof QuranAPI !== 'undefined' && QuranAPI.getAyahPage) {
        followPageInFlight = true;
        QuranAPI.getAyahPage(surahNumber, ayahNumber)
          .then((page) => {
            followPageInFlight = false;
            if (!page) return;
            // تأكيد إن الآية دي لسه هي المشغّلة فعلاً (المستخدم ممكن يكون غيّر حاجة أثناء الجلب)
            if (state.surahAudioSurah !== surahNumber || state.ayahPlayerAyahNum !== ayahNumber) return;
            if (state.currentPageData && state.currentPageData.pageNumber === page) return;
            loadPage(page);
          })
          .catch(() => { followPageInFlight = false; });
      }
    }
    // يُستدعى بعد إعادة رسم الصفحة (مثلاً عند التنقل بين صفحات المصحف أثناء التشغيل)
    // حتى تظل الآية الحالية مظلّلة إن كانت موجودة على الصفحة المعروضة الجديدة
    function reapplyAyahHighlight() {
      if (state.playerMode === 'ayah' && state.surahAudioSurah && state.ayahPlayerAyahNum) {
        highlightPlayingAyah(state.surahAudioSurah, state.ayahPlayerAyahNum);
      }
    }

    /* -------- Media Session: عناصر تحكم على شاشة القفل ومركز التنبيهات، -------- */
    /* -------- وهي أيضًا ما يسمح للصوت بالاستمرار أثناء تصغير التطبيق   -------- */
    function updateMediaSessionMetadata() {
      if (!('mediaSession' in navigator)) return;
      const num = state.surahAudioSurah;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: num ? `سورة ${surahNameByNumber(num)}` : 'المصحف الأشرف',
        artist: num ? reciterName(state.surahAudioReciter || getSelectedReciter()) : '',
        album: 'المصحف الأشرف',
        artwork: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    }
    function initMediaSessionHandlers() {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => goPrevTransport());
      navigator.mediaSession.setActionHandler('nexttrack', () => goNextTransport());
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
      try { navigator.mediaSession.setActionHandler('stop', () => stopAudio()); } catch (e) { /* غير مدعوم في بعض المتصفحات */ }
    }
    function seekBy(delta) {
      if (!state.surahAudioEl) return;
      const dur = state.surahAudioEl.duration || Infinity;
      state.surahAudioEl.currentTime = Math.min(Math.max(0, state.surahAudioEl.currentTime + delta), dur);
    }

    function showBar() {
      bar.classList.remove('hidden', 'bar-minimized');
      if (showBarFab) showBarFab.classList.add('hidden');
      // طبقة أمان إضافية: تعطيل استقبال النقر على الشريط للحظة عند ظهوره، حتى لو
      // وصلت نقرة تعويضية متبقية من نفس لمسة الزرار العائم لا تسقط على زرار خطأ
      // (مثل زرار الإيقاف) بمجرد ما يظهر الشريط في نفس مكان الزرار
      bar.style.pointerEvents = 'none';
      clearTimeout(showBar._guardTimer);
      showBar._guardTimer = setTimeout(() => { bar.style.pointerEvents = ''; }, 350);
    }

    function minimizeBar() {
      bar.classList.add('bar-minimized');
      if (showBarFab) showBarFab.classList.remove('hidden');
    }

    function stopAudio() {
      if (state.surahAudioEl) {
        state.surahAudioEl.pause();
        state.surahAudioEl = null;
      }
      state.surahAudioSurah = null;
      state.surahAudioReciter = null;
      state.playerMode = null;
      state.ayahPlayerAyahNum = null;
      clearAyahHighlight();
      bar.classList.add('hidden');
      bar.classList.remove('bar-minimized');
      if (showBarFab) showBarFab.classList.add('hidden');
      if (headerBtn) headerBtn.classList.remove('active');
      updatePlayPauseIcons(false);
      syncNowPlayingUI();
      if (barSeek) barSeek.value = 0;
      if (overlaySeek) overlaySeek.value = 0;
      if (barTimeCurrent) barTimeCurrent.textContent = '٠:٠٠';
      if (barTimeDuration) barTimeDuration.textContent = '٠:٠٠';
      if (overlayCurrentTime) overlayCurrentTime.textContent = '٠:٠٠';
      if (overlayDurationTime) overlayDurationTime.textContent = '٠:٠٠';
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      }
    }

    // تشغيل سورة كاملة = تشغيل متتابع آية بآية بدءًا من الآية الأولى. اعتمدنا هذه
    // الطريقة (بدل ملف صوتي واحد للسورة كلها) لأنها الوحيدة التي تتيح تحديد الآية
    // التي يقرأها القارئ الآن أوتوماتيكيًا في صفحة المصحف، ولأنها تعمل مع كل القرّاء
    function playSurah(surahNumber) {
      playAyahContinuous(surahNumber, 1);
    }

    /* -------- وضع الاستماع المتواصل من آية معينة، آية بعد آية بلا توقف -------- */
    async function ensureSurahListLoaded() {
      if (!state.surahList || !state.surahList.length) {
        await loadSurahIndex();
      }
    }

    async function playAyahContinuous(surahNumber, ayahNumber) {
      await ensureSurahListLoaded();

      // إيقاف أي صوت آخر شغال حاليًا تجنبًا للتداخل
      if (state.audioEl) { state.audioEl.pause(); }
      if (state.surahAudioEl) { state.surahAudioEl.pause(); state.surahAudioEl = null; }

      const ed = getSelectedReciter();
      // هيثم الدخين هو القارئ الوحيد اللي مفيش له تسجيل آية-بآية حقيقي في أي مصدر
      // موثوق لقيناه، فعنده بس ملف سورة كاملة (باقي القراء الجدد التلاتة — ياسر
      // الدوسري وفارس عباد وسعد الغامدي — بقى ليهم رابط آية-بآية حقيقي دقيق ١٠٠٪ من
      // مكتبة everyayah.com، انظر CUSTOM_AYAH_AUDIO في quran-api.js). قبل كده كان
      // الكود بيستبدل صوت هيثم بصوت العفاسي بصمت لأي آية، فكان حسّاس المستخدم إنه
      // بيدوس على قارئ وبيشتغل قارئ تاني. دلوقتي بنشغّله من ملف السورة الكاملة الصحيح
      const fullFileOnly = typeof QuranAPI !== 'undefined' && QuranAPI.isCustomAudioReciter && QuranAPI.isCustomAudioReciter(ed);

      state.playerMode = 'ayah';
      state.surahAudioSurah = surahNumber;
      state.surahAudioReciter = ed;
      // لو القارئ من نوع "ملف سورة كاملة بس" (هيثم الدخين حاليًا) بنتابع له رقم الآية
      // الحالي تقريبيًا (عبر القفز التقريبي + التتبع أثناء التشغيل تحت)، بدل ما نسيبها فاضية
      state.ayahPlayerAyahNum = ayahNumber;

      // لو المستخدم صغّر الشريط لزرار عائم يدويًا، إعادة تحميل الآية التالية أثناء
      // التشغيل المتواصل ما ينفعش يفتح الشريط تاني من تلقاء نفسه؛ بس أول مرة (لما
      // يكون لسه مخفي تمامًا "hidden") لازم نظهره عشان المستخدم يشوف إنه بدأ التشغيل
      if (bar.classList.contains('hidden')) showBar();
      if (headerBtn) headerBtn.classList.add('active');
      syncNowPlayingUI();
      if (barPlayBtn) barPlayBtn.innerHTML = '⏳';

      try {
        // للقراء اللي ملفهم سورة كاملة بلا تسجيل آية-بآية حقيقي: نجيب مقدّمًا طول نص
        // كل آية بالنسبة لإجمالي نص السورة، عشان نحسب موضع الآية المطلوبة كنسبة من
        // الملف الصوتي ونقفز لها فورًا بدل ما يبدأ التشغيل من أول السورة دايمًا
        let ayahLenList = null;
        if (fullFileOnly) {
          try { ayahLenList = await QuranAPI.getSurahAyahLengths(surahNumber); } catch (e) { ayahLenList = null; }
          if (ayahNumber !== 1) {
            showToast(`تسجيلات ${reciterName(ed)} سورة كاملة، هيبدأ من موضع هذه الآية تقريبًا داخل الملف`);
          }
        }

        const url = fullFileOnly
          ? QuranAPI.getSurahAudioURL(surahNumber, ed)
          : await QuranAPI.getAyahAudio(surahNumber, ayahNumber, ed);
        // قد يكون المستخدم غيّر الوضع أثناء الانتظار (مثلاً ضغط إيقاف)
        if (state.playerMode !== 'ayah' || state.surahAudioSurah !== surahNumber) return;
        if (state.ayahPlayerAyahNum !== ayahNumber) return;

        state.surahAudioEl = new Audio(url);
        state.surahAudioEl.playbackRate = getPlayerRate();
        syncNowPlayingUI();
        highlightPlayingAyah(surahNumber, ayahNumber);
        updateMediaSessionMetadata();

        // توقيت كل آية تقريبيًا (بالثواني) داخل الملف الكامل، محسوب بمجرد ما تُعرف
        // مدة الملف؛ يُستخدم للقفز لموضع الآية المطلوبة وأيضًا لتتبّع الآية الحالية
        // أثناء التشغيل (التظليل التلقائي) بدل ما يفضل واقف على نفس الآية طول السورة
        let ayahBounds = null;
        let seekedToStart = false;
        function computeBoundsAndSeek() {
          const dur = state.surahAudioEl && state.surahAudioEl.duration;
          if (!fullFileOnly || !ayahLenList || !ayahLenList.length || !dur || !isFinite(dur)) return;
          const totalLen = ayahLenList.reduce((s, a) => s + a.length, 0) || 1;
          let acc = 0;
          ayahBounds = ayahLenList.map((a) => {
            const start = (acc / totalLen) * dur;
            acc += a.length;
            return { ayah: a.numberInSurah, start };
          });
          if (!seekedToStart && ayahNumber > 1) {
            const target = ayahBounds.find((b) => b.ayah === ayahNumber);
            if (target) state.surahAudioEl.currentTime = target.start;
          }
          seekedToStart = true;
        }

        state.surahAudioEl.addEventListener('loadedmetadata', () => {
          const dur = Math.floor(state.surahAudioEl.duration) || 0;
          if (barSeek) barSeek.max = dur;
          if (overlaySeek) overlaySeek.max = dur;
          if (barTimeDuration) barTimeDuration.textContent = formatPlayerTime(dur);
          if (overlayDurationTime) overlayDurationTime.textContent = formatPlayerTime(dur);
          computeBoundsAndSeek();
        });
        state.surahAudioEl.addEventListener('timeupdate', () => {
          if (!state.surahAudioEl) return;
          const cur = Math.floor(state.surahAudioEl.currentTime);
          if (barSeek) barSeek.value = cur;
          if (overlaySeek) overlaySeek.value = cur;
          if (barTimeCurrent) barTimeCurrent.textContent = formatPlayerTime(cur);
          if (overlayCurrentTime) overlayCurrentTime.textContent = formatPlayerTime(cur);

          if (fullFileOnly && ayahBounds && ayahBounds.length) {
            const t = state.surahAudioEl.currentTime;
            let currentAyah = ayahBounds[0].ayah;
            for (let i = 0; i < ayahBounds.length; i++) {
              if (ayahBounds[i].start <= t) currentAyah = ayahBounds[i].ayah;
              else break;
            }
            if (state.ayahPlayerAyahNum !== currentAyah) {
              state.ayahPlayerAyahNum = currentAyah;
              highlightPlayingAyah(surahNumber, currentAyah);
              syncNowPlayingUI();
            }
          }
        });
        state.surahAudioEl.addEventListener('ended', () => {
          if (fullFileOnly) {
            // كان الملف سورة كاملة مش آية، فالانتقال يبقى للسورة اللي بعدها مباشرة
            if (!isPlayerContinuous()) { stopAudio(); return; }
            const nextSurah = surahNumber >= 114 ? 1 : surahNumber + 1;
            showToast(`الآن يُشغَّل: سورة ${surahNameByNumber(nextSurah)}`);
            playAyahContinuous(nextSurah, 1);
            return;
          }
          const count = ayahCountByNumber(surahNumber);
          let nextSurah = surahNumber;
          let nextAyah = ayahNumber + 1;
          if (count && nextAyah > count) {
            if (!isPlayerContinuous()) { stopAudio(); return; }
            nextSurah = surahNumber >= 114 ? 1 : surahNumber + 1;
            nextAyah = 1;
            showToast(`الآن يُشغَّل: سورة ${surahNameByNumber(nextSurah)}`);
          }
          playAyahContinuous(nextSurah, nextAyah);
        });

        state.surahAudioEl.addEventListener('error', () => {
          showToast('تعذّر تشغيل هذا التسجيل، تحقّق من الاتصال بالإنترنت');
          stopAudio();
        });

        // لو محتاجين نقفز لموضع آية معينة داخل ملف السورة الكاملة، ننتظر وصول
        // الميتاداتا (وتنفيذ القفز أعلاه) الأول قبل التشغيل، عشان المستخدم ميسمعش
        // جزء من أول السورة قبل ما ينقفز الصوت فجأة لموضع الآية المطلوبة
        if (fullFileOnly && ayahNumber > 1) {
          await new Promise((resolve) => {
            if (state.surahAudioEl.readyState >= 1) resolve();
            else state.surahAudioEl.addEventListener('loadedmetadata', () => resolve(), { once: true });
          });
          if (state.playerMode !== 'ayah' || state.surahAudioSurah !== surahNumber || state.ayahPlayerAyahNum !== ayahNumber) return;
        }

        await state.surahAudioEl.play();
        updatePlayPauseIcons(true);
      } catch (e) {
        showToast('تعذّر تشغيل الصوت، تحقّق من الاتصال بالإنترنت');
        stopAudio();
      }
    }

    function playAdjacentAyah(delta) {
      const surahNumber = state.surahAudioSurah;
      const ayahNumber = state.ayahPlayerAyahNum;
      if (!surahNumber || !ayahNumber) return;
      const count = ayahCountByNumber(surahNumber);
      let nextSurah = surahNumber;
      let nextAyah = ayahNumber + delta;
      if (nextAyah < 1) {
        nextSurah = surahNumber <= 1 ? 114 : surahNumber - 1;
        nextAyah = ayahCountByNumber(nextSurah) || 1;
      } else if (count && nextAyah > count) {
        nextSurah = surahNumber >= 114 ? 1 : surahNumber + 1;
        nextAyah = 1;
      }
      playAyahContinuous(nextSurah, nextAyah);
    }

    function togglePlayPause() {
      if (!state.surahAudioEl) return;
      if (state.surahAudioEl.paused) {
        state.surahAudioEl.play();
        updatePlayPauseIcons(true);
      } else {
        state.surahAudioEl.pause();
        updatePlayPauseIcons(false);
      }
    }

    function playAdjacentSurah(delta) {
      const current = state.surahAudioSurah || (state.currentPageData && state.currentPageData.ayahs[0].surah.number) || 1;
      let next = current + delta;
      if (next < 1) next = 114;
      if (next > 114) next = 1;
      playSurah(next);
    }

    function goNextTransport() {
      if (state.playerMode === 'ayah') playAdjacentAyah(1);
      else playAdjacentSurah(1);
    }
    function goPrevTransport() {
      if (state.playerMode === 'ayah') playAdjacentAyah(-1);
      else playAdjacentSurah(-1);
    }

    // تعريض الدوال لبقية التطبيق (نافذة اختيار السور وزر الرئيسية وقائمة خيارات الآية)
    window.__playerControls = {
      playSurah, togglePlayPause, stopAudio, playAdjacentSurah, syncNowPlayingUI,
      playAyahContinuous, playAdjacentAyah, reapplyAyahHighlight
    };

    if (headerBtn) {
      headerBtn.addEventListener('click', () => {
        const pageData = state.currentPageData;
        const firstAyah = pageData && pageData.ayahs && pageData.ayahs[0];
        const surahNumber = firstAyah ? firstAyah.surah.number : null;

        if (!state.surahAudioSurah && surahNumber) {
          playSurah(surahNumber);
        }
        openPlayerOverlay();
      });
    }

    if (barPlayBtn) barPlayBtn.addEventListener('click', togglePlayPause);
    if (overlayPlayBtn) overlayPlayBtn.addEventListener('click', togglePlayPause);
    // ◀◀ / ▶▶ في الشريط المصغّر: إرجاع/تقديم ١٠ ثوانٍ داخل نفس الآية
    if (barPrevBtn) barPrevBtn.addEventListener('click', () => seekBy(-10));
    if (barNextBtn) barNextBtn.addEventListener('click', () => seekBy(10));
    // |◀ / ▶| في الشريط المصغّر: الانتقال للآية السابقة/التالية
    if (barJumpStartBtn) barJumpStartBtn.addEventListener('click', goPrevTransport);
    if (barJumpEndBtn) barJumpEndBtn.addEventListener('click', goNextTransport);
    if (barStopBtn) barStopBtn.addEventListener('click', stopAudio);
    if (barSpeedBtn) {
      barSpeedBtn.textContent = formatRateLabel(getPlayerRate());
      barSpeedBtn.addEventListener('click', cyclePlayerRate);
    }
    if (overlayPrevBtn) overlayPrevBtn.addEventListener('click', goPrevTransport);
    if (overlayNextBtn) overlayNextBtn.addEventListener('click', goNextTransport);
    if (barCloseBtn) barCloseBtn.addEventListener('click', stopAudio);
    if (barExpandBtn) barExpandBtn.addEventListener('click', openPlayerOverlay);

    initMediaSessionHandlers();

    // إخفاء الشريط مؤقتًا أثناء القراءة، وإظهاره من الزرار العائم فقط
    if (barHideBtn) barHideBtn.addEventListener('click', minimizeBar);
    if (showBarFab) initShowBarFabDrag(showBarFab, showBar);

    if (barSeek) {
      barSeek.addEventListener('input', () => {
        if (state.surahAudioEl) state.surahAudioEl.currentTime = Number(barSeek.value);
      });
    }
    if (overlaySeek) {
      overlaySeek.addEventListener('input', () => {
        if (state.surahAudioEl) state.surahAudioEl.currentTime = Number(overlaySeek.value);
      });
    }

    if (continuousToggle) {
      continuousToggle.checked = isPlayerContinuous();
      continuousToggle.addEventListener('change', () => {
        localStorage.setItem(PLAYER_CONTINUOUS_KEY, continuousToggle.checked ? '1' : '0');
      });
    }

    // تغيير القارئ أثناء التشغيل: أعد تحميل نفس السورة أو نفس الآية فورًا بصوت القارئ الجديد
    document.addEventListener('reciter-changed', () => {
      $$('.reciter-choice').forEach((b) => b.classList.toggle('active', b.dataset.reciter === getSelectedReciter()));
      if (state.playerMode === 'ayah' && state.surahAudioSurah && state.ayahPlayerAyahNum) {
        playAyahContinuous(state.surahAudioSurah, state.ayahPlayerAyahNum);
      } else if (state.surahAudioSurah) {
        playSurah(state.surahAudioSurah);
      } else {
        syncNowPlayingUI();
      }
    });

    syncNowPlayingUI();
  }

  /* -------- نافذة المشغّل الكامل: قائمة السور القابلة للاختيار -------- */
  function renderPlayerSurahList(list) {
    const wrap = $('#player-surah-list');
    if (!wrap) return;
    wrap.innerHTML = list
      .map((s) => {
        const cleanName = cleanSurahName(s.nameAr);
        const revType = (s.revelationType === 'Meccan' || s.revelationType === 'مكية') ? 'مكية' : 'مدنية';
        const playing = state.surahAudioSurah === s.number;
        return `
        <button class="surah-item ${playing ? 'player-playing' : ''}" data-num="${s.number}">
          <span class="surah-item-num">${toArabicDigits(s.number)}</span>
          <span class="surah-item-info">
            <span class="surah-item-name">سورة ${cleanName}</span>
            <span class="surah-item-sub">${revType} · ${toArabicDigits(s.ayahCount)} آية</span>
          </span>
        </button>`;
      })
      .join('');

    $$('.surah-item', wrap).forEach((btn) => {
      btn.addEventListener('click', () => {
        const num = Number(btn.dataset.num);
        if (window.__playerControls) window.__playerControls.playSurah(num);
      });
    });
  }

  function openPlayerOverlay() {
    if (!state.surahList || !state.surahList.length) {
      loadSurahIndex().then(() => renderPlayerSurahList(state.surahList));
    } else {
      renderPlayerSurahList(state.surahList);
    }
    if (window.__playerControls) window.__playerControls.syncNowPlayingUI();
    openOverlay('#player-overlay');
  }

  function initPlayerOverlay() {
    const closeBtn = $('#btn-close-player');
    if (closeBtn) closeBtn.addEventListener('click', () => closeOverlay('#player-overlay'));

    renderReciterChips('#player-reciter-choices');

    const searchInput = $('#player-surah-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = stripTashkeel(e.target.value.trim());
        if (!q) return renderPlayerSurahList(state.surahList);
        const filtered = state.surahList.filter(
          (s) => stripTashkeel(s.nameAr).includes(q) || s.nameEn.toLowerCase().includes(q.toLowerCase())
        );
        renderPlayerSurahList(filtered);
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* الأذكار والأدعية                                                 */
  /* ---------------------------------------------------------------- */
  // يبني HTML لبطاقات عناصر قسم واحد (أذكار أو أدعية) — تُستخدم عند فتح صفحة القسم كاملة
  function buildDhikrItemsHTML(items, favType, sectionId) {
    return items
      .map((it, j) => {
        const target = Math.max(1, Number(it.count) || 1);
        const favKey = `${favType}:${sectionId}:${j}`;
        const isFav = favType ? isFavorite(favKey) : false;
        return `
      <div class="dhikr-card">
        <p class="dhikr-text">${escapeHTML(it.text)}</p>
        <div class="dhikr-foot">
          ${it.note ? `<span class="dhikr-note">${escapeHTML(it.note)}</span>` : ''}
          ${it.count && it.count > 1 ? `<span class="dhikr-count">×${toArabicDigits(it.count)}</span>` : ''}
          <span class="dhikr-foot-end">
            ${it.source ? `<span class="dhikr-source">${escapeHTML(it.source)}</span>` : ''}
            ${favType ? `<button class="fav-star ${isFav ? 'active' : ''}" data-fav-key="${favKey}" aria-label="إضافة للمفضلة">${isFav ? '★' : '☆'}</button>` : ''}
          </span>
        </div>
        <div class="tasbih-row">
          <button class="tasbih-counter" data-target="${target}" data-count="0" aria-label="مسبحة إلكترونية">
            <span class="tasbih-num">٠</span>
          </button>
          <span class="tasbih-hint">اضغط للعدّ حتى ${toArabicDigits(target)}</span>
          <button class="tasbih-reset" aria-label="إعادة تعيين العدّاد">
            <svg><use href="#icon-reset"></use></svg>
          </button>
        </div>
      </div>`;
      })
      .join('');
  }

  // تفتح صفحة (Overlay) بها كل عناصر قسم واحد كاملة قابلة للتمرير، بدل الفتح المكاني
  // القديم المحدود بارتفاع ثابت الذي كان يُخفي العناصر بعد عدد معيّن منها
  function openDhikrListOverlay(section, favType) {
    const titleEl = $('#dhikr-list-title');
    const contentEl = $('#dhikr-list-content');
    if (!titleEl || !contentEl) return;
    titleEl.textContent = section.title;
    contentEl.innerHTML = buildDhikrItemsHTML(section.items, favType, section.id);
    initTasbihCounters(contentEl);
    initFavoriteStars(contentEl);
    openOverlay('#dhikr-list-overlay');
  }

  function initDhikrListOverlay() {
    const closeBtn = $('#btn-close-dhikr-list');
    if (closeBtn) closeBtn.addEventListener('click', () => closeOverlay('#dhikr-list-overlay'));
  }

  function renderAccordion(containerId, dataset, favType) {
    const wrap = $(containerId);
    if (!wrap || !dataset) return;
    wrap.innerHTML = dataset
      .map(
        (section, i) => `
      <div class="accordion-section" data-idx="${i}">
        <button class="accordion-head">
          <span class="acc-icon">${section.icon}</span>
          <span class="acc-title">${escapeHTML(section.title)}</span>
          <span class="acc-count">${toArabicDigits(section.items.length)}</span>
          <svg class="acc-chevron"><use href="#icon-chevron-down"></use></svg>
        </button>
      </div>`
      )
      .join('');

    $$('.accordion-head', wrap).forEach((head, i) => {
      head.addEventListener('click', () => openDhikrListOverlay(dataset[i], favType));
    });
  }

  /* -------- الأذكار/الأدعية المفضّلة -------- */
  const FAVORITES_KEY = 'almus-hraf:favorites';
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveFavorites(f) {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(f)); } catch (e) { /* تجاهل */ }
  }
  function isFavorite(key) { return !!getFavorites()[key]; }

  function initFavoriteStars(wrap) {
    $$('.fav-star', wrap).forEach((star) => {
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = star.dataset.favKey;
        const favs = getFavorites();
        if (favs[key]) {
          delete favs[key];
          star.classList.remove('active');
          star.textContent = '☆';
        } else {
          favs[key] = true;
          star.classList.add('active');
          star.textContent = '★';
        }
        saveFavorites(favs);
      });
    });
  }

  function renderFavoritesView() {
    const wrap = $('#favorites-list');
    if (!wrap) return;
    const favs = getFavorites();
    const keys = Object.keys(favs).filter((k) => favs[k]);

    if (!keys.length) {
      wrap.innerHTML = `<p class="ayah-search-hint">لا توجد أذكار أو أدعية محفوظة بعد. اضغط ⭐ بجانب أي ذكر أو دعاء لإضافته هنا.</p>`;
      return;
    }

    function lookup(key) {
      const parts = key.split(':');
      const type = parts[0], sectionId = parts[1], idx = Number(parts[2]);
      const dataset = type === 'azkar'
        ? (typeof AZKAR_DATA !== 'undefined' ? AZKAR_DATA : [])
        : (typeof DUAS_DATA !== 'undefined' ? DUAS_DATA : []);
      const section = dataset.find((s) => s.id === sectionId);
      if (!section || !section.items[idx]) return null;
      return { item: section.items[idx], sectionTitle: section.title };
    }

    const cardsHTML = keys
      .map((key) => {
        const found = lookup(key);
        if (!found) return '';
        const it = found.item;
        return `
          <div class="dhikr-card">
            <p class="dhikr-text">${escapeHTML(it.text)}</p>
            <div class="dhikr-foot">
              <span class="dhikr-note">${escapeHTML(found.sectionTitle)}</span>
              <span class="dhikr-foot-end">
                ${it.source ? `<span class="dhikr-source">${escapeHTML(it.source)}</span>` : ''}
                <button class="fav-star active" data-fav-key="${key}" aria-label="إزالة من المفضلة">★</button>
              </span>
            </div>
          </div>`;
      })
      .join('');

    wrap.innerHTML = cardsHTML;

    $$('.fav-star', wrap).forEach((star) => {
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = star.dataset.favKey;
        const favs2 = getFavorites();
        delete favs2[key];
        saveFavorites(favs2);
        renderFavoritesView();
      });
    });
  }

  /* -------- المسبحة الإلكترونية: عدّاد لمسي لكل ذكر -------- */
  function updateTasbihVisual(btn) {
    const target = Number(btn.dataset.target) || 1;
    const count = Number(btn.dataset.count) || 0;
    const progress = Math.min(100, Math.round((count / target) * 100));
    btn.style.setProperty('--progress', progress);
    btn.querySelector('.tasbih-num').textContent = toArabicDigits(count);
    btn.classList.toggle('done', count >= target);
  }

  function initTasbihCounters(wrap) {
    $$('.tasbih-counter', wrap).forEach((btn) => updateTasbihVisual(btn));

    $$('.tasbih-counter', wrap).forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = Number(btn.dataset.target) || 1;
        let count = Number(btn.dataset.count) || 0;

        if (count >= target) {
          count = 0; // بعد إتمام العدد يعيد الضغط التالي العدّاد لبدء ذكر جديد
        } else {
          count += 1;
        }
        btn.dataset.count = String(count);
        updateTasbihVisual(btn);

        if (count === target) {
          if (navigator.vibrate) navigator.vibrate([25, 40, 25]);
          showToast('تم إتمام الذكر ✅ بارك الله فيك');
        } else if (navigator.vibrate) {
          navigator.vibrate(12);
        }
      });
    });

    $$('.tasbih-reset', wrap).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const counter = btn.parentElement.querySelector('.tasbih-counter');
        if (counter) {
          counter.dataset.count = '0';
          updateTasbihVisual(counter);
        }
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* الإعدادات                                                         */
  /* ---------------------------------------------------------------- */
  function initSettings() {
    $('#btn-close-settings').addEventListener('click', () => closeOverlay('#settings-overlay'));

    const root = document.documentElement;
    let fontStep = Number(localStorage.getItem('almus-hraf:fontStep') || 0);
    applyFontStep();

    function applyFontStep() {
      root.style.setProperty('--ayah-font-scale', (1 + fontStep * 0.08).toFixed(2));
    }
    $('#font-inc').addEventListener('click', () => {
      fontStep = Math.min(fontStep + 1, 5);
      applyFontStep();
      localStorage.setItem('almus-hraf:fontStep', String(fontStep));
      fitMushafPage();
    });
    $('#font-dec').addEventListener('click', () => {
      fontStep = Math.max(fontStep - 1, -3);
      applyFontStep();
      localStorage.setItem('almus-hraf:fontStep', String(fontStep));
      fitMushafPage();
    });

    const savedTheme = localStorage.getItem('almus-hraf:theme') || 'paper';
    document.body.classList.toggle('theme-night', savedTheme === 'night');
    $$('.theme-choice').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === savedTheme);
      b.addEventListener('click', () => {
        document.body.classList.toggle('theme-night', b.dataset.theme === 'night');
        localStorage.setItem('almus-hraf:theme', b.dataset.theme);
        $$('.theme-choice').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
      });
    });

    $('#btn-goto-lastread').addEventListener('click', () => {
      closeOverlay('#settings-overlay');
      goToLastRead();
    });

    initOfflineDownload();
    initReciterSettings();
    initKhatmaTracking();
    initFullscreenToggle();
  }

  /* ---------------------------------------------------------------- */
  /* إخفاء شريط الحالة (Status Bar) أثناء تشغيل التطبيق، عبر واجهة       */
  /* Fullscreen API القياسية في المتصفح، حتى يأخذ التطبيق مساحة الشريط  */
  /* بالكامل. مفعّل تلقائيًا افتراضيًا، والمستخدم لو حب يلغيه يدخل        */
  /* الإعدادات ويوقفه بنفسه.                                            */
  /* ملحوظة: هذا يعمل على أندرويد (متصفحات Chromium) عند تشغيل التطبيق   */
  /* كتطبيق مُثبَّت (PWA) من الشاشة الرئيسية. أما آيفون فمتصفح سفاري لا    */
  /* يدعم إخفاء شريط الحالة فعليًا عبر الويب، فيكتفي التطبيق هناك برسم     */
  /* المحتوى تحت الشريط (black-translucent) كما هو مضبوط بالفعل.         */
  /* بما إن المتصفحات تشترط أن يكون طلب ملء الشاشة ناتجًا عن تفاعل مباشر  */
  /* من المستخدم (لمسة/ضغطة)، فبنطلبه أول ما يلمس المستخدم الشاشة أول مرة */
  /* -------------------------------------------------------------------*/
  const FULLSCREEN_PREF_KEY = 'almus-hraf:hideStatusBar';
  function getFullscreenPref() {
    const raw = localStorage.getItem(FULLSCREEN_PREF_KEY);
    return raw === null ? true : raw === '1'; // مفعّل افتراضيًا لو المستخدم ما غيّرش الإعداد قبل كده
  }
  function isFullscreenSupported() {
    return !!(document.documentElement.requestFullscreen || document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }
  function isCurrentlyFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function requestAppFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { req.call(el).catch(() => {}); } catch (e) { /* تجاهل */ } }
  }
  function exitAppFullscreen() {
    if (!isCurrentlyFullscreen()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { exit.call(document).catch(() => {}); } catch (e) { /* تجاهل */ } }
  }
  // نعكس الحالة الفعلية لملء الشاشة (مش مجرد تفضيل المستخدم) على body، حتى يتقلّص
  // الهيدر لحجمه الطبيعي وتكبر مساحة صفحة القرآن فقط لو شريط الحالة مختفٍ فعلاً —
  // وليس بمجرد تفعيل الخيار قبل ما المتصفح يستجيب لطلب ملء الشاشة
  function syncStatusBarClass() {
    document.body.classList.toggle('statusbar-hidden', isCurrentlyFullscreen());
    requestAnimationFrame(fitMushafPage);
  }
  document.addEventListener('fullscreenchange', syncStatusBarClass);
  document.addEventListener('webkitfullscreenchange', syncStatusBarClass);

  let fullscreenGestureBound = false;
  function armFullscreenOnFirstTouch() {
    if (fullscreenGestureBound) return;
    fullscreenGestureBound = true;
    const tryOnce = () => {
      document.removeEventListener('pointerdown', tryOnce, true);
      if (getFullscreenPref() && !isCurrentlyFullscreen()) {
        requestAppFullscreen();
      }
    };
    document.addEventListener('pointerdown', tryOnce, true);
  }
  function initFullscreenToggle() {
    const toggle = $('#toggle-fullscreen');
    const sub = $('#fullscreen-sub');
    if (!toggle) return;

    if (!isFullscreenSupported()) {
      toggle.checked = false;
      toggle.disabled = true;
      if (sub) sub.textContent = 'متصفحك أو جهازك لا يدعم إخفاء شريط الحالة حاليًا';
      return;
    }

    const pref = getFullscreenPref();
    toggle.checked = pref;
    if (pref) {
      // أول تفعيل للتطبيق (أو لو كان مفعّل من قبل): نحاول ملء الشاشة فورًا، وإلا
      // ننتظر أول لمسة من المستخدم لأن المتصفحات تمنع طلب ملء الشاشة بدون تفاعل مباشر
      requestAppFullscreen();
      armFullscreenOnFirstTouch();
    }
    syncStatusBarClass();

    toggle.addEventListener('change', () => {
      localStorage.setItem(FULLSCREEN_PREF_KEY, toggle.checked ? '1' : '0');
      if (toggle.checked) {
        requestAppFullscreen();
        armFullscreenOnFirstTouch();
        showToast('هيختفي شريط الحالة، ويأخذ التطبيق مساحته كاملة');
      } else {
        exitAppFullscreen();
        showToast('تم إظهار شريط الحالة');
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* تحميل كل صفحات المصحف مسبقًا للعمل الكامل بدون إنترنت              */
  /* يعتمد على Service Worker: نطلب كل صفحة عبر fetch عادي، فيعترضها     */
  /* الـ Service Worker ويخزّنها دائمًا في ذاكرته (mushaf-ashraf-quran-  */
  /* data)، فتُقرأ لاحقًا فورًا من الجهاز نفسه ولو بلا اتصال بالإنترنت.   */
  /* ---------------------------------------------------------------- */
  const OFFLINE_DONE_KEY = 'almus-hraf:offlineDownloadDone';
  let offlineDownloadCancelled = false;

  function initOfflineDownload() {
    const btn = $('#btn-download-offline');
    if (!btn) return;

    const sub = $('#offline-download-sub');
    const wrap = $('#offline-progress-wrap');
    const fill = $('#offline-progress-fill');
    const label = $('#offline-progress-label');
    const cancelBtn = $('#btn-cancel-download');

    if (localStorage.getItem(OFFLINE_DONE_KEY) === '1') {
      btn.textContent = 'إعادة التحميل';
      if (sub) sub.textContent = 'تم تحميل المصحف كاملاً من قبل، ويعمل الآن بدون إنترنت ✅';
    }

    btn.addEventListener('click', async () => {
      if (!('caches' in window) || !navigator.serviceWorker) {
        return showToast('متصفحك لا يدعم التخزين الدائم بدون إنترنت');
      }

      offlineDownloadCancelled = false;
      btn.classList.add('hidden');
      if (wrap) wrap.classList.remove('hidden');

      const total = 604;
      // تركيز أقل على التزامن يقلّل من فشل الطلبات بسبب ضغط السيرفر أو
      // اضطراب الاتصال، وهو السبب الأغلب وراء تعذّر تحميل مئات الصفحات
      // من أول محاولة
      const concurrency = 4;
      let completed = 0;
      const queue = [];
      for (let p = 1; p <= total; p++) queue.push(p);
      let failedPages = [];

      function updateUI() {
        const pct = Math.round((completed / total) * 100);
        if (fill) fill.style.width = pct + '%';
        if (label) label.textContent = `${toArabicDigits(pct)}٪ — صفحة ${toArabicDigits(completed)} من ٦٠٤`;
      }

      // محاولة تحميل صفحة واحدة، مع إعادة محاولة تلقائية عند الفشل (حتى
      // لا يضطر المستخدم للضغط على "إعادة التحميل" عدة مرات يدويًا)
      async function fetchPageOnce(p) {
        const res = await fetch(QuranAPI.pageURL(p));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json(); // نقرأ الجسم بالكامل لضمان اكتمال تخزينه في الكاش
        // نبني فهرس بدايات السور في نفس الوقت، فيعمل الانتقال المباشر لأي
        // سورة بدون إنترنت بمجرد اكتمال هذا التحميل
        QuranAPI.recordSurahStartPagesFromRawPage(data);
      }

      async function fetchPageWithRetry(p, retries) {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            await fetchPageOnce(p);
            return true;
          } catch (e) {
            if (attempt < retries) {
              await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
            }
          }
        }
        return false;
      }

      async function worker() {
        while (queue.length && !offlineDownloadCancelled) {
          const p = queue.shift();
          const ok = await fetchPageWithRetry(p, 2);
          if (!ok) failedPages.push(p);
          completed++;
          updateUI();
        }
      }

      updateUI();
      await Promise.all(Array.from({ length: concurrency }, worker));

      // شوط إعادة محاولة تلقائي أخير للصفحات التي تعذّر تحميلها، بشكل متسلسل
      // وهادئ، بدل مطالبة المستخدم بإعادة الضغط على الزر من جديد
      if (!offlineDownloadCancelled && failedPages.length) {
        const retryList = failedPages;
        failedPages = [];
        for (const p of retryList) {
          if (offlineDownloadCancelled) break;
          const ok = await fetchPageWithRetry(p, 2);
          if (!ok) failedPages.push(p);
        }
      }
      const failed = failedPages.length;

      if (wrap) wrap.classList.add('hidden');
      btn.classList.remove('hidden');

      if (offlineDownloadCancelled) {
        showToast('تم إلغاء التحميل');
        btn.textContent = 'تحميل';
      } else {
        localStorage.setItem(OFFLINE_DONE_KEY, '1');
        btn.textContent = 'إعادة التحميل';
        if (sub) {
          sub.textContent = failed > 0
            ? `اكتمل التحميل مع تعذّر ${toArabicDigits(failed)} صفحة (تحقق من الاتصال وأعد المحاولة)`
            : 'تم تحميل المصحف كاملاً، ويعمل الآن بدون إنترنت ✅';
        }
        showToast(failed > 0 ? 'اكتمل التحميل مع بعض الأخطاء' : 'تم تحميل المصحف كاملاً بنجاح 🎉');
      }
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        offlineDownloadCancelled = true;
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* متابعة ختمة القرآن (الورد اليومي)                                  */
  /* كل صفحة تُفتَح تُسجَّل تلقائيًا كمقروءة بتاريخ اليوم                */
  /* ---------------------------------------------------------------- */
  const KHATMA_KEY = 'almus-hraf:khatma';
  function getKhatma() {
    try {
      const raw = localStorage.getItem(KHATMA_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return Object.assign({ startDate: todayStr(), dailyTarget: 4, pagesRead: {} }, parsed);
    } catch (e) {
      return { startDate: todayStr(), dailyTarget: 4, pagesRead: {} };
    }
  }
  function saveKhatma(k) {
    try { localStorage.setItem(KHATMA_KEY, JSON.stringify(k)); } catch (e) { /* تجاهل */ }
  }

  function recordKhatmaPageRead(pageNumber) {
    const k = getKhatma();
    const today = todayStr();
    if (k.pagesRead[pageNumber] !== today) {
      k.pagesRead[pageNumber] = today;
      saveKhatma(k);
    }
    renderKhatmaProgress();
  }

  function renderKhatmaProgress() {
    const fill = $('#khatma-progress-fill');
    const text = $('#khatma-progress-text');
    if (!fill && !text) return;

    const k = getKhatma();
    const total = 604;
    const readCount = Object.keys(k.pagesRead).length;
    const pct = Math.min(100, Math.round((readCount / total) * 100));
    if (fill) fill.style.width = pct + '%';

    const today = todayStr();
    const todayCount = Object.values(k.pagesRead).filter((d) => d === today).length;
    const target = Number(k.dailyTarget) || 4;
    const remaining = total - readCount;

    let etaText = '';
    if (remaining > 0 && target > 0) {
      const daysLeft = Math.ceil(remaining / target);
      etaText = ` — يتبقى نحو ${toArabicDigits(daysLeft)} يوم بمعدل الورد الحالي`;
    } else if (remaining <= 0) {
      etaText = ' — تهانينا، أتممت الختمة بالكامل 🎉';
    }

    if (text) {
      text.textContent = `قرأت ${toArabicDigits(readCount)} من ٦٠٤ صفحة (${toArabicDigits(pct)}٪) — اليوم: ${toArabicDigits(todayCount)} من ${toArabicDigits(target)} صفحة${etaText}`;
    }
  }

  function initKhatmaTracking() {
    const target = $('#khatma-daily-target');
    const restartBtn = $('#btn-khatma-restart');

    if (target) {
      target.value = getKhatma().dailyTarget || 4;
      target.addEventListener('change', () => {
        const s = getKhatma();
        s.dailyTarget = Math.max(1, Number(target.value) || 1);
        saveKhatma(s);
        renderKhatmaProgress();
      });
    }

    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        saveKhatma({ startDate: todayStr(), dailyTarget: (getKhatma().dailyTarget || 4), pagesRead: {} });
        renderKhatmaProgress();
        showToast('تم بدء ختمة جديدة، بالتوفيق 🤍');
      });
    }

    renderKhatmaProgress();
  }

  /* ---------------------------------------------------------------- */
  /* بوصلة اتجاه القبلة                                                */
  /* ---------------------------------------------------------------- */
  const KAABA_LAT = 21.4225;
  const KAABA_LNG = 39.8262;
  let qiblaBearing = null;

  function computeQiblaBearing(lat, lng) {
    const φ1 = (lat * Math.PI) / 180;
    const φ2 = (KAABA_LAT * Math.PI) / 180;
    const Δλ = ((KAABA_LNG - lng) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = (Math.atan2(y, x) * 180) / Math.PI;
    return (θ + 360) % 360;
  }

  function handleQiblaOrientation(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') {
      heading = e.webkitCompassHeading; // iOS: قيمة مطلقة دائمًا
    } else if (e.alpha !== null && e.alpha !== undefined) {
      heading = (360 - e.alpha) % 360; // تقريب شائع لأندرويد
    }
    if (heading === null || qiblaBearing === null) return;

    const ring = $('#qibla-ring');
    const pinRotator = $('#qibla-pin-rotator');
    if (ring) ring.style.transform = `rotate(${-heading}deg)`;
    if (pinRotator) pinRotator.style.transform = `rotate(${qiblaBearing}deg)`;

    const status = $('#qibla-status');
    if (status) {
      const diff = Math.abs((((qiblaBearing - heading + 540) % 360)) - 180);
      status.textContent = diff < 6
        ? 'أنت متجه الآن نحو القبلة تمامًا 🕋'
        : `زاوية القبلة من الشمال: ${toArabicDigits(Math.round(qiblaBearing))}°`;
    }
  }

  function initQiblaCompass() {
    const btn = $('#btn-enable-qibla');
    const status = $('#qibla-status');
    if (!btn) return;

    function startListening() {
      const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(eventName, handleQiblaOrientation);
      btn.classList.add('hidden');
    }

    function startWithPosition(lat, lng) {
      qiblaBearing = computeQiblaBearing(lat, lng);
      if (status) status.textContent = `زاوية القبلة من الشمال: ${toArabicDigits(Math.round(qiblaBearing))}°`;

      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+: يتطلب إذنًا صريحًا من ضغطة المستخدم
        btn.textContent = 'تفعيل البوصلة';
        btn.classList.remove('hidden');
        btn.onclick = () => {
          DeviceOrientationEvent.requestPermission()
            .then((res) => {
              if (res === 'granted') startListening();
              else showToast('لم يتم منح إذن استخدام البوصلة');
            })
            .catch(() => showToast('تعذّر تفعيل البوصلة على هذا الجهاز'));
        };
      } else if ('DeviceOrientationEvent' in window) {
        startListening();
      } else {
        btn.classList.add('hidden');
        if (status) status.textContent += ' — بوصلة الجهاز غير مدعومة على هذا المتصفح، استخدم هذه الزاوية على بوصلة عادية';
      }
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => startWithPosition(pos.coords.latitude, pos.coords.longitude),
        () => { if (status) status.textContent = 'تعذّر تحديد موقعك؛ فعّل خدمة الموقع من إعدادات الهاتف لحساب اتجاه القبلة'; }
      );
    } else if (status) {
      status.textContent = 'المتصفح لا يدعم تحديد الموقع';
    }
  }

  async function goToLastRead() {
    const raw = localStorage.getItem('almus-hraf:bookmark');
    if (!raw) return showToast('لا توجد علامة محفوظة بعد');
    const bm = JSON.parse(raw);
    closeOverlay('#nav-overlay');
    switchToTab('quran');

    await loadPage(bm.page || 1);
    setTimeout(() => {
      const target = $(`.ayah[data-surah="${bm.surah}"][data-ayah="${bm.ayah}"]`);
      if (target) {
        target.classList.add('ayah-highlight');
        setTimeout(() => target.classList.remove('ayah-highlight'), 2500);
      }
    }, 300);
  }

  /* ---------------------------------------------------------------- */
  /* مواقيت الصلاة والقبلة والإشعارات                                 */
  /* ---------------------------------------------------------------- */
  const PRAYER_NAMES = {
    Fajr: 'الفجر',
    Sunrise: 'الشروق',
    Dhuhr: 'الظهر',
    Asr: 'العصر',
    Maghrib: 'المغرب',
    Isha: 'العشاء'
  };

  let prayerTimings = null;
  let timerInterval = null;
  const GEO_KEY = 'almus-hraf:geo';

  function saveGeo(lat, lng) {
    try { localStorage.setItem(GEO_KEY, JSON.stringify({ lat, lng })); } catch (e) { /* تجاهل */ }
  }
  function getSavedGeo() {
    try {
      const raw = localStorage.getItem(GEO_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  async function loadPrayerTimes() {
    let lat = 30.0444;
    let lng = 31.2357;

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchTimings(pos.coords.latitude, pos.coords.longitude),
        () => fetchTimings(lat, lng)
      );
    } else {
      fetchTimings(lat, lng);
    }

    async function fetchTimings(latitude, longitude) {
      saveGeo(latitude, longitude);
      try {
        const res = await fetch(`https://api.aladhan.com/v1/timings?latitude=${latitude}&longitude=${longitude}&method=5`);
        const data = await res.json();

        if (data && data.data) {
          prayerTimings = data.data.timings;
          const hijri = data.data.date.hijri;
          const hijriEl = $('#hijri-date');
          if (hijriEl) hijriEl.textContent = `${hijri.day} ${hijri.month.ar} ${hijri.year} هـ`;

          renderPrayerTimes(prayerTimings);
          startNextPrayerCountdown(prayerTimings);
          syncPushSubscription(); // أول مرة تتوفر فيها الإحداثيات، نُحدّث خادم الـ Push بها إن كان مفعّلاً
        }
      } catch (e) {
        const nextName = $('#next-prayer-name');
        if (nextName) nextName.textContent = 'تعذر جلب المواقيت';
      }
    }
  }

  function renderPrayerTimes(timings) {
    Object.keys(PRAYER_NAMES).forEach((key) => {
      const card = $(`.p-card[data-p="${key}"]`);
      if (card) {
        const timeStr = timings[key];
        card.querySelector('.p-time').textContent = format12Hour(timeStr);
      }
    });
  }

  function format12Hour(time24) {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    return `${toArabicDigits(h12)}:${toArabicDigits(m.toString().padStart(2, '0'))} ${period}`;
  }

  function startNextPrayerCountdown(timings) {
    if (timerInterval) clearInterval(timerInterval);

    function update() {
      const now = new Date();
      const list = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
      let nextP = null;
      let nextTime = null;

      for (let p of list) {
        const [h, m] = timings[p].split(':').map(Number);
        const pDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
        if (pDate > now) {
          nextP = p;
          nextTime = pDate;
          break;
        }
      }

      if (!nextP) {
        nextP = 'Fajr';
        const [h, m] = timings['Fajr'].split(':').map(Number);
        nextTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m, 0);
      }

      $$('.p-card').forEach((c) => c.classList.remove('active'));
      const activeCard = $(`.p-card[data-p="${nextP}"]`);
      if (activeCard) activeCard.classList.add('active');

      const nextName = $('#next-prayer-name');
      if (nextName) nextName.textContent = PRAYER_NAMES[nextP];

      const diff = nextTime - now;
      const hrs = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      const cd = $('#prayer-countdown');
      if (cd) {
        cd.textContent = `${toArabicDigits(String(hrs).padStart(2, '0'))}:${toArabicDigits(String(mins).padStart(2, '0'))}:${toArabicDigits(String(secs).padStart(2, '0'))}`;
      }
    }

    update();
    timerInterval = setInterval(update, 1000);
  }

  /* ---------------------------------------------------------------- */
  /* جدولة حقيقية للتذكيرات (أذكار الصباح/المساء + سورة الكهف الجمعة)  */
  /* تُفحص التذكيرات دوريًا أثناء تشغيل التطبيق (فتحه أو بقاؤه في      */
  /* الخلفية على نفس الجهاز)، وتُخزَّن أوقاتها وحالة تفعيلها محليًا      */
  /* حتى تبقى كما هي بين الجلسات. الإشعارات الحقيقية بعد إغلاق التطبيق  */
  /* بالكامل تحتاج خادم دفع (Push Server) خارجي غير متوفر هنا.          */
  /* ---------------------------------------------------------------- */
  const REMINDERS_KEY = 'almus-hraf:reminders';
  // كل التذكيرات مُفعَّلة تلقائيًا افتراضيًا (بمجرد ما المستخدم يوافق على إذن
  // الإشعارات)، والمستخدم اللي حابب يلغي أي واحد منها يدخل الإعدادات ويوقفه بنفسه
  const DEFAULT_REMINDERS = {
    sabah: { enabled: true, time: '06:00', lastSent: '' },
    masaa: { enabled: true, time: '18:00', lastSent: '' },
    kahf: { enabled: true, time: '08:00', lastSent: '' },
    wird: { enabled: true, time: '21:00', lastSent: '' },
    naom: { enabled: true, time: '22:00', lastSent: '' },
    mayyit4h: { enabled: true, intervalMinutes: 30, lastSentAt: 0 },
    prayers: { enabled: true, lastSent: {} }
  };

  function getReminderSettings() {
    try {
      const raw = localStorage.getItem(REMINDERS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_REMINDERS));
      const parsed = JSON.parse(raw);
      return Object.assign(JSON.parse(JSON.stringify(DEFAULT_REMINDERS)), parsed);
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_REMINDERS));
    }
  }

  function saveReminderSettings(settings) {
    try { localStorage.setItem(REMINDERS_KEY, JSON.stringify(settings)); } catch (e) { /* تجاهل */ }
  }

  function todayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function nowHM() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // فحص كل التذكيرات المفعّلة، وإرسال إشعار لأي منها حان وقته اليوم ولم يُرسل بعد
  function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const settings = getReminderSettings();
    const today = todayStr();
    const hm = nowHM();
    let changed = false;

    if (settings.sabah.enabled && settings.sabah.lastSent !== today && hm >= settings.sabah.time) {
      sendNotification('أذكار الصباح ☀️', 'حان وقت أذكار الصباح، اضغط لفتح المصحف الأشرف وقراءتها.');
      settings.sabah.lastSent = today;
      changed = true;
    }

    if (settings.masaa.enabled && settings.masaa.lastSent !== today && hm >= settings.masaa.time) {
      sendNotification('أذكار المساء 🌙', 'حان وقت أذكار المساء، اضغط لفتح المصحف الأشرف وقراءتها.');
      settings.masaa.lastSent = today;
      changed = true;
    }

    const isFriday = new Date().getDay() === 5; // الجمعة
    if (settings.kahf.enabled && isFriday && settings.kahf.lastSent !== today && hm >= settings.kahf.time) {
      sendNotification('سورة الكهف 📖', 'اليوم الجمعة، لا تنسَ قراءة سورة الكهف بارك الله فيك.');
      settings.kahf.lastSent = today;
      changed = true;
    }

    if (settings.wird && settings.wird.enabled && settings.wird.lastSent !== today && hm >= settings.wird.time) {
      sendNotification('تذكير الورد اليومي 📅', 'حان وقت وردك اليومي من القرآن، اضغط لفتح المصحف ومتابعة القراءة.');
      settings.wird.lastSent = today;
      changed = true;
    }

    if (settings.naom && settings.naom.enabled && settings.naom.lastSent !== today && hm >= settings.naom.time) {
      sendNotification('أذكار النوم 🛏️', 'حان وقت أذكار النوم، تقبّل الله منك.');
      settings.naom.lastSent = today;
      changed = true;
    }

    // دعاء للفقيد بالفترة التي حددها المستخدم (تحقّق محلي بسيط أثناء فتح التطبيق فقط؛ التكرار الحقيقي الدقيق يديره خادم الـ Push)
    if (settings.mayyit4h && settings.mayyit4h.enabled) {
      const intervalMs = (Number(settings.mayyit4h.intervalMinutes) > 0 ? Number(settings.mayyit4h.intervalMinutes) : 240) * 60 * 1000;
      if (!settings.mayyit4h.lastSentAt || Date.now() - settings.mayyit4h.lastSentAt >= intervalMs) {
        sendNotification('دعاء للفقيد 🕊️', 'اللهم اغفر لأشرف أحمد جاهين وارحمه وأسكنه فسيح جناتك — قل: اللهم اغفر له وارحمه.');
        settings.mayyit4h.lastSentAt = Date.now();
        changed = true;
      }
    }

    // إشعار عند دخول وقت كل صلاة من الصلوات الخمس، بالاعتماد على المواقيت المجلوبة لموقع الجهاز
    if (settings.prayers && settings.prayers.enabled && prayerTimings) {
      if (!settings.prayers.lastSent) settings.prayers.lastSent = {};
      ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach((key) => {
        const pTime = prayerTimings[key];
        if (!pTime) return;
        if (settings.prayers.lastSent[key] !== today && hm >= pTime) {
          sendNotification(`حان وقت صلاة ${PRAYER_NAMES[key]} 🕌`, 'حي على الصلاة، حي على الفلاح.');
          settings.prayers.lastSent[key] = today;
          changed = true;
        }
      });
    }

    if (changed) saveReminderSettings(settings);
  }

  let reminderCheckTimer = null;
  function startReminderScheduler() {
    checkReminders();
    if (reminderCheckTimer) clearInterval(reminderCheckTimer);
    // فحص كل دقيقة أثناء بقاء التطبيق مفتوحًا (بالمقدمة أو الخلفية)
    reminderCheckTimer = setInterval(checkReminders, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkReminders();
    });
  }

  function sendNotification(title, body) {
    // بانر منبثق داخل التطبيق نفسه (يظهر دائمًا فورًا بصريًا فوق الشاشة،
    // بغض النظر عن سلوك نظام التشغيل مع إشعارات المتصفح)
    showNotificationPopup(title, body);

    if (Notification.permission === 'granted' && navigator.serviceWorker) {
      playNotificationSound();
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(title, {
          body,
          icon: 'notif-icon-512.png',
          badge: 'notif-badge-96.png',
          dir: 'rtl',
          silent: false,
          requireInteraction: true, // يبقى ظاهرًا حتى يتفاعل معه المستخدم بدل اختفائه سريعًا
          vibrate: [80, 40, 80]
        });
      }).catch(() => {
        try {
          new Notification(title, {
            body, icon: 'notif-icon-512.png', dir: 'rtl', silent: false, requireInteraction: true
          });
        } catch (e) { /* تجاهل */ }
      });
    }
  }

  // بانر إشعار منبثق أعلى الشاشة (شبيه بإشعارات واتساب/فيسبوك داخل التطبيق)
  // بشعار "أشرف" الدائري، يظهر وينزلق من الأعلى فوق كل الواجهة مباشرة
  let notifPopupTimer = null;
  function showNotificationPopup(title, body) {
    const el = $('#notif-popup');
    if (!el) return;
    $('#notif-popup-title').textContent = title || '';
    $('#notif-popup-body').textContent = body || '';
    el.classList.add('show');
    clearTimeout(notifPopupTimer);
    notifPopupTimer = setTimeout(() => el.classList.remove('show'), 6000);
  }

  function initNotificationPopup() {
    const el = $('#notif-popup');
    const closeBtn = $('#notif-popup-close');
    if (!el || !closeBtn) return;
    closeBtn.addEventListener('click', () => {
      clearTimeout(notifPopupTimer);
      el.classList.remove('show');
    });
    el.addEventListener('click', (e) => {
      if (e.target === closeBtn) return;
      clearTimeout(notifPopupTimer);
      el.classList.remove('show');
    });
  }

  // تشغيل نغمة تنبيه قصيرة مع كل إشعار، بدل الاكتفاء برسالة صامتة.
  // تُستخدم للتذكيرات المحلية (أذكار، مواقيت الصلاة...) طالما التطبيق
  // مفتوح (بالمقدمة أو الخلفية)، وأيضًا لإشعارات push الحقيقية عند وصولها
  // والتطبيق ما زال له تبويب مفتوح (عبر رسالة من الـ Service Worker أدناه)
  let notificationAudio = null;
  function playNotificationSound() {
    try {
      if (!notificationAudio) notificationAudio = new Audio('notify.mp3');
      notificationAudio.currentTime = 0;
      notificationAudio.play().catch(() => { /* قد يمنع المتصفح التشغيل التلقائي أحيانًا */ });
    } catch (e) { /* تجاهل */ }
  }

  function syncReminderUI() {
    const settings = getReminderSettings();
    const permGranted = ('Notification' in window) && Notification.permission === 'granted';

    [
      ['sabah', '#toggle-sabah', '#time-sabah'],
      ['masaa', '#toggle-masaa', '#time-masaa'],
      ['kahf', '#toggle-kahf', '#time-kahf'],
      ['wird', '#toggle-wird', '#time-wird'],
      ['naom', '#toggle-naom', '#time-naom']
    ].forEach(([key, toggleSel, timeSel]) => {
        const toggle = $(toggleSel);
        const timeInput = $(timeSel);
        if (!toggle || !timeInput) return;

        toggle.checked = !!settings[key].enabled;
        timeInput.value = settings[key].time;
        toggle.disabled = !permGranted;
        timeInput.disabled = !permGranted || !settings[key].enabled;

        toggle.onchange = () => {
          const s = getReminderSettings();
          s[key].enabled = toggle.checked;
          saveReminderSettings(s);
          timeInput.disabled = !toggle.checked;
          checkReminders();
          syncPushSubscription();
          if (toggle.checked) showToast('تم تفعيل التذكير بنجاح 🔔');
        };

        timeInput.onchange = () => {
          const s = getReminderSettings();
          s[key].time = timeInput.value;
          s[key].lastSent = ''; // إعادة التفعيل لهذا اليوم عند تغيير الوقت
          saveReminderSettings(s);
          syncPushSubscription();
        };
      });

    // دعاء للفقيد: مفتاح تفعيل + فترة تكرار يحددها المستخدم بنفسه (بالدقائق أو الساعات)
    const mayyitToggle = $('#toggle-mayyit4h');
    const mayyitValueInput = $('#mayyit-interval-value');
    const mayyitUnitSelect = $('#mayyit-interval-unit');
    if (mayyitToggle) {
      if (!settings.mayyit4h) settings.mayyit4h = { enabled: true, intervalMinutes: 30, lastSentAt: 0 };
      if (!settings.mayyit4h.intervalMinutes) settings.mayyit4h.intervalMinutes = 240;

      mayyitToggle.checked = !!settings.mayyit4h.enabled;
      mayyitToggle.disabled = !permGranted;

      // عرض الفترة المحفوظة بأنسب وحدة (ساعات لو قابلة للقسمة بالتمام، وإلا دقائق)
      if (mayyitValueInput && mayyitUnitSelect) {
        const savedMin = settings.mayyit4h.intervalMinutes;
        if (savedMin % 60 === 0) {
          mayyitUnitSelect.value = 'hours';
          mayyitValueInput.value = savedMin / 60;
        } else {
          mayyitUnitSelect.value = 'minutes';
          mayyitValueInput.value = savedMin;
        }
        mayyitValueInput.disabled = !permGranted;
        mayyitUnitSelect.disabled = !permGranted;
      }

      function currentIntervalMinutes() {
        const raw = Math.max(1, Number(mayyitValueInput.value) || 1);
        return mayyitUnitSelect.value === 'hours' ? raw * 60 : raw;
      }

      mayyitToggle.onchange = () => {
        const s = getReminderSettings();
        if (!s.mayyit4h) s.mayyit4h = { enabled: true, intervalMinutes: 30, lastSentAt: 0 };
        s.mayyit4h.enabled = mayyitToggle.checked;
        if (mayyitToggle.checked) s.mayyit4h.lastSentAt = Date.now(); // أول تذكير بعد فترة كاملة من التفعيل
        saveReminderSettings(s);
        checkReminders();
        syncPushSubscription();
        if (mayyitToggle.checked) {
          const unitLabel = mayyitUnitSelect && mayyitUnitSelect.value === 'hours' ? 'ساعة' : 'دقيقة';
          showToast(`تم تفعيل الدعاء الدوري للفقيد كل ${toArabicDigits(mayyitValueInput ? mayyitValueInput.value : 4)} ${unitLabel} 🕊️`);
        }
      };

      if (mayyitValueInput && mayyitUnitSelect) {
        const onIntervalChange = () => {
          const s = getReminderSettings();
          if (!s.mayyit4h) s.mayyit4h = { enabled: true, intervalMinutes: 30, lastSentAt: 0 };
          s.mayyit4h.intervalMinutes = currentIntervalMinutes();
          s.mayyit4h.lastSentAt = Date.now(); // إعادة ضبط العد التنازلي من الآن بالفترة الجديدة
          saveReminderSettings(s);
          syncPushSubscription();
        };
        mayyitValueInput.addEventListener('change', onIntervalChange);
        mayyitUnitSelect.addEventListener('change', onIntervalChange);
      }
    }

    // تذكير مواقيت الصلاة الخمس: مفتاح تفعيل فقط بلا وقت يدوي (يعتمد على المواقيت المجلوبة تلقائيًا)
    const prayersToggle = $('#toggle-prayers');
    if (prayersToggle) {
      if (!settings.prayers) settings.prayers = { enabled: true, lastSent: {} };
      prayersToggle.checked = !!settings.prayers.enabled;
      prayersToggle.disabled = !permGranted;

      prayersToggle.onchange = () => {
        const s = getReminderSettings();
        if (!s.prayers) s.prayers = { enabled: true, lastSent: {} };
        s.prayers.enabled = prayersToggle.checked;
        saveReminderSettings(s);
        checkReminders();
        syncPushSubscription();
        if (prayersToggle.checked) showToast('تم تفعيل تذكير مواقيت الصلاة 🕌');
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /* إشعارات الدفع الحقيقية (Web Push) عبر خادم خارجي (راسبيري باي)     */
  /* تعمل حتى بعد إغلاق التطبيق تمامًا. راجع push-server/README.md      */
  /* ---------------------------------------------------------------- */
  function pushEnabled() {
    return !!(PUSH_CONFIG.serverUrl && PUSH_CONFIG.vapidPublicKey && 'serviceWorker' in navigator && 'PushManager' in window);
  }

  // تحويل مفتاح VAPID العام من Base64Url إلى Uint8Array كما تتطلبه pushManager.subscribe
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  // الاشتراك الفعلي في الدفع عبر المتصفح (مرة واحدة فقط، ثم يبقى الاشتراك محفوظًا في المتصفح)
  async function subscribeToPush() {
    if (!pushEnabled()) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUSH_CONFIG.vapidPublicKey)
        });
      }
      return sub;
    } catch (e) {
      return null;
    }
  }

  // إرسال الاشتراك + التفضيلات الحالية (المواعيد المفعّلة + الموقع الجغرافي) إلى خادم الدفع
  // يُستدعى عند: تفعيل الإذن أول مرة، وأي تغيير في مواعيد/مفاتيح التذكيرات، وأول توفّر للموقع الجغرافي
  let pushSyncTimer = null;
  function syncPushSubscription() {
    if (!pushEnabled()) return;
    clearTimeout(pushSyncTimer);
    // تأخير بسيط (Debounce) لتجميع عدة تغييرات متتالية في طلب واحد بدل إثقال السيرفر الصغير
    pushSyncTimer = setTimeout(async () => {
      const sub = await subscribeToPush();
      if (!sub) return;

      const settings = getReminderSettings();
      const geo = getSavedGeo();

      try {
        await fetch(`${PUSH_CONFIG.serverUrl}/api/subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true' // يتجاهله السيرفر لو مش شغال عبر ngrok، مطلوب فقط مع نفق ngrok المجاني
          },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            lat: geo ? geo.lat : null,
            lng: geo ? geo.lng : null,
            prefs: {
              sabah: settings.sabah,
              masaa: settings.masaa,
              kahf: settings.kahf,
              wird: settings.wird,
              naom: settings.naom,
              mayyit4h: {
                enabled: !!(settings.mayyit4h && settings.mayyit4h.enabled),
                intervalMinutes: (settings.mayyit4h && Number(settings.mayyit4h.intervalMinutes) > 0) ? Number(settings.mayyit4h.intervalMinutes) : 240
              },
              prayers: { enabled: !!(settings.prayers && settings.prayers.enabled) }
            }
          })
        });
      } catch (e) { /* السيرفر غير متاح الآن — سيُعاد المحاولة عند أي تغيير لاحق أو فتح التطبيق مجددًا */ }
    }, 800);
  }

  // استقبال رسائل من الـ Service Worker (الضغط على إشعار push، أو تجديد اشتراك منتهي)
  function initPushMessaging() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'notification-click' && msg.url) {
        // فتح التبويب المناسب حسب رابط الإشعار (اختياري) — الافتراضي فتح الصفحة الرئيسية فقط
      } else if (msg.type === 'push-resubscribed') {
        syncPushSubscription();
      } else if (msg.type === 'push-notification-shown') {
        playNotificationSound();
        showNotificationPopup(msg.title, msg.body);
      }
    });
  }

  function initNotifications() {
    const btn = $('#btn-enable-notify');
    if (!btn) return;

    if ('Notification' in window && Notification.permission === 'granted') {
      btn.textContent = 'مُفعَّلة ✅';
      btn.disabled = true;
      syncPushSubscription();
    }

    syncReminderUI();
    startReminderScheduler();
    initPushMessaging();
    initNotificationPopup();

    btn.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        return showToast('المتصفح لا يدعم الإشعارات');
      }

      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        btn.textContent = 'مُفعَّلة ✅';
        btn.disabled = true;
        showToast(
          pushEnabled()
            ? 'تم تفعيل الإذن، يمكنك الآن ضبط مواعيد التذكيرات بالأسفل 🔔'
            : 'تم تفعيل الإذن (تذكيرات محلية أثناء فتح التطبيق فقط، لم يُضبط خادم الـ Push بعد) 🔔'
        );
        syncReminderUI();
        checkReminders();
        syncPushSubscription();
      } else {
        showToast('لم يتم إعطاء الإذن للإشعارات');
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* التسجيل والتشغيل الرئيسي                                         */
  /* ---------------------------------------------------------------- */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  function initOverlayBackdrops() {
    $$('.overlay').forEach((ov) => {
      ov.addEventListener('click', (e) => {
        if (e.target === ov) ov.classList.remove('open');
      });
    });
  }

  async function init() {
    initNavMenu();
    initHomeTab();
    initHadithTab();
    initDuaBanner();
    initIndexOverlay();
    initSwipeNavigation();
    initSwipeHintOnce();
    initAyahModal();
    initSettings();
    initOverlayBackdrops();
    registerServiceWorker();

    window.addEventListener('resize', fitMushafPage);
    window.addEventListener('orientationchange', fitMushafPage);

    loadPrayerTimes();
    initNotifications();
    initSurahAudioPlayer();
    initPlayerOverlay();
    initQiblaCompass();

    initDhikrListOverlay();
    if (typeof AZKAR_DATA !== 'undefined') renderAccordion('#azkar-accordion', AZKAR_DATA, 'azkar');
    if (typeof DUAS_DATA !== 'undefined') renderAccordion('#duas-accordion', DUAS_DATA, 'duas');

    loadSurahIndex();

    const savedPage = Number(localStorage.getItem('almus-hraf:currentPage') || 1);
    await loadPage(savedPage);

    setTimeout(() => {
      const splash = $('#splash');
      if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.remove(), 600);
      }
    }, 500);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
