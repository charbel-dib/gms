/* show the English or the Arabic version, the same choice as on the main site */
(() => {
  let lang = "en";
  try { lang = new URLSearchParams(location.search).get("lang") || localStorage.getItem("gms.site.lang") || "en"; } catch {}
  const btn = document.getElementById("langBtn");
  const set = (l) => {
    document.documentElement.lang = l;
    document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
    btn.textContent = l === "ar" ? "English" : "العربية";
    btn.lang = l === "ar" ? "en" : "ar";
    document.querySelector(".nav-cta .btn").textContent = l === "ar" ? "جرّبه ببلاش" : "Try it free";
    document.title = l === "ar" ? "الخصوصية والشروط · GMS" : "Privacy and terms · GMS";
  };
  set(lang === "ar" ? "ar" : "en");
  btn.addEventListener("click", () => {
    const next = document.documentElement.lang === "ar" ? "en" : "ar";
    try { localStorage.setItem("gms.site.lang", next); } catch {}
    set(next);
  });
})();
