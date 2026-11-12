import { buildDailyReviewViewModel } from './daily-review-presenter.js';

export function renderDailyReview(container, rawReview) {
  if (!container || typeof container.replaceChildren !== 'function' || !container.ownerDocument || typeof container.ownerDocument.createElement !== 'function') {
    throw new TypeError('daily_review_container_required');
  }

  const vm = buildDailyReviewViewModel(rawReview);
  const doc = container.ownerDocument;

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  container.replaceChildren();

  const article = el('article', 'daily-review-card');
  article.dataset.reviewDate = vm.reviewDate;

  const header = el('header', 'daily-review-header');
  header.appendChild(el('h3', '', vm.reviewDate));
  header.appendChild(el('p', '', `수집 기록 ${vm.sourceCount}개`));
  article.appendChild(header);

  const summaryUl = el('ul', 'daily-review-summary');
  const summaryItems = [
    ['사실', vm.summary.factCount],
    ['확인 필요', vm.summary.confirmationCount],
    ['태그', vm.summary.tagCount],
    ['기록 유형', vm.summary.recordTypeCount]
  ];
  for (const [label, count] of summaryItems) {
    const li = el('li', '', `${label} ${count}`);
    summaryUl.appendChild(li);
  }
  article.appendChild(summaryUl);

  if (vm.empty) {
    article.appendChild(el('p', 'daily-review-empty', '아직 분석된 기록이 없습니다.'));
  }

  if (vm.facts && vm.facts.length > 0) {
    const section = el('section', 'daily-review-facts');
    section.appendChild(el('h4', '', '확인된 사실'));
    const ul = el('ul');
    for (const item of vm.facts) {
      const li = el('li');
      li.dataset.status = item.status;
      li.appendChild(el('span', '', item.summary));
      li.appendChild(el('span', '', `신뢰도 ${item.confidencePercent}%`));
      ul.appendChild(li);
    }
    section.appendChild(ul);
    article.appendChild(section);
  }

  if (vm.confirmations && vm.confirmations.length > 0) {
    const section = el('section', 'daily-review-confirmations');
    section.appendChild(el('h4', '', '확인이 필요한 항목'));
    const ul = el('ul');
    for (const item of vm.confirmations) {
      const li = el('li');
      li.dataset.status = item.status;
      li.appendChild(el('span', '', item.text));
      li.appendChild(el('span', '', item.status));
      ul.appendChild(li);
    }
    section.appendChild(ul);
    article.appendChild(section);
  }

  if ((vm.tags && vm.tags.length > 0) || (vm.recordTypes && vm.recordTypes.length > 0)) {
    const section = el('section', 'daily-review-groups');
    if (vm.tags && vm.tags.length > 0) {
      section.appendChild(el('h4', '', '태그'));
      const ul = el('ul');
      for (const t of vm.tags) {
        ul.appendChild(el('li', '', `${t.label} ${t.count}`));
      }
      section.appendChild(ul);
    }
    if (vm.recordTypes && vm.recordTypes.length > 0) {
      section.appendChild(el('h4', '', '기록 유형'));
      const ul = el('ul');
      for (const r of vm.recordTypes) {
        ul.appendChild(el('li', '', `${r.label} ${r.count}`));
      }
      section.appendChild(ul);
    }
    article.appendChild(section);
  }

  container.appendChild(article);
  return vm;
}
