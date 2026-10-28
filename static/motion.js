// Keep motion decorative: content and controls remain usable without animation.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
window.animateEntrance = (element, delay = 0) => {
  if (!element || reducedMotion.matches || typeof element.animate !== 'function') return;
  element.getAnimations().filter(animation => animation.id === 'berkasia-entrance').forEach(animation => animation.cancel());
  const animation = element.animate(
    [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 700, delay, easing: 'cubic-bezier(.22,1,.36,1)' }
  );
  animation.id = 'berkasia-entrance';
};
window.animateFeedback = element => {
  if (!element || reducedMotion.matches || typeof element.animate !== 'function') return;
  element.animate([{transform:'scale(1)'},{transform:'scale(.97)'},{transform:'scale(1)'}], {duration:450,easing:'cubic-bezier(.22,1,.36,1)'});
};
document.addEventListener('click', event => {
  const control = event.target.closest('button:not(:disabled), a.download');
  if (control) window.animateFeedback(control);
});
// Start the illustrated sequence from step one when the tool or language changes.
window.restartSteps = () => {
  if (reducedMotion.matches) return;
  document.querySelectorAll('.step-card, .step-card *, .step-indicators span').forEach(element => {
    element.getAnimations().forEach(animation => { if (animation.effect?.getComputedTiming().iterations === Infinity) animation.currentTime = 0; });
  });
};
window.addEventListener('berkasia:language', window.restartSteps);
