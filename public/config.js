/**
 * Client-side configuration file for game physics and parameters
 * This should match the server-side config.js
 */

// Physics parameters
const physicsConfig = {
    // Platform properties
    platform: {
        width: 10,         // Width of the main platform
        height: 0.5,       // Height/thickness of the platform
        depth: 2,          // Depth of the platform
        yPosition: -5.0,   // Positioned in the lower 1/4 of the screen
        bottomPlatformOffset: 7, // Distance from main platform to bottom platform
        bottomPlatformWidth: 30, // Width of the bottom platform (much wider than the main platform)
        bottomPlatformHeight: 0.5 // Height of the bottom platform
    },

    // Avatar properties
    avatar: {
        scale: 0.625, // 50% of previous size (1.25 * 0.5 = 0.625)
        width: 1,    // Base width before scaling
    },

    // Movement physics
    movement: {
        acceleration: 0.1171875,  // Increased by another 25% from 0.09375
        deceleration: 0.00390625, // Increased by another 25% from 0.003125
        maxSpeed: 0.6640625,      // Increased by another 25% from 0.53125
        minSpeed: 0.0,        // Kept at 0 for consistency
        airControl: 0.5,      // Kept the same
        airDeceleration: 0.00390625, // Increased by another 25% from 0.003125
        directionChangeMultiplier: 1.5, // Direction change multiplier
        groundControlFactor: 0.78125, // Increased by another 25% from 0.625 (0.625 * 1.25 = 0.78125)
    },

    // Jump physics
    jump: {
        velocity: 0.5,     // Initial upward velocity for jumps
        gravity: -0.015,    // Gravity acceleration
        terminalVelocity: -0.4, // Maximum falling speed
        doubleJumpEnabled: true, // Whether double jumping is enabled
        doubleJumpVelocity: 0.5, // Velocity for double jumps (same as the initial jump velocity)
        // No time window - double jump is available at any height while in the air
    },

    // Crush action physics
    crush: {
        enabled: true,           // Whether crush action is enabled
        accelerationMultiplier: 3.0, // Multiplier for downward acceleration
        cooldown: 2000,         // Cooldown period in milliseconds
        areaOfEffect: 2.0,      // Radius of effect in avatar widths
        impactForce: 0.3        // Force applied to nearby avatars on impact
    },

    // Punch action physics has been removed

    // Respawn physics
    respawn: {
        height: 10.0,           // Height above platform in avatar sizes (legacy, now calculated dynamically)
        recoveryTime: 5000,     // Recovery period in milliseconds
        flashInterval: 200,     // Interval for flashing effect during recovery
        heightMultiplier: 1.5   // Multiplier for height above double jump height
    },

    // Collision physics
    collision: {
        bounceFactor: 0.5,  // How much velocity is retained when bouncing off edges
        landingFriction: 0.9, // Velocity multiplier when landing from a jump
        avatarBounce: 0.35,   // Reduced by half from 0.7 - How much velocity is transferred when avatars collide
        avatarFriction: 0.8,  // Friction applied during avatar collisions
        pushFactor: 0.15,    // Pushing force (reduced by half from 0.3)
        minSeparation: 0.01, // Minimum separation distance to maintain between avatars
        continuousDetection: true // Whether to use continuous collision detection
    }
};
