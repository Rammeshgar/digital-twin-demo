import * as THREE from 'three';

let blinkMesh,blinkIndex,blinkTime=-1,nextBlink=2.5;

export function refineCharacter(root){
 root.updateMatrixWorld(true);
 const fingers=new Set([...Array.from({length:15},(_,i)=>`bone_${i+16}`),...Array.from({length:15},(_,i)=>`bone_${i+35}`)]);
 root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh||mesh.name!=='body')return;
  mesh.geometry=mesh.geometry.clone();
  const p=mesh.geometry.attributes.position,joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
  const axes=mesh.skeleton.bones.map((bone,i)=>{
   if(!fingers.has(bone.name))return null;
   const m=mesh.skeleton.boneInverses[i].clone().invert().premultiply(mesh.bindMatrixInverse);
   return {origin:new THREE.Vector3().setFromMatrixPosition(m),axis:new THREE.Vector3(0,1,0).transformDirection(m)};
  });
  const point=new THREE.Vector3(),delta=new THREE.Vector3(),radial=new THREE.Vector3();
  for(let i=0;i<p.count;i++){
   point.fromBufferAttribute(p,i);delta.set(0,0,0);
   for(let c=0;c<4;c++){
    const a=axes[joints.getComponent(i,c)],w=weights.getComponent(i,c);if(!a||w<=0)continue;
    radial.copy(point).sub(a.origin).addScaledVector(a.axis,-radial.dot(a.axis));delta.addScaledVector(radial,-.06*w);
   }
   if(delta.lengthSq()){point.add(delta);p.setXYZ(i,point.x,point.y,point.z);}
  }
  p.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
 });
 const mesh=root.getObjectByName('new_head');if(!mesh?.isMesh)return;
 mesh.geometry=mesh.geometry.clone();const g=mesh.geometry;g.computeBoundingBox();
 const min=g.boundingBox.min,size=g.boundingBox.getSize(new THREE.Vector3()),p=g.attributes.position,delta=new Float32Array(p.count*3);
 const sourceMin=[-.613563776,3.941453218,-.759158790],sourceSize=[1.155377865,1.779469252,1.438422561];
 for(let i=0;i<p.count;i++){
  const x=sourceMin[0]+(p.getX(i)-min.x)/size.x*sourceSize[0],y=sourceMin[1]+(p.getY(i)-min.y)/size.y*sourceSize[1],z=sourceMin[2]+(p.getZ(i)-min.z)/size.z*sourceSize[2];
  const front=THREE.MathUtils.smoothstep(z,.28,.45);let w=0;
  for(const cx of [-.23,.19])w=Math.max(w,Math.exp(-Math.pow((x-cx)/.155,6)-Math.pow((y-5.075)/.15,6))*front);
  delta[i*3+1]=(5.065-y)*.95*w*size.y/sourceSize[1];
 }
 const targets=g.morphAttributes.position||=[];g.morphAttributes.position=targets;
 const a=new THREE.Float32BufferAttribute(delta,3);
 if(!g.morphTargetsRelative)for(let i=0;i<p.count;i++)a.setXYZ(i,p.getX(i),p.getY(i)+delta[i*3+1],p.getZ(i));
 a.name='NaturalBlink';blinkIndex=targets.length;targets.push(a);mesh.updateMorphTargets();blinkMesh=mesh;
}

export function updateNaturalBlink(delta,reducedMotion=false){
 if(!blinkMesh||reducedMotion)return;
 if(blinkTime<0){nextBlink-=delta;if(nextBlink>0)return;blinkTime=0;}
 blinkTime+=delta;const close=.075,hold=.025,open=.14;
 const weight=blinkTime<close?THREE.MathUtils.smoothstep(blinkTime,0,close):blinkTime<close+hold?1:1-THREE.MathUtils.smoothstep(blinkTime-close-hold,0,open);
 blinkMesh.morphTargetInfluences[blinkIndex]=weight;
 if(blinkTime>=close+hold+open){blinkTime=-1;nextBlink=Math.random()<.12?.22:2.4+Math.random()*3.6;}
}
