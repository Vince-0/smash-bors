import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js'; // Import THREE
import { Guy } from './Guy.js'; // Import Guy model
import { MinecraftSkinFetcher } from './MinecraftSkinFetcher.js'; // Import Minecraft skin fetcher

console.log(THREE); // Check if THREE is defined

// Create a Minecraft skin fetcher instance
const skinFetcher = new MinecraftSkinFetcher();

// Create a variable to store server-provided config
let serverConfig = null;

// Variables for WebSocket connection
let socket = null;
let myPlayerId = null;
let playerName = ""; // Store player name

// Global cooldown for death sound
const DEATH_SOUND_COOLDOWN_MS = 800; // ms
let lastDeathSoundAt = 0;


// Store all avatar meshes and name labels
const playerMeshes = {};
const playerLabels = {};

const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// Position camera to view the scene from the side
camera.position.z = 15; // Move camera back to see the scene
camera.position.y = 0;  // Center camera vertically
camera.position.x = 0;  // Center camera horizontally

// Increase camera's field of view to see more of the background
camera.fov = 85;
camera.updateProjectionMatrix();

// Add lights to the scene for better visibility
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

// Add directional light for shadows and highlights
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 10, 10);
scene.add(directionalLight);

// Add a subtle blue point light for atmosphere
const pointLight = new THREE.PointLight(0x0088ff, 0.5, 50);
pointLight.position.set(0, 5, 5);
scene.add(pointLight);

// Use server config if available, otherwise fall back to local config
function getPhysicsConfig() {
    return serverConfig ? serverConfig.physics : physics;
}

// Platform properties from config (will be initialized after server connection)
let platformWidth, platformHeight, platformDepth, platformY, platformTop;

// Initialize platform properties
function initPlatformProperties() {
    const config = getPhysicsConfig();
    platformWidth = config.platform.width;
    platformHeight = config.platform.height;
    platformDepth = config.platform.depth;
    platformY = config.platform.yPosition;
    platformTop = platformY + (platformHeight / 2); // Top surface of platform
}

// Create a horizontal platform for avatars to stand on with enhanced visuals
function createPlatform() {
    // Load texture for the platform
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('assets/textures/platform-main.jpg');
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 1);

    // Create a platform with proper orientation and more segments for better lighting
    const geometry = new THREE.BoxGeometry(platformWidth, platformHeight, platformDepth, 20, 4, 4);

    // Create material with texture and lighting properties for futuristic look
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,  // Base color (will be mixed with texture)
        roughness: 0.2,   // Very shiny
        metalness: 0.8,   // Very metallic
        emissive: 0x0088ff, // Blue glow
        emissiveIntensity: 0.2,
        envMapIntensity: 1.0
    });

    const platform = new THREE.Mesh(geometry, material);

    // Position the platform in the lower part of the screen
    platform.position.y = platformY;
    platform.position.z = 0; // Same z-position as avatars

    // Add a glow effect
    const glowGeometry = new THREE.BoxGeometry(platformWidth + 0.2, platformHeight + 0.2, platformDepth + 0.2);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    platform.add(glow);

    // Add edge highlight
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        linewidth: 1,
        transparent: true,
        opacity: 0.7
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    platform.add(edges);

    // Add platform to userData for reference
    platform.userData = { type: 'platform', isMainPlatform: true };

    console.log(`Enhanced main platform created at y=${platformY} with width=${platformWidth}`);

    return platform;
}

// Check if an avatar is colliding with the platform
function isCollidingWithPlatform(avatarX, avatarY, avatarHeight = 1.0) {
    // For most geometries, the origin is at the center, so the bottom edge is at y - height/2
    const avatarBottomY = avatarY - (avatarHeight / 2);

    // Check if avatar is within the platform's horizontal bounds
    const withinXBounds = Math.abs(avatarX) <= platformWidth / 2;

    // Check if avatar's bottom edge is at or below the platform's top surface
    const atOrBelowTop = avatarBottomY <= platformTop;

    // Check if avatar's bottom edge is close enough to the top surface to be considered "on" the platform
    const closeToTop = Math.abs(avatarBottomY - platformTop) < 0.1;

    // Return collision status and whether the avatar is standing on the platform
    return {
        colliding: withinXBounds && atOrBelowTop,
        standing: withinXBounds && closeToTop
    };
}

// Check if two avatars are colliding
function areAvatarsColliding(avatar1X, avatar1Y, avatar2X, avatar2Y) {
    // Get the collision radius based on the Guy model's width
    const scale = getAvatarScale();
    const guyWidth = 1.8 * scale; // Width of the Guy model (scaled)
    const collisionRadius = guyWidth * 0.4; // Use a slightly smaller collision radius for better gameplay

    // Calculate the distance between the two avatars
    const dx = avatar1X - avatar2X;
    const dy = avatar1Y - avatar2Y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Avatars are colliding if the distance is less than the sum of their radii
    return distance < (collisionRadius * 2);
}

// Initialize the game scene
function initScene() {
    // Add the main platform to the scene
    const platform = createPlatform();
    scene.add(platform);

    // Add the bottom platform (death zone)
    const bottomPlatform = createBottomPlatform();
    scene.add(bottomPlatform);

    // Initialize animated elements (background, particles, etc.)
    initAnimatedElements();

    console.log('Game scene initialized with platforms and visual effects');
}

// Create a text label for a player
function createPlayerLabel(id, name) {
    // Create a canvas for the text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    // Set text properties with futuristic font from Google Fonts - smaller size
    context.font = 'Bold 6.25px "Press Start 2P", cursive'; // Increased by 25% from 5px
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Clear the canvas to transparent
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Set text color without glow effect
    const textColor = String(id) === String(myPlayerId) ? '#00FF00' : '#FF0000';

    // No shadow/glow effect
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.fillStyle = textColor;

    // Draw text once (no multiple passes needed without glow)
    context.fillText(name, canvas.width / 2, canvas.height / 2);

    // Draw black outline for better visibility against any background
    context.shadowBlur = 0;
    context.strokeStyle = '#000000';
    context.lineWidth = 3;
    context.strokeText(name, canvas.width / 2, canvas.height / 2);

    // Draw text again without shadow for sharper appearance
    context.fillStyle = textColor;
    context.fillText(name, canvas.width / 2, canvas.height / 2);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);

    // Create sprite material with special settings for visibility
    const material = new THREE.SpriteMaterial({
        map: texture,
        sizeAttenuation: false, // Don't scale with distance
        depthTest: false, // Always render on top
        depthWrite: false // Don't write to depth buffer
    });

    // Create sprite
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.9375, 0.25, 1); // Increased by 25% from (0.75, 0.2, 1)

    // Store the name and other data in userData for later comparison
    sprite.userData = {
        name: name,
        isPlayerLabel: true, // Flag to identify this as a player label
        kills: 0,            // Track kills for score sound
        deaths: 0            // Track deaths
    };

    return sprite;
}

// Helper function to draw rounded rectangles on canvas
function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) {
        ctx.fill();
    }
    if (stroke) {
        ctx.stroke();
    }
}

