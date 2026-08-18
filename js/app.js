const video=document.getElementById('video'), overlay=document.getElementById('overlay'), ctx=overlay.getContext('2d');
const startBtn=document.getElementById('startBtn'), calibrateBtn=document.getElementById('calibrateBtn'), recordBtn=document.getElementById('recordBtn'), stopBtn=document.getElementById('stopBtn'), resetBtn=document.getElementById('resetBtn');
const statusEl=document.getElementById('status'), speedEl=document.getElementById('speed'), distanceEl=document.getElementById('distance'), elapsedEl=document.getElementById('elapsed'), msg=document.getElementById('message'), loading=document.getElementById('loading'), badge=document.getElementById('secureBadge');
const heightInput=document.getElementById('heightInput'), separationInput=document.getElementById('separationInput'), motionInput=document.getElementById('motionInput');
const maxSpeedEl=document.getElementById('maxSpeed'), fallTimeEl=document.getElementById('fallTime'), fallDistanceEl=document.getElementById('fallDistance'), detectStateEl=document.getElementById('detectState'), body=document.getElementById('dataBody'), downloadBtn=document.getElementById('downloadBtn'), saveCurrentBtn=document.getElementById('saveCurrentBtn');
const historyBody=document.getElementById('historyBody'), historySummary=document.getElementById('historySummary'), exportAllBtn=document.getElementById('exportAllBtn'), clearHistoryBtn=document.getElementById('clearHistoryBtn');
let stream=null, model=null, running=false, detecting=false, raf=0, floorY=null, releaseY=null, releaseT=null, maxSpeed=0, lastObj=null, rows=[], chart=null, frameCount=0, currentResult=null;
const HISTORY_KEY='gravityARLabHistoryV2';
let history=loadHistory();

function setMsg(t,type='info'){msg.textContent=t;msg.style.background=type==='error'?'#ffe8e8':type==='ok'?'#e8fff1':'#eef5ff';msg.style.color=type==='error'?'#9b1c1c':type==='ok'?'#17653a':'#245'}
function resize(){const r=video.getBoundingClientRect(); overlay.width=video.videoWidth||640; overlay.height=video.videoHeight||480; overlay.style.width=r.width+'px';overlay.style.height=r.height+'px'}
window.addEventListener('resize',resize);
function loadHistory(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch(e){return []}}
function persistHistory(){localStorage.setItem(HISTORY_KEY,JSON.stringify(history))}
function nextTrialNumber(){return history.length+1}
function formatDate(iso){return new Date(iso).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'medium'})}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function renderHistory(){
  if(!history.length){historyBody.innerHTML='<tr><td colspan="6" class="empty-history">ยังไม่มีประวัติการทดลอง — เมื่อวัตถุถึงพื้น ระบบจะบันทึกให้อัตโนมัติ</td></tr>';historySummary.innerHTML='';return}
  const counts={};history.forEach(x=>counts[x.object]=(counts[x.object]||0)+1);
  historySummary.innerHTML=`<div class="history-chip"><b>${history.length}</b><span>การทดลองทั้งหมด</span></div>`+Object.entries(counts).map(([k,v])=>`<div class="history-chip"><b>${v}</b><span>${escapeHtml(k)}</span></div>`).join('');
  historyBody.innerHTML=history.map((r,i)=>`<tr><td>${i+1}</td><td>${formatDate(r.timestamp)}</td><td><span class="object-tag">${escapeHtml(r.object)}</span></td><td>${Number(r.time).toFixed(3)}</td><td>${Number(r.distance).toFixed(3)}</td><td class="success-tag">${Number(r.maxSpeed).toFixed(3)}</td></tr>`).join('');
}
function saveTrial(result){history.push(result);persistHistory();renderHistory();currentResult=result;saveCurrentBtn.disabled=false;setMsg(`บันทึกการทดลองครั้งที่ ${history.length} แล้ว (${result.object})`,'ok')}
async function startCamera(){
  if(!window.isSecureContext && location.hostname!=='localhost'){setMsg('ต้องเปิดผ่าน HTTPS เช่น GitHub Pages จึงจะใช้กล้องได้','error');return}
  try{loading.style.display='flex';loading.textContent='กำลังขอสิทธิ์กล้อง…';stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play();resize();loading.style.display='none';startBtn.disabled=true;recordBtn.disabled=false;stopBtn.disabled=false;badge.textContent='กล้องพร้อม';badge.style.background='#0a9b5a';statusEl.textContent='กล้องพร้อม';setMsg('วางมือและวัตถุให้อยู่ในภาพ จากนั้นกด “เริ่มตรวจจับ”','ok');if(!model){setMsg('กำลังโหลด AI ตรวจจับวัตถุ…');model=await cocoSsd.load({base:'mobilenet_v2'});setMsg('โหลด AI สำเร็จ กด “เริ่มตรวจจับ” ได้เลย','ok')}}catch(e){loading.style.display='flex';loading.textContent='เปิดกล้องไม่สำเร็จ';badge.textContent='เปิดกล้องไม่ได้';setMsg('เปิดกล้องไม่สำเร็จ: '+cameraError(e),'error');console.error(e)}}
