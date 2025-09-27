const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch'); // For making HTTP requests to Mojang API
const config = require('./config'); // Import the config file

const app = express();
const server = http.createServer(app); // Create an HTTP server
const wss = new WebSocket.Server({ server }); // Pass the server instance to the WebSocket server

// Get physics parameters from config
const { physics } = config;
const platformWidth = physics.platform.width;
const avatarScale = physics.avatar.scale;
const avatarWidth = physics.avatar.width * avatarScale;

let players = {};
let playerCount = 0;

// Game state variables
let gameState = {
    roundInProgress: false,       // Start with round not in progress until second player joins
    roundStartTime: Date.now(),
    roundDuration: 3 * 60 * 1000, // 3 minutes in milliseconds
    pauseDuration: 10 * 1000,     // 10 seconds in milliseconds
    countdownDuration: 5 * 1000,  // 5 seconds countdown when second player joins
    countdownInProgress: false,   // Whether countdown is currently in progress
    countdownStartTime: 0,        // When the countdown started
    roundNumber: 1
};

// Track last update time for periodic updates
let lastUpdateTime = Date.now();

// Function to reset player positions for a new round
function resetPlayerPositions() {
    // Reset all players to their initial positions
    let playerIndex = 0;
    Object.keys(players).forEach(id => {
        // Calculate initial position based on player index
        const isLeftSide = playerIndex % 2 === 0;
        const sidePlayerCount = Math.floor(playerIndex / 2);
        const offsetFromEdge = sidePlayerCount * (avatarWidth * 2);

        // Calculate x position (negative for left side, positive for right side)
        const xPosition = isLeftSide
            ? -(platformWidth / 2) + offsetFromEdge + (avatarWidth / 2) // Left side with offset
            : (platformWidth / 2) - offsetFromEdge - (avatarWidth / 2);  // Right side with offset

        // Reset position and velocity
        players[id].x = xPosition;
        players[id].y = 0;
        players[id].velocityX = 0;
        players[id].velocityY = 0;
        players[id].isJumping = false;
        players[id].isRespawning = false;
        players[id].isInvulnerable = false;
        players[id].isVisible = true;
        players[id].lastCollidedWith = null;

        // Don't reset kills and deaths - they persist across rounds

        playerIndex++;
    });

    console.log('Reset all player positions for new round');
}

// Calculate initial position for a new player
function calculateInitialPosition() {
    // Count current players
    const currentPlayerCount = Object.keys(players).length;

    // Determine which side to place the player (alternate sides)
    const isLeftSide = currentPlayerCount % 2 === 0;

    // Calculate offset from the edge (2x avatar width for each player on that side)
    const sidePlayerCount = Math.floor(currentPlayerCount / 2);
    const offsetFromEdge = sidePlayerCount * (avatarWidth * 2);

    // Calculate x position (negative for left side, positive for right side)
    const xPosition = isLeftSide
        ? -(platformWidth / 2) + offsetFromEdge + (avatarWidth / 2) // Left side with offset
        : (platformWidth / 2) - offsetFromEdge - (avatarWidth / 2);  // Right side with offset

    // Y position is 0 (will be adjusted by client to stand on platform)
    // Add physics properties from config
    return {
        x: xPosition,
        y: 0,
        velocityX: 0,      // Horizontal velocity for inertia
        velocityY: 0,      // Vertical velocity for jumping
        acceleration: physics.movement.acceleration,  // Acceleration rate from config
        deceleration: physics.movement.deceleration,  // Deceleration rate from config
        maxSpeed: physics.movement.maxSpeed,          // Maximum horizontal speed from config
        minSpeed: physics.movement.minSpeed,          // Minimum horizontal speed from config
        airControl: physics.movement.airControl,      // Air control factor from config
        airDeceleration: physics.movement.airDeceleration, // Air deceleration from config
        groundControlFactor: physics.movement.groundControlFactor, // Ground control factor from config
        jumpVelocity: physics.jump.velocity,          // Initial upward velocity from config
        isJumping: false,
        movingLeft: false,  // Track if moving left
        movingRight: false,  // Track if moving right

        // Double jump properties
        canDoubleJump: false, // Whether player can currently double jump
        lastJumpTime: 0,     // Timestamp of last jump for double jump window

        // Crush action properties
        isCrushing: false,   // Whether player is currently performing crush action
        lastCrushTime: 0,    // Timestamp of last crush for cooldown

        // Punch action properties have been removed

        // Respawn properties
        isRespawning: false, // Whether player is currently respawning
        respawnTime: 0,      // Timestamp when respawn started
        isInvulnerable: false, // Whether player is currently invulnerable after respawn
        isVisible: true,     // For flashing effect during invulnerability

        // Player identification
        name: "Player",     // Default player name (will be updated by client)

        // Player score tracking
        kills: 0,           // Number of times this player pushed others off
        deaths: 0,          // Number of times this player fell off
        lastCollidedWith: null, // ID of the last player this player collided with
    };
}

