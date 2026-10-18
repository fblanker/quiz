'use strict';

// Lightweight wrapper around the existing Quizzy server.
// It keeps the original game/server logic untouched and enhances the served UI
// with QR sharing plus locally generated sound effects and background music.
const fs = require('fs');
const path = require('path');

const originalReadFile = fs.readFile.bind(fs);
const originalReadFileSync = fs.readFileSync.bind(fs);
const indexPath = path.join(__dirname, 'public', 'index.html');
const qrPath = path.join(__dirname, 'public', 'quiz-qr.svg');

let qrDataUri = '';
try {
  const svg = originalReadFileSync(qrPath, 'utf8');
  qrDataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
} catch (e) {
  console.warn('QR-code kon niet worden geladen:', e.message);
}

const enhancementCss = `
<style id="quizzy-enhancements-css">
.qz-share-card{text-align:center;overflow:hidden}
.qz-share-title{font-size:1.08rem;font-weight:800;margin:0 0 4px}
.qz-share-copy{margin:0 auto 12px;max-width:34rem}
.qz-qr{display:block;width:min(210px,62vw);height:auto;margin:12px auto;background:#fff;border-radius:16px;padding:12px;border:1px solid var(--border);box-sizing:border-box}
.qz-url{display:inline-block;max-width:100%;overflow-wrap:anywhere;font-weight:700;color:var(--accent);text-decoration:none}
.qz-lobby-join{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,220px);gap:18px;align-items:center}
.qz-lobby-join .qz-qr{width:100%;margin:0}
.qz-lobby-pin{text-align:center}
.qz-audio{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;border:1px solid var(--border);border-radius:999px;padding:10px 14px;background:var(--surface);color:var(--text);font:inherit;font-weight:800;box-shadow:0 8px 28px rgba(0,0,0,.16);cursor:pointer}
.qz-audio[aria-pressed="true"]{background:var(--accent);color:var(--accent-text);border-color:transparent}
@media (max-width:580px){.qz-lobby-join{grid-template-columns:1fr}.qz-lobby-join .qz-qr{width:min(190px,58vw);margin:0 auto}.qz-audio{right:10px;bottom:10px;font-size:.85rem}}
</style>`;

