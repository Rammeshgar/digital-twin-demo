import * as THREE from 'three';
import {refineHandSurface} from './hand-surface.mjs';

let blinkMesh,blinkIndex,blinkTime=-1,nextBlink=2.5;

export function refineCharacter(root){
 root.updateMatrixWorld(true);
 const body=root.getObjectByName('body');
 const handSurface=refineHandSurface(body);
 if(handSurface)root.userData.handSurface=handSurface;
 const mesh=root.getObjectByName('new_head');if(!mesh?.isMesh)return;
 mesh.geometry=mesh.geometry.clone();const g=mesh.geometry;g.computeBoundingBox();
 const min=g.boundingBox.min,size=g.boundingBox.getSize(new THREE.Vector3()),p=g.attributes.position,delta=new Float32Array(p.count*3);
 const visemeEntries=Object.entries(mesh.morphTargetDictionary||{});
 const previousInfluences=[...(mesh.morphTargetInfluences||[])];
 const sourceMin=[-.613563776,3.941453218,-.759158790],sourceSize=[1.155377865,1.779469252,1.438422561];
 for(let i=0;i<p.count;i++){
  const x=sourceMin[0]+(p.getX(i)-min.x)/size.x*sourceSize[0],y=sourceMin[1]+(p.getY(i)-min.y)/size.y*sourceSize[1],z=sourceMin[2]+(p.getZ(i)-min.z)/size.z*sourceSize[2];
  const front=THREE.MathUtils.smoothstep(z,.28,.45);let w=0;
  for(const cx of [-.23,.19])w=Math.max(w,Math.exp(-Math.pow((x-cx)/.155,6)-Math.pow((y-5.075)/.15,6))*front);
  delta[i*3+1]=(5.065-y)*.95*w*size.y/sourceSize[1];
 }
 const targets=g.morphAttributes.position||=[];g.morphAttributes.position=targets;
 // updateMorphTargets rebuilds the dictionary from attribute names. Preserve
 // the GLTF viseme names before adding NaturalBlink or lip sync becomes inert.
 for(const [name,index] of visemeEntries)if(targets[index])targets[index].name=name;
 const a=new THREE.Float32BufferAttribute(delta,3);
 if(!g.morphTargetsRelative)for(let i=0;i<p.count;i++)a.setXYZ(i,p.getX(i),p.getY(i)+delta[i*3+1],p.getZ(i));
 a.name='NaturalBlink';blinkIndex=targets.length;targets.push(a);mesh.updateMorphTargets();blinkMesh=mesh;
 for(let i=0;i<previousInfluences.length;i++)mesh.morphTargetInfluences[i]=previousInfluences[i];
}

export function updateNaturalBlink(delta,reducedMotion=false){
 if(!blinkMesh||reducedMotion)return;
 if(blinkTime<0){nextBlink-=delta;if(nextBlink>0)return;blinkTime=0;}
 blinkTime+=delta;const close=.075,hold=.025,open=.14;
 const weight=blinkTime<close?THREE.MathUtils.smoothstep(blinkTime,0,close):blinkTime<close+hold?1:1-THREE.MathUtils.smoothstep(blinkTime-close-hold,0,open);
 blinkMesh.morphTargetInfluences[blinkIndex]=weight;
 if(blinkTime>=close+hold+open){blinkTime=-1;nextBlink=Math.random()<.12?.22:2.4+Math.random()*3.6;}
}