wss.on('connection', (ws) => {
    const playerId = Date.now();
    console.log(`New player connected with ID: ${playerId}`);

    // Assign initial position based on player count
    players[playerId] = calculateInitialPosition();
    playerCount++;

    console.log(`Assigned initial position for player ${playerId}:`, players[playerId]);

    // Send initial state to the new player, including physics config
    ws.send(JSON.stringify({
        type: 'init',
        playerId,
        players,
        config: {
            physics: physics // Send the physics config to the client
        }
    }));
    console.log(`Sent initial state to player ${playerId} with physics config`);

    // Check if this is the second player joining
    if (Object.keys(players).length === 2 && !gameState.roundInProgress && !gameState.countdownInProgress) {
        // Start the countdown for the first round
        gameState.countdownInProgress = true;
        gameState.countdownStartTime = Date.now();
        console.log('Second player joined. Starting 5-second countdown to first round.');

        // Broadcast countdown start to all clients
        broadcast(JSON.stringify({
            type: 'countdownStart',
            countdownDuration: gameState.countdownDuration,
            players: players
        }));
    }

    ws.on('message', (message) => {
        console.log(`Received message from player ${playerId}:`, message.toString());
        try {
            const data = JSON.parse(message);
            const player = players[playerId];

            if (data.type === 'setName') {
                // Update player name
                if (data.name && typeof data.name === 'string') {
                    // Limit name to 18 characters and sanitize
                    const sanitizedName = data.name.substring(0, 18).replace(/[^\w\s]/gi, '');
                    player.name = sanitizedName || "Player";
                    console.log(`Player ${playerId} set name to: ${player.name}`);

                    // Broadcast updated player list to all clients
                    broadcast(JSON.stringify({ type: 'update', players }));
                }
            }
            else if (data.type === 'move') {
                const isOnGround = !player.isJumping && player.y <= PLATFORM_TOP;

                // Handle directional movement with acceleration
                if (data.direction === 'left') {
                        // If currently moving right, apply stronger deceleration for quicker direction change
                    if (player.velocityX > 0) {
                        // Apply stronger deceleration when changing direction
                        // Use the new directionChangeMultiplier parameter
                        const directionChangeMultiplier = physics.movement.directionChangeMultiplier || 2;
                        player.velocityX -= player.acceleration * directionChangeMultiplier;

                        // If velocity is very low after direction change, give it a boost
                        if (player.velocityX > -0.1 && player.velocityX <= 0) {
                            player.velocityX = -0.1; // Minimum velocity after direction change
                        }
                    } else {
                        // Apply the same control factor to ground and air movement
                        const controlFactor = isOnGround ?
                            (physics.movement.groundControlFactor || player.airControl) :
                            player.airControl;
                        player.velocityX -= player.acceleration * controlFactor;
                    }

                    // Minimum speed is no longer applied for consistency

                    // Limit to max speed
                    if (player.velocityX < -player.maxSpeed) {
                        player.velocityX = -player.maxSpeed;
                    }

                    player.movingLeft = true;
                    player.movingRight = false;
                }
                else if (data.direction === 'right') {
                    // If currently moving left, apply stronger deceleration for quicker direction change
                    if (player.velocityX < 0) {
                        // Apply stronger deceleration when changing direction
                        // Use the new directionChangeMultiplier parameter
                        const directionChangeMultiplier = physics.movement.directionChangeMultiplier || 2;
                        player.velocityX += player.acceleration * directionChangeMultiplier;

                        // If velocity is very low after direction change, give it a boost
                        if (player.velocityX < 0.1 && player.velocityX >= 0) {
                            player.velocityX = 0.1; // Minimum velocity after direction change
                        }
                    } else {
                        // Apply the same control factor to ground and air movement
                        const controlFactor = isOnGround ?
                            (physics.movement.groundControlFactor || player.airControl) :
                            player.airControl;
                        player.velocityX += player.acceleration * controlFactor;
                    }

                    // Minimum speed is no longer applied for consistency

                    // Limit to max speed
                    if (player.velocityX > player.maxSpeed) {
                        player.velocityX = player.maxSpeed;
                    }

                    player.movingLeft = false;
                    player.movingRight = true;
                }

                console.log(`Player ${playerId} accelerating to velocityX=${player.velocityX}`);
                broadcast(JSON.stringify({ type: 'update', players }));
            }
            else if (data.type === 'stop') {
                // Handle stop command (key up event)
                if (data.direction === 'left') {
                    player.movingLeft = false;

                    // If moving left and left key is released, apply gentle deceleration
                    // but only if the right key isn't pressed (to allow smooth direction changes)
                    if (player.velocityX < 0 && !player.movingRight) {
                        // Apply a gentler deceleration for smoother movement
                        player.velocityX *= 0.9; // Reduce velocity by only 10% for smoother deceleration
                    }
                }
                else if (data.direction === 'right') {
                    player.movingRight = false;

                    // If moving right and right key is released, apply gentle deceleration
                    // but only if the left key isn't pressed (to allow smooth direction changes)
                    if (player.velocityX > 0 && !player.movingLeft) {
                        // Apply a gentler deceleration for smoother movement
                        player.velocityX *= 0.9; // Reduce velocity by only 10% for smoother deceleration
                    }
                }

                console.log(`Player ${playerId} stopped ${data.direction} movement, velocityX=${player.velocityX}`);
                broadcast(JSON.stringify({ type: 'update', players }));
            }
            else if (data.type === 'jump') {
                const currentTime = Date.now();

                // Handle regular jump (if not already jumping)
                if (!player.isJumping) {
                    player.velocityY = player.jumpVelocity; // Use the player's jump velocity property
                    player.isJumping = true;
                    player.canDoubleJump = physics.jump.doubleJumpEnabled; // Enable double jump
                    player.lastJumpTime = currentTime; // Record jump time for double jump window
                    console.log(`Player ${playerId} jumped with velocity=${player.velocityY}`);
                    broadcast(JSON.stringify({ type: 'update', players }));
                }
                // Handle double jump if enabled (available at any height while in the air)
                else if (player.canDoubleJump && physics.jump.doubleJumpEnabled && player.isJumping) {
                    player.velocityY = physics.jump.doubleJumpVelocity; // Use double jump velocity
                    player.canDoubleJump = false; // Disable double jump until next regular jump
                    player.isDoubleJumping = true; // Flag for visual feedback
                    console.log(`Player ${playerId} performed double jump with velocity=${player.velocityY}`);
                    broadcast(JSON.stringify({
                        type: 'update',
                        players,
                        doubleJump: { playerId: playerId } // Send double jump event for visual feedback
                    }));
                }
            }
            else if (data.type === 'crush') {
                const currentTime = Date.now();

                // Only allow crushing if the player is in the air and cooldown has expired
                if (player.isJumping && currentTime - player.lastCrushTime > physics.crush.cooldown) {
                    player.isCrushing = true;
                    player.lastCrushTime = currentTime;

                    // Apply strong downward velocity
                    player.velocityY = physics.jump.terminalVelocity * physics.crush.accelerationMultiplier;

                    console.log(`Player ${playerId} performed crush action with velocity=${player.velocityY}`);
                    broadcast(JSON.stringify({ type: 'update', players }));
                }
            }
            // Punch action has been removed
            else {
                console.log(`Unknown message type from player ${playerId}:`, data.type);
            }
        } catch (error) {
            console.error(`Error processing message from player ${playerId}:`, error);
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected`);
        delete players[playerId];
        broadcast(JSON.stringify({ type: 'update', players }));
    });
});

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Physics constants from config
const GRAVITY = physics.jump.gravity; // Gravity acceleration
const TERMINAL_VELOCITY = physics.jump.terminalVelocity; // Maximum falling speed
const PLATFORM_Y = physics.platform.yPosition; // Platform's y position
const PLATFORM_HEIGHT = physics.platform.height; // Platform's height
const PLATFORM_TOP = PLATFORM_Y + (PLATFORM_HEIGHT / 2); // Top surface of platform

// Bottom platform (death zone) constants
const BOTTOM_PLATFORM_Y = PLATFORM_Y - physics.platform.bottomPlatformOffset; // Use config value
const BOTTOM_PLATFORM_HEIGHT = physics.platform.bottomPlatformHeight || PLATFORM_HEIGHT * 3;
const BOTTOM_PLATFORM_TOP = BOTTOM_PLATFORM_Y + (BOTTOM_PLATFORM_HEIGHT / 2); // Top surface of bottom platform

console.log(`Platform positions: Main platform at y=${PLATFORM_Y}, top at y=${PLATFORM_TOP}`);
console.log(`Bottom platform at y=${BOTTOM_PLATFORM_Y}, top at y=${BOTTOM_PLATFORM_TOP}`);

// Function to check if two avatars are colliding
function areAvatarsColliding(avatar1, avatar2) {
    // Define the collision radius (size of the avatar)
    const collisionRadius = avatarWidth / 2; // Half the width of an avatar

    // Calculate the distance between the two avatars
    const dx = avatar1.x - avatar2.x;
    const dy = avatar1.y - avatar2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Avatars are colliding if the distance is less than the sum of their radii
    return {
        colliding: distance < (collisionRadius * 2),
        distance: distance,
        overlap: (collisionRadius * 2) - distance,
        direction: { x: dx, y: dy }
    };
}

// Function to predict if two avatars will collide in the next frame
function predictCollision(avatar1, avatar2, timeStep = 1/60) {
    // Calculate future positions based on current velocities
    const futureAvatar1 = {
        x: avatar1.x + avatar1.velocityX * timeStep,
        y: avatar1.y + avatar1.velocityY * timeStep
    };

    const futureAvatar2 = {
        x: avatar2.x + avatar2.velocityX * timeStep,
        y: avatar2.y + avatar2.velocityY * timeStep
    };

    // Check if the avatars will be colliding at their future positions
    const collisionRadius = avatarWidth / 2;
    const dx = futureAvatar1.x - futureAvatar2.x;
    const dy = futureAvatar1.y - futureAvatar2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance < (collisionRadius * 2);
}

// Function to handle collision between two avatars
function handleAvatarCollision(avatar1, avatar2) {
    // Skip collision handling if either avatar is invulnerable
    if (avatar1.isInvulnerable || avatar2.isInvulnerable) return false;

    // Check if the avatars are colliding
    const collision = areAvatarsColliding(avatar1, avatar2);
    const willCollide = physics.collision.continuousDetection ?
                        predictCollision(avatar1, avatar2) : false;

    // Handle both current collisions and predicted collisions if continuous detection is enabled
    if (!collision.colliding && !willCollide) return false;

    // If avatars are not currently colliding but will collide in the next frame,
    // we need to adjust their velocities to prevent the collision
    const isPreventiveAction = !collision.colliding && willCollide;

    // Use current collision data if available, otherwise use predicted collision direction
    let distance, nx, ny;

    if (collision.colliding) {
        distance = collision.distance;
        nx = collision.direction.x / distance; // Normalized x direction
        ny = collision.direction.y / distance; // Normalized y direction
    } else {
        // For predicted collisions, calculate direction based on current positions and velocities
        const dx = avatar1.x - avatar2.x;
        const dy = avatar1.y - avatar2.y;
        distance = Math.sqrt(dx * dx + dy * dy);
        nx = dx / distance;
        ny = dy / distance;
    }

    // If distance is zero (avatars exactly on top of each other), use a default direction
    if (distance === 0) {
        nx = 1;
        ny = 0;
    }

    // Calculate relative velocity
    const vx = avatar1.velocityX - avatar2.velocityX;
    const vy = avatar1.velocityY - avatar2.velocityY;

    // Calculate velocity along the collision normal
    const velocityAlongNormal = vx * nx + vy * ny;

    // For actual collisions, only resolve if avatars are moving toward each other
    // For predicted collisions, always resolve to prevent them from occurring
    if (!isPreventiveAction && velocityAlongNormal > 0) return false;

    // Calculate bounce factor (coefficient of restitution)
    const bounceFactor = physics.collision.avatarBounce;

    // Calculate impulse scalar
    const impulseScalar = -(1 + bounceFactor) * velocityAlongNormal / 2;

    // Apply impulse to both avatars in opposite directions
    avatar1.velocityX += impulseScalar * nx;
    avatar1.velocityY += impulseScalar * ny;
    avatar2.velocityX -= impulseScalar * nx;
    avatar2.velocityY -= impulseScalar * ny;

    // Apply friction to perpendicular component of velocity
    const friction = physics.collision.avatarFriction;
    const tx = -ny; // Tangent x (perpendicular to normal)
    const ty = nx;  // Tangent y (perpendicular to normal)

    // Calculate velocity along the tangent
    const velocityAlongTangent = vx * tx + vy * ty;
    const tangentImpulseScalar = -velocityAlongTangent * friction / 2;

    // Apply tangential impulse
    avatar1.velocityX += tangentImpulseScalar * tx;
    avatar1.velocityY += tangentImpulseScalar * ty;
    avatar2.velocityX -= tangentImpulseScalar * tx;
    avatar2.velocityY -= tangentImpulseScalar * ty;

    // For actual collisions, separate the avatars to prevent sticking
    if (collision.colliding) {
        // Ensure minimum separation
        const minSeparation = physics.collision.minSeparation;
        const requiredSeparation = Math.max(collision.overlap, minSeparation);

        // Apply separation
        const separationFactor = 0.5; // How much to separate them
        const separationX = nx * requiredSeparation * separationFactor;
        const separationY = ny * requiredSeparation * separationFactor;

        avatar1.x += separationX;
        avatar1.y += separationY;
        avatar2.x -= separationX;
        avatar2.y -= separationY;

        // Apply additional push force when avatars are in contact
        const pushFactor = physics.collision.pushFactor;
        avatar1.velocityX += nx * pushFactor;
        avatar1.velocityY += ny * pushFactor;
        avatar2.velocityX -= nx * pushFactor;
        avatar2.velocityY -= ny * pushFactor;
    }

    console.log(`${isPreventiveAction ? 'Predicted' : 'Actual'} collision resolved between avatars with velocities: (${avatar1.velocityX.toFixed(2)}, ${avatar1.velocityY.toFixed(2)}) and (${avatar2.velocityX.toFixed(2)}, ${avatar2.velocityY.toFixed(2)})`);

    return true;
}

// Physics update loop
function updatePhysics() {
    let updated = false;

    // Update each player's physics
    Object.keys(players).forEach(id => {
        const player = players[id];
        let playerUpdated = false;

        // Apply gravity if the player is jumping or not on the platform
        if (player.isJumping || player.y > PLATFORM_TOP) {
            // Apply gravity to velocity
            player.velocityY += GRAVITY;

            // Limit falling speed to terminal velocity
            if (player.velocityY < TERMINAL_VELOCITY) {
                player.velocityY = TERMINAL_VELOCITY;
            }

            // Update position based on vertical velocity
            player.y += player.velocityY;

            // Check if player has landed on the platform
            // Only consider landing if player is within the platform's horizontal bounds
            const halfPlatformWidth = platformWidth / 2;
            const isWithinPlatform = Math.abs(player.x) <= halfPlatformWidth;

            if (player.velocityY < 0 && player.y <= PLATFORM_TOP && isWithinPlatform) {
                // Handle crush impact if player was crushing
                if (player.isCrushing) {
                    // Apply area of effect impact to nearby players
                    const crushRadius = physics.crush.areaOfEffect * avatarWidth;
                    Object.keys(players).forEach(targetId => {
                        // Skip self
                        if (targetId === id) return;

                        const target = players[targetId];

                        // Skip invulnerable players
                        if (target.isInvulnerable) return;

                        // Only affect players on the platform
                        if (target.isJumping) return;

                        // Calculate horizontal distance (only consider x-axis for platform impact)
                        const dx = target.x - player.x;
                        const distance = Math.abs(dx);

                        // If target is within crush radius, apply impact force
                        if (distance <= crushRadius) {
                            // Calculate direction vector (only horizontal)
                            const dirX = dx / distance;

                            // Apply impact force (stronger closer to impact point)
                            const impactFactor = 1 - (distance / crushRadius); // 1 at center, 0 at edge
                            const impactForce = physics.crush.impactForce * impactFactor;
                            target.velocityX += dirX * impactForce;

                            console.log(`Player ${targetId} was affected by ${id}'s crush with force ${impactForce.toFixed(2)}`);
                        }
                    });

                    player.isCrushing = false;
                    console.log(`Player ${id} landed from crush with impact`);
                }

                player.y = PLATFORM_TOP; // Snap to platform
                player.velocityY = 0;
                player.isJumping = false;
                player.canDoubleJump = false; // Reset double jump on landing

                // Apply a horizontal velocity reduction on landing for a more realistic feel
                // This simulates a loss of momentum when landing
                player.velocityX *= physics.collision.landingFriction;

                console.log(`Player ${id} landed on platform with velocityX=${player.velocityX}`);
            }

            // Check if player has reached the bottom platform (death zone)
            // Add a small buffer to ensure detection
            if (player.y <= BOTTOM_PLATFORM_TOP + 0.5 && !player.isRespawning) {
                console.log(`Player ${id} at y=${player.y}, bottom platform top at y=${BOTTOM_PLATFORM_TOP}`);
                // Trigger respawn
                player.isRespawning = true;
                player.respawnTime = Date.now();
                player.isInvulnerable = true;

                // Increment death counter
                player.deaths++;
                console.log(`Player ${id} death count increased to ${player.deaths}`);

                // Award kill to the last player who collided with this player, if any
                if (player.lastCollidedWith) {
                    const killerId = player.lastCollidedWith;
                    if (players[killerId]) {
                        players[killerId].kills++;
                        console.log(`Player ${killerId} awarded a kill. New kill count: ${players[killerId].kills}`);
                    }
                }

                // Reset last collision
                player.lastCollidedWith = null;

                // Calculate respawn position at the center of the platform with an offset
                // to prevent collision with other avatars

                // Count current active players and determine this player's index
                const activePlayers = Object.keys(players);
                const playerIndex = activePlayers.indexOf(id);

                // Calculate offset based on player index to prevent collisions
                // Each player gets positioned with an offset of 2x avatar width from center
                const offsetMultiplier = Math.floor(playerIndex / 2) + 1; // Start at 1x
                const offsetDirection = playerIndex % 2 === 0 ? 1 : -1; // Alternate left/right
                const offsetX = offsetDirection * (avatarWidth * 2 * offsetMultiplier);

                // Position at center of platform with calculated offset
                const respawnX = offsetX;

                // Calculate height 50% higher than a double jump would reach
                // First, estimate the max height a double jump would reach
                // For a double jump, we apply initial jump velocity + double jump velocity
                // and let gravity bring it down
                const initialJumpVelocity = physics.jump.velocity;
                const doubleJumpVelocity = physics.jump.doubleJumpVelocity;
                const gravity = Math.abs(physics.jump.gravity); // Use absolute value for calculation

                // Estimate max height: v²/2g for each jump component
                const initialJumpHeight = (initialJumpVelocity * initialJumpVelocity) / (2 * gravity);
                const doubleJumpHeight = (doubleJumpVelocity * doubleJumpVelocity) / (2 * gravity);
                const totalJumpHeight = initialJumpHeight + doubleJumpHeight;

                // Add more height based on config multiplier
                const respawnHeight = totalJumpHeight * physics.respawn.heightMultiplier;

                // Reset position above the platform
                player.x = respawnX;
                player.y = PLATFORM_TOP + respawnHeight;
                player.velocityX = 0;
                player.velocityY = 0;
                player.isJumping = true;

                // Punch state reset code has been removed

                console.log(`Player ${id} reached bottom platform and is respawning at x=${respawnX}, y=${player.y} (height: ${respawnHeight})`);
            }

            playerUpdated = true;
        }

        // Apply horizontal movement based on velocity
        if (player.velocityX !== 0) {
            // Update position based on horizontal velocity
            player.x += player.velocityX;
            playerUpdated = true;

            // Apply deceleration if not actively moving in that direction
            const isOnGround = !player.isJumping && player.y <= PLATFORM_TOP;

            // Use the same deceleration rate for both ground and air for consistency
            const decelerationRate = player.airDeceleration;

            if (player.velocityX > 0 && !player.movingRight) {
                // Decelerate if moving right but not pressing right key
                player.velocityX -= decelerationRate;
                if (player.velocityX < 0) player.velocityX = 0; // Prevent overshooting zero
            }
            else if (player.velocityX < 0 && !player.movingLeft) {
                // Decelerate if moving left but not pressing left key
                player.velocityX += decelerationRate;
                if (player.velocityX > 0) player.velocityX = 0; // Prevent overshooting zero
            }

            // Define the playable area (100% wider than the platform - 2x platform width)
            const playableAreaWidth = platformWidth * 2.0;
            const halfPlayableAreaWidth = playableAreaWidth / 2;

            // Check if player has moved beyond the playable area
            if (Math.abs(player.x) > halfPlayableAreaWidth) {
                // If player is at the edge of the playable area, prevent moving further
                if (player.x > halfPlayableAreaWidth) {
                    player.x = halfPlayableAreaWidth;
                    player.velocityX = 0; // Stop horizontal movement at the boundary
                } else if (player.x < -halfPlayableAreaWidth) {
                    player.x = -halfPlayableAreaWidth;
                    player.velocityX = 0; // Stop horizontal movement at the boundary
                }
                console.log(`Player ${id} reached playable area boundary at x=${player.x}`);
            }

            // Check if player has moved off the platform (but still within playable area)
            // This is a separate check from the landing detection to ensure players fall off edges
            const halfPlatformWidth = platformWidth / 2;
            if (Math.abs(player.x) > halfPlatformWidth && player.y <= PLATFORM_TOP + 1) {
                // Player is off the platform horizontally and near platform height
                // Force them to start falling if they're not already
                if (!player.isJumping || Math.abs(player.velocityY) < 0.01) {
                    player.isJumping = true;
                    // Apply a stronger downward velocity to ensure they start falling immediately
                    player.velocityY = -0.15;
                    console.log(`Player ${id} walked/pushed off platform edge at x=${player.x}, y=${player.y}`);
                }

                // If they're exactly at platform height, nudge them down slightly
                if (player.y === PLATFORM_TOP) {
                    player.y -= 0.01;
                }
            }
        }

        // Handle invulnerability and flashing effect
        if (player.isInvulnerable) {
            const currentTime = Date.now();
            const timeInInvulnerability = currentTime - player.respawnTime;

            // Check if invulnerability period is over
            if (timeInInvulnerability > physics.respawn.recoveryTime) {
                player.isInvulnerable = false;
                player.isVisible = true; // Ensure player is visible when invulnerability ends
                player.isRespawning = false; // End respawn state

                // Punch state reset code has been removed

                console.log(`Player ${id} is no longer invulnerable or respawning`);
                playerUpdated = true;
            } else {
                // Handle flashing effect during invulnerability
                const flashState = Math.floor(timeInInvulnerability / physics.respawn.flashInterval) % 2 === 0;
                if (player.isVisible !== flashState) {
                    player.isVisible = flashState;
                    playerUpdated = true;
                    console.log(`Player ${id} flashing: ${flashState}`);
                }
            }
        }

        updated = updated || playerUpdated;
    });

    // Perform multiple collision detection passes to ensure no collisions are missed
    const MAX_COLLISION_PASSES = 3; // Maximum number of collision detection passes per frame
    const playerIds = Object.keys(players);

    // Only perform multiple passes if we have more than one player
    if (playerIds.length > 1) {
        let collisionsResolved = 0;

        // Perform multiple passes of collision detection
        for (let pass = 0; pass < MAX_COLLISION_PASSES; pass++) {
            let passCollisionsResolved = 0;

            // Check for collisions between all pairs of avatars
            for (let i = 0; i < playerIds.length; i++) {
                for (let j = i + 1; j < playerIds.length; j++) {
                    const player1 = players[playerIds[i]];
                    const player2 = players[playerIds[j]];

                    // Handle collision between these two avatars
                    const collisionResolved = handleAvatarCollision(player1, player2);
                    if (collisionResolved) {
                        updated = true;
                        passCollisionsResolved++;
                        console.log(`Pass ${pass + 1}: Collision resolved between avatars ${playerIds[i]} and ${playerIds[j]}`);

                        // Track last collision for kill attribution
                        player1.lastCollidedWith = playerIds[j];
                        player2.lastCollidedWith = playerIds[i];
                        console.log(`Updated last collision: ${playerIds[i]} <-> ${playerIds[j]}`);
                    }
                }
            }

            // Keep track of total collisions resolved
            collisionsResolved += passCollisionsResolved;

            // If no collisions were resolved in this pass, no need for more passes
            if (passCollisionsResolved === 0) {
                break;
            }
        }

        if (collisionsResolved > 0) {
            console.log(`Resolved ${collisionsResolved} collisions in this frame`);
        }
    }

    // Check timers
    const currentTime = Date.now();

    // Check countdown timer if countdown is in progress
    if (gameState.countdownInProgress) {
        const countdownElapsed = currentTime - gameState.countdownStartTime;

        // If countdown is complete, start the round
        if (countdownElapsed >= gameState.countdownDuration) {
            gameState.countdownInProgress = false;
            gameState.roundInProgress = true;
            gameState.roundStartTime = currentTime;
            console.log(`Countdown complete. Round ${gameState.roundNumber} started.`);

            // Reset player positions for the round
            resetPlayerPositions();

            // Broadcast round start to clients
            broadcast(JSON.stringify({
                type: 'roundStart',
                roundNumber: gameState.roundNumber,
                roundDuration: gameState.roundDuration,
                players: players
            }));
        }
        else {
            // Update clients with countdown progress
            broadcast(JSON.stringify({
                type: 'countdownUpdate',
                timeRemaining: gameState.countdownDuration - countdownElapsed,
                players: players
            }));
        }
    }

    // Check round timer if round is in progress
    const roundElapsed = currentTime - gameState.roundStartTime;

    // If round is in progress and time is up, end the round
    if (gameState.roundInProgress && roundElapsed >= gameState.roundDuration) {
        gameState.roundInProgress = false;
        gameState.roundStartTime = currentTime; // Reset timer for pause duration
        console.log(`Round ${gameState.roundNumber} ended. Starting pause.`);

        // Broadcast round end to clients
        broadcast(JSON.stringify({
            type: 'roundEnd',
            roundNumber: gameState.roundNumber,
            pauseDuration: gameState.pauseDuration,
            players: players // Send current scores
        }));
    }
    // If round is paused and pause time is up, start a new round
    else if (!gameState.roundInProgress && roundElapsed >= gameState.pauseDuration) {
        gameState.roundInProgress = true;
        gameState.roundStartTime = currentTime; // Reset timer for round duration
        gameState.roundNumber++;
        console.log(`Round ${gameState.roundNumber} started.`);

        // Reset player positions for new round
        resetPlayerPositions();

        // Broadcast round start to clients
        broadcast(JSON.stringify({
            type: 'roundStart',
            roundNumber: gameState.roundNumber,
            roundDuration: gameState.roundDuration,
            players: players // Send current scores
        }));
    }

    // Broadcast updates if any player's physics changed
    if ((updated && Object.keys(players).length > 0) ||
        (currentTime - lastUpdateTime > 1000)) { // Force update at least every second for timer
        broadcast(JSON.stringify({
            type: 'update',
            players: players,
            gameState: {
                roundInProgress: gameState.roundInProgress,
                roundNumber: gameState.roundNumber,
                timeRemaining: gameState.roundInProgress ?
                    Math.max(0, gameState.roundDuration - roundElapsed) :
                    Math.max(0, gameState.pauseDuration - roundElapsed)
            }
        }));
        lastUpdateTime = currentTime;
    }

    // Schedule the next update
    setTimeout(updatePhysics, 1000 / 60); // 60 FPS
}

