'use strict';

// Quizzy enhancement layer: skyline theme, QR sharing and local WebAudio effects.
const fs = require('fs');
const path = require('path');
const http = require('http');

const originalReadFile = fs.readFile.bind(fs);
const originalCreateServer = http.createServer.bind(http);
const indexPath = path.join(__dirname, 'public', 'index.html');
const qrPath = path.join(__dirname, 'public', 'quiz-qr.svg');
const backgroundPath = path.join(__dirname, 'public', 'background.mp4');

let qrDataUri = '';
try {
  const svg = fs.readFileSync(qrPath, 'utf8');
  qrDataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
} catch (e) {
  console.warn('QR-code kon niet worden geladen:', e.message);
}

// Intercept the server created by server.js so the MP4 is served as a normal
// media resource. Range support is important for reliable HTML5 video playback.
http.createServer = function createEnhancedServer(appHandler) {
  return originalCreateServer(function enhancedHandler(req, res) {
    const url = (req.url || '/').split('?')[0];
    if (url !== '/background.mp4') return appHandler(req, res);

    fs.stat(backgroundPath, function (err, stat) {
      if (err || !stat.isFile() || stat.size < 1000) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Achtergrondvideo ontbreekt');
      }

      const total = stat.size;
      const range = req.headers.range;
      const common = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
      };

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + total });
          return res.end();
        }
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : total - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + total });
          return res.end();
        }
        end = Math.min(end, total - 1);
        res.writeHead(206, Object.assign({}, common, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
          'Content-Length': end - start + 1
        }));
        return fs.createReadStream(backgroundPath, { start, end }).pipe(res);
      }

      res.writeHead(200, Object.assign({}, common, { 'Content-Length': total }));
      fs.createReadStream(backgroundPath).pipe(res);
    });
  });
};

const enhancementCss = `
<style id="quizzy-enhancements-css">
:root{
  --bg:#070914;--surface:rgba(10,12,23,.82);--text:#fff7e9;--muted:#d8c8b2;
  --border:rgba(255,188,92,.28);--accent:#f2a33a;--accent-text:#211006;
  --ok:#58bd78;--bad:#ef6b5b;--c0:#c64b3d;--c1:#4f6d9b;--c2:#c99035;--c3:#4e8b61;
  color-scheme:dark;
}
html,body{min-height:100%;background:#070914!important}
body{position:relative;overflow-x:hidden}
.qz-bg-video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;object-position:center center;z-index:0;pointer-events:none;filter:saturate(.95) contrast(1.08) brightness(.78)}
.qz-bg-shade{position:fixed;inset:0;z-index:0;pointer-events:none;background:linear-gradient(180deg,rgba(3,5,12,.56),rgba(8,8,15,.22) 42%,rgba(7,6,12,.70) 100%)}
.wrap{position:relative;z-index:1}
header.top{padding:10px 12px;border-radius:14px;background:linear-gradient(90deg,rgba(8,9,18,.72),rgba(24,13,13,.42));border:1px solid rgba(255,185,82,.16);backdrop-filter:blur(9px)}
header.top h1{color:#fff6e7;text-shadow:0 2px 18px rgba(0,0,0,.75)}
header.top .sub{color:#e7cfad}
.card,.qcard{background:linear-gradient(145deg,rgba(11,13,24,.88),rgba(24,15,18,.78));border-color:rgba(255,190,94,.25);box-shadow:0 18px 55px rgba(0,0,0,.30);backdrop-filter:blur(12px)}
input,textarea,select{background:rgba(4,6,14,.76);border-color:rgba(255,190,94,.25);color:#fff7e9}
input::placeholder,textarea::placeholder{color:#aa9b89}
.btn{background:linear-gradient(135deg,#f5b44d,#df7b28);color:#211006;box-shadow:0 8px 24px rgba(216,111,26,.22)}
.btn.sec{background:rgba(9,11,20,.58);color:#f8ead7;border-color:rgba(255,190,94,.32);box-shadow:none}
.pin{color:#ffd27b;text-shadow:0 0 30px rgba(242,163,58,.34)}
.qtext{color:#fff8ed;text-shadow:0 2px 18px rgba(0,0,0,.58)}
.tbar{background:rgba(255,255,255,.12)} .tbar>i{background:linear-gradient(90deg,#f2a33a,#ffd27b)}
.chip{background:rgba(4,6,14,.60);border-color:rgba(255,190,94,.22)}
.tile{box-shadow:0 10px 26px rgba(0,0,0,.24)}
.qz-share-card{text-align:center;overflow:hidden}
.qz-share-title{font-size:1.08rem;font-weight:800;margin:0 0 4px;color:#ffd27b}
.qz-share-copy{margin:0 auto 12px;max-width:34rem}
.qz-qr{display:block;width:min(210px,62vw);height:auto;margin:12px auto;background:#fff;border-radius:16px;padding:12px;border:1px solid rgba(255,190,94,.32);box-sizing:border-box;box-shadow:0 12px 36px rgba(0,0,0,.34)}
.qz-url{display:inline-block;max-width:100%;overflow-wrap:anywhere;font-weight:700;color:#ffd27b;text-decoration:none}
.qz-lobby-join{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,220px);gap:18px;align-items:center}
.qz-lobby-join .qz-qr{width:100%;margin:0}.qz-lobby-pin{text-align:center}
.qz-audio{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;border:1px solid rgba(255,190,94,.30);border-radius:999px;padding:10px 14px;background:rgba(8,10,18,.86);color:#fff4df;font:inherit;font-weight:800;box-shadow:0 8px 28px rgba(0,0,0,.30);cursor:pointer;backdrop-filter:blur(10px)}
.qz-audio[aria-pressed="true"]{background:linear-gradient(135deg,#f5b44d,#df7b28);color:#211006;border-color:transparent}
@media(max-width:580px){.qz-bg-video{object-position:center bottom}.qz-lobby-join{grid-template-columns:1fr}.qz-lobby-join .qz-qr{width:min(190px,58vw);margin:0 auto}.qz-audio{right:10px;bottom:10px;font-size:.85rem}}
@media(prefers-reduced-motion:reduce){.qz-bg-video{display:none}}
</style>`;

