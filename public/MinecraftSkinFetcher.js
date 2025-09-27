// MinecraftSkinFetcher.js - Module to fetch Minecraft skins from Mojang API via server proxy
export class MinecraftSkinFetcher {
    constructor() {
        // Base URLs for server proxy endpoints
        this.userIdUrl = "/api/minecraft/user/{username}";
        this.userInfoUrl = "/api/minecraft/profile/{userid}";

        // Cache for skins to avoid repeated requests
        this.skinCache = {};
    }

    /**
     * Get the skin URL for a Minecraft username
     * @param {string} username - Minecraft username
     * @returns {Promise<string>} - Promise resolving to skin URL
     */
    async getSkinUrl(username) {
        try {
            // Check cache first
            if (this.skinCache[username]) {
                console.log(`Using cached skin for ${username}`);
                return this.skinCache[username];
            }

            // Step 1: Get user ID from username using server proxy
            console.log(`Fetching Minecraft user ID for ${username} via server proxy`);
            const userIdResponse = await fetch(this.userIdUrl.replace('{username}', username));
            if (!userIdResponse.ok) {
                throw new Error(`Failed to get user ID for ${username}: ${userIdResponse.status}`);
            }

            const userData = await userIdResponse.json();
            if (!userData.id) {
                throw new Error(`Invalid user ID response for ${username}`);
            }

            const userId = userData.id;
            console.log(`Got Minecraft user ID for ${username}: ${userId}`);

            // Step 2: Get user profile info with the user ID using server proxy
            console.log(`Fetching Minecraft profile for ${userId} via server proxy`);
            const userInfoResponse = await fetch(this.userInfoUrl.replace('{userid}', userId));
            if (!userInfoResponse.ok) {
                throw new Error(`Failed to get user info for ${username}: ${userInfoResponse.status}`);
            }

            const userInfo = await userInfoResponse.json();

            // Step 3: Find and decode the textures property
            const textureProperty = userInfo.properties.find(prop => prop.name === 'textures');
            if (!textureProperty) {
                throw new Error(`No texture information found for ${username}`);
            }

            // Decode the base64 value
            const textureData = JSON.parse(atob(textureProperty.value));

            // Step 4: Extract the skin URL
            if (!textureData.textures || !textureData.textures.SKIN || !textureData.textures.SKIN.url) {
                throw new Error(`No skin URL found for ${username}`);
            }

            const skinUrl = textureData.textures.SKIN.url;
            console.log(`Got skin URL for ${username}: ${skinUrl}`);

            // Cache the result
            this.skinCache[username] = skinUrl;

            return skinUrl;
        } catch (error) {
            console.error(`Error fetching Minecraft skin for ${username}:`, error);
            // Return a default skin URL in case of error
            return null;
        }
    }
}
