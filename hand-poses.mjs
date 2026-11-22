import {Quaternion, Vector3, MathUtils} from 'three';

// Existing exported rig has 3 independently weighted joints on each of ten digits.
// R/L correspond to the authored gesture library, not screen left/right.
const FINGERS = [
    {name:'index',base:25,splay:-0.075}, {name:'middle',base:22,splay:-0.015},
    {name:'ring',base:16,splay:0.045}, {name:'pinky',base:19,splay:0.105},
];
const shapes = {
    relaxed: {index:[8,18,27],middle:[11,22,32],ring:[15,28,39],pinky:[19,34,44],thumb:0.26,spread:0.65},
    open: {index:[2,7,11],middle:[4,9,14],ring:[7,12,19],pinky:[11,17,24],thumb:0.03,spread:1.22},
    rounded: {index:[15,30,40],middle:[17,34,45],ring:[20,39,50],pinky:[25,44,56],thumb:0.50,spread:0.55},
    point: {index:[1,3,6],middle:[28,48,63],ring:[32,54,67],pinky:[35,58,70],thumb:0.75,spread:0.48},
    emphasis: {index:[12,23,35],middle:[20,36,47],ring:[25,43,54],pinky:[29,47,60],thumb:0.58,spread:0.70},
    attentive: {index:[7,16,26],middle:[10,21,31],ring:[13,25,37],pinky:[16,31,43],thumb:0.20,spread:0.75},
    reflect: {index:[14,26,37],middle:[16,30,40],ring:[19,34,45],pinky:[22,38,49],thumb:0.40,spread:0.57},
};

const styles = {
    Explain_Right:['open','relaxed'], Present_Left:['relaxed','open'],
    Open_Both:['open','open'], Emphasis_Right:['emphasis','relaxed'],
    Emphasis_Left:['relaxed','emphasis'], Compare_Sides:['open','rounded'],
    Frame_An_Idea:['rounded','rounded'], Offer_Forward:['open','open'],
    Small_Point:['point','relaxed'], Conclude_Both:['open','open'],
};
const yAxis = new Vector3(0,1,0);

function makeHand(root, offset, sign) {
    const byId=n=>root.getObjectByName(`bone_${n+offset}`);
    const joints=[];
    const poses={};
    // In the wrist's local frame the four fingers grow along +Y, across Z;
    // mirrored palm normals point ±X. Derive swing from the actual rest roll,
    // rather than imposing an arbitrary Euler axis on differently rolled bones.
    for(const digit of FINGERS){
        const bones=[0,1,2].map(i=>byId(digit.base+i));
        if(bones.some(b=>!b?.isBone))return null;
        const rest=[];let cumulative=new Quaternion();
        for(const b of bones){cumulative=cumulative.clone().multiply(b.quaternion);rest.push(cumulative.clone());joints.push(b);}
        for(const [label,shape] of Object.entries(shapes)){
            poses[label]??=[];
            let parent=new Quaternion();
            for(let k=0;k<3;k++){
                const angle=MathUtils.degToRad(shape[digit.name][k]);
                const desired=new Vector3(sign*Math.sin(angle),Math.cos(angle),digit.splay*shape.spread*(k===0?1:0.68)).normalize();
                const from=yAxis.clone().applyQuaternion(rest[k]);
                const world=new Quaternion().setFromUnitVectors(from,desired).multiply(rest[k]).normalize();
                poses[label].push(parent.clone().invert().multiply(world).normalize());
                parent=world;
            }
        }
    }
    // Thumb has a distinct opposable, diagonal rig. Preserve its bind roll and
    // apply modest local opposition rather than bending it like a long finger.
    for(let k=0;k<3;k++){
        const b=byId(28+k);if(!b?.isBone)return null;joints.push(b);
        for(const [label,shape] of Object.entries(shapes)){
            const angle=MathUtils.degToRad((k===0?10:k===1?19:13)*shape.thumb);
            const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-sign*angle);
            poses[label].push(b.quaternion.clone().multiply(rotation).normalize());
        }
    }
    return {joints,poses,current:poses.relaxed.map(q=>q.clone())};
}

export function createHandPerformance(root){
    const hands=[makeHand(root,0,1),makeHand(root,19,-1)];
    if(hands.some(h=>!h))return {update(){},count:0};
    const desired=new Quaternion();
    return {
        count:30,
        update(delta,category,clip,time,duration,elapsed){
            const speaking=category==='gesture';
            const progress=MathUtils.clamp(time/Math.max(duration||1,0.1),0,1);
            const accent=speaking?Math.pow(Math.sin(Math.PI*progress),1.35):0;
            const baseline=category==='thinking'?'reflect':category==='listening'?'attentive':'relaxed';
            const chosen=speaking?(styles[clip]||['open','rounded']):[baseline,baseline];
            const alpha=1-Math.exp(-10*Math.min(Math.max(delta,0.016),0.1));
            hands.forEach((hand,side)=>{
                const base=hand.poses[baseline],target=hand.poses[chosen[side]];
                const amount=speaking?accent:0.0;
                hand.joints.forEach((bone,i)=>{
                    // Quiet, asynchronous small flex in repose. It never causes
                    // a full gesture or tries to track random pointer movement.
                    const micro=speaking?0:0.025*(0.5+0.5*Math.sin(elapsed*0.86+i*.43+side*1.7));
                    desired.copy(base[i]).slerp(target[i],amount);
                    if(micro>0)desired.slerp(hand.poses.rounded[i],micro);
                    hand.current[i].slerp(desired,alpha).normalize();
                    bone.quaternion.copy(hand.current[i]);
                });
            });
        }
    };
}