function cameraError(e){if(e.name==='NotAllowedError')return'กรุณาอนุญาต Camera ในเบราว์เซอร์';if(e.name==='NotFoundError')return'ไม่พบกล้อง';if(e.name==='NotReadableError')return'กล้องกำลังถูกใช้งานโดยแอปอื่น';if(e.name==='SecurityError')return'เบราว์เซอร์บล็อกการเข้าถึงกล้อง';return e.message||'ไม่ทราบสาเหตุ'}
function stopCamera(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;cancelAnimationFrame(raf);running=false;detecting=false;recordBtn.disabled=true;stopBtn.disabled=true;startBtn.disabled=false;badge.textContent='หยุดกล้อง';badge.style.background='#ffffff22'}
function calibrateFloor(){if(!video.videoWidth){setMsg('เปิดกล้องก่อนตั้งพื้น','error');return}floorY=overlay.height*0.88;setMsg('ตั้งพื้นแล้ว — ระบบจะถือเส้นล่างของภาพเป็นระดับพื้น','ok');drawGuides(null)}
function reset(){rows=[];body.innerHTML='<tr><td colspan=5 class=empty-history>ยังไม่มีผลการทดลองรอบนี้</td></tr>';releaseT=null;releaseY=null;lastObj=null;maxSpeed=0;currentResult=null;saveCurrentBtn.disabled=true;maxSpeedEl.textContent='0.00';fallTimeEl.textContent='0.000';fallDistanceEl.textContent='0.00';speedEl.textContent='0.00 m/s';distanceEl.textContent='0.00 m';elapsedEl.textContent='0.000 s';detectStateEl.textContent='รอ';statusEl.textContent='พร้อม';if(chart){chart.destroy();chart=null}drawGuides(null)}
function startDetect(){if(!model){setMsg('กำลังโหลด AI กรุณารอสักครู่','error');return}if(floorY===null)calibrateFloor();detecting=true;running=true;frameCount=0;releaseT=null;releaseY=null;lastObj=null;rows=[];body.innerHTML='';maxSpeed=0;currentResult=null;saveCurrentBtn.disabled=true;statusEl.textContent='กำลังค้นหามือ/วัตถุ';detectStateEl.textContent='ค้นหา';recordBtn.disabled=true;setMsg('ยกวัตถุไว้เหนือพื้น แล้วปล่อยลงมา ระบบจะพยายามตรวจจับจังหวะปล่อยอัตโนมัติ','ok');loop()}
function stopDetect(){
  detecting=false; running=false; cancelAnimationFrame(raf);
  recordBtn.disabled=false; stopBtn.disabled=false;
  if(releaseT!==null && rows.length){
    const last=rows[rows.length-1];
    const label=lastObj?.label || currentResult?.object || 'ไม่ทราบชนิด';
    const result={
      id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(),
      timestamp:new Date().toISOString(),
      trial:nextTrialNumber(),
      object:label,
      time:last.t,
      distance:last.d,
      maxSpeed:maxSpeed,
      points:rows.map(r=>({...r})),
      height:Number(heightInput.value),
      stoppedManually:true
    };
    currentResult=result;
    releaseT=null;
    releaseY=null;
    lastObj=null;
    statusEl.textContent='สรุปผลแล้ว';
    detectStateEl.textContent='เสร็จสิ้น';
    fallTimeEl.textContent=result.time.toFixed(3);
    fallDistanceEl.textContent=result.distance.toFixed(2);
    maxSpeedEl.textContent=result.maxSpeed.toFixed(2);
    updateTable();
    saveTrial(result);
    setMsg(`หยุดการทดลองและสรุปผลครั้งที่ ${result.trial} แล้ว`,'ok');
  } else {
    statusEl.textContent='หยุด';
    detectStateEl.textContent='ยังไม่มีผล';
    setMsg('หยุดแล้ว แต่ยังไม่พบจังหวะปล่อยวัตถุ จึงยังไม่มีข้อมูลสำหรับสรุป','error');
  }
}
async function loop(){if(!running)return;if(video.readyState<2){raf=requestAnimationFrame(loop);return}frameCount++;if(frameCount%2===0){try{const preds=await model.detect(video);process(preds)}catch(e){console.error(e)}}raf=requestAnimationFrame(loop)}
function center(p){return{x:p.bbox[0]+p.bbox[2]/2,y:p.bbox[1]+p.bbox[3]/2,w:p.bbox[2],h:p.bbox[3]}}
function chooseObject(preds){const candidates=preds.filter(p=>p.score>.45&&!['person','dining table','chair','couch','bed','floor'].includes(p.class));if(!candidates.length)return null;if(lastObj){let best=null,bd=1e9;for(const p of candidates){const c=center(p),d=Math.hypot(c.x-lastObj.x,c.y-lastObj.y);if(d<bd){bd=d;best={...c,label:p.class,score:p.score}}}if(best&&bd<Math.max(130,lastObj.w*3))return best}return candidates.map(p=>({...center(p),label:p.class,score:p.score})).sort((a,b)=>a.y-b.y)[0]||null}
function process(preds){
  const obj=chooseObject(preds);
  drawGuides(obj);
  if(!obj)return;
  const now=performance.now();
  if(lastObj && releaseT===null){
    const dy=obj.y-lastObj.y;
    const sep=Math.abs(obj.y-lastObj.y);
    if(dy>Number(motionInput.value) && sep>Number(separationInput.value) && obj.y>lastObj.y){
      releaseT=now; releaseY=obj.y; maxSpeed=0; rows=[]; body.innerHTML='';
      detectStateEl.textContent='ปล่อยแล้ว'; statusEl.textContent='กำลังตก';
      setMsg(`ตรวจพบการปล่อยวัตถุ: ${obj.label} — กำลังติดตาม…`,'ok');
    }
  }
  if(releaseT!==null){
    const t=(now-releaseT)/1000;
    const totalPx=Math.max(1,(floorY||overlay.height*.88)-releaseY);
    const metersPerPx=Number(heightInput.value)/totalPx;
    const d=Math.max(0,(obj.y-releaseY)*metersPerPx);
    let v=0;
    if(lastObj)v=Math.abs((obj.y-lastObj.y)*metersPerPx)/Math.max(.001,(now-lastObj.t)/1000);
    maxSpeed=Math.max(maxSpeed,v);
    speedEl.textContent=v.toFixed(2)+' m/s'; distanceEl.textContent=d.toFixed(2)+' m'; elapsedEl.textContent=t.toFixed(3)+' s';
    rows.push({t,d,v}); if(rows.length>200)rows.shift(); updateChart();
    if(obj.y+obj.h/2>=(floorY||overlay.height*.88))finish(t,d,v,obj.label);
  }
  lastObj={...obj,t:now};
}
function finish(t,d,v,label){const result={id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(),timestamp:new Date().toISOString(),trial:nextTrialNumber(),object:label||'ไม่ทราบชนิด',time:t,distance:d,maxSpeed,points:rows.map(r=>({...r})),height:Number(heightInput.value)};releaseT=null;statusEl.textContent='กระทบพื้น';detectStateEl.textContent='เสร็จสิ้น';fallTimeEl.textContent=t.toFixed(3);fallDistanceEl.textContent=d.toFixed(2);maxSpeedEl.textContent=maxSpeed.toFixed(2);currentResult=result;updateTable();saveTrial(result);lastObj=null;running=false;detecting=false;recordBtn.disabled=false;cancelAnimationFrame(raf)}
function drawGuides(obj){ctx.clearRect(0,0,overlay.width,overlay.height);if(floorY!==null){ctx.strokeStyle='#00d084';ctx.lineWidth=4;ctx.setLineDash([12,8]);ctx.beginPath();ctx.moveTo(0,floorY);ctx.lineTo(overlay.width,floorY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#00d084';ctx.font='bold 20px sans-serif';ctx.fillText('พื้น',20,Math.max(25,floorY-12))}if(obj){ctx.strokeStyle='#ff3b30';ctx.lineWidth=3;ctx.strokeRect(obj.x-obj.w/2,obj.y-obj.h/2,obj.w,obj.h);ctx.fillStyle='#ff3b30';ctx.font='bold 18px sans-serif';ctx.fillText(`${obj.label} ${(obj.score*100).toFixed(0)}%`,obj.x-obj.w/2,Math.max(20,obj.y-obj.h/2-7))}}
function updateTable(){if(!currentResult){body.innerHTML='<tr><td colspan=5 class=empty-history>กำลังเก็บข้อมูลการตก…</td></tr>';return}body.innerHTML=`<tr><td>ครั้งที่ ${currentResult.trial}</td><td><span class=object-tag>${escapeHtml(currentResult.object)}</span></td><td>${Number(currentResult.time).toFixed(3)}</td><td>${Number(currentResult.distance).toFixed(3)}</td><td class=success-tag>${Number(currentResult.maxSpeed).toFixed(3)}</td></tr>`}
function updateChart(){const data=rows.map(r=>({x:r.t,y:r.v}));if(!chart){chart=new Chart(document.getElementById('chart'),{type:'line',data:{datasets:[{label:'ความเร็ว (m/s)',data,borderWidth:2,pointRadius:1,tension:.2}]},options:{responsive:true,maintainAspectRatio:false,parsing:false,scales:{x:{type:'linear',title:{display:true,text:'เวลา (s)'}},y:{title:{display:true,text:'ความเร็ว (m/s)'},beginAtZero:true}}}})}else{chart.data.datasets[0].data=data;chart.update('none')}}
function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`}
function exportCurrent(){if(!currentResult&&!rows.length){setMsg('ยังไม่มีข้อมูลการทดลอง','error');return}const r=currentResult||{trial:'',timestamp:new Date().toISOString(),object:'ครั้งปัจจุบัน',time:rows.at(-1)?.t||0,distance:rows.at(-1)?.d||0,maxSpeed};const csv=['trial,datetime,object,time_s,distance_m,max_speed_mps'];csv.push([r.trial||'',r.timestamp||'',r.object,r.time,r.distance,r.maxSpeed].map(csvCell).join(','));downloadText(csv.join('\n'),'gravity-ar-current-summary.csv')}
function exportAll(){if(!history.length){setMsg('ยังไม่มีประวัติการทดลอง','error');return}const lines=['trial,datetime,object,time_s,distance_m,max_speed_mps'];history.forEach(r=>lines.push([r.trial,r.timestamp,r.object,r.time,r.distance,r.maxSpeed].map(csvCell).join(',')));downloadText(lines.join('\n'),'gravity-ar-all-experiments-summary.csv');setMsg(`ส่งออกสรุปทั้งหมด ${history.length} การทดลองแล้ว`,'ok')}
function downloadText(text,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function saveCurrent(){if(currentResult)saveTrial({...currentResult,id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(),trial:nextTrialNumber(),timestamp:new Date().toISOString()})}
function clearHistory(){if(!history.length)return;if(!confirm('ต้องการล้างประวัติการทดลองทั้งหมดหรือไม่? ข้อมูลจะถูกลบจากเครื่องนี้'))return;history=[];persistHistory();renderHistory();setMsg('ล้างประวัติการทดลองทั้งหมดแล้ว','ok')}
downloadBtn.onclick=exportCurrent;saveCurrentBtn.onclick=saveCurrent;exportAllBtn.onclick=exportAll;clearHistoryBtn.onclick=clearHistory;startBtn.onclick=startCamera;calibrateBtn.onclick=calibrateFloor;recordBtn.onclick=startDetect;stopBtn.onclick=stopDetect;resetBtn.onclick=reset;
body.innerHTML='<tr><td colspan=5 class=empty-history>ยังไม่มีผลการทดลองรอบนี้</td></tr>';
renderHistory();
if(!navigator.mediaDevices?.getUserMedia)setMsg('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้องผ่านเว็บ','error');