function enhancementScript(qrUri) {
  return `
<script id="quizzy-enhancements-js">
(function(){
'use strict';
var QUIZ_URL='https://quiz-ou4d.onrender.com/';
var QR_URI=${JSON.stringify(qrUri)};
var audioOn=false,ctx=null,musicTimer=null,musicStep=0,lastSignal='';

function mountBackground(){
  if(document.getElementById('qz-bg-video'))return;
  var v=document.createElement('video');
  v.id='qz-bg-video';v.className='qz-bg-video';v.src='/background.mp4?v=4';
  v.autoplay=true;v.loop=true;v.muted=true;v.defaultMuted=true;v.playsInline=true;
  v.setAttribute('muted','');v.setAttribute('playsinline','');v.setAttribute('aria-hidden','true');
  var shade=document.createElement('div');shade.className='qz-bg-shade';shade.setAttribute('aria-hidden','true');
  document.body.insertBefore(v,document.body.firstChild);document.body.insertBefore(shade,v.nextSibling);
  var p=v.play();if(p&&p.catch)p.catch(function(){});
}
function shareCard(compact){
  var wrap=document.createElement('div');wrap.className=compact?'qz-lobby-join':'card qz-share-card';
  var img='<img class="qz-qr" src="'+QR_URI+'" alt="QR-code naar de Quizzy website">';
  if(compact)wrap.innerHTML='<div class="qz-lobby-pin"><div class="muted">Scan om mee te doen of ga naar</div><a class="qz-url" href="'+QUIZ_URL+'">quiz-ou4d.onrender.com</a><div class="muted small" style="margin-top:8px">Gebruik daarna de pincode hierboven.</div></div>'+img;
  else wrap.innerHTML='<div class="qz-share-title">Deel Quizzy</div><p class="muted qz-share-copy">Scan deze QR-code om nu of later naar de quizsite te gaan.</p>'+img+'<a class="qz-url" href="'+QUIZ_URL+'">quiz-ou4d.onrender.com</a>';
  return wrap;
}
function decorate(){
  var app=document.getElementById('app');if(!app)return;
  var hostLink=app.querySelector('[data-act="hostlogin"]');
  if(hostLink&&!app.querySelector('.qz-share-card')){var p=hostLink.closest('p');if(p&&p.parentNode)p.parentNode.insertBefore(shareCard(false),p);}
  var pin=app.querySelector('.pin');
  if(pin&&!app.querySelector('.qz-lobby-join')){var card=pin.closest('.card');if(card){var existing=card.querySelector('.muted');if(existing)existing.textContent='Pincode om mee te doen';card.appendChild(shareCard(true));}}
  detectSignals(app.innerText||'');
}
function ensureAudio(){if(ctx)return true;var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;ctx=new AC();return true;}
function tone(freq,dur,vol,type,delay){if(!audioOn||!ensureAudio())return;var t=ctx.currentTime+(delay||0),o=ctx.createOscillator(),g=ctx.createGain();o.type=type||'sine';o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol||.05,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+dur+.03);}
function sfx(kind){if(kind==='answer'){tone(520,.12,.045,'sine',0);tone(680,.16,.035,'sine',.08);}else if(kind==='good'){tone(523,.16,.055,'sine',0);tone(659,.18,.05,'sine',.12);tone(784,.32,.045,'sine',.24);}else if(kind==='bad'){tone(220,.18,.05,'triangle',0);tone(175,.28,.045,'triangle',.12);}else if(kind==='start'){tone(392,.12,.04,'sine',0);tone(523,.12,.04,'sine',.1);tone(659,.22,.04,'sine',.2);}else if(kind==='finish'){tone(523,.18,.05,'sine',0);tone(659,.18,.05,'sine',.13);tone(784,.18,.05,'sine',.26);tone(1047,.38,.045,'sine',.39);}}
var chords=[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]];
function playChord(){if(!audioOn||!ensureAudio())return;var ch=chords[musicStep%chords.length],now=ctx.currentTime;ch.forEach(function(f,i){var o=ctx.createOscillator(),g=ctx.createGain();o.type=i===1?'triangle':'sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.014,now+.45);g.gain.setValueAtTime(.014,now+2.7);g.gain.exponentialRampToValueAtTime(.0001,now+3.6);o.connect(g);g.connect(ctx.destination);o.start(now);o.stop(now+3.7);});tone(ch[0]/2,.55,.018,'sine',.05);tone(ch[0]/2,.45,.012,'sine',1.85);musicStep++;}
function startMusic(){if(musicTimer)return;playChord();musicTimer=setInterval(playChord,3600);}function stopMusic(){if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}
function storeAudio(){try{localStorage.setItem('qz_audio',audioOn?'1':'0');}catch(e){}}function restoreAudio(){try{return localStorage.getItem('qz_audio')==='1';}catch(e){return false;}}
function setAudio(on){audioOn=on;storeAudio();var b=document.getElementById('qz-audio');if(b){b.setAttribute('aria-pressed',on?'true':'false');b.textContent=on?'🔊 Muziek & geluid':'🔇 Muziek & geluid';}if(on){ensureAudio();if(ctx&&ctx.state==='suspended')ctx.resume();startMusic();sfx('start');}else stopMusic();}
function detectSignals(text){var signal='';if(text.indexOf('Goed zo!')>=0)signal='good';else if(text.indexOf('Helaas, fout')>=0||text.indexOf('Tijd is om')>=0)signal='bad';else if(text.indexOf('Einde van de quiz')>=0||text.indexOf('Eindstand')>=0)signal='finish';else if(text.indexOf('Vraag ')>=0&&text.indexOf('Beantwoord:')>=0)signal='start';if(signal&&signal!==lastSignal){lastSignal=signal;sfx(signal);}if(!signal)lastSignal='';}
mountBackground();
var audioBtn=document.createElement('button');audioBtn.id='qz-audio';audioBtn.className='qz-audio';audioBtn.type='button';audioBtn.setAttribute('aria-pressed','false');audioBtn.textContent='🔇 Muziek & geluid';audioBtn.addEventListener('click',function(){setAudio(!audioOn);});document.body.appendChild(audioBtn);
document.addEventListener('click',function(e){if(!audioOn)return;var a=e.target.closest&&e.target.closest('[data-act]');if(!a)return;var act=a.getAttribute('data-act');if(act==='answer'||act==='join')sfx('answer');else if(act==='start'||act==='next')sfx('start');},true);
var mo=new MutationObserver(decorate),app=document.getElementById('app');if(app)mo.observe(app,{childList:true,subtree:true,characterData:true});decorate();
if(restoreAudio()){var arm=function(){setAudio(true);};document.addEventListener('pointerdown',arm,{once:true});}
})();
</script>`;
}

fs.readFile = function(file, options, callback) {
  let cb = callback, opts = options;
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
    } catch (e) { cb(e); }
  });
};

require('./server.js');