// Create a bottom platform (death zone) for avatars to fall onto with enhanced visuals
function createBottomPlatform() {
    const config = getPhysicsConfig();
    const bottomPlatformY = platformY - config.platform.bottomPlatformOffset; // Use config value
    const bottomPlatformWidth = config.platform.bottomPlatformWidth || platformWidth * 3;
    const bottomPlatformHeight = config.platform.bottomPlatformHeight || platformHeight;

    // Load texture for the platform
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('assets/textures/platform-death.jpg');
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 1);

    // Make the bottom platform span the entire bottom of the screen with more segments for better lighting
    const geometry = new THREE.BoxGeometry(bottomPlatformWidth, bottomPlatformHeight, platformDepth, 20, 4, 4);

    // Create material with texture and lighting properties for futuristic look
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xff0000, // Red color for death zone
        emissive: 0xff0000, // Strong red glow
        emissiveIntensity: 0.3,
        roughness: 0.4,
        metalness: 0.6
    });

    const bottomPlatform = new THREE.Mesh(geometry, material);

    // Position the bottom platform at the bottom 1/10 of the screen
    bottomPlatform.position.y = bottomPlatformY;
    bottomPlatform.position.z = 0; // Same z-position as main platform

    // Add a glow effect
    const glowGeometry = new THREE.BoxGeometry(bottomPlatformWidth + 0.2, bottomPlatformHeight + 0.2, platformDepth + 0.2);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    bottomPlatform.add(glow);

    // Add edge highlight
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xff3333,
        linewidth: 1,
        transparent: true,
        opacity: 0.7
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    bottomPlatform.add(edges);

    // Add lava-like particle effect
    const particleCount = 30;
    const particles = new THREE.Group();

    for (let i = 0; i < particleCount; i++) {
        const size = 0.1 + Math.random() * 0.2;
        const particle = new THREE.Mesh(
            new THREE.SphereGeometry(size, 8, 8),
            new THREE.MeshBasicMaterial({
                color: Math.random() > 0.5 ? 0xff5500 : 0xff0000,
                transparent: true,
                opacity: 0.7
            })
        );

        // Random position along the platform
        const x = (Math.random() * bottomPlatformWidth) - (bottomPlatformWidth / 2);
        const y = (Math.random() * bottomPlatformHeight / 2) - (bottomPlatformHeight / 4);
        particle.position.set(x, y, platformDepth / 2);

        // Animation data
        particle.userData = {
            originalY: y,
            speed: 0.005 + Math.random() * 0.01,
            phase: Math.random() * Math.PI * 2
        };

        particles.add(particle);
    }

    bottomPlatform.add(particles);
    bottomPlatform.userData = {
        type: 'platform',
        isDeathPlatform: true,
        particles: particles
    };

    // Add animation update function to the platform
    bottomPlatform.updateParticles = function(time) {
        const particles = this.userData.particles.children;
        for (let i = 0; i < particles.length; i++) {
            const particle = particles[i];
            // Floating animation
            particle.position.y = particle.userData.originalY +
                Math.sin(time * particle.userData.speed + particle.userData.phase) * 0.2;

            // Pulsing opacity
            particle.material.opacity = 0.5 + Math.sin(time * 0.001 + i) * 0.3;
        }
    };

    console.log(`Created enhanced bottom platform at y=${bottomPlatformY}, width=${bottomPlatformWidth}, height=${bottomPlatformHeight}`);

    return bottomPlatform;
}

// Handle form submission
document.getElementById('name-form').addEventListener('submit', function(event) {
    event.preventDefault();

    // Get player name from input field
    playerName = document.getElementById('player-name').value.trim();

    // Validate player name (1-18 characters)
    if (playerName.length < 1 || playerName.length > 18) {
        alert('Please enter a name between 1 and 18 characters');
        return;
    }

    // Hide login screen and show game canvas and scoreboard
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('gameCanvas').style.display = 'block';
    document.getElementById('scoreboard').style.display = 'block';

    // Connect to WebSocket server
    connectToServer();
});

