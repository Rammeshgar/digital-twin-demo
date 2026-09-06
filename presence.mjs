import {Quaternion,Euler} from 'three';

// Additive rotations only: no torso/neck scaling, root translation or foot drift.
// Call after the authored pose is sampled; restore before the next pose sample.
export function createPresence(root){
 const names=['bone_10','bone_11','bone_12','bone_31','bone_51'];
 const bones=names.map(name=>root.getObjectByName(name));
 const base=bones.map(b=>b?.quaternion.clone());
 const q=new Quaternion(),e=new Euler();let applied=false;
 function restore(){if(applied)bones.forEach((b,i)=>{if(b)b.quaternion.copy(base[i]);});applied=false;}
 function update(t,enabled=true){
  if(!enabled)return;
  const breath=Math.sin(t*Math.PI*2/4.7),sway=Math.sin(t*.61+.3),turn=Math.sin(t*.37);
  const rotations=[
   [.004*breath,.008*turn,.010*sway],
   [.009*breath,-.003*turn,-.004*sway],
   [.003*breath,0,.006*breath+.003*Math.sin(t*.83)],
   [.003*breath,0,-.006*breath+.003*Math.sin(t*.79+.8)],
   [-.004*breath,-.002*turn,-.003*sway]
  ];
  bones.forEach((b,i)=>{if(!b)return;base[i].copy(b.quaternion);e.set(...rotations[i]);b.quaternion.multiply(q.setFromEuler(e));});applied=true;
 }
 return {restore,update};
}
