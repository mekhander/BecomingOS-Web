import { normalizeDailyReviewUserState, updateDailyReviewUserState } from './daily-review-user-state.js';

const DECISION_OPTIONS = [
  { value: 'pending', label: '보류' },
  { value: 'confirmed', label: '확인' },
  { value: 'corrected', label: '수정' },
  { value: 'rejected', label: '거절' },
];

export function renderDailyReviewUserForm(container, rawState, options = {}) {
  if (
    !container ||
    typeof container.replaceChildren !== 'function' ||
    !container.ownerDocument ||
    typeof container.ownerDocument.createElement !== 'function'
  ) {
    throw new TypeError('daily_review_user_form_container_required');
  }

  let currentState = normalizeDailyReviewUserState(rawState);

  if (
    !options ||
    typeof options !== 'object' ||
    typeof options.onSave !== 'function' ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new TypeError('daily_review_user_form_options_required');
  }

  const onSave = options.onSave;
  const now = options.now ?? (() => new Date().toISOString());
  const doc = container.ownerDocument;

  const form = doc.createElement('form');
  form.className = 'daily-review-user-form';
  form.dataset.reviewDate = currentState.reviewDate ?? '';

  const confirmations = Array.isArray(currentState.confirmations) ? currentState.confirmations : [];
  const confirmationFieldsets = [];

  for (let index = 0; index < confirmations.length; index += 1) {
    const item = confirmations[index];
    const recordId = String(item.recordId ?? item.id ?? '');
    const decisionId = `daily-review-decision-${index}`;
    const correctionId = `daily-review-correction-${index}`;

    const fieldset = doc.createElement('fieldset');
    fieldset.className = 'daily-review-user-confirmation';
    fieldset.dataset.recordId = recordId;

    const legend = doc.createElement('legend');
    legend.textContent = String(item.text ?? item.label ?? item.prompt ?? '');
    fieldset.appendChild(legend);

    const decisionLabel = doc.createElement('label');
    decisionLabel.htmlFor = decisionId;
    decisionLabel.textContent = '결정';

    const select = doc.createElement('select');
    select.id = decisionId;
    select.className = 'daily-review-decision';
    select.name = `decision-${recordId}`;

    for (const opt of DECISION_OPTIONS) {
      const optionEl = doc.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      select.appendChild(optionEl);
    }

    const initialDecision = DECISION_OPTIONS.some((opt) => opt.value === item.decision)
      ? item.decision
      : 'pending';
    select.value = initialDecision;

    const correctionLabel = doc.createElement('label');
    correctionLabel.htmlFor = correctionId;
    correctionLabel.textContent = '수정 내용';

    const correctionTextarea = doc.createElement('textarea');
    correctionTextarea.id = correctionId;
    correctionTextarea.className = 'daily-review-correction';
    correctionTextarea.name = `correction-${recordId}`;
    correctionTextarea.value = typeof item.correction === 'string' ? item.correction : '';

    const syncCorrectionState = (clearWhenNotCorrected) => {
      const isCorrected = select.value === 'corrected';
      correctionTextarea.hidden = !isCorrected;
      correctionTextarea.disabled = !isCorrected;
      correctionTextarea.required = isCorrected;
      correctionLabel.hidden = !isCorrected;
      if (!isCorrected && clearWhenNotCorrected) {
        correctionTextarea.value = '';
      }
    };

    syncCorrectionState(false);

    select.addEventListener('change', () => {
      syncCorrectionState(true);
    });

    fieldset.appendChild(decisionLabel);
    fieldset.appendChild(select);
    fieldset.appendChild(correctionLabel);
    fieldset.appendChild(correctionTextarea);

    form.appendChild(fieldset);
    confirmationFieldsets.push({ fieldset, select, correctionTextarea });
  }

  const reflectionLabel = doc.createElement('label');
  reflectionLabel.htmlFor = 'daily-review-reflection-input';
  reflectionLabel.textContent = '회고';

  const reflectionTextarea = doc.createElement('textarea');
  reflectionTextarea.id = 'daily-review-reflection-input';
  reflectionTextarea.name = 'reflection';
  reflectionTextarea.className = 'daily-review-reflection';
  reflectionTextarea.maxLength = 10000;
  reflectionTextarea.value = typeof currentState.reflection === 'string' ? currentState.reflection : '';

  form.appendChild(reflectionLabel);
  form.appendChild(reflectionTextarea);

  const priorityLabel = doc.createElement('label');
  priorityLabel.htmlFor = 'daily-review-priority-input';
  priorityLabel.textContent = '오늘의 우선순위';

  const priorityInput = doc.createElement('input');
  priorityInput.id = 'daily-review-priority-input';
  priorityInput.type = 'text';
  priorityInput.name = 'todayPriority';
  priorityInput.className = 'daily-review-priority';
  priorityInput.maxLength = 500;
  priorityInput.value = typeof currentState.todayPriority === 'string' ? currentState.todayPriority : '';

  form.appendChild(priorityLabel);
  form.appendChild(priorityInput);

  const statusParagraph = doc.createElement('p');
  statusParagraph.className = 'daily-review-user-status';
  statusParagraph.setAttribute('role', 'status');
  statusParagraph.setAttribute('aria-live', 'polite');

  const submitButton = doc.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'daily-review-save';
  submitButton.textContent = '저장';

  form.appendChild(statusParagraph);
  form.appendChild(submitButton);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const updatedConfirmations = confirmationFieldsets.map(({ fieldset, select, correctionTextarea }) => {
      const recordId = fieldset.dataset.recordId;
      const decision = select.value;
      const correction = decision === 'corrected' ? correctionTextarea.value : '';
      return { recordId, decision, correction };
    });

    const changes = {
      confirmations: updatedConfirmations,
      reflection: reflectionTextarea.value,
      todayPriority: priorityInput.value,
    };

    submitButton.disabled = true;
    statusParagraph.textContent = '저장 중…';

    try {
      const updatedState = updateDailyReviewUserState(currentState, changes, now());
      const savedResult = await onSave(updatedState);
      if (savedResult !== null && savedResult !== undefined) {
        currentState = normalizeDailyReviewUserState(savedResult);
      } else {
        currentState = normalizeDailyReviewUserState(updatedState);
      }
      statusParagraph.textContent = '저장했습니다.';
    } catch {
      statusParagraph.textContent = '저장하지 못했습니다.';
    } finally {
      submitButton.disabled = false;
    }
  });

  container.replaceChildren(form);
  return form;
}
