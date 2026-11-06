/* GMS website: the reception demo in the hero, the product tour tabs, and the demo request form. */
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- hero: three members check in, one after another ----
  const desk = document.querySelector(".desk");
  const rows = [...document.querySelectorAll("#deskList li")];
  const scanText = document.getElementById("scanText");
  const scan = document.querySelector(".desk-scan");
  const count = document.getElementById("inCount");
  if (desk && rows.length && !reduce) {
    desk.classList.add("live");
    const names = ["Rita Haddad", "Karim Saab", "Joe Khoury"];
    let i = 0, visitors = 41;
    const step = () => {
      if (i === rows.length) {
        // pause on the full desk, then start again
        setTimeout(() => { rows.forEach((r) => r.classList.remove("in")); i = 0; visitors = 41; count.textContent = String(visitors); setTimeout(step, 600); }, 4200);
        return;
      }
      scan.classList.add("reading");
      scanText.textContent = `Reading ${names[i]}’s QR code…`;
      setTimeout(() => {
        scan.classList.remove("reading");
        scanText.textContent = "Scan a QR code, or type a name";
        rows[i].classList.add("in");
        visitors += 1;
        count.textContent = String(visitors);
        i += 1;
        setTimeout(step, 1500);
      }, 900);
    };
    // start only when the desk is visible
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

  // ---- product tour: accessible tabs (arrow keys move between them) ----
  const tabs = [...document.querySelectorAll('.tour-tabs [role="tab"]')];
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const k = e.key;
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) return;
      e.preventDefault();
      const n = k === "Home" ? 0 : k === "End" ? tabs.length - 1 : (i + (k === "ArrowDown" || k === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[n], true);
    });
  });

  // ---- pricing buttons pre-fill the plan in the demo form ----
  document.querySelectorAll("[data-plan]").forEach((a) => a.addEventListener("click", () => {
    const msg = document.querySelector('#demoForm textarea[name="message"]');
    if (msg && !msg.value) msg.value = `Interested in the ${a.dataset.plan} plan.`;
  }));

  // ---- demo request ----
  const form = document.getElementById("demoForm");
  const out = document.getElementById("formMsg");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      out.className = "form-msg";
      const fields = ["name", "gym_name", "phone"];
      let firstBad = null;
      for (const f of fields) {
        const el = form.elements[f];
        const ok = el.value.trim().length >= (f === "phone" ? 7 : 2);
        el.setAttribute("aria-invalid", String(!ok));
        if (!ok && !firstBad) firstBad = el;
      }
      if (firstBad) { out.textContent = "Fill in your name, your gym and a phone number."; out.classList.add("err"); firstBad.focus(); return; }
      const data = Object.fromEntries(new FormData(form));
      const body = { name: data.name, gym_name: data.gym_name, phone: data.phone, city: data.city || null, members: data.members || null, message: data.message || null, website: data.website || "" };
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const r = await fetch("/api/public/demo-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Something went wrong. Message us on WhatsApp instead.");
        form.classList.add("sent");
        form.innerHTML = `<h3>Thanks, ${String(data.name).split(" ")[0].replace(/[<>&]/g, "")}!</h3><p style="color:var(--ink-2);max-width:40ch">We’ll message you on WhatsApp today to find a time for your demo.</p>`;
      } catch (err) {
        out.textContent = err.message;
        out.classList.add("err");
        btn.disabled = false;
        btn.textContent = "Book my demo";
      }
    });
  }
})();