// Start the physics loop
updatePhysics();

// Add middleware to parse JSON requests
app.use(express.json());

// API endpoint to get Minecraft user ID from username
app.get('/api/minecraft/user/:username', async (req, res) => {
    try {
        const username = req.params.username;
        console.log(`Proxying request for Minecraft user ID: ${username}`);

        const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);

        if (!response.ok) {
            console.log(`Mojang API returned status ${response.status} for username ${username}`);
            return res.status(response.status).json({
                error: `Failed to get user ID for ${username}`
            });
        }

        const data = await response.json();
        console.log(`Got Minecraft user ID for ${username}: ${data.id}`);
        res.json(data);
    } catch (error) {
        console.error('Error proxying Minecraft user ID request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint to get Minecraft user profile from user ID
app.get('/api/minecraft/profile/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log(`Proxying request for Minecraft user profile: ${userId}`);

        const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${userId}`);

        if (!response.ok) {
            console.log(`Mojang API returned status ${response.status} for user ID ${userId}`);
            return res.status(response.status).json({
                error: `Failed to get user profile for ${userId}`
            });
        }

        const data = await response.json();
        console.log(`Got Minecraft user profile for ${userId}`);
        res.json(data);
    } catch (error) {
        console.error('Error proxying Minecraft user profile request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve static files from the public directory
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`Server is listening on http://${HOST}:${PORT}`);
});