// Function to connect to WebSocket server
function connectToServer() {
    // Create WebSocket connection
    socket = new WebSocket(`ws://${window.location.hostname}:3000`);

    // WebSocket event handlers
    socket.onopen = () => {
        console.log('Connected to server');
        // Send player name to server
        socket.send(JSON.stringify({ type: 'setName', name: playerName }));
    };

    socket.onmessage = (event) => {
        console.log('Received message from server:', event.data);
        const data = JSON.parse(event.data);

        // Check for double jump event
        if (data.doubleJump && data.doubleJump.playerId) {
            // Show double jump text indicator
            showDoubleJumpIndicator(data.doubleJump.playerId);
        }

        if (data.type === 'init') {
            console.log('Init received with players and config:', data);
            // Store the player ID
            myPlayerId = data.playerId;
            console.log('My player ID set to:', myPlayerId, 'Type:', typeof myPlayerId);

            // Store the server-provided config
            serverConfig = data.config;
            console.log('Received server config:', serverConfig);

            // Initialize platform properties with server config
            initPlatformProperties();

            // Initialize the game scene
            initScene();

            // Update players
            updatePlayers(data.players);
        } else if (data.type === 'update') {
            console.log('Update received with players:', data.players);

            // Update player positions and visuals
            updatePlayers(data.players);

            // Update scoreboard if game state is provided
            if (data.gameState) {
                updateScoreboard(data.players, data.gameState);
            }
        } else if (data.type === 'roundEnd') {
            console.log(`Round ${data.roundNumber} ended. Pause for ${data.pauseDuration / 1000} seconds.`);
            // Update scoreboard with end of round information
            updateScoreboard(data.players, {
                roundInProgress: false,
                roundNumber: data.roundNumber,
                timeRemaining: data.pauseDuration
            });

            // Show round over message with boss information
            showRoundOverMessage(Math.floor(data.pauseDuration / 1000), data.players);
        } else if (data.type === 'countdownStart') {
            console.log(`Round countdown started. Duration: ${data.countdownDuration / 1000} seconds.`);
            // Show countdown message
            showCountdownMessage(Math.floor(data.countdownDuration / 1000));
        } else if (data.type === 'countdownUpdate') {
            // Update countdown display
            updateCountdown(Math.ceil(data.timeRemaining / 1000));
        } else if (data.type === 'roundStart') {
            console.log(`Round ${data.roundNumber} started. Duration: ${data.roundDuration / 1000} seconds.`);
            // Update scoreboard with new round information
            updateScoreboard(data.players, {
                roundInProgress: true,
                roundNumber: data.roundNumber,
                timeRemaining: data.roundDuration
            });

            // Hide round over message and countdown message
            hideRoundOverMessage();
            hideCountdownMessage();

            // Show fight message
            showFightMessage();
        } else {
            console.warn('Unknown message type:', data.type);
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
        console.log('Disconnected from server');
    };
}

// Avatar scale factor from config
function getAvatarScale() {
    return getPhysicsConfig().avatar.scale;
}

// Create a Guy avatar
function createGuyAvatar() {
    const scale = getAvatarScale();
    const guy = new Guy();

    // Scale the guy model according to config
    guy.group.scale.set(scale, scale, scale);

    return {
        isGuy: true,
        guy: guy,
        group: guy.group,
        height: guy.getHeight() * scale,
        width: guy.getWidth() * scale,
        depth: guy.getDepth() * scale
    };
}

// Keep the original geometry functions for backward compatibility
// Create a cube (enhanced square)
function createSquareGeometry() {
    const scale = getAvatarScale();
    // Use a beveled cube with more segments for better lighting
    return new THREE.BoxGeometry(1 * scale, 1 * scale, 0.5 * scale, 2, 2, 2);
}

// Create a sphere (enhanced circle)
function createCircleGeometry() {
    const scale = getAvatarScale();
    // Use a sphere instead of a flat circle for 3D effect
    return new THREE.SphereGeometry(0.5 * scale, 16, 16);
}

// Create a tetrahedron (enhanced triangle)
function createTriangleGeometry() {
    const scale = getAvatarScale();
    // Use a tetrahedron for a 3D triangular shape
    return new THREE.TetrahedronGeometry(0.6 * scale, 0);
}

// Create a torus (enhanced cross)
function createCrossGeometry() {
    const scale = getAvatarScale();
    // Create a group to hold the two toruses that form the enhanced cross
    const group = new THREE.Group();

    // Horizontal torus
    const horizontalBar = new THREE.Mesh(
        new THREE.TorusGeometry(0.3 * scale, 0.1 * scale, 8, 16),
        new THREE.MeshStandardMaterial() // Material will be set later
    );
    horizontalBar.rotation.y = Math.PI / 2; // Rotate to make it horizontal

    // Vertical torus
    const verticalBar = new THREE.Mesh(
        new THREE.TorusGeometry(0.3 * scale, 0.1 * scale, 8, 16),
        new THREE.MeshStandardMaterial() // Material will be set later
    );
    verticalBar.rotation.x = Math.PI / 2; // Rotate to make it vertical

    group.add(horizontalBar);
    group.add(verticalBar);

    return { isGroup: true, group: group };
}

// Determine which shape to use for each avatar
function getAvatarGeometry(playerId) {
    // Always return a Guy model
    return createGuyAvatar();
}

// Function to update player positions based on server data
function updatePlayers(serverPlayers) {
    console.log('Updating avatars:', serverPlayers);
    console.log('Current avatarMeshes:', Object.keys(playerMeshes));

    // Track kill counts to detect when a player scores
    const previousKills = {};
    Object.keys(playerMeshes).forEach(id => {
        if (playerLabels[id] && playerLabels[id].userData) {
            previousKills[id] = playerLabels[id].userData.kills || 0;
        }
    });

    // Create/update meshes for all avatars
    Object.keys(serverPlayers).forEach(id => {
        const avatarData = serverPlayers[id];
        console.log(`Processing avatar ${id}:`, avatarData);

        // If this is a new avatar, create a mesh
        if (!playerMeshes[id]) {
            console.log(`Creating new avatar mesh for ${id}`);

            // Get Guy avatar
            const avatarResult = getAvatarGeometry(id);

            // Set color based on player ID
            const isMyAvatar = String(id) === String(myPlayerId);
            const baseColor = isMyAvatar ? 0x00ff00 : 0xff0000;
            const emissiveColor = isMyAvatar ? 0x003300 : 0x330000;
            console.log(`Setting avatar ${id} color to: ${baseColor === 0x00ff00 ? 'green' : 'red'}`);

            // Set the color of the Guy model
            avatarResult.guy.setColor(baseColor, emissiveColor);

            // Try to fetch and apply Minecraft skin if player has a name
            if (avatarData.name) {
                console.log(`Attempting to fetch Minecraft skin for ${avatarData.name}`);
                // Fetch skin asynchronously - don't block rendering
                skinFetcher.getSkinUrl(avatarData.name).then(skinUrl => {
                    if (skinUrl) {
                        console.log(`Got skin URL for ${avatarData.name}:`, skinUrl);
                        // Apply the skin to the Guy model
                        avatarResult.guy.applyMinecraftSkin(skinUrl).then(success => {
                            if (success) {
                                console.log(`Successfully applied Minecraft skin to ${avatarData.name}`);
                            } else {
                                console.warn(`Failed to apply Minecraft skin to ${avatarData.name}`);
                            }
                        });
                    } else {
                        console.warn(`No Minecraft skin found for ${avatarData.name}`);
                    }
                }).catch(error => {
                    console.error(`Error fetching Minecraft skin for ${avatarData.name}:`, error);
                });
            }

            // Store the mesh and metadata
            playerMeshes[id] = avatarResult.group;
            playerMeshes[id].userData = {
                guy: avatarResult.guy,
                height: avatarResult.height,
                width: avatarResult.width,
                depth: avatarResult.depth,
                isGuy: true
            };

            scene.add(playerMeshes[id]);
            console.log(`Added avatar mesh to scene for ${id}`);

            // Create player name label
            const playerName = avatarData.name || `Player ${id.substring(id.length - 4)}`;
            const label = createPlayerLabel(id, playerName);
            playerLabels[id] = label;

            // Create a separate group for the player label to ensure it's always visible
            const labelGroup = new THREE.Group();
            labelGroup.add(label);
            labelGroup.userData = { isNameLabel: true };

            // Position label above avatar's head
            const headHeight = avatarResult.height;
            label.position.y = headHeight * 0.8; // Position above head for 50% size text

            // Add label group to avatar mesh so it moves with it
            playerMeshes[id].add(labelGroup);

            // Ensure the label is always visible
            label.renderOrder = 9999; // Very high renderOrder to ensure it renders on top

            // Set depthTest to false so it renders on top of everything
            label.material.depthTest = false;
            label.material.depthWrite = false;

            // Store reference to the avatar in the label's userData
            label.userData.avatarId = id;
            console.log(`Added name label for ${id}: ${playerName}`);
        }

        // Store previous position for collision detection
        const prevX = playerMeshes[id].position.x;
        const prevY = playerMeshes[id].position.y;

        // Update position
        playerMeshes[id].position.x = avatarData.x;

        // Get the avatar's height for positioning
        const avatarHeight = playerMeshes[id].userData?.height || 1.0;

        // Update avatar's y position based on server data
        // For jumping avatars, use the exact y position from the server
        // For avatars on the platform, ensure they're positioned correctly
        if (avatarData.isJumping || avatarData.y > platformTop) {
            // Avatar is jumping or falling - use the exact y position
            // Position the bottom of the avatar at the server's y position
            playerMeshes[id].position.y = avatarData.y + (avatarHeight / 2);
            console.log(`Avatar ${id} is jumping/falling at y=${playerMeshes[id].position.y}`);
        } else {
            // Avatar is on the platform - position it exactly on top
            // Position the bottom of the avatar at the top of the platform
            playerMeshes[id].position.y = platformTop + (avatarHeight / 2);
            console.log(`Avatar ${id} is on the platform at y=${playerMeshes[id].position.y}`);
        }

        // Animate the Guy model if it exists
        if (playerMeshes[id].userData?.isGuy && playerMeshes[id].userData.guy) {
            const guy = playerMeshes[id].userData.guy;

            // Determine if moving and in which direction
            const isMoving = Math.abs(avatarData.velocityX) > 0.05;
            const movingRight = avatarData.velocityX > 0;

            // Face the direction of movement
            if (isMoving) {
                playerMeshes[id].rotation.y = movingRight ? Math.PI / 2 : -Math.PI / 2;
            }

            // Apply appropriate animation
            if (avatarData.isJumping) {
                // Jumping animation
                guy.jump();
            } else if (isMoving) {
                // Walking animation - use position for continuous animation
                // Adjust animation speed based on velocity
                const speed = Math.abs(avatarData.velocityX);
                const animationSpeed = Math.min(3.125, Math.max(1.5625, speed * 2)); // Increased animation speed by another 25%
                const walkCycle = (Date.now() % 1000) / 1000;
                guy.walk(walkCycle, animationSpeed);
            } else {
                // Standing still
                guy.resetPose();

                // Subtle idle animation - slight head movement
                const headTurn = Math.sin(Date.now() / 3000) * 0.1;
                guy.moveHead(headTurn);
            }
        }

        // Z position is maintained from creation

        // We no longer need to check for collisions here as the server handles it with bouncing physics

        // Handle visibility for respawning/invulnerable players
        if (avatarData.isVisible !== undefined) {
            playerMeshes[id].visible = avatarData.isVisible;
        }

        // Check if player scored a kill and play sound
        if (playerLabels[id] && avatarData.kills !== undefined) {
            // Store current kills in label userData
            const currentKills = avatarData.kills || 0;
            const previousKills = playerLabels[id].userData.kills || 0;

            // Update stored kill count
            playerLabels[id].userData.kills = currentKills;

            // If kills increased, play score sound
            if (currentKills > previousKills) {
                console.log(`Player ${id} scored a kill! Kills: ${previousKills} -> ${currentKills}`);

                // Play score sound
                const scoreSound = document.getElementById('score-sound');
                if (scoreSound) {
                    scoreSound.currentTime = 0; // Reset sound to beginning
                    scoreSound.volume = 0.5; // Medium volume
                    scoreSound.play().catch(error => {
                        console.warn('Could not play score sound:', error);
                    });
                }
            }

            // Store death count too
            if (avatarData.deaths !== undefined) {
                playerLabels[id].userData.deaths = avatarData.deaths || 0;
            }
        }

        // Update player name if it changed
        if (avatarData.name && playerLabels[id]) {
            const currentName = playerLabels[id].userData?.name;
            if (currentName !== avatarData.name) {
                // Create new label with updated name
                const newLabel = createPlayerLabel(id, avatarData.name);

                // Find the label group
                let labelGroup = null;
                playerMeshes[id].children.forEach(child => {
                    if (child.userData && child.userData.isNameLabel) {
                        labelGroup = child;
                    }
                });

                if (labelGroup) {
                    // Copy position from old label
                    newLabel.position.copy(playerLabels[id].position);
                    // Copy existing userData and update name
                    newLabel.userData = {
                        name: avatarData.name,
                        isPlayerLabel: true,
                        kills: playerLabels[id].userData.kills || 0,
                        deaths: playerLabels[id].userData.deaths || 0
                    };

                    // Ensure the label is always visible
                    newLabel.renderOrder = 9999; // Very high renderOrder

                    // Set depthTest to false so it renders on top of everything
                    newLabel.material.depthTest = false;
                    newLabel.material.depthWrite = false;

                    // Store reference to the avatar in the label's userData
                    newLabel.userData.avatarId = id;

                    // Remove old label and add new one to the group
                    labelGroup.remove(playerLabels[id]);
                    labelGroup.add(newLabel);
                    playerLabels[id] = newLabel;
                } else {
                    // If no label group exists, create one
                    const newLabelGroup = new THREE.Group();
                    newLabelGroup.add(newLabel);
                    newLabelGroup.userData = { isNameLabel: true };

                    // Position label above avatar's head
                    const avatarHeight = playerMeshes[id].userData?.height || 1.0;
                    newLabel.position.y = avatarHeight * 0.8; // Position above head for 50% size text

                    // Ensure the label is always visible
                    newLabel.renderOrder = 9999; // Very high renderOrder

                    // Set depthTest to false so it renders on top of everything
                    newLabel.material.depthTest = false;
                    newLabel.material.depthWrite = false;

                    // Store reference to the avatar in the label's userData
                    newLabel.userData.avatarId = id;

                    // Remove old label directly from mesh if it exists
                    playerMeshes[id].remove(playerLabels[id]);

                    // Add new label group
                    playerMeshes[id].add(newLabelGroup);
                    playerLabels[id] = newLabel;
                }

                console.log(`Updated name label for ${id}: ${avatarData.name}`);

                // Try to fetch and apply Minecraft skin for the new name
                if (playerMeshes[id].userData?.isGuy && playerMeshes[id].userData.guy) {
                    console.log(`Attempting to fetch Minecraft skin for updated name ${avatarData.name}`);
                    // Fetch skin asynchronously
                    skinFetcher.getSkinUrl(avatarData.name).then(skinUrl => {
                        if (skinUrl) {
                            console.log(`Got skin URL for ${avatarData.name}:`, skinUrl);
                            // Apply the skin to the Guy model
                            playerMeshes[id].userData.guy.applyMinecraftSkin(skinUrl).then(success => {
                                if (success) {
                                    console.log(`Successfully applied Minecraft skin to ${avatarData.name}`);
                                } else {
                                    console.warn(`Failed to apply Minecraft skin to ${avatarData.name}`);
                                }
                            });
                        } else {
                            console.warn(`No Minecraft skin found for ${avatarData.name}`);
                        }
                    }).catch(error => {
                        console.error(`Error fetching Minecraft skin for ${avatarData.name}:`, error);
                    });
                }
            }
        }

        // Check if player is respawning (just fell off the platform)
        if (avatarData.isRespawning && !playerMeshes[id].userData.wasRespawning) {
            // Create explosion effect at the fall position
            createExplosionEffect(prevX, prevY);

            // Play death sound globally with a short cooldown
            const now = Date.now();
            if (now - lastDeathSoundAt >= DEATH_SOUND_COOLDOWN_MS) {
                const deathSound = document.getElementById('death-sound');
                if (deathSound) {
                    deathSound.currentTime = 0; // Reset to beginning
                    deathSound.volume = 0.65;   // Medium-high volume
                    deathSound.play().catch(err => {
                        console.warn('Could not play death sound:', err);
                    });
                }
                lastDeathSoundAt = now;
            }

            playerMeshes[id].userData.wasRespawning = true;
            console.log(`Created explosion effect for player ${id} at (${prevX}, ${prevY})`);
        } else if (!avatarData.isRespawning && playerMeshes[id].userData.wasRespawning) {
            // Reset the respawning flag when player is no longer respawning
            playerMeshes[id].userData.wasRespawning = false;
            console.log(`Player ${id} finished respawning`);
        }

        // Debug player position
        console.log(`Player ${id} position: (${avatarData.x}, ${avatarData.y}), isRespawning: ${avatarData.isRespawning}, isJumping: ${avatarData.isJumping}`);

        console.log(`Updated position for avatar ${id}: (${avatarData.x}, ${avatarData.y})`);
    });

    // Function to create explosion effect
    function createExplosionEffect(x, y) {
        console.log(`Creating explosion effect at (${x}, ${y})`);

        // Create particle system for explosion
        const particleCount = 50; // More particles
        const particles = new THREE.Group();

        // Create particles
        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 8, 8), // Larger particles
                new THREE.MeshBasicMaterial({
                    color: i % 3 === 0 ? 0xff0000 : (i % 3 === 1 ? 0xff9900 : 0xffff00), // Red, orange, yellow
                    transparent: true
                })
            );

            // Set initial position
            particle.position.set(x, y, 0);

            // Set random velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.1 + Math.random() * 0.2; // Faster particles
            particle.userData = {
                velocityX: Math.cos(angle) * speed,
                velocityY: Math.sin(angle) * speed,
                life: 60 + Math.floor(Math.random() * 30) // Longer life
            };

            particles.add(particle);
        }

        scene.add(particles);

        // Animate particles
        function animateParticles() {
            let allDead = true;

            particles.children.forEach(particle => {
                if (particle.userData.life > 0) {
                    // Update position
                    particle.position.x += particle.userData.velocityX;
                    particle.position.y += particle.userData.velocityY;

                    // Apply gravity
                    particle.userData.velocityY -= 0.003;

                    // Decrease life
                    particle.userData.life--;

                    // Fade out
                    particle.material.opacity = particle.userData.life / 60;

                    // Scale down over time
                    const scale = Math.max(0.1, particle.userData.life / 60);
                    particle.scale.set(scale, scale, scale);

                    allDead = false;
                }
            });

            // Remove particles when all are dead
            if (allDead) {
                scene.remove(particles);
                particles.children.forEach(particle => {
                    particle.geometry.dispose();
                    particle.material.dispose();
                });
                console.log('Explosion effect completed');
            } else {
                requestAnimationFrame(animateParticles);
            }
        }

        animateParticles();
    }

    // Remove disconnected avatars and their labels
    Object.keys(playerMeshes).forEach(id => {
        if (!serverPlayers[id]) {
            console.log(`Removing disconnected avatar ${id}`);

            // Clean up label resources
            if (playerLabels[id]) {
                const material = playerLabels[id].material;
                if (material && material.map) {
                    material.map.dispose();
                }
                material.dispose();
                delete playerLabels[id];
            }

            // Remove avatar from scene and delete reference
            scene.remove(playerMeshes[id]);
            delete playerMeshes[id];
        }
    });

    console.log('Avatar update complete. Active avatars:', Object.keys(playerMeshes));
}

