const nav = document.querySelector('.nav');
const mobile = window.matchMedia('(max-width: 600px)');
let previousY = window.scrollY;
let queued = false;
function updateNavigation() {
  queued = false;
  const y = Math.max(0, window.scrollY);
  if (!mobile.matches) { nav.classList.remove('nav--hidden'); previousY = y; return; }
  const delta = y - previousY;
  const focused = nav.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
  if (y < 64 || focused || delta < -4) nav.classList.remove('nav--hidden');
  else if (delta > 4) nav.classList.add('nav--hidden');
  if (Math.abs(delta) > 4 || y < 64) previousY = y;
}
window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(updateNavigation); } }, {passive:true});
mobile.addEventListener('change', () => { nav.classList.remove('nav--hidden'); previousY = window.scrollY; });
nav.addEventListener('focusin', () => nav.classList.remove('nav--hidden'));
