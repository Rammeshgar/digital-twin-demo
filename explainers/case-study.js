(()=>{'use strict';
 const map=document.getElementById('system-map'),guide=document.getElementById('animated-guide');
 const parts=new Set(['input','context','reply','voice','avatar','fallback']),scenarios=new Set(['typed','speech','no-mic','no-model']);
 let visible=false,ready=false,pending=null,suspended=false;
 function load(){if(!guide.getAttribute('src'))guide.src=guide.dataset.src;}
 function tell(){if(!ready||!guide.contentWindow)return;const open=visible&&!document.hidden&&!suspended;guide.contentWindow.postMessage({type:'portfolio-figure',open,theme:globalThis.PortfolioTheme?.current||'light'},location.origin);if(open&&pending){guide.contentWindow.postMessage({type:'portfolio-guide-selection',...pending},location.origin);pending=null;}}
 if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries.at(-1).isIntersecting;if(visible)load();tell();},{threshold:.01}).observe(guide);else{visible=true;load();}
 window.addEventListener('message',event=>{if(event.origin!==location.origin||!event.data||typeof event.data!=='object')return;const m=event.data;
  if(event.source===map.contentWindow&&m.type==='portfolio-map-selection'&&parts.has(m.part)&&(m.scenario===undefined||scenarios.has(m.scenario))){pending={part:m.part,scenario:m.scenario};load();document.getElementById('guide').focus({preventScroll:true});document.getElementById('panel-guide').scrollIntoView({block:'nearest',behavior:'auto'});tell();}
  else if(event.source===guide.contentWindow){if(m.type==='portfolio-figure-ready'){ready=true;tell();}else if(m.type==='portfolio-guide-selection'&&parts.has(m.part)&&(m.scenario===undefined||scenarios.has(m.scenario)))map.contentWindow?.postMessage(m,location.origin);}
 });
 guide.addEventListener('load',tell);document.addEventListener('visibilitychange',tell);window.addEventListener('pagehide',()=>{suspended=true;tell();});window.addEventListener('pageshow',()=>{suspended=false;tell();});
document.addEventListener('portfolio-theme-change',tell);
})();