// Function to update the scoreboard with player scores and game state
function updateScoreboard(players, gameState) {
    // Update round number and time remaining
    if (gameState) {
        // Update round number
        document.getElementById('round-number').textContent = gameState.roundNumber;

        // Format time remaining as MM:SS
        const timeRemaining = gameState.timeRemaining;
        const minutes = Math.floor(timeRemaining / 60000);
        const seconds = Math.floor((timeRemaining % 60000) / 1000);
        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        document.getElementById('time-remaining').textContent = formattedTime;
    }

    // Get the score table body
    const tableBody = document.getElementById('score-table-body');

    // Clear existing rows
    tableBody.innerHTML = '';

    // Convert players object to array for sorting
    const playerArray = Object.entries(players).map(([id, player]) => {
        // Calculate K/D ratio (avoid division by zero)
        const kd = player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : player.kills > 0 ? player.kills.toFixed(2) : '0.00';
        return {
            id,
            name: player.name || `Player ${id.substring(id.length - 4)}`,
            kills: player.kills || 0,
            deaths: player.deaths || 0,
            kd: parseFloat(kd)
        };
    });

    // Sort players by K/D ratio (highest first)
    playerArray.sort((a, b) => b.kd - a.kd);

    // Add rows for each player
    playerArray.forEach((player, index) => {
        const row = document.createElement('tr');

        // Highlight the current player's row
        if (String(player.id) === String(myPlayerId)) {
            row.classList.add('my-score');
        }

        // Add rank column (1-based)
        const rankCell = document.createElement('td');
        rankCell.textContent = index + 1;
        row.appendChild(rankCell);

        // Add name column
        const nameCell = document.createElement('td');
        nameCell.textContent = player.name;
        row.appendChild(nameCell);

        // Add kills column
        const killsCell = document.createElement('td');
        killsCell.textContent = player.kills;
        row.appendChild(killsCell);

        // Add deaths column
        const deathsCell = document.createElement('td');
        deathsCell.textContent = player.deaths;
        row.appendChild(deathsCell);

        // Add K/D ratio column
        const kdCell = document.createElement('td');
        kdCell.textContent = player.kd;
        row.appendChild(kdCell);

        // Add the row to the table
        tableBody.appendChild(row);
    });
}

