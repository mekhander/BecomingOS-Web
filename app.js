import { cleanupSyncedEntries, getSetting, listEntries, listPlans, saveEntry, savePlan, saveSetting } from './db.js';
import { syncPending } from './drive.js';

const $ = selector => document.querySelector(selector);
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const typeInfo = { note:['메모','📝'], photo:['사진','📷'], file:['파일','📎'], audio:['녹음','🎙️'], review:['회고','✦'] };
let mediaRecorder;
let audioChunks = [];

function id() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`; }
function now() { return new Date().toISOString(); }
function message(text, error = false) { const el=$('#captureMessage'); el.textContent=text; el.style.color=error?'#a43f38':''; }
function entryBase(type, fields = {}) { const createdAt=now(); return { id:id(), type, title:typeInfo[type][0], text:'', tags:[], createdAt, capturedAt:createdAt, syncState:'pending', ...fields }; }

async function addFiles(files, type) {
  let saved = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) { message(`${file.name}: 100MB를 넘어서 저장하지 않았습니다.`, true); continue; }
    await saveEntry(entryBase(type, { title:file.name, fileName:file.name, mimeType:file.type || 'application/octet-stream', size:file.size, blob:file }));
    saved += 1;
  }
  if (saved) message(`${saved}개를 이 기기에 저장했습니다.`);
  await renderTimeline();
}

async function renderTimeline() {
  const query=$('#searchInput').value.trim().toLowerCase(); const type=$('#typeFilter').value;
  const entries=(await listEntries()).filter(e => (!type || e.type===type) && (!query || `${e.title} ${e.text} ${(e.tags||[]).join(' ')}`.toLowerCase().includes(query)));
  $('#entryCount').textContent=entries.length; $('#timeline').replaceChildren(); $('#emptyTimeline').hidden=entries.length>0;
  for (const entry of entries) {
    const card=$('#entryTemplate').content.firstElementChild.cloneNode(true); const [label,icon]=typeInfo[entry.type]||['기록','•'];
    card.querySelector('.entry-icon').textContent=icon; card.querySelector('.entry-meta').textContent=`${label} · ${new Date(entry.createdAt).toLocaleString('ko-KR')}`;
    card.querySelector('h3').textContent=entry.title; card.querySelector('p').textContent=entry.localContentRemoved?'Drive에 보관되어 기기 원본이 정리되었습니다.':(entry.text || entry.fileName || '첨부 기록');
    card.querySelector('.entry-tags').textContent=(entry.tags||[]).map(t=>`#${t}`).join(' '); card.querySelector('.sync-badge').textContent=entry.syncState==='synced'?'Drive ✓':entry.syncState==='error'?'재시도 필요':'대기';
    $('#timeline').append(card);
  }
}

async function renderPlans() {
  const plans=await listPlans(); $('#planList').replaceChildren();
  for (const plan of plans) { const row=document.createElement('label'); row.className=`plan-item${plan.done?' done':''}`; row.innerHTML=`<input type="checkbox" ${plan.done?'checked':''}><div><span class="plan-title"></span><small></small></div><span>›</span>`; row.querySelector('.plan-title').textContent=plan.text; row.querySelector('small').textContent=plan.dueDate?`예정 ${plan.dueDate}`:'날짜 없음'; row.querySelector('input').addEventListener('change',async e=>{plan.done=e.target.checked;await savePlan(plan);renderPlans();}); $('#planList').append(row); }
}

function updateNetwork() { const online=navigator.onLine; $('#networkDot').classList.toggle('online',online); $('#networkText').textContent=online?'인터넷 연결됨':'오프라인'; $('#syncText').textContent=online?'Drive 동기화를 사용할 수 있습니다':'기기에 안전하게 저장합니다'; }

$('#noteForm').addEventListener('submit',async event=>{event.preventDefault();const text=$('#noteText').value.trim();if(!text)return;await saveEntry(entryBase('note',{title:text.slice(0,42),text,tags:$('#noteTags').value.split(',').map(t=>t.trim()).filter(Boolean)}));event.target.reset();message('메모를 이 기기에 저장했습니다.');await renderTimeline();});
$('#photoInput').addEventListener('change',e=>addFiles(e.target.files,'photo'));
$('#fileInput').addEventListener('change',e=>addFiles(e.target.files,'file'));
$('#recordButton').addEventListener('click',async()=>{if(mediaRecorder?.state==='recording'){mediaRecorder.stop();return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});audioChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);mediaRecorder.onstop=async()=>{const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType});stream.getTracks().forEach(t=>t.stop());await saveEntry(entryBase('audio',{title:`녹음 ${new Date().toLocaleString('ko-KR')}`,fileName:`recording-${Date.now()}.webm`,mimeType:blob.type,size:blob.size,blob}));$('#recordHint').textContent='눌러서 시작';message('녹음을 이 기기에 저장했습니다.');await renderTimeline();};mediaRecorder.start();$('#recordHint').textContent='녹음 중 · 눌러서 정지';message('녹음 중입니다…');}catch(error){message(location.protocol==='https:'||location.hostname==='localhost'?'마이크 권한을 허용해 주세요.':'녹음은 HTTPS 주소에서 사용할 수 있습니다.',true);}});
$('#quickReviewButton').addEventListener('click',()=>$('#reviewDialog').showModal());
$('#reviewForm').addEventListener('submit',async event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();const text=$('#reviewText').value.trim();if(!text)return;await saveEntry(entryBase('review',{title:`${new Date().toLocaleDateString('ko-KR')} 회고`,text}));event.target.reset();$('#reviewDialog').close();message('오늘의 회고를 저장했습니다.');await renderTimeline();});
$('#planForm').addEventListener('submit',async event=>{event.preventDefault();await savePlan({id:id(),text:$('#planText').value.trim(),dueDate:$('#planDate').value,done:false,createdAt:now()});event.target.reset();await renderPlans();});
$('#searchInput').addEventListener('input',renderTimeline); $('#typeFilter').addEventListener('change',renderTimeline);

document.querySelectorAll('.bottom-nav button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.view,.bottom-nav button').forEach(el=>el.classList.remove('active'));$(`#${button.dataset.view}`).classList.add('active');button.classList.add('active');if(button.dataset.view==='timelineView')renderTimeline();if(button.dataset.view==='planView')renderPlans();}));
$('#settingsButton').addEventListener('click',async()=>{$('#clientIdInput').value=await getSetting('googleClientId');$('#cleanupEnabled').checked=await getSetting('cleanupEnabled',true);$('#settingsDialog').showModal();});
$('#settingsForm').addEventListener('submit',async event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();await saveSetting('googleClientId',$('#clientIdInput').value.trim());await saveSetting('cleanupEnabled',$('#cleanupEnabled').checked);$('#settingsDialog').close();message('설정을 저장했습니다.');});
$('#syncNowButton').addEventListener('click',async()=>{if(!navigator.onLine){message('인터넷에 연결되면 다시 시도하세요.',true);return;}message('Drive 동기화 중…');try{const result=await syncPending();message(`${result.uploaded}개 업로드 · ${result.cloudDeleted}개 1년 보관 만료`);if(await getSetting('cleanupEnabled',true))await cleanupSyncedEntries(30);await renderTimeline();}catch(error){message(error.message,true);}});

window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);updateNetwork();renderTimeline();renderPlans();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js');
if(await getSetting('cleanupEnabled',true))await cleanupSyncedEntries(30);
