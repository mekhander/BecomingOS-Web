import { cleanupSyncedEntries, getSetting, listEntries, listPlans, saveEntry, savePlan, saveSetting } from './db.js?v=4';
import { syncDailyReview, syncPending } from './drive.js?v=4';
import { getDailyReview } from './daily-review-store.js';
import { renderDailyReview } from './daily-review-renderer.js';
import { createDailyReviewUserState } from './daily-review-user-state.js';
import { getDailyReviewUserState, saveDailyReviewUserState } from './daily-review-user-store.js';
import { renderDailyReviewUserForm } from './daily-review-user-form.js';

const $ = selector => document.querySelector(selector);
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const typeInfo = { note:['메모','📝'], photo:['사진','📷'], file:['파일','📎'], audio:['녹음','🎙️'], review:['회고','✦'] };
let mediaRecorder;
let audioChunks = [];
const activeObjectUrls = new Set();
let backgroundSyncPromise = null;
let backgroundSyncRequested = false;

function runBackgroundSync() {
  if (!navigator.onLine) return Promise.resolve();
  if (backgroundSyncPromise) {
    backgroundSyncRequested = true;
    return backgroundSyncPromise;
  }
  return backgroundSyncPromise = (async () => {
    do {
      backgroundSyncRequested = false;
      const result = await syncPending({ interactive: false });
      if (result?.skipped === 'not-connected') return;
      try {
        await syncTodayDailyReview({ interactive: false });
      } catch (error) {
        console.warn('오늘의 데일리 리뷰 동기화 중 오류가 발생했습니다.');
      }
      if (await getSetting('cleanupEnabled', true)) await cleanupSyncedEntries(30);
      await renderTimeline();
    } while (backgroundSyncRequested && navigator.onLine);
  })().catch(error => console.warn('Background sync failed:', error)).finally(() => {
    backgroundSyncPromise = null;
    backgroundSyncRequested = false;
  });
}

