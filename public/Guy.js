// Guy.js - Simplified 3D man model compatible with THREE.js 0.175.0
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

export class Guy {
    constructor() {
        // Create a group to hold all mesh objects
        this.group = new THREE.Group();

        // Flag to track if using Minecraft skin
        this.hasMinecraftSkin = false;

        // Create materials with modern THREE.js syntax
        this.materials = {
            head: new THREE.MeshStandardMaterial({
                color: 0xffff00,
                emissive: 0x1a1a00,
                emissiveIntensity: 0.3,
                metalness: 0.3,
                roughness: 0.7
            }),
            face: new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0x1a1a1a,
                emissiveIntensity: 0.1,
                metalness: 0.1,
                roughness: 0.9
            }),
            body: new THREE.MeshStandardMaterial({
                color: 0x00ff00,
                emissive: 0x001a00,
                emissiveIntensity: 0.3,
                metalness: 0.3,
                roughness: 0.7
            }),
            limbs: new THREE.MeshStandardMaterial({
                color: 0x00ff00,
                emissive: 0x001a00,
                emissiveIntensity: 0.3,
                metalness: 0.3,
                roughness: 0.7
            })
        };

        // HEAD - simplified with fewer segments
        this.head = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.8, 0.8, 1, 1, 1),
            [this.materials.head, this.materials.head, this.materials.head,
             this.materials.head, this.materials.face, this.materials.head]
        );
        this.head.position.y = 1.5;
        this.head.castShadow = true;
        this.group.add(this.head);

        // BODY - simplified
        this.body = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1.5, 0.6, 1, 1, 1),
            this.materials.body
        );
        this.body.position.y = 0.75;
        this.body.castShadow = true;
        this.group.add(this.body);

        // ARMS - simplified
        this.arm_right = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 1.2, 0.4, 1, 1, 1),
            this.materials.limbs
        );
        this.arm_right.position.set(0.7, 0.75, 0);
        this.arm_right.geometry.translate(0, -0.5, 0);
        this.arm_right.castShadow = true;
        this.group.add(this.arm_right);

        this.arm_left = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 1.2, 0.4, 1, 1, 1),
            this.materials.limbs
        );
        this.arm_left.position.set(-0.7, 0.75, 0);
        this.arm_left.geometry.translate(0, -0.5, 0);
        this.arm_left.castShadow = true;
        this.group.add(this.arm_left);

        // LEGS - simplified
        this.leg_right = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 1.5, 0.4, 1, 1, 1),
            this.materials.limbs
        );
        this.leg_right.position.set(0.3, -0.75, 0);
        this.leg_right.geometry.translate(0, -0.75, 0);
        this.leg_right.castShadow = true;
        this.group.add(this.leg_right);

        this.leg_left = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 1.5, 0.4, 1, 1, 1),
            this.materials.limbs
        );
        this.leg_left.position.set(-0.3, -0.75, 0);
        this.leg_left.geometry.translate(0, -0.75, 0);
        this.leg_left.castShadow = true;
        this.group.add(this.leg_left);

        // Store original positions for animation reference
        this.storeOriginalPositions();
    }

    // Store original positions and rotations for reference
    storeOriginalPositions() {
        this.originalPositions = {
            arm_right: {
                position: this.arm_right.position.clone(),
                rotation: this.arm_right.rotation.clone()
            },
            arm_left: {
                position: this.arm_left.position.clone(),
                rotation: this.arm_left.rotation.clone()
            },
            leg_right: {
                position: this.leg_right.position.clone(),
                rotation: this.leg_right.rotation.clone()
            },
            leg_left: {
                position: this.leg_left.position.clone(),
                rotation: this.leg_left.rotation.clone()
            }
        };
    }

    // Apply a Minecraft skin texture to the model
    async applyMinecraftSkin(skinUrl) {
        if (!skinUrl) return false;

        try {
            // Load the texture
            const textureLoader = new THREE.TextureLoader();
            const texture = await new Promise((resolve, reject) => {
                textureLoader.load(
                    skinUrl,
                    (texture) => {
                        texture.flipY = false;
                        resolve(texture);
                    },
                    undefined,
                    (error) => reject(error)
                );
            });

            // Create materials for different body parts
            // For simplicity, we'll use the same texture for all parts
            const skinMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.7,
                metalness: 0.0
            });

            // Apply the material to all body parts
            this.head.material = skinMaterial;
            this.body.material = skinMaterial;
            this.arm_left.material = skinMaterial;
            this.arm_right.material = skinMaterial;
            this.leg_left.material = skinMaterial;
            this.leg_right.material = skinMaterial;

            // Update materials reference
            this.materials.head = skinMaterial;
            this.materials.body = skinMaterial;
            this.materials.limbs = skinMaterial;

            this.hasMinecraftSkin = true;
            return true;
        } catch (error) {
            console.error('Error applying Minecraft skin:', error);
            return false;
        }
    }

    // Set color for the entire avatar
    setColor(color, emissiveColor) {
        // If using a Minecraft skin, don't change the color
        if (this.hasMinecraftSkin) return;

        // Convert to hex if needed
        const colorHex = (typeof color === 'number') ? color : new THREE.Color(color).getHex();
        const emissiveHex = (typeof emissiveColor === 'number') ? emissiveColor : new THREE.Color(emissiveColor).getHex();

        // Update all materials
        this.materials.head.color.setHex(colorHex);
        this.materials.head.emissive.setHex(emissiveHex);
        this.materials.body.color.setHex(colorHex);
        this.materials.body.emissive.setHex(emissiveHex);
        this.materials.limbs.color.setHex(colorHex);
        this.materials.limbs.emissive.setHex(emissiveHex);

        // Face stays white with a tint
        this.materials.face.color.setHex(0xffffff);
        this.materials.face.emissive.setHex(emissiveHex);
    }

    // Reset to neutral pose
    resetPose() {
        this.arm_right.rotation.set(0, 0, 0);
        this.arm_left.rotation.set(0, 0, 0);
        this.leg_right.rotation.set(0, 0, 0);
        this.leg_left.rotation.set(0, 0, 0);
        this.head.rotation.set(0, 0, 0);
    }

    // Move arm with modern THREE.js syntax
    moveArm(armId, x, z) {
        const arm = this[armId];
        if (!arm) return;

        // Reset rotation
        arm.rotation.set(0, 0, 0);

        // Apply new rotation
        arm.rotation.x = Math.PI * 2 * x;
        arm.rotation.z = Math.PI / 2 * z * (armId === 'arm_left' ? -1 : 1);
    }

    // Move head with modern THREE.js syntax
    moveHead(y) {
        this.head.rotation.y = Math.PI * 2 * y;
    }

    // Move legs for walking animation
    moveLegs(per) {
        per = per % 1;
        const bias = Math.abs(0.5 - per) / 0.5;

        this.leg_left.rotation.x = (0.75 - bias * 1.5);
        this.leg_right.rotation.x = (-0.75 + bias * 1.5);
    }

    // Walking animation
    walk(per, swings = 1) {
        per = per % 1;
        const r = Math.PI * 2 * per;
        const armPer = Math.cos(r * swings) + 1 / 2;

        this.moveArm('arm_right', -0.1 + 0.2 * armPer, 0);
        this.moveArm('arm_left', 0.1 - 0.2 * armPer, 0);
        this.moveLegs(per * swings);
    }

    // Jumping pose
    jump() {
        this.resetPose();
        this.moveArm('arm_right', 0.2, 0.3);
        this.moveArm('arm_left', 0.2, 0.3);
        this.leg_right.rotation.x = 0.3;
        this.leg_left.rotation.x = 0.3;
    }

    // Get the height of the model for positioning
    getHeight() {
        // Calculate from the bottom of the legs to the top of the head
        return 4.0; // Approximate height based on our geometry
    }

    // Get the width of the model for collision detection
    getWidth() {
        // Width is determined by the arms span
        return 1.8; // Approximate width based on our geometry
    }

    // Get the depth of the model for collision detection
    getDepth() {
        // Depth is front-to-back measurement
        return 0.8; // Approximate depth based on our geometry
    }
}