function enhancementScript(qrUri) {
  return `
<script id="quizzy-enhancements-js">
(function(){
'use strict';
var QUIZ_URL='https://quiz-ou4d.onrender.com/';
var QR_URI=${JSON.stringify(qrUri)};
var audioOn=false,ctx=null,musicTimer=null,musicStep=0,lastSignal='';

function shareCard(compact){
  var wrap=document.createElement('div');
  wrap.className=compact?'qz-lobby-join':'card qz-share-card';
  var img='<img class="qz-qr" src="'+QR_URI+'" alt="QR-code naar de Quizzy website">';
  if(compact){
    wrap.innerHTML='<div class="qz-lobby-pin"><div class="muted">Scan om mee te doen of ga naar</div><a class="qz-url" href="'+QUIZ_URL+'">quiz-ou4d.onrender.com</a><div class="muted small" style="margin-top:8px">Gebruik daarna de pincode hierboven.</div></div>'+img;
  }else{
    wrap.innerHTML='<div class="qz-share-title">Deel Quizzy</div><p class="muted qz-share-copy">Laat iemand deze QR-code scannen om nu of later naar de quizsite te gaan.</p>'+img+'<a class="qz-url" href="'+QUIZ_URL+'">quiz-ou4d.onrender.com</a>';
  }
  return wrap;
}

function decorate(){
  var app=document.getElementById('app'); if(!app)return;
  var hostLink=app.querySelector('[data-act="hostlogin"]');
  if(hostLink&&!app.querySelector('.qz-share-card')){
    var p=hostLink.closest('p'); if(p&&p.parentNode)p.parentNode.insertBefore(shareCard(false),p);
  }
  var pin=app.querySelector('.pin');
  if(pin&&!app.querySelector('.qz-lobby-join')){
    var card=pin.closest('.card');
    if(card){
      var existing=card.querySelector('.muted'); if(existing)existing.textContent='Pincode om mee te doen';
      var grid=shareCard(true);
      card.appendChild(grid);
    }
  }
  detectSignals(app.innerText||'');
}

function ensureAudio(){
  if(ctx)return true;
  var AC=window.AudioContext||window.webkitAudioContext; if(!AC)return false;
  ctx=new AC(); return true;
}
function tone(freq,dur,vol,type,delay){
  if(!audioOn||!ensureAudio())return;
  var t=ctx.currentTime+(delay||0),o=ctx.createOscillator(),g=ctx.createGain();
  o.type=type||'sine';o.frequency.setValueAtTime(freq,t);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol||0.05,t+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+dur+0.03);
}
function sfx(kind){
  if(kind==='answer'){tone(520,.12,.045,'sine',0);tone(680,.16,.035,'sine',.08);}
  else if(kind==='good'){tone(523,.16,.055,'sine',0);tone(659,.18,.05,'sine',.12);tone(784,.32,.045,'sine',.24);}
  else if(kind==='bad'){tone(220,.18,.05,'triangle',0);tone(175,.28,.045,'triangle',.12);}
  else if(kind==='start'){tone(392,.12,.04,'sine',0);tone(523,.12,.04,'sine',.1);tone(659,.22,.04,'sine',.2);}
  else if(kind==='finish'){tone(523,.18,.05,'sine',0);tone(659,.18,.05,'sine',.13);tone(784,.18,.05,'sine',.26);tone(1047,.38,.045,'sine',.39);}
}

// Soft original gospel-inspired instrumental: warm sustained triads and a gentle bass pulse.
var chords=[
  [261.63,329.63,392.00], // C
  [220.00,261.63,329.63], // Am
  [174.61,220.00,261.63], // F
  [196.00,246.94,293.66]  // G
];
function playChord(){
  if(!audioOn||!ensureAudio())return;
  var ch=chords[musicStep%chords.length],now=ctx.currentTime;
  ch.forEach(function(f,i){
    var o=ctx.createOscillator(),g=ctx.createGain();o.type=i===1?'triangle':'sine';o.frequency.value=f;
    g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.014,now+.45);g.gain.setValueAtTime(.014,now+2.7);g.gain.exponentialRampToValueAtTime(.0001,now+3.6);
    o.connect(g);g.connect(ctx.destination);o.start(now);o.stop(now+3.7);
  });
  tone(ch[0]/2,.55,.018,'sine',.05); tone(ch[0]/2,.45,.012,'sine',1.85);
  musicStep++;
}
function startMusic(){if(musicTimer)return;playChord();musicTimer=setInterval(playChord,3600);}
function stopMusic(){if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}
function setAudio(on){
  audioOn=on;storeAudio();
  var b=document.getElementById('qz-audio');if(b){b.setAttribute('aria-pressed',on?'true':'false');b.textContent=on?'🔊 Muziek & geluid':'🔇 Muziek & geluid';}
  if(on){ensureAudio();if(ctx&&ctx.state==='suspended')ctx.resume();startMusic();sfx('start');}else stopMusic();
}
function storeAudio(){try{localStorage.setItem('qz_audio',audioOn?'1':'0');}catch(e){}}
function restoreAudio(){try{return localStorage.getItem('qz_audio')==='1';}catch(e){return false;}}

function detectSignals(text){
  var signal='';
  if(text.indexOf('Goed zo!')>=0)signal='good';
  else if(text.indexOf('Helaas, fout')>=0||text.indexOf('Tijd is om')>=0)signal='bad';
  else if(text.indexOf('Einde van de quiz')>=0||text.indexOf('Eindstand')>=0)signal='finish';
  else if(text.indexOf('Vraag ')>=0&&text.indexOf('Beantwoord:')>=0)signal='start';
  if(signal&&signal!==lastSignal){lastSignal=signal;sfx(signal);}
  if(!signal)lastSignal='';
}

var audioBtn=document.createElement('button');audioBtn.id='qz-audio';audioBtn.className='qz-audio';audioBtn.type='button';audioBtn.setAttribute('aria-pressed','false');audioBtn.textContent='🔇 Muziek & geluid';
audioBtn.addEventListener('click',function(){setAudio(!audioOn);});document.body.appendChild(audioBtn);

document.addEventListener('click',function(e){
  if(!audioOn)return;
  var a=e.target.closest&&e.target.closest('[data-act]'); if(!a)return;
  var act=a.getAttribute('data-act'); if(act==='answer'||act==='join')sfx('answer'); else if(act==='start'||act==='next')sfx('start');
},true);

var mo=new MutationObserver(function(){decorate();});
var app=document.getElementById('app');if(app)mo.observe(app,{childList:true,subtree:true,characterData:true});
decorate();
if(restoreAudio()){
  // Browsers require a user gesture before audio starts; arm it for the first interaction.
  var arm=function(){document.removeEventListener('pointerdown',arm);setAudio(true);};
  document.addEventListener('pointerdown',arm,{once:true});
}
})();
</script>`;
}

fs.readFile = function(file, options, callback) {
  let cb = callback;
  let opts = options;
  if (typeof options === 'function') { cb = options; opts = undefined; }

  return originalReadFile(file, opts, function(err, data) {
    if (err || path.resolve(String(file)) !== path.resolve(indexPath)) return cb(err, data);
    try {
      const wasBuffer = Buffer.isBuffer(data);
      let html = wasBuffer ? data.toString('utf8') : String(data);
      if (!html.includes('quizzy-enhancements-css')) {
        html = html.replace('</head>', enhancementCss + '\n</head>');
        html = html.replace('</body>', enhancementScript(qrDataUri) + '\n</body>');
      }
      cb(null, wasBuffer ? Buffer.from(html, 'utf8') : html);
    } catch (e) {
      cb(e);
    }
  });
};

require('./server.js');
