/* Local-clock theme: day 07:00–19:00; a manual choice lasts until the next boundary. */
(()=>{'use strict';
 if(window.PortfolioTheme)return;
 const key='studio-local-theme-override-v1',root=document.documentElement;
 const valid=value=>value==='light'||value==='dark';
 let choice=null,current,parentTheme=null;
 function clock(now=new Date()){
  const hour=now.getHours(),day=hour>=7&&hour<19;
  const date=new Date(now.getTime());if(hour<7)date.setDate(date.getDate()-1);
  return {theme:day?'light':'dark',period:[date.getFullYear(),date.getMonth()+1,date.getDate(),day?'day':'night'].join(':')};
 }
 function parse(value){try{const saved=JSON.parse(value);return valid(saved?.theme)&&typeof saved.period==='string'?saved:null;}catch{return null;}}
 try{choice=parse(localStorage.getItem(key));}catch{}
 function refresh(){const local=clock();if(choice?.period!==local.period)choice=null;apply(parentTheme||choice?.theme||local.theme);}
 function refreshButtons(){document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
  button.hidden=false;button.setAttribute('aria-pressed',String(current==='dark'));
  button.setAttribute('aria-label','Dark theme');button.title=current==='dark'?'Switch to light theme':'Switch to dark theme';
  const icon=button.querySelector('[data-theme-icon]');if(icon)icon.textContent=current==='dark'?'☀':'☾';
 });}
 function tell(frame){if(location.origin!=='null'&&frame?.contentWindow)frame.contentWindow.postMessage({type:'portfolio-theme',theme:current},location.origin);}
 function apply(theme){
  if(!valid(theme))return;
  const changed=current!==theme;current=theme;root.dataset.theme=theme;root.style.colorScheme=theme;
  if(document.body)document.body.dataset.theme=theme;
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',theme==='dark'?'#171d1b':'#f3efe6');
  refreshButtons();
  if(changed){document.dispatchEvent(new CustomEvent('portfolio-theme-change',{detail:{theme}}));document.querySelectorAll('iframe').forEach(tell);}
 }
 function set(theme){if(!valid(theme))return;choice={theme,period:clock().period};try{localStorage.setItem(key,JSON.stringify(choice));}catch{}apply(theme);}
 const api={get current(){return current;},get preference(){return choice?.theme||null;},set,toggle(){set(current==='dark'?'light':'dark');}};
 window.PortfolioTheme=api;
 refresh();
 setInterval(refresh,30000);
 window.addEventListener('focus',refresh);
 window.addEventListener('pageshow',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.addEventListener('storage',event=>{if(event.key!==key&&event.key!==null)return;choice=parse(event.newValue);refresh();});
 window.addEventListener('message',event=>{
  if(parent===window||event.source!==parent||event.origin!==location.origin||event.data?.type!=='portfolio-theme'||!valid(event.data.theme))return;
  parentTheme=event.data.theme;apply(parentTheme);
 });
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-theme-toggle]'))api.toggle();});
 document.addEventListener('load',event=>{if(event.target?.tagName==='IFRAME')tell(event.target);},true);
 function mount(){
  apply(current);
  const compact=['compact','preview'].includes(new URLSearchParams(location.search).get('layout'));
  let button=document.querySelector('[data-theme-toggle]');
  if(!button&&!compact){
   // Keep an existing standalone figure control instead of adding a duplicate.
   button=document.getElementById('theme');
   if(!button){const host=document.querySelector('[data-theme-control],.site-header nav,.site-header,header');if(host){button=document.createElement('button');host.append(button);}}
   if(button){button.type='button';button.classList.add('theme-toggle');button.setAttribute('data-theme-toggle','');button.innerHTML='<span data-theme-icon aria-hidden="true">☾</span><span class="theme-label">Theme</span>';}
  }
  refreshButtons();document.querySelectorAll('iframe').forEach(tell);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
