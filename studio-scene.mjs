import * as THREE from 'three';

// A compact practical set: dimensional paperboard, an inset light panel, a
// brass seam and a smoked architectural wall. All geometry is deliberately
// behind the performance, not screen-space decoration.
export function createStudioSet(scene, lowPower = false) {
    const group = new THREE.Group();
    group.name = 'Studio_V2';
    scene.background = new THREE.Color(0x202630);

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
    const charcoal = surface(0x303740);
    const edge = surface(0x171f27);
    const slate = surface(0x3b464f);
    const graphite = surface(0x34404b);
    const brass = surface(0xb17e55, 0.64, 0.45, null);
    const paperboard = surface(0x677476);
    const diffuser = new THREE.MeshStandardMaterial({
        color: 0xe8d9b6, emissive: 0xc6a16e, emissiveIntensity: 0.48, roughness: 1
    });
    const aqua = new THREE.MeshStandardMaterial({
        color: 0x71b6ac, emissive: 0x32756a, emissiveIntensity: 0.55, roughness: 0.8
    });

    function box(name, dimensions, position, material) {
        const object = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
        object.name = `Studio_V2_${name}`;
        object.position.set(...position);
        group.add(object);
        return object;
    }

    // The two recessed layers make a silhouette behind the hair; the edge
    // seams and inset panels supply parallax while the centre stays quiet.
    box('BackWall', [7.6, 3.6, 0.10], [0, 1.65, -1.84], charcoal);
    box('Recess', [2.11, 3.3, 0.065], [0, 1.58, -1.73], graphite);
    box('Header', [7.4, 0.16, 0.09], [0, 2.89, -1.68], edge);
    box('Base', [7.4, 0.15, 0.12], [0, 0.1, -1.65], edge);
    box('LeftWall', [1.86, 3.28, 0.14], [-1.99, 1.57, -1.66], slate);
    box('RightWall', [1.89, 3.28, 0.14], [2.01, 1.57, -1.66], slate);

    for (const side of [-1, 1]) {
        box(`RecessEdge_${side}`, [0.16, 3.04, 0.17], [side * 1.13, 1.57, -1.55], edge);
        box(`BrassSeam_${side}`, [0.016, 2.88, 0.018], [side * 1.04, 1.58, -1.45], brass);
        // Narrow side slats catch real light when the visitor changes angle.
        for (let i = 0; i < 6; i++) {
            box(`Slat_${side}_${i}`, [0.032, 2.7, 0.09], [side * (1.35 + i * 0.12), 1.56, -1.54], edge);
        }
    }

    // A paper-backed photographic practical on the right. The warm edge
    // lamp and inset aqua indicator on the left are visual accents, not LEDs
    // used as a substitute for lighting the subject.
    box('PracticalHousing', [0.62, 0.99, 0.16], [1.22, 1.86, -1.42], edge);
    box('PracticalMat', [0.54, 0.91, 0.036], [1.22, 1.86, -1.32], paperboard);
    box('PracticalDiffuser', [0.44, 0.81, 0.022], [1.22, 1.86, -1.294], diffuser);
    box('PracticalSeam', [0.44, 0.012, 0.025], [1.22, 1.67, -1.274], brass);
    box('LeftAccent', [0.065, 0.78, 0.075], [-1.21, 1.52, -1.40], edge);
    box('LeftSignal', [0.018, 0.71, 0.027], [-1.21, 1.52, -1.345], aqua);

    // Subtle technical shelf/baffle adds horizontal depth beneath the lamp.
    box('ShelfBoard', [1.17, 0.08, 0.40], [1.60, 0.97, -1.46], edge);
    box('ShelfTrim', [1.18, 0.012, 0.025], [1.60, 1.003, -1.25], brass);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), surface(0x1d292b));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.065;
    floor.receiveShadow = !lowPower;
    group.add(floor);
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.70, 0.06, lowPower ? 48 : 80), edge);
    podium.position.y = -0.035;
    podium.receiveShadow = !lowPower;
    group.add(podium);
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.69, 0.69, 0.006, lowPower ? 48 : 80), brass);
    trim.position.y = -0.02;
    group.add(trim);

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
    const wash = new THREE.PointLight(0x80aabe, 1.95, 4.2, 2);
    wash.position.set(-0.95, 1.5, -0.8);
    scene.add(wash);
    const practical = new THREE.PointLight(0xffcda6, 1.1, 2.8, 2);
    practical.position.set(1.08, 1.87, -1.02);
    scene.add(practical);
    return { group, signal: aqua };
}