// Function to show the round over message with countdown and boss message
function showRoundOverMessage(seconds, players) {
    // Get the message elements
    const messageElement = document.getElementById('round-message');
    const countdownElement = document.getElementById('countdown');
    const bossMessageElement = document.getElementById('boss-message');

    // Play round end sound
    const roundEndSound = document.getElementById('round-end-sound');
    if (roundEndSound) {
        roundEndSound.currentTime = 0; // Reset sound to beginning
        roundEndSound.volume = 0.5; // Medium volume
        roundEndSound.play().catch(error => {
            console.warn('Could not play round end sound:', error);
        });
    }

    // Set initial countdown value
    countdownElement.textContent = seconds;

    // Determine who is the boss (player with highest K/D ratio)
    let bossName = "NO BOSS";

    if (players && Object.keys(players).length > 0) {
        // Convert players object to array for sorting
        const playerArray = Object.entries(players).map(([id, player]) => {
            // Calculate K/D ratio (avoid division by zero)
            const kd = player.deaths > 0 ? (player.kills / player.deaths) : player.kills;
            return {
                id,
                name: player.name || `Player ${id.substring(id.length - 4)}`,
                kills: player.kills || 0,
                deaths: player.deaths || 0,
                kd: kd
            };
        });

        // Sort players by K/D ratio (highest first)
        playerArray.sort((a, b) => b.kd - a.kd);

        // Check if there's a tie for first place
        if (playerArray.length >= 2 && playerArray[0].kd === playerArray[1].kd) {
            bossName = "NO BOSS";
        } else if (playerArray.length > 0) {
            bossName = `${playerArray[0].name} IS BOSS`;
        }
    }

    // Update the boss message
    bossMessageElement.textContent = bossName;

    // Show the message
    messageElement.style.display = 'block';

    // Start the countdown
    let remainingSeconds = seconds;
    const countdownInterval = setInterval(() => {
        remainingSeconds--;

        if (remainingSeconds <= 0) {
            // Stop the countdown when it reaches zero
            clearInterval(countdownInterval);
        } else {
            // Update the countdown display
            countdownElement.textContent = remainingSeconds;
        }
    }, 1000);

    // Store the interval ID so we can clear it if needed
    messageElement.dataset.countdownInterval = countdownInterval;
}

// Function to hide the round over message
function hideRoundOverMessage() {
    // Get the message element
    const messageElement = document.getElementById('round-message');

    // Clear any existing countdown interval
    if (messageElement.dataset.countdownInterval) {
        clearInterval(parseInt(messageElement.dataset.countdownInterval));
        delete messageElement.dataset.countdownInterval;
    }

    // Hide the message
    messageElement.style.display = 'none';
}

// Function to show the countdown message when a round is about to start
function showCountdownMessage(seconds) {
    // Get the message elements
    const messageElement = document.getElementById('countdown-message');
    const countdownElement = document.getElementById('round-countdown');

    // Set initial countdown value
    countdownElement.textContent = seconds;

    // Show the message
    messageElement.style.display = 'block';
}

// Function to update the countdown display
function updateCountdown(seconds) {
    // Get the countdown element
    const countdownElement = document.getElementById('round-countdown');

    // Update the countdown value
    countdownElement.textContent = seconds;
}

// Function to hide the countdown message
function hideCountdownMessage() {
    // Get the message element
    const messageElement = document.getElementById('countdown-message');

    // Hide the message
    messageElement.style.display = 'none';
}

