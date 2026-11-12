/* GMS website: the check-in demo in the hero, and the request form asked one question at a time. */
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const AR = window.GMS_LANG === "ar";
  const tr = (en, ar) => (AR ? ar : en);

  // ---- hero: three members check in, one after another ----
  const desk = document.querySelector(".desk");
  const rows = [...document.querySelectorAll("#deskList li")];
  const scanText = document.getElementById("scanText");
  const scan = document.querySelector(".desk-scan");
  const count = document.getElementById("inCount");
  if (desk && rows.length && !reduce) {
    desk.classList.add("live");
    const idle = scanText.textContent;
    let i = 0, visitors = 41;
    const step = () => {
      if (i === rows.length) {
        // pause on the full desk, then start again
        setTimeout(() => { rows.forEach((r) => r.classList.remove("in")); i = 0; visitors = 41; count.textContent = String(visitors); setTimeout(step, 600); }, 4200);
        return;
      }
      const name = rows[i].querySelector("b").textContent;
      scan.classList.add("reading");
      scanText.textContent = name;
      setTimeout(() => {
        scan.classList.remove("reading");
        scanText.textContent = idle;
        rows[i].classList.add("in");
        count.textContent = String(++visitors);
        i += 1;
        setTimeout(step, 1500);
      }, 900);
    };
    // start only when the desk is on screen
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); setTimeout(step, 500); }
    });
    io.observe(desk);
  }
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
    if (s.querySelector("input[type=radio]") && !s.querySelector("input:checked")) return bad(null, tr("Pick one answer.", "اختار جواب."));
    if (n === 3) {
      if (form.elements.name.value.trim().length < 2) return bad(form.elements.name, tr("Write your name.", "اكتب اسمك."));
      if (form.elements.gym_name.value.trim().length < 2) return bad(form.elements.gym_name, tr("Write the gym’s name.", "اكتب اسم النادي."));
    }
    if (n === 4 && form.elements.phone.value.replace(/\D/g, "").length < 7) return bad(form.elements.phone, tr("Write a phone number we can reach on WhatsApp.", "اكتب رقم فينا نراسلك عليه عالواتساب."));
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
    next.textContent = tr("Sending…", "عم نبعت…");
    try {
      const r = await fetch("/api/public/demo-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(/phone/i.test(j.message || "") ? tr("This phone number doesn’t look right. Check it and try again.", "رقم التلفون مش مظبوط. تأكد منه وجرّب مرة تانية.") : tr("It didn’t go through. Try again, or message us on WhatsApp.", "ما انبعتت. جرّب مرة تانية، أو راسلنا عالواتساب."));
      const first = String(d.name).trim().split(/\s+/)[0];
      const done = document.createElement("div");
      done.className = "done";
      done.setAttribute("role", "status");
      const h = document.createElement("h3");
      h.textContent = tr(`Thanks, ${first}.`, `شكراً ${first}.`);
      const p = document.createElement("p");
      p.textContent = tr("We’ll message you on WhatsApp today to find a time to pass by.", "منراسلك عالواتساب اليوم لنتفق عوقت نمرق فيه.");
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
})();