function id() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`; }
function now() { return new Date().toISOString(); }

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function syncTodayDailyReview(options = {}) {
  const res = await syncDailyReview(localDateKey(), options);
  if (res && res.status === 'imported') {
    await renderTodayDailyReview();
  }
  return res;
}

async function renderTodayDailyReview() {
  const content = document.getElementById('dailyReviewContent');
  const status = document.getElementById('dailyReviewStatus');
  if (!content || !status) return;
  try {
    const review = await getDailyReview(localDateKey());
    if (!review) {
      content.replaceChildren();
      status.textContent = '오늘 분석 결과가 아직 없습니다.';
      return;
    }
    renderDailyReview(content, review);
    const existingUserState = await getDailyReviewUserState(review.reviewDate);
    const userState = existingUserState ?? createDailyReviewUserState(review, new Date().toISOString());
    const userSection = content.ownerDocument.createElement('section');
    userSection.className = 'daily-review-user-section';
    content.appendChild(userSection);
    renderDailyReviewUserForm(userSection, userState, {
      onSave: state => saveDailyReviewUserState(state),
    });
    status.textContent = `${review.sourceCount}개의 기록을 분석했습니다.`;
  } catch {
    content.replaceChildren();
    status.textContent = '분석 결과를 표시할 수 없습니다.';
  }
}

function message(text, error = false) { const el=$('#captureMessage'); el.textContent=text; el.style.color=error?'#a43f38':''; }
function entryBase(type, fields = {}) { const createdAt=now(); return { id:id(), type, title:typeInfo[type][0], text:'', tags:[], createdAt, capturedAt:createdAt, syncState:'pending', processingState:'unprocessed', ...fields }; }

async function sha256Hex(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function addFiles(files, type) {
  let saved = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) { message(`${file.name}: 100MB를 넘어서 저장하지 않았습니다.`, true); continue; }
    const checksum = await sha256Hex(file);
    await saveEntry(entryBase(type, { title:file.name, fileName:file.name, mimeType:file.type || 'application/octet-stream', size:file.size, blob:file, checksumAlgorithm:'SHA-256', checksum }));
    saved += 1;
  }
  if (saved) { message(`${saved}개를 이 기기에 저장했습니다.`); await renderTimeline(); void runBackgroundSync(); }
  else { await renderTimeline(); }
}

async function renderTimeline() {
  for (const url of activeObjectUrls) URL.revokeObjectURL(url);
  activeObjectUrls.clear();
  const query=$('#searchInput').value.trim().toLowerCase(); const type=$('#typeFilter').value;
  const entries=(await listEntries()).filter(e => (!type || e.type===type) && (!query || `${e.title} ${e.text} ${(e.tags||[]).join(' ')}`.toLowerCase().includes(query)));
  $('#entryCount').textContent=entries.length; $('#timeline').replaceChildren(); $('#emptyTimeline').hidden=entries.length>0;
  for (const entry of entries) {
    const card=$('#entryTemplate').content.firstElementChild.cloneNode(true); const [label,icon]=typeInfo[entry.type]||['기록','•'];
    card.querySelector('.entry-icon').textContent=icon; card.querySelector('.entry-meta').textContent=`${label} · ${new Date(entry.createdAt).toLocaleString('ko-KR')}`;
    card.querySelector('h3').textContent=entry.title; card.querySelector('p').textContent=entry.localContentRemoved?'Drive에 보관되어 기기 원본이 정리되었습니다.':(entry.text || entry.fileName || '첨부 기록');
    card.querySelector('.entry-tags').textContent=(entry.tags||[]).map(t=>`#${t}`).join(' '); card.querySelector('.sync-badge').textContent=entry.syncState==='synced'?'Drive ✓':entry.syncState==='error'?'재시도 필요':'대기';
    if (entry.blob && !entry.localContentRemoved) {
      const url = URL.createObjectURL(entry.blob);
      activeObjectUrls.add(url);
      const link = document.createElement('a');
      link.className = 'entry-attachment';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = entry.type === 'photo' ? '사진 보기' : entry.type === 'audio' ? '녹음 재생' : '파일 열기';
      if (entry.type === 'file') link.download = entry.fileName || entry.title;
      card.querySelector('.entry-body').append(link);
    }
    $('#timeline').append(card);
  }
}

async function renderPlans() {
  const plans=await listPlans(); $('#planList').replaceChildren();
  for (const plan of plans) { const row=document.createElement('label'); row.className=`plan-item${plan.done?' done':''}`; row.innerHTML=`<input type="checkbox" ${plan.done?'checked':''}><div><span class="plan-title"></span><small></small></div><span>›</span>`; row.querySelector('.plan-title').textContent=plan.text; row.querySelector('small').textContent=plan.dueDate?`예정 ${plan.dueDate}`:'날짜 없음'; row.querySelector('input').addEventListener('change',async e=>{plan.done=e.target.checked;await savePlan(plan);renderPlans();}); $('#planList').append(row); }
}

function updateNetwork() { const online=navigator.onLine; $('#networkDot').classList.toggle('online',online); $('#networkText').textContent=online?'인터넷 연결됨':'오프라인'; $('#syncText').textContent=online?'Drive 동기화를 사용할 수 있습니다':'기기에 안전하게 저장합니다'; }