// Function to show the run indicator with trail effect (text removed)
function showRunIndicator(playerId, direction) {
    // Check if the player mesh exists
    if (!playerMeshes[playerId]) return;

    // Create trail effect only - no text
    createMovementTrail(playerId, direction);
}

// Function to create a downward trail effect for crush action
function createDownwardTrail(playerId) {
    // Check if the player mesh exists
    if (!playerMeshes[playerId]) return;

    // Get player position
    const playerMesh = playerMeshes[playerId];
    const playerPos = playerMesh.position.clone();

    // Create trail particles
    const trailCount = 15; // More particles for a more dramatic effect
    const trailGroup = new THREE.Group();
    scene.add(trailGroup);

    // Create particles
    for (let i = 0; i < trailCount; i++) {
        // Create particle geometry
        const size = 0.25 - (i * 0.015); // Slightly larger particles
        const geometry = new THREE.SphereGeometry(size, 8, 8);

        // Create material with player color but transparent
        const isLocalPlayer = playerId === myPlayerId;
        const color = isLocalPlayer ? 0x00ff00 : 0xff0000;

        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8 - (i * 0.05) // Higher starting opacity
        });

        // Create mesh
        const particle = new THREE.Mesh(geometry, material);

        // Position in a downward pattern
        const xOffset = (Math.random() - 0.5) * 1.5; // Random horizontal spread
        const yOffset = -0.3 - (i * 0.2); // Downward positioning
        particle.position.copy(playerPos).add(new THREE.Vector3(xOffset, yOffset, 0));

        // Add velocity for animation
        particle.userData = {
            velocityX: (Math.random() - 0.5) * 0.05,
            velocityY: -0.1 - (Math.random() * 0.1), // Faster downward movement
            gravity: -0.005 // Additional gravity effect
        };

        // Add to trail group
        trailGroup.add(particle);
    }

    // Animate and remove trail
    const startTime = Date.now();
    const duration = 600; // 0.6 seconds - faster than the run trail

    function animateTrail() {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
            // Fade out all particles
            const fadeRatio = elapsed / duration;

            trailGroup.children.forEach((particle, index) => {
                // Update position with velocity and gravity
                particle.position.x += particle.userData.velocityX;
                particle.position.y += particle.userData.velocityY;
                particle.userData.velocityY += particle.userData.gravity; // Apply gravity

                // Fade out
                particle.material.opacity = Math.max(0, 0.8 - (index * 0.05) - fadeRatio * 0.8);

                // Scale down over time
                const scale = Math.max(0.2, 1.0 - fadeRatio * 0.8);
                particle.scale.set(scale, scale, scale);
            });

            requestAnimationFrame(animateTrail);
        } else {
            // Remove all particles and dispose resources
            while (trailGroup.children.length > 0) {
                const particle = trailGroup.children[0];
                particle.material.dispose();
                particle.geometry.dispose();
                trailGroup.remove(particle);
            }
            scene.remove(trailGroup);
        }
    }

    // Start animation
    animateTrail();
}

// Function to create a movement trail effect
function createMovementTrail(playerId, direction) {
    // Check if the player mesh exists
    if (!playerMeshes[playerId]) return;

    // Get player position
    const playerMesh = playerMeshes[playerId];
    const playerPos = playerMesh.position.clone();

    // Create trail particles
    const trailCount = 10;
    const trailGroup = new THREE.Group();
    scene.add(trailGroup);

    // Direction vector
    const dirVector = new THREE.Vector3(
        direction === 'right' ? -1 : 1, // Trail goes opposite to movement direction
        0,
        0
    );

    // Create particles
    for (let i = 0; i < trailCount; i++) {
        // Create particle geometry
        const size = 0.2 - (i * 0.015); // Decreasing size
        const geometry = new THREE.SphereGeometry(size, 8, 8);

        // Create material with player color but transparent
        const isLocalPlayer = playerId === myPlayerId;
        const color = isLocalPlayer ? 0x00ff00 : 0xff0000;

        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.7 - (i * 0.06) // Decreasing opacity
        });

        // Create mesh
        const particle = new THREE.Mesh(geometry, material);

        // Position along the trail
        const offset = dirVector.clone().multiplyScalar(0.3 + (i * 0.15));
        particle.position.copy(playerPos).add(offset);

        // Add to trail group
        trailGroup.add(particle);
    }

    // Animate and remove trail
    const startTime = Date.now();
    const duration = 800; // 0.8 seconds

    function animateTrail() {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
            // Fade out all particles
            const fadeRatio = elapsed / duration;

            trailGroup.children.forEach((particle, index) => {
                // Fade out
                particle.material.opacity = Math.max(0, 0.7 - (index * 0.06) - fadeRatio * 0.7);

                // Spread out slightly
                const spreadFactor = fadeRatio * 0.2;
                const yOffset = (Math.sin(index + elapsed * 0.01) * spreadFactor);
                particle.position.y += yOffset * 0.01;
            });

            requestAnimationFrame(animateTrail);
        } else {
            // Remove all particles and dispose resources
            while (trailGroup.children.length > 0) {
                const particle = trailGroup.children[0];
                particle.material.dispose();
                particle.geometry.dispose();
                trailGroup.remove(particle);
            }
            scene.remove(trailGroup);
        }
    }

    // Start animation
    animateTrail();
}

// Function to show the double jump indicator
function showDoubleJumpIndicator(playerId) {
    // Check if the player mesh exists
    if (!playerMeshes[playerId]) return;

    // Create a canvas for the text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 64;

    // Set text properties - 25% larger
    context.font = 'Bold 20px "Press Start 2P", cursive'; // Increased from 16px to 20px (25% larger)
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Clear the canvas to transparent
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw text with glow effect
    context.shadowColor = '#FFFFFF';
    context.shadowBlur = 10;
    context.fillStyle = '#FFFF00'; // Yellow text

    // Draw the "JUMP!" text
    context.fillText("JUMP!", canvas.width / 2, canvas.height / 2);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);

    // Create sprite material
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 1.0
    });

    // Create sprite - 25% larger
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.875, 0.625, 1); // Increased by 25% from (1.5, 0.5, 1)

    // Position below the player's feet
    const avatarHeight = playerMeshes[playerId].userData?.height || 1.0;

    // Check if this is a Guy model (3D man avatar)
    const isGuyModel = playerMeshes[playerId].userData?.isGuyModel;

    if (isGuyModel) {
        // For Guy models, position at the bottom of the legs
        sprite.position.y = -2.0; // Position at the feet level
    } else {
        // For geometric shapes, position below the bottom edge
        sprite.position.y = -avatarHeight - 0.2; // Position below the avatar with a small gap
    }

    // Create a separate group for the jump indicator to avoid affecting the player label
    const indicatorGroup = new THREE.Group();
    indicatorGroup.add(sprite);
    indicatorGroup.userData = { isJumpIndicator: true };

    // Add the group to the player mesh
    playerMeshes[playerId].add(indicatorGroup);

    // Animate and remove after a short time
    const startTime = Date.now();
    const duration = 1000; // 1 second

    function animateJumpText() {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
            // Move upward
            sprite.position.y += 0.01;

            // Fade out
            const opacity = 1.0 - (elapsed / duration);
            material.opacity = opacity;

            requestAnimationFrame(animateJumpText);
        } else {
            // Find and remove the indicator group when animation is complete
            if (playerMeshes[playerId]) {
                // Find the indicator group
                playerMeshes[playerId].children.forEach(child => {
                    if (child.userData && child.userData.isJumpIndicator) {
                        // Remove the group from the player mesh
                        playerMeshes[playerId].remove(child);
                    }
                });
            }

            // Clean up resources
            material.dispose();
            texture.dispose();
        }
    }

    // Start animation
    animateJumpText();
}

