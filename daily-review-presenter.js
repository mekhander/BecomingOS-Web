import { normalizeDailyReview } from './daily-review.js';

export function buildDailyReviewViewModel(rawReview) {
  const normalized = normalizeDailyReview(rawReview);

  const reviewDate = normalized.reviewDate;
  const timezone = normalized.timezone;
  const sourceCount = normalized.sourceCount;

  const facts = (normalized.facts || []).map(item => ({
    recordId: item.recordId,
    summary: item.summary,
    status: item.userStatus,
    confidencePercent: Math.round((item.confidence || 0) * 100)
  }));

  const confirmations = (normalized.confirmations || []).map(item => ({
    recordId: item.recordId,
    text: item.text,
    status: item.userStatus
  }));

  const tags = (normalized.tags || []).map(item => ({
    label: '#' + item.tag,
    count: item.count
  }));

  const recordTypes = (normalized.recordTypes || []).map(item => ({
    label: item.recordType,
    count: item.count
  }));

  const summary = {
    factCount: facts.length,
    confirmationCount: confirmations.length,
    tagCount: tags.length,
    recordTypeCount: recordTypes.length
  };

  const empty =
    facts.length === 0 &&
    confirmations.length === 0 &&
    tags.length === 0 &&
    recordTypes.length === 0;

  return {
    reviewDate,
    timezone,
    sourceCount,
    summary,
    facts,
    confirmations,
    tags,
    recordTypes,
    empty
  };
}
