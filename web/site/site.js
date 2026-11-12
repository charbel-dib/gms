/* GMS website: the check-in desk in the hero, and the request form asked one question at a time. */
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the language can change while the page is open (the العربية button), so it is read each time
  const tr = (en, ar) => (window.GMS_LANG === "ar" ? ar : en);

  // ---- hero: the desk keeps receiving people, newest on top, three rows always on screen ----
  // The three rows in the HTML are what shows without JavaScript or with reduced motion.
  const PEOPLE = [
    { s: "ok", av: "MR", en: ["Maya Rizk", "6 months, 2 months left", "Welcome in"], ar: ["مايا رزق", "6 أشهر، بقي شهران", "أهلًا وسهلًا"] },
    { s: "warn", av: "KS", en: ["Karim Saab", "1 month, ends Friday", "Reminder ready on WhatsApp"], ar: ["كريم صعب", "شهر، ينتهي يوم الجمعة", "التذكير جاهز على واتساب"] },
    { s: "ok", av: "HS", en: ["Hadi Salameh", "Paid $35 today", "Welcome in"], ar: ["هادي سلامة", "دفع 35$ اليوم", "أهلًا وسهلًا"] },
    { s: "bad", av: "JK", en: ["Joe Khoury", "1 year, owes $45", "Collect $45 or 4,028,000 LBP"], ar: ["جو خوري", "سنة، عليه 45$", "حصّل 45$ أو 4,028,000 ل.ل."] },
    { s: "ok", av: "RH", en: ["Rita Haddad", "3 months, 23 days left", "Welcome in"], ar: ["ريتا حداد", "3 أشهر، بقي 23 يومًا", "أهلًا وسهلًا"] },
    { s: "warn", av: "LN", en: ["Layal Najjar", "Student, ends tomorrow", "Reminder ready on WhatsApp"], ar: ["ليال نجار", "اشتراك طلاب، ينتهي غدًا", "التذكير جاهز على واتساب"] },
  ];
  const desk = document.querySelector(".desk");
  const list = document.getElementById("deskList");
  const scanText = document.getElementById("scanText");
  const scan = document.querySelector(".desk-scan");
  const count = document.getElementById("inCount");
  const pause = document.getElementById("deskPause");
  if (desk && list && !reduce) {
    const row = (p) => {
      const [name, plan, verdict] = tr(p.en, p.ar);
      const li = document.createElement("li");
      li.dataset.s = p.s;
      li.innerHTML = '<span class="who"><span class="av"></span><span><b></b><small></small></span></span><span class="verdict"><span class="plate"></span><span></span></span>';
      li.querySelector(".av").textContent = p.av;
      li.querySelector("b").textContent = name;
      li.querySelector("small").textContent = plan;
      li.querySelector(".verdict > span:last-child").textContent = verdict;
      li.dataset.k = String(PEOPLE.indexOf(p));
      return li;
    };
    let next = 0, visitors = 41, timer = 0, running = false, paused = false, onScreen = false;
    const idle = () => tr("Type a name or scan a code", "اكتب اسمًا أو امسح رمزًا");
    // start from three people already in, so the desk is never empty
    const fill = () => {
      const shown = [...list.children].map((li) => li.dataset.k).filter(Boolean).map(Number);
      const keys = shown.length === 3 ? shown : [3, 2, 1];
      list.replaceChildren(...keys.map((k) => row(PEOPLE[k])));
      if (!shown.length) next = 4;
    };
    fill();
    desk.classList.add("live");
    const step = () => {
      if (!running) return;
      const p = PEOPLE[next % PEOPLE.length];
      next += 1;
      scan.classList.add("reading");
      scanText.textContent = tr(p.en[0], p.ar[0]);
      timer = setTimeout(() => {
        scan.classList.remove("reading");
        scanText.textContent = idle();
        const li = row(p);
        li.classList.add("arrive");
        list.querySelector(".arrive")?.classList.remove("arrive");
        list.prepend(li);
        // the rows already there slide down by the height of the newcomer
        const h = li.offsetHeight + 8;
        [...list.children].slice(1).forEach((r) => r.animate([{ transform: `translateY(${-h}px)` }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }));
        list.lastElementChild?.remove();
        count.textContent = String(++visitors);
        timer = setTimeout(step, 2200);
      }, 900);
    };
    const sync = () => {
      const go = onScreen && !paused && !document.hidden;
      if (go && !running) { running = true; timer = setTimeout(step, 700); }
      if (!go && running) { running = false; clearTimeout(timer); scan.classList.remove("reading"); scanText.textContent = idle(); }
    };
    new IntersectionObserver((e) => { onScreen = e.some((x) => x.isIntersecting); sync(); }).observe(desk);
    document.addEventListener("visibilitychange", sync);
    if (pause) {
      pause.hidden = false;
      pause.addEventListener("click", () => {
        paused = !paused;
        pause.setAttribute("aria-pressed", String(paused));
        pause.textContent = paused ? tr("Play", "تشغيل") : tr("Pause", "إيقاف مؤقت");
        sync();
      });
    }
    // after a language switch, rebuild the rows in the new language
    document.addEventListener("gms:lang", () => {
      fill();
      if (!scan.classList.contains("reading")) scanText.textContent = idle();
      if (pause) pause.textContent = paused ? tr("Play", "تشغيل") : tr("Pause", "إيقاف مؤقت");
    });
  }
  // a hairline under the nav once the page has moved
  const nav = document.querySelector(".nav");
  if (nav) { const on = () => nav.classList.toggle("scrolled", window.scrollY > 8); on(); window.addEventListener("scroll", on, { passive: true }); }
  const clock = document.getElementById("clock");
  if (clock) {
    const tick = () => { clock.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" }); };
    tick();
    setInterval(tick, 30000);
  }

  // ---- the request: one question per card ----
  // Without JavaScript every question shows at once and the form still sends.
  const form = document.getElementById("wizard");
  if (!form) return;
  const steps = [...form.querySelectorAll(".step")];
  const bar = document.getElementById("wzBar");
  const counter = document.getElementById("wzCount");
  const back = document.getElementById("wzBack");
  const next = document.getElementById("wzNext");
  const msg = document.getElementById("formMsg");
  const last = steps.length - 1;
  let at = 0;
  form.classList.add("js");

  const show = (n, focus = true) => {
    form.dataset.dir = n < at ? "back" : "fwd";
    at = n;
    steps.forEach((s, k) => s.classList.toggle("on", k === n));
    bar.style.width = `${((n + 1) / steps.length) * 100}%`;
    counter.textContent = tr(`${n + 1} of ${steps.length}`, `${n + 1} من ${steps.length}`);
    back.hidden = n === 0;
    next.textContent = n === last ? tr("Ask for my free month", "اطلب شهري المجاني") : tr("Next", "التالي");
    msg.textContent = "";
    msg.className = "form-msg";
    if (focus) (steps[n].querySelector("input:checked") || steps[n].querySelector("input:not([type=radio]):not([tabindex='-1'])") || steps[n].querySelector("input"))?.focus({ preventScroll: true });
  };

  // what each card needs before moving on
  const check = (n) => {
    const s = steps[n];
    const bad = (el, text) => { if (el) el.setAttribute("aria-invalid", "true"); msg.textContent = text; msg.className = "form-msg err"; el?.focus(); return false; };
    s.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    if (s.querySelector("input[type=radio]") && !s.querySelector("input:checked")) return bad(null, tr("Pick one answer.", "اختر إجابة واحدة."));
    if (n === 3) {
      if (form.elements.name.value.trim().length < 2) return bad(form.elements.name, tr("Write your name.", "اكتب اسمك."));
      if (form.elements.gym_name.value.trim().length < 2) return bad(form.elements.gym_name, tr("Write the gym’s name.", "اكتب اسم النادي."));
    }
    if (n === 4 && form.elements.phone.value.replace(/\D/g, "").length < 7) return bad(form.elements.phone, tr("Write a phone number we can reach on WhatsApp.", "اكتب رقمًا يمكننا مراسلتك عليه عبر واتساب."));
    return true;
  };

  // a tap on an answer moves on by itself
  form.querySelectorAll(".choices input").forEach((r) => r.addEventListener("change", () => {
    const n = steps.indexOf(r.closest(".step"));
    if (n === at && n < last) setTimeout(() => show(n + 1), reduce ? 0 : 180);
  }));
  // quick town buttons fill the field and move on
  const city = form.elements.city;
  document.querySelectorAll("#cityQuick button").forEach((b) => b.addEventListener("click", () => {
    city.value = b.textContent;
    document.querySelectorAll("#cityQuick button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    show(at + 1);
  }));
  city.addEventListener("input", () => document.querySelectorAll("#cityQuick button").forEach((x) => x.setAttribute("aria-pressed", String(x.textContent === city.value))));
  back.addEventListener("click", () => show(Math.max(0, at - 1)));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!check(at)) return;
    if (at < last) { show(at + 1); return; }
    const d = Object.fromEntries(new FormData(form));
    const body = {
      name: d.name, gym_name: d.gym_name, phone: d.phone, city: d.city || null, members: d.members || null,
      message: d.kind ? `Type of gym: ${d.kind}` : null, website: d.website || "",
    };
    next.disabled = true;
    next.textContent = tr("Sending…", "جارٍ الإرسال…");
    try {
      const r = await fetch("/api/public/demo-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(/phone/i.test(j.message || "") ? tr("This phone number doesn’t look right. Check it and try again.", "رقم الهاتف غير صحيح. تحقّق منه وحاول مرة أخرى.") : tr("It didn’t go through. Try again, or message us on WhatsApp.", "لم يُرسل الطلب. حاول مرة أخرى، أو راسلنا على واتساب."));
      const first = String(d.name).trim().split(/\s+/)[0];
      const done = document.createElement("div");
      done.className = "done";
      done.setAttribute("role", "status");
      const h = document.createElement("h3");
      h.textContent = tr(`Thanks, ${first}.`, `شكرًا يا ${first}.`);
      const p = document.createElement("p");
      p.textContent = tr("We’ll message you on WhatsApp today to find a time to pass by.", "سنراسلك على واتساب اليوم لنتفق على موعد للزيارة.");
      done.append(h, p);
      form.replaceChildren(done);
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "form-msg err";
      next.disabled = false;
      next.textContent = tr("Ask for my free month", "اطلب شهري المجاني");
    }
  });

  show(0, false);
  // after a language switch, relabel the counter and the buttons
  document.addEventListener("gms:lang", () => { if (steps[at]?.isConnected) show(at, false); else { const d = form.querySelector(".done"); if (d) d.dir = document.documentElement.dir; } });
})();
