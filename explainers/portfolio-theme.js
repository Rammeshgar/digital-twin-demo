/* One local theme preference. No network, media, playback or selection changes. */
(()=>{'use strict';
 if(window.PortfolioTheme)return;
 const key='sadeq-portfolio-theme',root=document.documentElement;
 const system=window.matchMedia('(prefers-color-scheme: dark)');
 const valid=value=>value==='light'||value==='dark';
 let choice=null,current;
 try{const saved=localStorage.getItem(key);if(valid(saved))choice=saved;}catch{}
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
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',theme==='dark'?'#111d1b':'#eee9df');
  refreshButtons();
  if(changed){document.dispatchEvent(new CustomEvent('portfolio-theme-change',{detail:{theme}}));document.querySelectorAll('iframe').forEach(tell);}
 }
 function set(theme){if(!valid(theme))return;choice=theme;try{localStorage.setItem(key,theme);}catch{}apply(theme);}
 const api={get current(){return current;},get preference(){return choice;},set,toggle(){set(current==='dark'?'light':'dark');}};
 window.PortfolioTheme=api;
 apply(choice||(system.matches?'dark':'light'));
 system.addEventListener('change',()=>{if(choice===null)apply(system.matches?'dark':'light');});
 window.addEventListener('storage',event=>{if(event.key!==key&&event.key!==null)return;choice=valid(event.newValue)?event.newValue:null;apply(choice||(system.matches?'dark':'light'));});
 window.addEventListener('message',event=>{
  if(parent===window||event.source!==parent||event.origin!==location.origin||event.data?.type!=='portfolio-theme'||!valid(event.data.theme))return;
  apply(event.data.theme);
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
