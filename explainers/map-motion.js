/* Directional illustration, never telemetry. Native SVG owns the animation clock. */
(()=>{'use strict';
 const routeSelector='path[data-edge],path[data-from][data-to]';
 const diagrams=[...document.querySelectorAll('svg')].filter(svg=>svg.querySelector(routeSelector));
 const main=document.querySelector('main');if(!main||!diagrams.length)return;
 const ns='http://www.w3.org/2000/svg',key='sadeq-map-motion';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let paused=false,suspended=false;try{paused=localStorage.getItem(key)==='paused';}catch{}
 const supported=diagrams.every(svg=>typeof svg.pauseAnimations==='function'&&typeof svg.unpauseAnimations==='function');
 const create=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [name,value]of Object.entries(attrs))node.setAttribute(name,String(value));return node;};
 const states=diagrams.map((svg,index)=>{
  if(!svg.id)svg.id='map-motion-diagram-'+index;
  const signals=[...svg.querySelectorAll(routeSelector)].map((edge,i)=>{
   if(!edge.id)edge.id=svg.id+'-route-'+i;
   const duration=3.6+(i%3)*.45,begin=String(-(i*.67)%duration)+'s';
   const outer=create('g',{'class':'map-flow-signal','aria-hidden':'true'});
   const packet=create('g',{'class':'map-flow-packet'});
   packet.append(create('circle',{'class':'map-flow-halo',r:5.5}),create('circle',{'class':'map-flow-core',r:2.2}),create('path',{'class':'map-flow-arrow',d:'M-8 -3L-4 0L-8 3'}));
   const motion=create('animateMotion',{dur:duration+'s',begin,repeatCount:'indefinite',rotate:'auto'});
   motion.append(create('mpath',{href:'#'+edge.id}));packet.append(motion);
   packet.append(create('animate',{attributeName:'opacity',values:'0;1;1;0',keyTimes:'0;.08;.88;1',dur:duration+'s',begin,repeatCount:'indefinite'}));
   outer.append(packet);
   try{
    const length=edge.getTotalLength(),end=edge.getPointAtLength(length*.94);
    if(length>0&&Number.isFinite(end.x)&&Number.isFinite(end.y)){
     const arrival=create('circle',{'class':'map-flow-arrival',cx:end.x,cy:end.y,r:1.5,opacity:0});
     arrival.append(create('animate',{attributeName:'r',values:'1.5;1.5;5;5',keyTimes:'0;.78;.94;1',dur:duration+'s',begin,repeatCount:'indefinite'}),create('animate',{attributeName:'opacity',values:'0;0;.6;0',keyTimes:'0;.78;.86;1',dur:duration+'s',begin,repeatCount:'indefinite'}));outer.append(arrival);
    }
   }catch{}
   edge.after(outer);
   return{edge,outer};
  });
  if(supported)svg.pauseAnimations();
  return{svg,signals,visible:false};
 });
 const toolbar=document.createElement('div');toolbar.className='map-motion-toolbar';
 const note=document.createElement('p');note.textContent='Directional animation · illustrates the connections';
 const button=document.createElement('button');button.type='button';button.className='map-motion-toggle';button.setAttribute('aria-controls',diagrams.map(svg=>svg.id).join(' '));toolbar.append(note,button);
 const header=main.querySelector('header,.map-header'),layout=main.querySelector('.map-layout');
 if(header?.parentElement===main)header.after(toolbar);else if(layout?.parentElement===main)main.insertBefore(toolbar,layout);else main.prepend(toolbar);
 function select(){for(const {signals}of states)for(const {edge,outer}of signals)outer.dataset.active=String(edge.dataset.incident==='true'||edge.dataset.selected==='true'||edge.dataset.active==='true'||edge.classList.contains('connected')||edge.classList.contains('selected'));}
 function sync(){
  const reason=!supported?'unavailable':reduced.matches?'reduced':paused?'paused':'enabled';
  document.body.dataset.mapMotion=reason;
  button.disabled=!supported||reduced.matches;button.setAttribute('aria-pressed',String(paused||reduced.matches));
  button.textContent=!supported?'Map motion unavailable':reduced.matches?'Motion off · Reduced motion':paused?'Play map motion':'Pause map motion';
  for(const state of states){const run=supported&&!reduced.matches&&!paused&&!suspended&&!document.hidden&&state.visible;state.svg.dataset.mapMotion=run?'running':'held';if(supported)state.svg[run?'unpauseAnimations':'pauseAnimations']();}
 }
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){const state=states.find(item=>item.svg===entry.target);if(state)state.visible=entry.isIntersecting;}sync();});states.forEach(state=>observer.observe(state.svg));
 const selectionObserver=new MutationObserver(records=>{if(records.some(record=>record.target.matches?.(routeSelector)))select();});states.forEach(state=>selectionObserver.observe(state.svg,{subtree:true,attributes:true,attributeFilter:['class','data-incident','data-active','data-selected']}));
 button.addEventListener('click',()=>{paused=!paused;try{localStorage.setItem(key,paused?'paused':'enabled');}catch{}sync();});
 document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
 window.addEventListener('pagehide',()=>{suspended=true;sync();});window.addEventListener('pageshow',()=>{suspended=false;sync();});
 window.addEventListener('storage',event=>{if(event.key===key){paused=event.newValue==='paused';sync();}});
 select();sync();
})();
