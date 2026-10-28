// Retain the real select as the source of truth for forms and scripts.
for (const select of document.querySelectorAll('#unit, #format, #pdf-method')) {
  const wrapper = document.createElement('div'); wrapper.className = 'custom-select';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'select-trigger';
  button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', select.getAttribute('aria-label'));
  const value = document.createElement('span'); value.className = 'select-value';
  const arrow = document.createElement('span'); arrow.className = 'select-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '⌄';
  button.append(value, arrow);
  const list = document.createElement('div'); list.className = 'select-options'; list.id = `options-${select.id}`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', select.getAttribute('aria-label')); button.setAttribute('aria-controls', list.id); list.hidden = true;
  select.insertAdjacentElement('afterend', wrapper); wrapper.append(button, list); select.classList.add('native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  const sync = () => {
    value.textContent = select.selectedOptions[0]?.textContent || '';
    button.setAttribute('aria-label', select.getAttribute('aria-label'));
    list.setAttribute('aria-label', select.getAttribute('aria-label'));
    button.disabled = select.disabled;
    list.replaceChildren();
    for (const option of select.options) {
      if (option.disabled) continue;
      const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'select-option'; choice.setAttribute('role', 'option'); choice.setAttribute('aria-selected', String(option.selected)); choice.textContent = option.textContent;
      choice.addEventListener('click', () => { select.value = option.value; select.dispatchEvent(new Event('change', {bubbles:true})); sync(); close(); button.focus(); });
      list.append(choice);
    }
  };
  button.addEventListener('click', () => { const opening = list.hidden; document.querySelectorAll('.select-options').forEach(other => { other.hidden = true; other.previousElementSibling?.setAttribute('aria-expanded', 'false'); }); sync(); list.hidden = !opening; button.setAttribute('aria-expanded', String(opening)); });
  button.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) button.click(); (e.key === 'ArrowDown' ? list.firstElementChild : list.lastElementChild)?.focus(); } else if (e.key === 'Escape') close(); });
  list.addEventListener('keydown', e => { const choices = [...list.querySelectorAll('button')], i = choices.indexOf(document.activeElement); if (e.key === 'Escape') { e.preventDefault(); close(); button.focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); choices[(i + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus(); } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); (e.key === 'Home' ? choices[0] : choices.at(-1))?.focus(); } });
  document.addEventListener('click', event => { if (!wrapper.contains(event.target)) close(); });
  select.addEventListener('change', sync);
  new MutationObserver(sync).observe(select, {attributes:true, childList:true, subtree:true, characterData:true});
  window.addEventListener('berkasia:language', sync);
  window.addEventListener('berkasia:sync-selects', sync);
  sync();
}
