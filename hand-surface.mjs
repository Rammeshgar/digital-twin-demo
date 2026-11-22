import * as THREE from 'three';

// Selective one-level subdivision + constrained volume-preserving relaxation.
// All original skin/UV data outside the hands is retained. Midpoint joints are
// blended and normalized; adjacent faces are split to prevent T-junctions.
export function refineHandSurface(mesh){
    if(!mesh?.isSkinnedMesh||mesh.name!=='body'||!mesh.geometry.index)return null;
    const source=mesh.geometry, attributes=source.attributes;
    const count=attributes.position.count;
    if(!attributes.skinIndex||!attributes.skinWeight)return null;
    const boneIds=mesh.skeleton.bones.map(b=>Number(b.name?.match(/^bone_(\d+)$/)?.[1]));
    const sideFor=n=>(n>=15&&n<=30)?1:(n>=34&&n<=49)?2:0;
    const rows={};
    for(const [name,attr] of Object.entries(attributes)){
        const values=[];
        for(let v=0;v<count;v++)for(let c=0;c<attr.itemSize;c++)values.push(attr.getComponent(v,c));
        rows[name]={size:attr.itemSize,values};
    }
    const handData=(v)=>{
        let left=0,right=0;
        for(let j=0;j<4;j++){
            const side=sideFor(boneIds[rows.skinIndex.values[v*4+j]]);
            const w=rows.skinWeight.values[v*4+j];
            if(side===1)left+=w;else if(side===2)right+=w;
        }
        return {side:left>=right?1:2,weight:Math.max(left,right)};
    };
    const weights=Array.from({length:count},(_,v)=>handData(v));
    const sameHand=(a,b)=>weights[a].side===weights[b].side;
    const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
    const marked=new Set(), raw=source.index.array;
    const faces=[];
    for(let i=0;i<raw.length;i+=3){
        const a=raw[i],b=raw[i+1],c=raw[i+2];
        const w=[a,b,c].map(v=>weights[v]);
        const hand=w.every(x=>x.weight>.70&&x.side===w[0].side)&&w.reduce((s,x)=>s+x.weight,0)/3>.86;
        faces.push({a,b,c,hand});
        if(hand){marked.add(edgeKey(a,b));marked.add(edgeKey(b,c));marked.add(edgeKey(c,a));}
    }
    let added=0;
    const mids=new Map();
    function split(a,b){
        const key=edgeKey(a,b);if(!marked.has(key))return -1;
        if(mids.has(key))return mids.get(key);
        const id=count+added++;mids.set(key,id);
        for(const [name,row] of Object.entries(rows)){
            if(name==='skinIndex'||name==='skinWeight')continue;
            for(let c=0;c<row.size;c++)row.values.push((row.values[a*row.size+c]+row.values[b*row.size+c])*.5);
        }
        const merged=new Map();
        for(const v of [a,b])for(let c=0;c<4;c++){
            const j=rows.skinIndex.values[v*4+c],w=rows.skinWeight.values[v*4+c]*.5;
            merged.set(j,(merged.get(j)||0)+w);
        }
        const ranked=[...merged].filter(([,w])=>w>1e-7).sort((x,y)=>y[1]-x[1]).slice(0,4);
        const sum=ranked.reduce((s,[,w])=>s+w,0)||1;
        for(let c=0;c<4;c++){rows.skinIndex.values.push(ranked[c]?.[0]||0);rows.skinWeight.values.push((ranked[c]?.[1]||0)/sum);}
        weights.push(handData(id));return id;
    }
    const bodyIndices=[],handIndices=[];
    function emit(target,a,b,c){target.push(a,b,c);}
    for(const {a,b,c,hand} of faces){
        const ab=split(a,b),bc=split(b,c),ca=split(c,a),target=hand?handIndices:bodyIndices;
        const bits=(ab>=0?1:0)|(bc>=0?2:0)|(ca>=0?4:0);
        switch(bits){
            case 0:emit(target,a,b,c);break;
            case 1:emit(target,a,ab,c);emit(target,ab,b,c);break;
            case 2:emit(target,b,bc,a);emit(target,bc,c,a);break;
            case 4:emit(target,c,ca,b);emit(target,ca,a,b);break;
            case 3:emit(target,b,bc,ab);emit(target,a,ab,c);emit(target,ab,bc,c);break;
            case 6:emit(target,c,ca,bc);emit(target,b,bc,a);emit(target,bc,ca,a);break;
            case 5:emit(target,a,ab,ca);emit(target,c,ca,b);emit(target,ca,ab,b);break;
            case 7:emit(target,a,ab,ca);emit(target,ab,b,bc);emit(target,ca,bc,c);emit(target,ab,bc,ca);break;
        }
    }
    const all=[...bodyIndices,...handIndices], positions=rows.position.values;
    // UV seams often duplicate vertices. Weld only coincident positions with
    // the same hand identity; never merge separate fingers merely nearby.
    const groups=new Map(),vertexGroup=new Array(weights.length);
    for(let i=0;i<weights.length;i++){
        if(weights[i].weight<.72)continue;
        const key=`${weights[i].side}:${positions.slice(i*3,i*3+3).map(v=>v.toFixed(5)).join(':')}`;
        let g=groups.get(key);if(!g){g={ids:[],neighbors:new Set(),boundary:false};groups.set(key,g);}
        g.ids.push(i);vertexGroup[i]=g;
    }
    for(let i=0;i<all.length;i+=3){
        const tri=all.slice(i,i+3);
        for(const v of tri){const g=vertexGroup[v];if(!g)continue;for(const n of tri){if(n===v)continue;const h=vertexGroup[n];if(!h||!sameHand(v,n)||i<bodyIndices.length)g.boundary=true;else if(g!==h)g.neighbors.add(h);}}
    }
    // The Taubin pair removes harsh faceting while preserving the knuckle
    // and finger volume. Cuffs and every boundary vertex remain locked.
    const current=g=>new THREE.Vector3().fromArray(positions,g.ids[0]*3);
    function relax(factor){
        const updates=[];
        for(const g of groups.values()){
            if(g.boundary||g.neighbors.size<3)continue;
            const p=current(g),avg=new THREE.Vector3();
            for(const n of g.neighbors)avg.add(current(n));avg.divideScalar(g.neighbors.size);
            updates.push([g,p.lerp(avg,factor)]);
        }
        for(const [g,p] of updates)for(const i of g.ids)p.toArray(positions,i*3);
    }
    for(let i=0;i<2;i++){relax(.34);relax(-.26);}

    // Taper finger shafts, not the palm or cuff. Work in the actual skin bind
    // frame so the deformation follows each anatomical segment instead of a
    // global XYZ scale; keep the weighted knuckle transitions continuous.
    const axes=mesh.skeleton.bones.map((bone,i)=>{
        const id=boneIds[i];
        if(!((id>=16&&id<=30)||(id>=35&&id<=49)))return null;
        const matrix=mesh.skeleton.boneInverses[i].clone().invert().premultiply(mesh.bindMatrixInverse);
        const thumb=(id>=28&&id<=30)||(id>=47&&id<=49);
        return {origin:new THREE.Vector3().setFromMatrixPosition(matrix),axis:new THREE.Vector3(0,1,0).transformDirection(matrix),amount:thumb?.055:.105};
    });
    const pos=new THREE.Vector3(),offset=new THREE.Vector3(),radial=new THREE.Vector3();
    for(const group of groups.values()){
        const i=group.ids[0];
        if(weights[i].weight<.78||group.boundary)continue;
        pos.fromArray(positions,i*3);offset.set(0,0,0);
        for(let c=0;c<4;c++){
            const shaft=axes[rows.skinIndex.values[i*4+c]],w=rows.skinWeight.values[i*4+c];
            if(!shaft||w<=0)continue;
            radial.copy(pos).sub(shaft.origin);radial.addScaledVector(shaft.axis,-radial.dot(shaft.axis));
            offset.addScaledVector(radial,-shaft.amount*w);
        }
        if(offset.lengthSq()){pos.add(offset);for(const id of group.ids)pos.toArray(positions,id*3);}
    }
    const geometry=new THREE.BufferGeometry();
    for(const [name,row] of Object.entries(rows)){
        const array=name==='skinIndex'?new Uint16Array(row.values):new Float32Array(row.values);
        geometry.setAttribute(name,new THREE.BufferAttribute(array,row.size));
    }
    geometry.setIndex(all);
    geometry.addGroup(0,bodyIndices.length,0);geometry.addGroup(bodyIndices.length,handIndices.length,1);
    geometry.computeVertexNormals();
    const normals=geometry.attributes.normal;
    // Smooth normals across actual UV seams in the hand, while the original
    // body remains a flat-shaded paper-cut material.
    for(const g of groups.values()){
        if(g.ids.length<2)continue;const normal=new THREE.Vector3();
        for(const id of g.ids)normal.add(new THREE.Vector3().fromBufferAttribute(normals,id));normal.normalize();
        for(const id of g.ids)normals.setXYZ(id,normal.x,normal.y,normal.z);
    }
    normals.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const original=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
    const handMaterial=original.clone();handMaterial.userData={...original.userData,handSurface:true};handMaterial.flatShading=false;
    mesh.geometry=geometry;mesh.material=[original,handMaterial];
    return {verticesBefore:count,verticesAfter:weights.length,handTriangles:handIndices.length/3,extraVertices:added};
}