$('#noteForm').addEventListener('submit',async event=>{event.preventDefault();const text=$('#noteText').value.trim();if(!text)return;await saveEntry(entryBase('note',{title:text.slice(0,42),text,tags:$('#noteTags').value.split(',').map(t=>t.trim()).filter(Boolean)}));event.target.reset();message('메모를 이 기기에 저장했습니다.');await renderTimeline();void runBackgroundSync();});
$('#photoInput').addEventListener('change',e=>addFiles(e.target.files,'photo'));
$('#fileInput').addEventListener('change',e=>addFiles(e.target.files,'file'));
$('#recordButton').addEventListener('click',async()=>{if(mediaRecorder?.state==='recording'){mediaRecorder.stop();return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);mediaRecorder.onstop=async()=>{const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType});stream.getTracks().forEach(t=>t.stop());const checksum=await sha256Hex(blob);await saveEntry(entryBase('audio',{title:`녹음 ${new Date().toLocaleString('ko-KR')}`,fileName:`recording-${Date.now()}.webm`,mimeType:blob.type,size:blob.size,blob,checksumAlgorithm:'SHA-256',checksum}));$('#recordHint').textContent='눌러서 시작';message('녹음을 이 기기에 저장했습니다.');await renderTimeline();void runBackgroundSync();};mediaRecorder.start();$('#recordHint').textContent='녹음 중 · 눌러서 정지';message('녹음 중입니다…');}catch(error){message(location.protocol==='https:'||location.hostname==='localhost'?'마이크 권한을 허용해 주세요.':'녹음은 HTTPS 주소에서 사용할 수 있습니다.',true);}});
$('#quickReviewButton').addEventListener('click',()=>$('#reviewDialog').showModal());
$('#reviewForm').addEventListener('submit',async event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();const text=$('#reviewText').value.trim();if(!text)return;await saveEntry(entryBase('review',{title:`${new Date().toLocaleDateString('ko-KR')} 회고`,text}));event.target.reset();$('#reviewDialog').close();message('오늘의 회고를 저장했습니다.');await renderTimeline();void runBackgroundSync();});
$('#planForm').addEventListener('submit',async event=>{event.preventDefault();await savePlan({id:id(),text:$('#planText').value.trim(),dueDate:$('#planDate').value,done:false,createdAt:now()});event.target.reset();await renderPlans();});
$('#searchInput').addEventListener('input',renderTimeline); $('#typeFilter').addEventListener('change',renderTimeline);

document.querySelectorAll('.bottom-nav button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.view,.bottom-nav button').forEach(el=>el.classList.remove('active'));$(`#${button.dataset.view}`).classList.add('active');button.classList.add('active');if(button.dataset.view==='timelineView'){renderTimeline();void renderTodayDailyReview();}if(button.dataset.view==='planView')renderPlans();}));
$('#settingsButton').addEventListener('click',async()=>{$('#cleanupEnabled').checked=await getSetting('cleanupEnabled',true);$('#settingsDialog').showModal();});
$('#settingsForm').addEventListener('submit',async event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();await saveSetting('cleanupEnabled',$('#cleanupEnabled').checked);$('#settingsDialog').close();message('설정을 저장했습니다.');});
$('#syncNowButton').addEventListener('click',async()=>{if(!navigator.onLine){message('인터넷에 연결되면 다시 시도하세요.',true);return;}message('Drive 동기화 중…');try{const result=await syncPending();let reviewRes=null;let reviewFailed=false;try{reviewRes=await syncTodayDailyReview({interactive:false});}catch(e){reviewFailed=true;}if(await getSetting('cleanupEnabled',true))await cleanupSyncedEntries(30);await renderTimeline();if(reviewFailed){message('업로드가 완료되었으나 분석을 불러오지 못했습니다.');}else if(reviewRes&&reviewRes.status==='imported'){message(`${result.uploaded}개 업로드 · 오늘 분석 업데이트`);}else if(reviewRes&&reviewRes.status==='not_found'){message(`${result.uploaded}개 업로드 · 오늘 분석 아직 준비되지 않음`);}else{message(`${result.uploaded}개 업로드`);}}catch(error){message(error.message,true);}});

window.addEventListener('online',()=>{updateNetwork();void runBackgroundSync();});window.addEventListener('offline',updateNetwork);updateNetwork();renderTimeline();renderPlans();void renderTodayDailyReview();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js');
if(await getSetting('cleanupEnabled',true))await cleanupSyncedEntries(30);
