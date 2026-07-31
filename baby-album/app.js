/* すくすくアルバム — フィルター / ライトボックス / スクロール表示 */
(function () {
  'use strict';

  var grid = document.getElementById('photo-grid');
  if (!grid) return;

  /* JS が動くときだけ「あとから表示」を有効にする */
  document.documentElement.classList.add('js');

  var items = Array.prototype.slice.call(grid.querySelectorAll('li'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var resultCount = document.getElementById('result-count');
  var emptyState = document.getElementById('empty-state');
  var totalCount = document.getElementById('total-count');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (totalCount) totalCount.textContent = String(items.length);

  /* ---------- スクロールで順番に表示 ---------- */
  function reveal(el) { el.classList.add('is-visible'); }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach(reveal);
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

    items.forEach(function (item) { observer.observe(item); });
  }

  /* ---------- タグでしぼりこむ ---------- */
  function visibleItems() {
    return items.filter(function (item) { return !item.hidden; });
  }

  function applyFilter(filter) {
    var shown = 0;

    items.forEach(function (item) {
      var match = filter === 'all' || item.dataset.tag === filter;
      item.hidden = !match;
      if (match) {
        item.style.setProperty('--i', String(shown));
        reveal(item);
        shown++;
      }
    });

    if (resultCount) resultCount.textContent = shown + '枚を表示中';
    if (emptyState) emptyState.hidden = shown !== 0;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (other) {
        other.setAttribute('aria-pressed', String(other === chip));
      });
      applyFilter(chip.dataset.filter);
    });
  });

  /* ---------- ライトボックス ---------- */
  var dialog = document.getElementById('lightbox');
  var photoBox = document.getElementById('lightbox-photo');
  var titleEl = document.getElementById('lightbox-title');
  var captionEl = document.getElementById('lightbox-caption');
  var dateEl = document.getElementById('lightbox-date');
  var closeBtn = document.getElementById('lightbox-close');
  var prevBtn = document.getElementById('lightbox-prev');
  var nextBtn = document.getElementById('lightbox-next');
  var current = 0;

  var supportsDialog = dialog && typeof dialog.showModal === 'function';

  function show(index) {
    var list = visibleItems();
    if (!list.length) return;

    current = (index + list.length) % list.length;

    var card = list[current].querySelector('.card');
    var source = card.querySelector('.card-photo');
    var time = card.querySelector('time');

    photoBox.innerHTML = source.innerHTML;
    photoBox.className = 'lightbox-photo card-photo--' + (card.dataset.theme || 'a');
    photoBox.setAttribute('aria-label', card.dataset.title + 'の写真');

    titleEl.textContent = card.dataset.title;
    captionEl.textContent = card.dataset.caption;
    dateEl.textContent = card.dataset.date;
    if (time) dateEl.setAttribute('datetime', time.getAttribute('datetime'));

    var multiple = list.length > 1;
    prevBtn.disabled = !multiple;
    nextBtn.disabled = !multiple;
  }

  grid.addEventListener('click', function (event) {
    var card = event.target.closest('.card');
    if (!card || !supportsDialog) return;

    var index = visibleItems().indexOf(card.parentElement);
    show(index);
    dialog.showModal();          /* Esc で閉じる・フォーカストラップは <dialog> の標準機能 */
  });

  if (supportsDialog) {
    closeBtn.addEventListener('click', function () { dialog.close(); });
    prevBtn.addEventListener('click', function () { show(current - 1); });
    nextBtn.addEventListener('click', function () { show(current + 1); });

    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
    });

    /* 背景（::backdrop）をクリックしたら閉じる */
    dialog.addEventListener('click', function (event) {
      if (event.target !== dialog) return;
      var box = dialog.getBoundingClientRect();
      var outside = event.clientY < box.top || event.clientY > box.bottom ||
                    event.clientX < box.left || event.clientX > box.right;
      if (outside) dialog.close();
    });
  }
})();
