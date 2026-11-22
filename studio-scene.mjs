import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// A complete, enclosed recording atelier. Furniture, trim, acoustic panels,
// floor, side returns and ceiling are real world-space geometry.
export function createStudioSet(scene, lowPower = false) {
    const group = new THREE.Group();
    group.name = 'Studio_V3_Atelier';
    scene.background = new THREE.Color(0x242b30);

    // A deterministic fine-grained paper surface; one little local texture,
    // no assets or noise post-process to download or animate.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(256, 256);
    let seed = 135783;
    for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const tone = 226 + (seed >>> 29) * 3;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = tone;
        pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const paper = new THREE.CanvasTexture(canvas);
    paper.colorSpace = THREE.SRGBColorSpace;
    paper.wrapS = paper.wrapT = THREE.RepeatWrapping;
    paper.repeat.set(2.5, 3.5);

    const surface = (color, roughness = 0.94, metalness = 0.02, texture = paper) =>
        new THREE.MeshStandardMaterial({ color, roughness, metalness, map: texture });
    const charcoal = surface(0x30383d);
    const edge = surface(0x171f27);
    const slate = surface(0x45494a);
    const graphite = surface(0x363f46);
    const brass = surface(0xb17e55, 0.64, 0.45, null);
    const paperboard = surface(0x6a6c63);
    const acoustic = surface(0x343a3a,0.98,0.0);
    const timber = surface(0x5c493c,0.86,0.02);
    const floorMaterial=surface(0x303638,0.88,0.015);
    const darkGlass=surface(0x253a3e,0.55,0.10,null);
    const diffuser = new THREE.MeshStandardMaterial({
        color: 0xf3e6c9, emissive: 0xd1b07a, emissiveIntensity: 0.34, roughness: 1
    });
    const aqua = new THREE.MeshStandardMaterial({
        color: 0x71b6ac, emissive: 0x32756a, emissiveIntensity: 0.55, roughness: 0.8
    });

    function box(name, dimensions, position, material) {
        const object = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
        object.name = `Studio_V3_${name}`;
        object.position.set(...position);
        group.add(object);
        return object;
    }

    function repeated(name,dimensions,positions,material){
        const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(...dimensions),material,positions.length);
        const dummy=new THREE.Object3D();
        positions.forEach((p,i)=>{dummy.position.set(...p);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
        mesh.name=`Studio_V3_${name}`;group.add(mesh);return mesh;
    }

    // The entire permitted camera sphere stays inside the room. The old
    // plywood backplate is retained only as an inset section of this shell.
    const roomX=3.65, roomBack=-2.23, roomFront=4.70, roomHeight=3.65;
    const roomDepth=roomFront-roomBack;
    box('RearShell',[roomX*2+.16,roomHeight,.22],[0,roomHeight/2-.06,roomBack],charcoal);
    box('FrontShell',[roomX*2+.16,roomHeight,.18],[0,roomHeight/2-.06,roomFront],acoustic);
    box('Ceiling',[roomX*2+.22,.17,roomDepth+.22],[0,roomHeight+.04,(roomFront+roomBack)/2],edge);
    for(const side of [-1,1]){
        box(`SideShell_${side}`,[.20,roomHeight,roomDepth+.22],[side*roomX,roomHeight/2-.06,(roomFront+roomBack)/2],slate);
        box(`SideBase_${side}`,[.075,.14,roomDepth],[side*(roomX-.15),.075,(roomFront+roomBack)/2],edge);
        box(`SideCove_${side}`,[.10,.16,roomDepth],[side*(roomX-.18),roomHeight-.13,(roomFront+roomBack)/2],edge);
        // Repeating acoustic modules with insets and brass dividers continue
        // past the corner in either orbit direction, never exposing a void.
        for(let i=0;i<4;i++){
            const z=-1.34+i*1.38;
            box(`SideAcoustic_${side}_${i}`,[.075,2.78,1.27],[side*(roomX-.15),1.55,z],acoustic);
            box(`SidePanelEdge_${side}_${i}`,[.092,.025,1.27],[side*(roomX-.19),.17,z],timber);
            box(`SidePanelCopper_${side}_${i}`,[.03,2.78,.014],[side*(roomX-.205),1.55,z-.64],brass);
        }
        const slatPositions=Array.from({length:11},(_,i)=>[side*(roomX-.205),1.62,-1.92+i*.105]);
        repeated(`CornerSlats_${side}`,[.095,2.70,.035],slatPositions,timber);
        box(`SidePracticalFrame_${side}`,[.11,.92,.52],[side*(roomX-.19),1.85,.63],edge);
        box(`SidePractical_${side}`,[.028,.78,.40],[side*(roomX-.26),1.85,.63],diffuser);
        box(`SidePracticalSeam_${side}`,[.033,.012,.40],[side*(roomX-.277),1.67,.63],brass);
        // A low credenza gives the side perspective a recognizable studio
        // silhouette. Nothing moves, glows excessively or resembles a HUD.
        box(`Credenza_${side}`,[.37,.48,1.34],[side*(roomX-.41),.28,-.90],timber);
        box(`CredenzaTop_${side}`,[.41,.055,1.38],[side*(roomX-.41),.55,-.90],edge);
        box(`CredenzaFoot_${side}`,[.34,.06,1.24],[side*(roomX-.41),.035,-.90],edge);
    }
    // A pair of genuine recessed ceiling strip fixtures. They remain visible
    // when tilted upward without a blasted white ceiling.
    box('CeilingRecess',[2.55,.06,.92],[0,roomHeight-.08,-.7],acoustic);
    for(const side of [-1,1])box(`CeilingStrip_${side}`,[.045,.025,2.30],[side*1.67,roomHeight-.09,.0],diffuser);

    // The two recessed layers make a silhouette behind the hair; the edge
    // seams and inset panels supply parallax while the centre stays quiet.
    box('BackWall', [7.1, 3.58, 0.12], [0, 1.72, -2.05], charcoal);
    box('Recess', [2.11, 3.3, 0.065], [0, 1.58, -1.73], graphite);
    box('Header', [7.4, 0.16, 0.09], [0, 2.89, -1.68], edge);
    box('Base', [7.4, 0.15, 0.12], [0, 0.1, -1.65], edge);
    box('LeftWall', [2.36, 3.28, 0.14], [-2.28, 1.57, -1.81], slate);
    box('RightWall', [2.36, 3.28, 0.14], [2.28, 1.57, -1.81], slate);

    for (const side of [-1, 1]) {
        box(`RecessEdge_${side}`, [0.16, 3.04, 0.17], [side * 1.13, 1.57, -1.55], edge);
        box(`BrassSeam_${side}`, [0.016, 2.88, 0.018], [side * 1.04, 1.58, -1.45], brass);
        // Narrow side slats catch real light when the visitor changes angle.
        repeated(`Slats_${side}`,[.033,2.7,.09],Array.from({length:11},(_,i)=>[side*(1.36+i*.13),1.56,-1.68]),edge);
        box(`RearReturn_${side}`, [.09,3.24,.58],[side*3.35,1.59,-1.78],edge);
        box(`RearReturnTrim_${side}`, [.035,3.02,.035],[side*3.30,1.57,-1.46],brass);
    }

    // A paper-backed photographic practical on the right. The warm edge
    // lamp and inset aqua indicator on the left are visual accents, not LEDs
    // used as a substitute for lighting the subject.
    box('PracticalHousing', [0.54, 0.84, 0.12], [1.57, 1.92, -1.46], edge);
    box('PracticalMat', [0.46, 0.76, 0.034], [1.57, 1.92, -1.38], paperboard);
    box('PracticalDiffuser', [0.38, 0.68, 0.022], [1.57, 1.92, -1.354], diffuser);
    box('PracticalSeam', [0.38, 0.012, 0.025], [1.57, 1.77, -1.334], brass);
    box('LeftAccent', [0.065, 0.78, 0.075], [-1.21, 1.52, -1.40], edge);
    box('LeftSignal', [0.018, 0.71, 0.027], [-1.21, 1.52, -1.345], aqua);

    // Subtle technical shelf/baffle adds horizontal depth beneath the lamp.
    box('ShelfBoard', [1.28, 0.08, 0.38], [1.72, 0.97, -1.58], timber);
    box('ShelfTrim', [1.29, 0.012, 0.025], [1.72, 1.003, -1.38], brass);
    // Quiet studio details: a few reference volumes and a smoked-glass
    // work display. They are deliberately small compared with the portrait.
    for(let i=0;i<4;i++)box(`ReferenceVolume_${i}`,[.065,.21-i*.018,.15],[2.10+i*.074,1.12-i*.009,-1.52],i===1?paperboard:i===3?timber:edge);
    box('LeftConsoleBody',[.76,.42,.31],[-1.75,.27,-1.7],timber);
    box('LeftConsoleTop',[.79,.055,.34],[-1.75,.51,-1.7],edge);
    box('LeftConsoleFace',[.61,.18,.02],[-1.75,.30,-1.53],darkGlass);
    box('LeftConsoleSeam',[.60,.010,.024],[-1.75,.23,-1.515],brass);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomX*2+.15,roomDepth+.15), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0,-0.065,(roomFront+roomBack)/2);
    floor.receiveShadow = !lowPower;
    group.add(floor);
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.70, 0.06, lowPower ? 48 : 80), edge);
    podium.position.y = -0.035;
    podium.receiveShadow = !lowPower;
    group.add(podium);
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.69, 0.69, 0.006, lowPower ? 48 : 80), brass);
    trim.position.y = -0.02;
    group.add(trim);

    // Subtle architectural floor-joint lines beyond the podium. Warm corner
    // seams and intentional room limits stay visible at low camera angles.
    repeated('FloorJoints',[roomX*2-.13,.003,.008],Array.from({length:6},(_,i)=>[0,-.062,-1.91+i*1.09]),edge);
    repeated('FloorLongJoints',[.008,.003,roomDepth-.13],[-2.3,-1.13,1.13,2.3].map(x=>[x,-.062,(roomFront+roomBack)/2]),edge);

    // Static architecture draws as one batch per material. The moving rig,
    // shadow-receiving floor and instanced slats keep their own meshes.
    const architecturalBatches=new Map();
    for(const child of [...group.children]){
        if(!child.isMesh||child.isInstancedMesh||child.geometry.type!=='BoxGeometry')continue;
        child.updateMatrix();
        const batch=architecturalBatches.get(child.material)||[];
        batch.push({child,geometry:child.geometry.clone().applyMatrix4(child.matrix)});
        architecturalBatches.set(child.material,batch);
    }
    for(const [material,batch] of architecturalBatches){
        if(batch.length<2)continue;
        const geometry=mergeGeometries(batch.map(item=>item.geometry),false);
        if(!geometry)continue;
        for(const item of batch){group.remove(item.child);item.child.geometry.dispose();item.geometry.dispose();}
        const mesh=new THREE.Mesh(geometry,material);mesh.name='Studio_V3_ArchitecturalBatch';group.add(mesh);
    }
    scene.add(group);
    const ambient = new THREE.HemisphereLight(0xebe0d5, 0x29313a, 1.07);
    scene.add(ambient);

    // A portrait light ratio with two different colour temperatures. The warm
    // key reveals face planes without making the paper skin excessively orange.
    const key = new THREE.DirectionalLight(0xffe8ca, 2.35);
    key.position.set(2.6, 3.65, 3.8);
    key.castShadow = !lowPower;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.normalBias = 0.018;
    key.shadow.bias = -0.00018;
    key.shadow.camera.left = key.shadow.camera.bottom = -1.8;
    key.shadow.camera.right = key.shadow.camera.top = 1.8;
    key.shadow.camera.near = 0.3;
    key.shadow.camera.far = 10;
    key.target.position.set(0, 1.1, 0);
    scene.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xb0d5df, 1.03);
    fill.position.set(-3.1, 2.1, 4);
    scene.add(fill);
    const face = new THREE.DirectionalLight(0xfff0df, 0.40);
    face.position.set(0, 1.9, 5.2);
    scene.add(face);
    const rim = new THREE.DirectionalLight(0xffc08e, 2.35);
    rim.position.set(-2.5, 2.8, -2.3);
    scene.add(rim);
    const coolRim = new THREE.DirectionalLight(0x8ebdc9, 1.22);
    coolRim.position.set(2.8, 2.7, -2.1);
    scene.add(coolRim);
    const wash = new THREE.PointLight(0x80aabe, 1.85, 4.2, 2);
    wash.position.set(-0.95, 1.5, -0.8);
    scene.add(wash);
    const practical = new THREE.PointLight(0xffcda6, 1.1, 2.8, 2);
    practical.position.set(1.48, 1.87, -1.17);
    scene.add(practical);
    // Small side-wall washes maintain depth when looking beyond the frontal
    // portrait. They are not animated and do not add expensive shadow maps.
    if(!lowPower)for(const side of [-1,1]){
        const sideWash=new THREE.PointLight(side===1?0xffce9d:0x80a9b5,1.28,3.2,2);
        sideWash.position.set(side*2.88,1.67,.55);scene.add(sideWash);
    }
    return { group, signal: aqua };
}
