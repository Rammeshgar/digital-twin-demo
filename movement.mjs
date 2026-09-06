import * as THREE from 'three';
import {createPresence} from './presence.mjs';

export async function createMovement(root) {
    const response=await fetch('./gestures.json');
    if(!response.ok) throw Error('Gesture library unavailable');
    const data=await response.json();
    const clips=data.map(c=>({...c,tracks:c.tracks.map(t=>{
        const bone=root.getObjectByName(t.name);
        if(!bone?.isBone) throw Error(`Gesture bone missing: ${t.name}`);
        return {bone,sample:new THREE.QuaternionKeyframeTrack(t.name+'.quaternion',t.times,t.values).createInterpolant()};
    })}));
    const bones=[];root.traverse(b=>{if(b.isBone)bones.push(b);});
    const saved=bones.map(b=>b.quaternion.clone());
    const presence=createPresence(root);
    let mode=null,current=null,outgoing=null,time=0,outTime=0,blendTime=0,deck=[];
    const overlap=.30;
    function choose(category) {
        if(!deck.length) {
            deck=clips.filter(c=>c.category===category&&c!==current);
            for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
        }
        return deck.pop()||clips.find(c=>c.category===category);
    }
    function sample(clip,t){for(const track of clip.tracks)track.bone.quaternion.fromArray(track.sample.evaluate(Math.min(t,clip.duration)));}
    function change(category,first=false) {
        outgoing=first?null:current;outTime=time;current=choose(category);
        time=category==='gesture'&&!first?current.duration*.10:0;
        blendTime=0;
        if(!outgoing)bones.forEach((b,i)=>saved[i].copy(b.quaternion));
    }
    return {
        update(delta,state,elapsed) {
            presence.restore();
            const category=state.speaking?'gesture':state.busy?'thinking':state.listening||state.recordingStream||state.recognitionStarting?'listening':'idle';
            if(category!==mode){deck=[];mode=category;change(category,true);}
            time+=delta;outTime+=delta;blendTime+=delta;
            const end=current.duration*(category==='gesture'?.9:1);
            if(time>=end-overlap&&blendTime>=overlap)change(category);
            if(outgoing){sample(outgoing,outTime);bones.forEach((b,i)=>saved[i].copy(b.quaternion));}
            sample(current,time);
            const weight=THREE.MathUtils.smoothstep(blendTime,0,overlap);
            if(weight<1)bones.forEach((b,i)=>b.quaternion.slerp(saved[i],1-weight));
            else outgoing=null;
            presence.update(elapsed);
        },
        count:clips.length
    };
}
