const singleton = require('./Singleton'); 

class SecretHandler {
    constructor() {
        // Make window duration 2 minutes
        this.WINDOW_DURATION = 120;
        
        this.variants = [
            {
                id: 0,
                key: "plzunklandsee",
                secretFile: "secret.txt",
                fileSequence: ["Rose.gif", "bunny.mp4", "planet.mov"],
                riddle: "Hello! I have a secret for you. Only if you send me a Rose, a Lily, and a bunny. Send me through a flicker and we will watch the movie planet together."
            },
             {
                id: 1,
                key: "imcryingwhiledoingthis",
                secretFile: "secret2.txt",
                fileSequence: ["Flamingo.jpeg", "Deer.png", "Canna.gif"],
                riddle: "Hello! I have a secret for you. Only if you send me a Flamingo.jpeg, a Deer.png, and Canna.gif."
            },
            {
                id: 2,
                key: "homeworkhomework",
                secretFile: "secret3.txt",
                fileSequence: ["Deer.png", "Cardinal.jpeg", "Dog.jpeg"],
                riddle: "Hello! I have a secret for you. Only if you send me a Deer.png, Cardinal.jpeg and Dog.jpeg."
            },
        ];
    }
    
    /**
     * Get the current variant based on time window
     * Windows rotate every WINDOW_DURATION seconds
     * @returns {Object} Current variant with window information
     */
    getCurrentVariant() {
        const now = singleton.getTimestamp();
        console.log("Current time: ", now); 
        const windowIndex = Math.floor(now / this.WINDOW_DURATION);
        const variantIndex = windowIndex % this.variants.length;
        console.log("Current variant: ", variantIndex); 
        
        // Return the variant with additional window info
        return {
            ...this.variants[variantIndex],
            windowId: windowIndex,
            windowStart: windowIndex * this.WINDOW_DURATION,
            windowEnd: (windowIndex + 1) * this.WINDOW_DURATION
        };
    }
    
    /**
     * Get a specific variant by ID (useful for testing)
     * @param {number} id - Variant ID (0, 1, or 2)
     * @returns {Object} The variant
     */
    getVariantById(id) {
        return this.variants[id];
    }
    
    /**
     * Check if a session started in a given window is still valid
     * @param {number} startWindow - The window ID when session started
     * @returns {boolean} True if still in same window
     */
    isWindowValid(startWindow) {
        const now = singleton.getTimestamp();
        console.log("Current time: ", now); 
        const currentWindow = Math.floor(now / this.WINDOW_DURATION);
        return startWindow === currentWindow;
    }
    
    /**
     * Get the current window ID
     * @returns {number} Current window ID
     */
    getCurrentWindow() {
        const now = singleton.getTimestamp();
        console.log("Current time: ", now); 
        return Math.floor(now / this.WINDOW_DURATION);
    }
    
    /**
     * Split a key into 3 parts (as equal as possible)
     * @param {string} key - The full key string
     * @returns {Array} Array of 3 key parts
     */
    splitKey(key) {
        const partSize = Math.ceil(key.length / 3);
        return [
            key.substr(0, partSize),
            key.substr(partSize, partSize),
            key.substr(partSize * 2)
        ];
    }
    
    /**
     * Encode a key part into the 32-bit reserved field
     * Format: [8 bits][8 bits][8 bits][8 bits]
     *         char1   char2   partNum windowId
     * 
     * @param {string} keyPart - The key part string (1-2 chars)
     * @param {number} partNum - Part number (1, 2, or 3)
     * @param {number} windowId - The window ID
     * @returns {number} 32-bit integer for reserved field
     */
    encodeKeyPart(keyPart, partNum, windowId) {
        let reserved = 0;
        
        // Add first character (if exists) to bits 24-31
        if (keyPart.length >= 1) {
            reserved |= (keyPart.charCodeAt(0) << 24);
        }
        
        // Add second character (if exists) to bits 16-23
        if (keyPart.length >= 2) {
            reserved |= (keyPart.charCodeAt(1) << 16);
        }
        
        // Add part number (1-3) to bits 8-15
        reserved |= ((partNum & 0xFF) << 8);
        
        // Add window ID (lower 8 bits) to bits 0-7
        reserved |= (windowId & 0xFF);
        
        return reserved;
    }
    
    /**
     * Decode the reserved field (for ACK messages)
     * @param {number} reserved - 32-bit reserved field value
     * @returns {Object} Decoded information
     */
    decodeReserved(reserved) {
        return {
            char1: (reserved >> 24) & 0xFF,
            char2: (reserved >> 16) & 0xFF,
            partNum: (reserved >> 8) & 0xFF,
            windowId: reserved & 0xFF
        };
    }
    
    /**
     * Encode an error code in the reserved field
     * @param {number} errorCode - Error code (1-255)
     * @returns {number} 32-bit reserved field with error marker
     */
    encodeError(errorCode) {
        // Use 0xE0 in high byte to indicate error
        return (0xE0 << 24) | (errorCode & 0xFFFFFF);
    }
    
    /**
     * Check if reserved field contains an error
     * @param {number} reserved - 32-bit reserved field
     * @returns {boolean} True if this is an error response
     */
    isError(reserved) {
        return ((reserved >> 24) & 0xFF) === 0xE0;
    }
    
    /**
     * Get the error code from reserved field
     * @param {number} reserved - 32-bit reserved field
     * @returns {number} Error code
     */
    getErrorCode(reserved) {
        return reserved & 0xFFFFFF;
    }
    
    /**
     * Reconstruct full key from parts
     * @param {Array} keyParts - Array of 3 key parts
     * @returns {string} Full key
     */
    reconstructKey(keyParts) {
        return keyParts.join('');
    }
    
    // Maybe to be deleted
    /**
     * Validate that all required files exist
     * Call this during server startup
     * @param {Object} fs - Node.js fs module
     * @param {string} imagesPath - Path to images folder
     * @returns {Array} List of missing files
     */
    validateFiles(fs, path, imagesPath) {
        const allFiles = [];
        const missing = [];
        
        // Collect all required files
        this.variants.forEach(variant => {
            allFiles.push(variant.secretFile);
            variant.fileSequence.forEach(file => allFiles.push(file));
        });
        
        // Check each file
        allFiles.forEach(file => {
            const filePath = path.join(imagesPath, file);
            if (!fs.existsSync(filePath)) {
                missing.push(file);
            }
        });
        
        if (missing.length > 0) {
            console.warn('⚠️ Warning: Missing secret session files:');
            missing.forEach(f => console.warn(`   - ${f}`));
        } else {
            console.log('✅ All secret session files found');
        }
        
        return missing;
    }
    
    /**
     * Get a human-readable description of a variant
     * @param {number} variantId - Variant ID (0, 1, or 2)
     * @returns {string} Description
     */
    getVariantDescription(variantId) {
        const variant = this.variants[variantId];
        if (!variant) return "Unknown variant";
        
        return `Variant ${variantId}: Key="${variant.key}", Files=${variant.fileSequence.join(' → ')}`;
    }
    
    /**
     * Create a new session object for a client
     * @param {number} startWindow - Window ID when session starts
     * @param {Object} variant - The variant being used
     * @returns {Object} Session object
     */
    createSession(startWindow, variant) {
        return {
            startWindow: startWindow,
            variant: variant,
            expectedFiles: variant.fileSequence,
            nextFileIndex: 0,
            keyParts: [],
            keyPartsReceived: 0,
            awaitingAck: false,
            lastKeyPartNum: null,
            complete: false,
            ackTimeout: null
        };
    }
}

module.exports = SecretHandler;