// Function to show the fight message
function showFightMessage() {
    // Get the message element and sound
    const messageElement = document.getElementById('fight-message');
    const fightSound = document.getElementById('fight-sound');

    // Show the message
    messageElement.style.display = 'block';

    // Add the explosion animation class
    messageElement.classList.add('fight-explode');

    // Play the fight sound
    fightSound.currentTime = 0; // Reset sound to beginning
    fightSound.play().catch(error => {
        console.warn('Could not play fight sound:', error);
    });

    // Hide the message after 2 seconds
    setTimeout(() => {
        messageElement.style.display = 'none';
        messageElement.classList.remove('fight-explode');
    }, 2000);
}

// Create a background with clouds
function createBackground() {
    console.log('Creating animated background with clouds');

    // Create a group to hold all background elements
    const background = new THREE.Group();

    // Add a gradient background plane
    const bgGeometry = new THREE.PlaneGeometry(100, 60);
    const bgMaterial = new THREE.MeshBasicMaterial({
        color: 0x0a1a2a,  // Dark blue
        side: THREE.DoubleSide
    });
    const bgPlane = new THREE.Mesh(bgGeometry, bgMaterial);
    bgPlane.position.z = -15;
    background.add(bgPlane);

    // Create cloud sprites
    const textureLoader = new THREE.TextureLoader();
    const cloud1Texture = textureLoader.load('assets/images/cloud1.png');
    const cloud2Texture = textureLoader.load('assets/images/cloud2.png');

    // Create multiple clouds with different sizes and positions
    for (let i = 0; i < 15; i++) {
        const texture = i % 2 === 0 ? cloud1Texture : cloud2Texture;
        const cloudMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5 + (Math.random() * 0.3) // Increased opacity
        });

        const cloud = new THREE.Sprite(cloudMaterial);

        // Random size - larger clouds
        const scale = 8 + Math.random() * 15;
        cloud.scale.set(scale, scale * 0.6, 1);

        // Random position across the screen - wider distribution
        cloud.position.set(
            (Math.random() * 80) - 40,  // x: -40 to 40
            (Math.random() * 40) - 15,  // y: -15 to 25
            -12 + (Math.random() * 4)   // z: varying depth for parallax effect
        );

        // Animation data - faster movement
        cloud.userData = {
            speed: 0.01 + Math.random() * 0.02,
            direction: Math.random() > 0.5 ? 1 : -1,
            originalZ: cloud.position.z
        };

        background.add(cloud);
    }

    // Add some stars in the background
    for (let i = 0; i < 50; i++) {
        const starGeometry = new THREE.SphereGeometry(0.05 + Math.random() * 0.1, 8, 8);
        const starMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 1.0
        });
        const star = new THREE.Mesh(starGeometry, starMaterial);

        // Random position
        star.position.set(
            (Math.random() * 80) - 40,  // x: -40 to 40
            (Math.random() * 40) - 10,  // y: -10 to 30
            -14                         // z: behind clouds
        );

        // Animation data for twinkling
        star.userData = {
            twinkleSpeed: 0.005 + Math.random() * 0.01,
            twinklePhase: Math.random() * Math.PI * 2
        };

        background.add(star);
    }

    console.log(`Created background with ${background.children.length} elements`);

    // Add background to scene
    scene.add(background);

    return background;
}

// Global variables for animation
let clock = new THREE.Clock();
let background;
let bottomPlatform;

// Initialize background and other animated elements
function initAnimatedElements() {
    background = createBackground();

    // Get the bottom platform reference
    scene.traverse(object => {
        if (object.userData && object.userData.isDeathPlatform) {
            bottomPlatform = object;
        }
    });
}

// Function to update player labels to ensure they're visible
function updatePlayerLabels() {
    // Loop through all player labels
    Object.keys(playerLabels).forEach(id => {
        const label = playerLabels[id];
        if (label && label.material) {
            // Ensure the label is always visible
            label.material.depthTest = false;
            label.material.depthWrite = false;
            label.renderOrder = 9999;

            // Find the label group
            if (playerMeshes[id]) {
                playerMeshes[id].children.forEach(child => {
                    if (child.userData && child.userData.isNameLabel) {
                        // Ensure the group is above the avatar
                        const avatarHeight = playerMeshes[id].userData?.height || 1.0;
                        if (label.position.y < avatarHeight * 0.6 || label.position.y > avatarHeight * 1.0) {
                            label.position.y = avatarHeight * 0.8; // Maintain consistent position for 50% size
                        }
                    }
                });
            }
        }
    });
}

function animate() {
    requestAnimationFrame(animate);

    // Get elapsed time for animations
    const time = clock.getElapsedTime() * 1000; // Convert to milliseconds

    // Animate background elements
    if (background) {
        background.children.forEach(child => {
            // Skip the background plane
            if (child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry) {
                return;
            }

            // Animate clouds (sprites)
            if (child instanceof THREE.Sprite) {
                // Move cloud horizontally
                child.position.x += child.userData.speed * child.userData.direction;

                // Add slight vertical movement
                if (child.userData.originalZ) {
                    child.position.y = child.position.y + Math.sin(time * 0.0005) * 0.01;
                }

                // Wrap around when cloud goes off screen (with wider bounds)
                if (child.position.x > 45) child.position.x = -45;
                if (child.position.x < -45) child.position.x = 45;
            }

            // Animate stars (small spheres)
            if (child instanceof THREE.Mesh && child.geometry instanceof THREE.SphereGeometry) {
                // Twinkle effect
                if (child.userData.twinkleSpeed) {
                    const twinkle = Math.sin(time * child.userData.twinkleSpeed + child.userData.twinklePhase);
                    child.material.opacity = 0.5 + twinkle * 0.5;
                    child.scale.setScalar(1.0 + twinkle * 0.3);
                }
            }
        });
    }

    // Animate death platform particles
    if (bottomPlatform && bottomPlatform.updateParticles) {
        bottomPlatform.updateParticles(time);
    }

    // Update player labels to ensure they're visible
    updatePlayerLabels();

    // Render the scene
    renderer.render(scene, camera);
}

animate();

// Track which keys are currently pressed and their timing
const keysPressed = {
    ArrowLeft: false,
    ArrowRight: false
};

// Track double tap timing
const doubleTapTracking = {
    ArrowLeft: { lastTap: 0, isRunning: false },
    ArrowRight: { lastTap: 0, isRunning: false }
};

// Track crush action to prevent multiple trail effects
const crushActionTracking = {
    isActive: false,
    lastActivated: 0,
    cooldownTime: 500 // 500ms cooldown before allowing another crush effect
};

// Double tap threshold in milliseconds
const DOUBLE_TAP_THRESHOLD = 300;

// Punch action tracking variables have been removed

// Add event listeners for keyboard input
window.addEventListener('keydown', (event) => {
    if (!myPlayerId || !socket || socket.readyState !== WebSocket.OPEN) return;

    // Space key for punch action has been removed
    if (event.key === ' ' || event.key === 'Spacebar') {
        // Repurpose space key for jump
        socket.send(JSON.stringify({ type: 'jump' }));
        console.log('Sent jump command (space key)');

        // Play jump sound
        const jumpSound = document.getElementById('jump-sound');
        if (jumpSound) {
            jumpSound.currentTime = 0; // Reset to beginning
            jumpSound.volume = 0.5;    // Medium volume
            jumpSound.play().catch(err => {
                console.warn('Could not play jump sound:', err);
            });
        }
        return;
    }

    // Handle directional movement with inertia
    switch (event.key) {
        case 'ArrowUp':
            // Send jump command
            socket.send(JSON.stringify({ type: 'jump' }));
            console.log('Sent jump command');

            // Play jump sound
            const jumpSound = document.getElementById('jump-sound');
            if (jumpSound) {
                jumpSound.currentTime = 0; // Reset to beginning
                jumpSound.volume = 0.5;    // Medium volume
                jumpSound.play().catch(err => {
                    console.warn('Could not play jump sound:', err);
                });
            }
            break;
        case 'ArrowDown':
            // Send crush command
            socket.send(JSON.stringify({ type: 'crush' }));
            console.log('Sent crush command');

            // Check if crush effect is on cooldown
            const currentTime = Date.now();
            const timeSinceLastCrush = currentTime - crushActionTracking.lastActivated;

            // Only create trail effect if not already active and cooldown has passed
            if (!crushActionTracking.isActive && timeSinceLastCrush > crushActionTracking.cooldownTime) {
                // Set crush as active
                crushActionTracking.isActive = true;
                crushActionTracking.lastActivated = currentTime;

                // Create downward trail effect for the crush action
                createDownwardTrail(myPlayerId);

                // Reset crush active state after animation duration
                setTimeout(() => {
                    crushActionTracking.isActive = false;
                }, 600); // Match the duration in createDownwardTrail function
            }
            break;
        case 'ArrowLeft':
            if (!keysPressed.ArrowLeft) {
                keysPressed.ArrowLeft = true;

                // Check for double tap
                const currentTime = Date.now();
                const lastTapTime = doubleTapTracking.ArrowLeft.lastTap;
                const timeSinceLastTap = currentTime - lastTapTime;

                // Update last tap time
                doubleTapTracking.ArrowLeft.lastTap = currentTime;

                // If this is a double tap (quick successive presses)
                if (timeSinceLastTap < DOUBLE_TAP_THRESHOLD && !doubleTapTracking.ArrowLeft.isRunning) {
                    // Set running state
                    doubleTapTracking.ArrowLeft.isRunning = true;

                    // Show run indicator
                    showRunIndicator(myPlayerId, 'left');

                    console.log('Double tap detected: Running left');

                    // Send a special run command if you want to implement server-side running
                    // socket.send(JSON.stringify({ type: 'run', direction: 'left' }));
                }

                // If right key is also pressed, prioritize the most recent key press
                if (keysPressed.ArrowRight) {
                    // Send stop right command first to ensure smooth direction change
                    socket.send(JSON.stringify({ type: 'stop', direction: 'right' }));
                    console.log('Sent stop right command (left key pressed)');

                    // Reset right running state
                    doubleTapTracking.ArrowRight.isRunning = false;
                }

                // Send move left command
                socket.send(JSON.stringify({ type: 'move', direction: 'left' }));
                console.log('Sent move left command');
            }
            break;
        case 'ArrowRight':
            if (!keysPressed.ArrowRight) {
                keysPressed.ArrowRight = true;

                // Check for double tap
                const currentTime = Date.now();
                const lastTapTime = doubleTapTracking.ArrowRight.lastTap;
                const timeSinceLastTap = currentTime - lastTapTime;

                // Update last tap time
                doubleTapTracking.ArrowRight.lastTap = currentTime;

                // If this is a double tap (quick successive presses)
                if (timeSinceLastTap < DOUBLE_TAP_THRESHOLD && !doubleTapTracking.ArrowRight.isRunning) {
                    // Set running state
                    doubleTapTracking.ArrowRight.isRunning = true;

                    // Show run indicator
                    showRunIndicator(myPlayerId, 'right');

                    console.log('Double tap detected: Running right');

                    // Send a special run command if you want to implement server-side running
                    // socket.send(JSON.stringify({ type: 'run', direction: 'right' }));
                }

                // If left key is also pressed, prioritize the most recent key press
                if (keysPressed.ArrowLeft) {
                    // Send stop left command first to ensure smooth direction change
                    socket.send(JSON.stringify({ type: 'stop', direction: 'left' }));
                    console.log('Sent stop left command (right key pressed)');

                    // Reset left running state
                    doubleTapTracking.ArrowLeft.isRunning = false;
                }

                // Send move right command
                socket.send(JSON.stringify({ type: 'move', direction: 'right' }));
                console.log('Sent move right command');
            }
            break;
        default:
            return; // Don't send message for other keys
    }
});

// Add event listener for key up to handle stopping movement
window.addEventListener('keyup', (event) => {
    if (!myPlayerId || !socket || socket.readyState !== WebSocket.OPEN) return;

    // Space key release handling for punch action has been removed
    if (event.key === ' ' || event.key === 'Spacebar') {
        // No special handling needed for space key release
        return;
    }

    switch (event.key) {
        case 'ArrowDown':
            // No need to send any command on key up for crush
            // Just ensure we're not blocking future crush effects
            // The setTimeout in keydown already handles this, but this is a safety measure
            setTimeout(() => {
                crushActionTracking.isActive = false;
            }, 100);
            break;
        case 'ArrowLeft':
            keysPressed.ArrowLeft = false;
            socket.send(JSON.stringify({ type: 'stop', direction: 'left' }));
            console.log('Sent stop left command');

            // Reset running state
            doubleTapTracking.ArrowLeft.isRunning = false;

            // If right key is still pressed, reactivate right movement
            if (keysPressed.ArrowRight) {
                socket.send(JSON.stringify({ type: 'move', direction: 'right' }));
                console.log('Reactivated right movement after left key release');
            }
            break;
        case 'ArrowRight':
            keysPressed.ArrowRight = false;
            socket.send(JSON.stringify({ type: 'stop', direction: 'right' }));
            console.log('Sent stop right command');

            // Reset running state
            doubleTapTracking.ArrowRight.isRunning = false;

            // If left key is still pressed, reactivate left movement
            if (keysPressed.ArrowLeft) {
                socket.send(JSON.stringify({ type: 'move', direction: 'left' }));
                console.log('Reactivated left movement after right key release');
            }
            break;
        default:
            return; // Don't send message for other keys
    }
});

// Add event listener for window blur to reset key states
window.addEventListener('blur', () => {
    if (!myPlayerId || !socket || socket.readyState !== WebSocket.OPEN) return;

    // Reset all key states
    if (keysPressed.ArrowLeft) {
        keysPressed.ArrowLeft = false;
        socket.send(JSON.stringify({ type: 'stop', direction: 'left' }));
        console.log('Window blur: Sent stop left command');

        // Reset running state
        doubleTapTracking.ArrowLeft.isRunning = false;
    }

    if (keysPressed.ArrowRight) {
        keysPressed.ArrowRight = false;
        socket.send(JSON.stringify({ type: 'stop', direction: 'right' }));
        console.log('Window blur: Sent stop right command');

        // Reset running state
        doubleTapTracking.ArrowRight.isRunning = false;
    }

    // Punch-related code has been removed
});